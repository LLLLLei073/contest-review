import { type CFClient } from './sync.js';
import { type CoreStore, submissionSchema } from './core-store.js';
import {
  analysisCacheSchema,
  analysisProblemSchema,
  standingsSchema,
  ratingChangesSchema,
  type AnalysisReport,
} from './contest-analysis.js';
import { z } from 'zod';
import { type CFSubmission, type CFContest, type CFRating } from './domain.js';

export class AnalysisService {
  private tasks = new Map<string, AnalysisReport['task']>();
  running: Promise<void> | null = null;
  private key = '';
  reset() {
    if (this.running) throw new Error('请等待比赛分析完成');
    this.tasks.clear();
  }
  constructor(
    private store: CoreStore,
    private cf: CFClient,
    private persist: () => Promise<void> = async () => {},
  ) {}
  get(h: string, id: number): AnalysisReport {
    return {
      ...this.store.analysis(h, id),
      task: this.tasks.get(h + ':' + id) ?? { status: 'idle', message: '' },
    };
  }
  start(h: string, id: number) {
    this.store.analysis(h, id);
    const key = h + ':' + id;
    if (this.running) {
      if (this.key === key) return this.get(h, id);
      throw new Error('另一场比赛正在分析，请稍后刷新');
    }
    this.key = key;
    this.tasks.set(key, { status: 'running', message: '正在补全榜单、评级、题目难度和赛时提交' });
    this.running = this.run(h, id, key).finally(() => {
      this.running = null;
    });
    // Errors are represented in task status; no unhandled background rejection.
    return this.get(h, id);
  }
  private async run(h: string, id: number, key: string) {
    try {
      const standings = standingsSchema.parse(await this.cf.call('contest.standings', { contestId: id }));
      if (standings.contest.id !== id) throw new Error('榜单比赛编号不一致');
      const warnings: string[] = [];
      let ratings: z.infer<typeof ratingChangesSchema> = [];
      try {
        ratings = ratingChangesSchema.parse(await this.cf.call('contest.ratingChanges', { contestId: id }));
      } catch (e) {
        warnings.push('评级对照不可用：' + (e as Error).message);
      }
      if (standings.problems.some((p) => p.rating === undefined)) {
        try {
          const set = z
            .object({ problems: z.array(analysisProblemSchema) })
            .parse(await this.cf.call('problemset.problems'));
          const byIndex = new Map(set.problems.filter((p) => p.contestId === id).map((p) => [p.index, p]));
          standings.problems = standings.problems.map((p) => ({
            ...p,
            rating: p.rating ?? byIndex.get(p.index)?.rating,
          }));
        } catch (e) {
          warnings.push('题目难度补全失败：' + (e as Error).message);
        }
      }
      // Refresh the user's complete contest history to include rejudgements. No source code is fetched.
      const submissions = new Map<number, CFSubmission>();
      for (let from = 1; ; from += 900) {
        const page = z
          .array(submissionSchema)
          .parse(await this.cf.call('contest.status', { contestId: id, handle: h, from, count: 1000 }));
        for (const s of page) {
          if ((s.contestId ?? s.problem.contestId) !== id) throw new Error('提交比赛编号不一致');
          submissions.set(s.id, s);
        }
        if (page.length < 1000) break;
      }
      // Failed optional enrichment must not replace a previously richer snapshot.
      if (warnings.length && this.store.get('analysis_cache', h, String(id)))
        throw new Error(warnings.join('；') + '；已保留上次缓存');
      const cache = analysisCacheSchema.parse({
        id,
        fetchedAt: new Date().toISOString(),
        standings,
        ratings,
        warnings,
        submissionsComplete: true,
      });
      this.store.ingest(h, [...submissions.values()]);
      const old = this.store.get<CFContest & { rating?: CFRating }>('contests', h, String(id));
      this.store.put('contests', h, String(id), { ...old, ...standings.contest });
      this.store.put('analysis_cache', h, String(id), cache);
      await this.persist();
      this.tasks.set(key, {
        status: 'completed',
        message: warnings.length ? '分析完成，部分对照数据缺失' : '分析已更新',
      });
    } catch (e) {
      this.tasks.set(key, { status: 'failed', message: (e as Error).message });
    }
  }
}
