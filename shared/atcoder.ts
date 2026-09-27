import { z } from 'zod';
import type { CoreStore } from './core-store.js';
import type { CFSubmission, ContestReview, Problem, SyncJob } from './domain.js';

export const atcoderHandleSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_]+$/);
export const atcoderSubmissionSchema = z.object({
  id: z.number().int().positive(),
  epoch_second: z.number().int().nonnegative(),
  problem_id: z.string().min(1),
  contest_id: z.string().min(1),
  user_id: z.string(),
  language: z.string(),
  result: z.string(),
  point: z.number().optional(),
});
export type AtcoderSubmission = z.infer<typeof atcoderSubmissionSchema>;
export const atcoderProblemSchema = z.object({
  id: z.string(),
  contest_id: z.string(),
  problem_index: z.string(),
  name: z.string(),
  title: z.string().optional(),
});
export const atcoderContestSchema = z.object({
  id: z.string(),
  start_epoch_second: z.number(),
  duration_second: z.number(),
  title: z.string(),
  rate_change: z.string().optional(),
});
export type AtcoderContest = z.infer<typeof atcoderContestSchema>;
export const atcoderReportSchema = z.object({
  contestId: z.string(),
  fetchedAt: z.string().datetime(),
  source: z.literal('atcoder-problems'),
  complete: z.boolean().default(false),
  inContest: z.array(
    z.object({
      id: z.number(),
      problemKey: z.string(),
      time: z.number(),
      verdict: z.string(),
      url: z.string(),
    }),
  ),
  afterContest: z.array(
    z.object({
      id: z.number(),
      problemKey: z.string(),
      time: z.number(),
      verdict: z.string(),
      url: z.string(),
    }),
  ),
  solved: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  firstAcMinutes: z.number().nullable(),
  advice: z.array(z.object({ evidence: z.string(), action: z.string() })),
});
export type AtcoderReport = z.infer<typeof atcoderReportSchema>;
export const atcoderFailure = new Set(['WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE']);
export function atcoderProfile(handle: string) {
  return 'ac~' + atcoderHandleSchema.parse(handle).toLowerCase();
}
export function atcoderKey(problemId: string) {
  return 'atcoder:' + problemId;
}
export function atcoderNamespace(handle: string) {
  return 'atcoder:' + atcoderHandleSchema.parse(handle).toLowerCase();
}
export function normalizeAtcoder(
  s: AtcoderSubmission,
  problem?: z.infer<typeof atcoderProblemSchema>,
  difficulty?: number,
): CFSubmission {
  return {
    id: s.id,
    source: 'atcoder',
    contestKey: s.contest_id,
    creationTimeSeconds: s.epoch_second,
    problem: {
      problemsetName: 'atcoder',
      index: s.problem_id,
      name: problem?.name || s.problem_id,
      rating:
        difficulty !== undefined && Number.isFinite(difficulty) && difficulty >= 0
          ? Math.round(difficulty)
          : undefined,
      tags: [],
    },
    verdict:
      s.result === 'AC'
        ? 'OK'
        : (
            {
              WA: 'WRONG_ANSWER',
              TLE: 'TIME_LIMIT_EXCEEDED',
              MLE: 'MEMORY_LIMIT_EXCEEDED',
              RE: 'RUNTIME_ERROR',
              CE: 'COMPILATION_ERROR',
              OLE: 'OUTPUT_LIMIT_EXCEEDED',
            } as Record<string, string>
          )[s.result] || s.result,
    programmingLanguage: s.language,
    author: { participantType: 'PRACTICE' },
  };
}

