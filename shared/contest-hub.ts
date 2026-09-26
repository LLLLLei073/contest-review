import { type CoreStore } from './core-store.js';
import { type SyncService } from './sync.js';
import { type AnalysisService } from './analysis-service.js';
import {
  XcpcClient,
  batchJobSchema,
  emptyContestReview,
  xcpcAdvice,
  xcpcPlayerSchema,
  xcpcReportSchema,
  xcpcScore,
  type BatchJob,
  type XcpcHistory,
  type XcpcPlayer,
  type XcpcReport,
} from './xcpc.js';
import type { ContestReview } from './domain.js';

export class ContestHub {
  readonly xcpc: XcpcClient;
  running: Promise<void> | null = null;
  private reportRunning: Promise<void> | null = null;
  private reportKey = '';
  private reportErrors = new Map<string, string>();
  private stopping = false;
  constructor(
    private store: CoreStore,
    private sync: SyncService,
    private analysis: AnalysisService,
    private persist: () => Promise<void> = async () => {},
    xcpc?: XcpcClient,
  ) {
    this.xcpc = xcpc ?? new XcpcClient();
    for (const j of store.externalAll<BatchJob>('batch'))
      if (j.status === 'running')
        store.externalPut('batch', j.id, {
          ...j,
          status: 'interrupted',
          phase: '程序已重启，可再次一键复盘',
          finishedAt: new Date().toISOString(),
        });
  }
  isBusy() {
    return !!this.running || !!this.reportRunning;
  }
  reset() {
    if (this.isBusy()) throw new Error('请等待比赛分析完成');
    this.reportErrors.clear();
  }
  active() {
    return this.store.setting('xcpc-active');
  }
  mode(): 'official' | 'all' {
    return this.store.setting('xcpc-mode') === 'all' ? 'all' : 'official';
  }
  binding() {
    const key = this.active();
    return key ? (this.store.externalGet<XcpcPlayer>('player', key) ?? null) : null;
  }
  async search(name: string) {
    return this.xcpc.search(name);
  }
  async bind(key: string) {
    if (this.isBusy() || this.sync.running || this.analysis.running) throw new Error('请等待当前任务完成');
    const player = xcpcPlayerSchema.parse(await this.xcpc.player(key));
    if (player.key !== key) throw new Error('XCPC 选手标识不一致');
    const tiers = await this.xcpc.contestTiers().catch(() => new Map<string, string>());
    this.savePlayer(player, tiers);
    this.store.setSetting('xcpc-active', key);
    await this.persist();
    return this.binding();
  }
  setMode(mode: 'official' | 'all') {
    this.store.setSetting('xcpc-mode', mode);
  }
  private savePlayer(player: XcpcPlayer, tiers = new Map<string, string>()) {
    this.store.externalPut('player', player.key, player);
    for (const item of player.history) {
      const old = this.store.externalGet<XcpcHistory>('xcpc:' + player.key, 'history:' + item.contestId);
      this.store.externalPut('xcpc:' + player.key, 'history:' + item.contestId, {
        ...item,
        tier: tiers.get(item.contestId) ?? item.tier ?? old?.tier,
      });
    }
  }
  rows() {
    const handle = this.store.active(),
      key = this.active(),
      mode = this.mode();
    const cf = handle
      ? this.store.contests(handle).map((c) => ({ source: 'cf' as const, key: 'cf:' + c.id, ...c }))
      : [];
    const xcpc = key
      ? this.store.externalAllPrefix<XcpcHistory>('xcpc:' + key, 'history:').map((h) => ({
          source: 'xcpc' as const,
          key: 'xcpc:' + h.contestId,
          id: h.contestId,
          name: h.title,
          startTimeSeconds: Date.parse(h.startAt) / 1000,
          types: [h.official ? 'XCPC_OFFICIAL' : 'XCPC_STARRED'],
          review:
            this.store.externalGet<ContestReview>('xcpc:' + key, 'review:' + h.contestId) ??
            emptyContestReview(),
          inContestSolved: h.solved ?? null,
          analysisStatus: xcpcScore(h, mode) === null ? '无表现分' : '来源表现分',
          analysisScore: xcpcScore(h, mode),
          teamName: h.teamName,
          rank: mode === 'official' ? (h.rankOfficial ?? h.rank) : h.rank,
          teamCount: mode === 'official' ? (h.teamCountOfficial ?? h.teamCount) : h.teamCount,
          official: h.official,
          rated: h.rated,
          tier: h.tier ?? '',
        }))
      : [];
    return [...cf, ...xcpc].sort((a, b) => (b.startTimeSeconds ?? 0) - (a.startTimeSeconds ?? 0));
  }
  getReport(slug: string) {
    const key = this.active();
    if (!key) throw new Error('请先绑定 XCPC 选手');
    const history = this.store.externalGet<XcpcHistory>('xcpc:' + key, 'history:' + slug);
    if (!history) throw new Error('当前选手没有这场比赛');
    const cached = this.store.externalGet<XcpcReport>('xcpc:' + key, 'report:' + slug) ?? null;
    const report = cached
      ? {
          ...cached,
          advice: xcpcAdvice(
            history,
            this.store.externalAllPrefix<XcpcHistory>('xcpc:' + key, 'history:'),
            this.mode(),
            cached.detail,
            key,
          ),
        }
      : null;
    const taskKey = key + ':' + slug;
    return {
      history,
      report,
      mode: this.mode(),
      task: {
        status:
          this.reportRunning && this.reportKey === taskKey
            ? 'running'
            : this.reportErrors.has(taskKey)
              ? 'failed'
              : 'idle',
        message: this.reportErrors.get(taskKey) ?? '',
      },
    };
  }
  startReport(slug: string) {
    const key = this.active();
    this.getReport(slug);
    const taskKey = key + ':' + slug;
    if (this.running || this.sync.running || this.analysis.running)
      throw new Error('请等待当前同步或分析完成');
    if (this.reportRunning) {
      if (this.reportKey === taskKey) return this.getReport(slug);
      throw new Error('另一场 XCPC 比赛正在分析');
    }
    this.reportKey = taskKey;
    this.reportErrors.delete(taskKey);
    this.reportRunning = this.refreshReport(key, slug)
      .catch((e) => {
        this.reportErrors.set(taskKey, (e as Error).message);
      })
      .finally(() => {
        this.reportRunning = null;
      });
    return this.getReport(slug);
  }
  private async refreshReport(key: string, slug: string) {
    const detail = await this.xcpc.contest(slug);
    if (detail.slug !== slug) throw new Error('XCPC 比赛编号不一致');
    const team = detail.teams.find((t) => t.members.some((m) => m.key === key));
    if (!team && !detail.archiveOnly && !detail.unrated)
      throw new Error('公开比赛名单中没有该选手，已保留旧报告');
    const history = this.store.externalGet<XcpcHistory>('xcpc:' + key, 'history:' + slug);
    if (!history) throw new Error('当前选手没有这场比赛');
    const all = this.store.externalAllPrefix<XcpcHistory>('xcpc:' + key, 'history:');
    const report = xcpcReportSchema.parse({
      playerKey: key,
      contestId: slug,
      fetchedAt: new Date().toISOString(),
      source: 'xcpcrating',
      sourceUrl: `https://hei-maom.github.io/xcpcrating/#/contests/${encodeURIComponent(slug)}`,
      detail,
      advice: xcpcAdvice(history, all, this.mode(), detail, key),
    });
    this.store.externalPut('xcpc:' + key, 'report:' + slug, report);
    await this.persist();
  }
  saveReview(slug: string, review: ContestReview) {
    const key = this.active();
    this.getReport(slug);
    this.store.externalPut('xcpc:' + key, 'review:' + slug, review);
    return review;
  }
  latestJob(): BatchJob | null {
    return this.store.externalAll<BatchJob>('batch').at(-1) ?? null;
  }
  stop() {
    this.stopping = true;
    this.sync.stop();
  }
  startBatch() {
    if (this.running || this.sync.running || this.analysis.running || this.reportRunning)
      throw new Error('已有同步或分析任务正在运行');
    if (!this.store.active() && !this.active()) throw new Error('请先绑定 Codeforces 或 XCPC 选手');
    this.stopping = false;
    const job: BatchJob = {
      id: crypto.randomUUID(),
      status: 'running',
      phase: '准备同步比赛',
      processed: 0,
      total: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      startedAt: new Date().toISOString(),
    };
    this.store.externalPut('batch', job.id, job);
    this.running = this.runBatch(job).finally(() => {
      this.running = null;
    });
    void this.running.catch(() => {});
    return job;
  }
  private async runBatch(job: BatchJob) {
    const save = async () => {
      this.store.externalPut('batch', job.id, batchJobSchema.parse(job));
      await this.persist();
    };
    const check = () => {
      if (this.stopping) throw new Error('用户已中断');
    };
    try {
      const handle = this.store.active(),
        key = this.active();
      if (handle) {
        job.phase = '同步 Codeforces 提交';
        await save();
        check();
        const old = this.store.latestJob(handle);
        this.sync.start(handle, 'incremental', !!old && ['failed', 'interrupted'].includes(old.status));
        await this.sync.running;
        const result = this.store.latestJob(handle);
        if (result?.status !== 'completed') {
          job.failed++;
          job.errors.push('Codeforces 同步：' + (result?.message ?? '未知错误'));
        }
      }
      if (key) {
        job.phase = '同步 XCPC 比赛';
        await save();
        check();
        try {
          const player = await this.xcpc.player(key);
          const tiers = await this.xcpc.contestTiers().catch(() => new Map<string, string>());
          this.savePlayer(player, tiers);
          await save();
        } catch (e) {
          job.failed++;
          job.errors.push('XCPC 同步：' + (e as Error).message);
        }
      }
      const cfPending = handle
        ? this.store
            .contests(handle)
            .filter(
              (c) =>
                c.types.some((t) => ['CONTESTANT', 'VIRTUAL', 'OUT_OF_COMPETITION'].includes(t)) &&
                !this.store.get('analysis_cache', handle, String(c.id)),
            )
        : [];
      const xcpcPending = key
        ? this.store
            .externalAllPrefix<XcpcHistory>('xcpc:' + key, 'history:')
            .filter((h) => !this.store.externalGet('xcpc:' + key, 'report:' + h.contestId))
        : [];
      job.total = cfPending.length + xcpcPending.length;
      await save();
      for (const contest of cfPending) {
        check();
        job.phase = `分析 Codeforces #${contest.id}`;
        await save();
        this.analysis.start(handle, contest.id);
        await this.analysis.running;
        const result = this.analysis.get(handle, contest.id);
        job.processed++;
        if (result.task.status === 'completed') job.succeeded++;
        else {
          job.failed++;
          job.errors.push(`CF #${contest.id}：${result.task.message}`);
        }
        await save();
      }
      for (const contest of xcpcPending) {
        check();
        job.phase = `分析 XCPC ${contest.title}`;
        await save();
        try {
          await this.refreshReport(key, contest.contestId);
          job.succeeded++;
        } catch (e) {
          job.failed++;
          job.errors.push(`${contest.title}：${(e as Error).message}`);
        }
        job.processed++;
        await save();
      }
      job.status = job.failed ? 'failed' : 'completed';
      job.phase = job.failed ? '部分比赛未完成，可再次一键复盘' : '全部待复盘比赛已处理';
    } catch (e) {
      job.status = 'interrupted';
      job.phase = (e as Error).message;
    }
    job.finishedAt = new Date().toISOString();
    await save();
  }
}