export interface AtcoderClientLike {
  submissions(handle: string, from: number): Promise<AtcoderSubmission[]>;
  resources<T>(name: 'problems' | 'contests' | 'problem-models'): Promise<T>;
  cancel(): void;
}
export class AtcoderClient implements AtcoderClientLike {
  private tail: Promise<unknown> = Promise.resolve();
  private last = 0;
  private controller = new AbortController();
  constructor(
    private fetcher: typeof fetch = fetch,
    private interval = 1200,
  ) {}
  cancel() {
    this.controller.abort();
    this.controller = new AbortController();
  }
  private request<T>(url: string): Promise<T> {
    const signal = this.controller.signal;
    const next = this.tail.then(async () => {
      let error: unknown;
      for (let i = 0; i < 3; i++) {
        signal.throwIfAborted();
        const wait = Math.max(0, this.last + this.interval - Date.now());
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        this.last = Date.now();
        try {
          const response = await this.fetcher(url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return (await response.json()) as T;
        } catch (e) {
          error = e;
          if (i < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i));
        }
      }
      throw new Error('AtCoder Problems 暂不可用：' + String(error));
    });
    this.tail = next.catch(() => {});
    return next;
  }
  submissions(handle: string, from: number) {
    return this.request<AtcoderSubmission[]>(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(handle)}&from_second=${Math.max(0, from)}`,
    );
  }
  resources<T>(name: 'problems' | 'contests' | 'problem-models') {
    return this.request<T>(`https://kenkoooo.com/atcoder/resources/${name}.json`);
  }
}

export class AtcoderService {
  running: Promise<void> | null = null;
  private stopping = false;
  constructor(
    private store: CoreStore,
    readonly client: AtcoderClientLike = new AtcoderClient(),
    private persist: () => Promise<void> = async () => {},
  ) {}
  stop() {
    this.stopping = true;
    this.client.cancel();
  }
  async refresh(contestId: string) {
    const handle = this.store.activeAtcoder();
    if (!handle) throw new Error('请先绑定 AtCoder');
    if (this.running) throw new Error('AtCoder 同步正在进行');
    this.start(handle, 'incremental');
    await this.running;
    const job = this.store.latestJob(atcoderProfile(handle));
    if (job?.status !== 'completed') throw new Error(job?.message ?? '同步失败');
    return this.report(contestId);
  }
  start(handle: string, mode: 'full' | 'incremental' = 'incremental', resume = false): SyncJob {
    if (this.running) throw new Error('AtCoder 同步正在进行');
    const h = atcoderHandleSchema.parse(handle),
      profile = atcoderProfile(h),
      old = this.store.latestJob(profile);
    this.stopping = false;
    const continued = resume && old && ['failed', 'interrupted'].includes(old.status);
    const fullReady = this.store
      .all<SyncJob>('jobs', profile)
      .some((j) => j.mode === 'full' && j.status === 'completed');
    const job: SyncJob = continued
      ? { ...old, status: 'running', finishedAt: undefined }
      : {
          id: crypto.randomUUID(),
          handle: h,
          mode: fullReady ? mode : 'full',
          status: 'running',
          processed: 0,
          cursor:
            fullReady && mode === 'incremental'
              ? Math.max(
                  1,
                  this.store
                    .all<CFSubmission>('submissions', profile)
                    .reduce((n, s) => Math.max(n, s.creationTimeSeconds), 1) - 86400,
                )
              : 1,
          message: '准备读取 AtCoder 提交',
          startedAt: new Date().toISOString(),
        };
    this.store.put('jobs', profile, job.id, job);
    this.running = this.run(profile, job).finally(() => {
      this.running = null;
    });
    void this.running.catch(() => {});
    return job;
  }
  private async run(profile: string, job: SyncJob) {
    const save = async () => {
      this.store.put('jobs', profile, job.id, job);
      await this.persist();
    };
    try {
      let cursor = job.cursor;
      while (true) {
        if (this.stopping) throw new Error('同步已中断');
        const batch = z
          .array(atcoderSubmissionSchema)
          .parse(await this.client.submissions(job.handle, cursor - 1));
        const previous = cursor;
        this.store.ingestAtcoder(profile, batch);
        job.processed += batch.length;
        const max = batch.reduce((n, s) => Math.max(n, s.epoch_second), cursor - 1);
        if (batch.length === 500 && max === batch[0].epoch_second)
          throw new Error('同一秒的提交达到接口分页上限，无法确认完整性');
        if (max >= cursor) cursor = max + 1;
        job.cursor = cursor;
        job.message = `已读取 ${job.processed} 条提交`;
        await save();
        if (batch.length < 500) break;
        if (cursor === previous) throw new Error('同一秒的提交达到接口分页上限，无法确认历史完整性');
      }
      const meta = this.store.externalGet<{
        fetchedAt: string;
        problems: z.infer<typeof atcoderProblemSchema>[];
        contests: AtcoderContest[];
        models: Record<string, { difficulty?: number }>;
      }>('atcoder-meta', 'catalog');
      if (!meta || Date.now() - Date.parse(meta.fetchedAt) > 86400000) {
        try {
          const [problems, contests, models] = await Promise.all([
            this.client.resources<z.infer<typeof atcoderProblemSchema>[]>('problems'),
            this.client.resources<AtcoderContest[]>('contests'),
            this.client.resources<Record<string, { difficulty?: number }>>('problem-models'),
          ]);
          this.store.externalPut('atcoder-meta', 'catalog', {
            fetchedAt: new Date().toISOString(),
            problems: z.array(atcoderProblemSchema).parse(problems),
            contests: z.array(atcoderContestSchema).parse(contests),
            models,
          });
        } catch (error) {
          job.message += '；题目目录暂不可用，已保留提交';
        }
      }
      this.store.enrichAtcoder(profile);
      this.store.markRecentChecked(profile);
      job.status = 'completed';
      job.finishedAt = new Date().toISOString();
      await save();
    } catch (error) {
      job.status = this.stopping ? 'interrupted' : 'failed';
      job.message = (error as Error).message;
      job.finishedAt = new Date().toISOString();
      await save();
    }
  }
  report(contestId: string) {
    const handle = this.store.activeAtcoder();
    if (!handle) throw new Error('请先绑定 AtCoder 用户名');
    const profile = atcoderProfile(handle);
    const meta = this.store.externalGet<{ contests: AtcoderContest[] }>('atcoder-meta', 'catalog');
    const contest = meta?.contests.find((c) => c.id === contestId);
    const cached = this.store.externalGet<AtcoderReport>(atcoderNamespace(handle), 'report:' + contestId);
    if (!contest) {
      if (cached) return cached;
      throw new Error('比赛信息暂不可用');
    }
    const latest = this.store.latestJob(profile);
    if (
      cached &&
      (latest?.status !== 'completed' ||
        !latest?.finishedAt ||
        Date.parse(cached.fetchedAt) >= Date.parse(latest.finishedAt))
    )
      return cached;
    const submissions = this.store
      .all<CFSubmission>('submissions', profile)
      .filter((s) => s.contestKey === contestId);
    const validWindow =
      contest.start_epoch_second > 0 && contest.duration_second > 0 && contest.duration_second <= 7 * 86400;
    const start = contest.start_epoch_second,
      end = start + contest.duration_second;
    const map = (s: CFSubmission) => ({
      id: s.id,
      problemKey: atcoderKey(s.problem.index),
      time: s.creationTimeSeconds,
      verdict: s.verdict || 'UNKNOWN',
      url: `https://atcoder.jp/contests/${contestId}/submissions/${s.id}`,
    });
    const inContest = submissions
      .filter((s) => validWindow && s.creationTimeSeconds >= start && s.creationTimeSeconds < end)
      .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds)
      .map(map);
    const afterContest = submissions
      .filter((s) => !validWindow || s.creationTimeSeconds >= end)
      .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds)
      .map(map);
    const solved = new Set(inContest.filter((s) => s.verdict === 'OK').map((s) => s.problemKey));
    const failures = inContest.filter((s) =>
      [
        'WRONG_ANSWER',
        'TIME_LIMIT_EXCEEDED',
        'MEMORY_LIMIT_EXCEEDED',
        'RUNTIME_ERROR',
        'COMPILATION_ERROR',
        'OUTPUT_LIMIT_EXCEEDED',
      ].includes(s.verdict),
    ).length;
    const ac = inContest.find((s) => s.verdict === 'OK');
    const advice: AtcoderReport['advice'] = [];
    const failed = [
      'WRONG_ANSWER',
      'TIME_LIMIT_EXCEEDED',
      'MEMORY_LIMIT_EXCEEDED',
      'RUNTIME_ERROR',
      'COMPILATION_ERROR',
      'OUTPUT_LIMIT_EXCEEDED',
    ];
    const byProblem = new Map<string, typeof inContest>();
    for (const item of inContest)
      byProblem.set(item.problemKey, [...(byProblem.get(item.problemKey) ?? []), item]);
    for (const [key, items] of byProblem)
      if (items.filter((s) => failed.includes(s.verdict)).length >= 3)
        advice.push({
          evidence: `${key.slice(8)} 赛时至少 3 次失败提交`,
          action: '再次提交前先整理反例并检查边界。',
        });
    if (inContest.filter((s) => ['COMPILATION_ERROR', 'RUNTIME_ERROR'].includes(s.verdict)).length >= 2)
      advice.push({ evidence: '赛时至少两次编译或运行错误', action: '提交前检查编译、初始化和越界。' });
    if (
      inContest.filter((s) => ['TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED'].includes(s.verdict)).length >=
      2
    )
      advice.push({ evidence: '赛时至少两次超时或超内存', action: '编码前核算复杂度与资源上限。' });
    for (const [key, items] of byProblem) {
      const f = items.filter((s) => failed.includes(s.verdict));
      if (f.length > 1 && f.at(-1)!.time - f[0].time >= contest.duration_second * 0.2)
        advice.push({
          evidence: `${key.slice(8)} 连续失败提交跨度 ${Math.round((f.at(-1)!.time - f[0].time) / 60)} 分钟`,
          action: '为同题设置切题检查点，避免重复试错。',
        });
    }
    if (!advice.length && solved.size)
      advice.push({
        evidence: `赛时通过 ${solved.size} 题`,
        action: '整理有效解法，并保留下一场的时间分配记录。',
      });
    const complete = this.store
      .all<SyncJob>('jobs', profile)
      .some((j) => j.mode === 'full' && j.status === 'completed');
    const report = atcoderReportSchema.parse({
      contestId,
      fetchedAt: new Date().toISOString(),
      source: 'atcoder-problems',
      complete,
      inContest,
      afterContest,
      solved: solved.size,
      failures,
      firstAcMinutes: ac ? Math.round((ac.time - start) / 60) : null,
      advice: advice.slice(0, 5),
    });
    this.store.externalPut(atcoderNamespace(handle), 'report:' + contestId, report);
    return report;
  }
  contests() {
    const handle = this.store.activeAtcoder();
    if (!handle) return [];
    const meta = this.store.externalGet<{ contests: AtcoderContest[] }>('atcoder-meta', 'catalog');
    const byId = new Map(meta?.contests.map((c) => [c.id, c]) ?? []);
    const submissions = this.store.all<CFSubmission>('submissions', atcoderProfile(handle));
    const ids = new Set(submissions.map((s) => s.contestKey).filter((s): s is string => !!s));
    return [...ids]
      .map((id) => {
        const c = byId.get(id),
          start = c?.start_epoch_second ?? 0,
          end = start + (c?.duration_second ?? 0);
        const validWindow = start > 0 && !!c?.duration_second && c.duration_second <= 7 * 86400;
        const live = submissions.filter(
          (s) =>
            s.contestKey === id &&
            validWindow &&
            s.creationTimeSeconds >= start &&
            s.creationTimeSeconds < end,
        );
        const solved = new Set(live.filter((s) => s.verdict === 'OK').map((s) => s.problem.index));
        return {
          source: 'atcoder' as const,
          key: 'atcoder:' + id,
          id,
          name: c?.title ?? id,
          startTimeSeconds: start || undefined,
          types: live.length ? ['ATCODER_WINDOW'] : ['PRACTICE'],
          inContestSolved: live.length ? solved.size : null,
          analysisStatus: live.length ? '赛时提交记录' : '仅练习',
          analysisScore: null,
          performanceRating: null,
          review: this.store.externalGet<ContestReview>(atcoderNamespace(handle), 'review:' + id) ?? {
            timeAllocation: '',
            mistakes: '',
            improvements: '',
          },
        };
      })
      .sort((a, b) => (b.startTimeSeconds ?? 0) - (a.startTimeSeconds ?? 0));
  }
}
