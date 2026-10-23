import { z } from 'zod';
import type { CoreStore } from './core-store.js';
import type { CFSubmission, SyncJob } from './domain.js';

// 洛谷没有官方开放 API，这里使用站点的 _contentOnly JSON 接口（社区文档
// https://0f-0b.github.io/luogu-api-docs）。该接口仅返回较近一段提交记录，
// 且不允许浏览器跨域访问：纯浏览器模式（GitHub Pages）无法同步洛谷，只有
// 本地服务器模式可用。历史深度与接口形态都可能变化，失败时要给出可读错误。
export const luoguUidSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}$/);
export type LuoguUser = {
  uid: number;
  name: string;
  passedProblemCount: number;
  submittedProblemCount: number;
};
export const luoguRecordSchema = z.object({
  id: z.number().int().positive(),
  uid: z.number().optional(),
  time: z.number(),
  status: z.number(),
  language: z.string().default(''),
  score: z.number().nullable().optional(),
  problem: z.object({
    pid: z.string().min(1).max(30),
    title: z.string().min(1).max(300),
    difficulty: z.number().optional(),
  }),
  contest: z.object({ cid: z.number(), name: z.string() }).nullable().optional(),
});
export type LuoguRecord = z.infer<typeof luoguRecordSchema>;
export const luoguRecordListSchema = z.object({
  count: z.number().optional(),
  perPage: z.number().optional(),
  result: z.array(luoguRecordSchema).default([]),
});
export const luoguUserSnapshotSchema = z.object({
  uid: z.string(),
  name: z.string(),
  passedProblemCount: z.number().int().nonnegative(),
  submittedProblemCount: z.number().int().nonnegative(),
  rating: z.number().nullable(),
  fetchedAt: z.string().datetime(),
});
export type LuoguUserSnapshot = z.infer<typeof luoguUserSnapshotSchema>;
export const LUOGU_MAX_PAGES_PER_RUN = 500;

export const luoguStatusVerdict = new Map<number, string>([
  [0, 'TESTING'],
  [1, 'TESTING'],
  [2, 'COMPILATION_ERROR'],
  [3, 'OUTPUT_LIMIT_EXCEEDED'],
  [4, 'MEMORY_LIMIT_EXCEEDED'],
  [5, 'TIME_LIMIT_EXCEEDED'],
  [6, 'WRONG_ANSWER'],
  [7, 'RUNTIME_ERROR'],
  [12, 'OK'],
]);
export function luoguVerdict(status: number) {
  return luoguStatusVerdict.get(status) ?? 'PARTIAL';
}
// 洛谷难度为 7 档枚举，这里映射为量级相近的 CF rating 估算值，
// 仅用于难度分布展示，不参与掌握度计算。
export const luoguDifficultyRating: Record<number, number> = {
  1: 800,
  2: 1000,
  3: 1200,
  4: 1500,
  5: 1900,
  6: 2300,
  7: 2700,
};
export function luoguRating(difficulty?: number) {
  if (typeof difficulty !== 'number') return undefined;
  const rating = luoguDifficultyRating[difficulty];
  return rating ?? undefined;
}
export function luoguDifficultyLabel(difficulty?: number) {
  return (
    {
      0: '暂无评定',
      1: '入门',
      2: '普及−',
      3: '普及/提高−',
      4: '普及+/提高',
      5: '提高+/省选−',
      6: '省选/NOI−',
      7: 'NOI/NOI+',
    } as Record<number, string>
  )[difficulty ?? -1];
}
export function luoguProfile(uid: string) {
  return 'lg~' + luoguUidSchema.parse(uid);
}
export function luoguKey(pid: string) {
  return 'luogu:' + pid;
}
export function luoguNamespace(uid: string) {
  return 'luogu:' + luoguUidSchema.parse(uid);
}
export function normalizeLuogu(record: LuoguRecord): CFSubmission {
  // 部分接口版本把时间戳写成毫秒，这里统一为秒。
  const seconds = record.time > 1e12 ? Math.round(record.time / 1000) : record.time;
  return {
    id: record.id,
    source: 'luogu',
    contestKey: record.contest ? String(record.contest.cid) : undefined,
    creationTimeSeconds: seconds,
    problem: {
      problemsetName: 'luogu',
      index: record.problem.pid,
      name: record.problem.title,
      rating: luoguRating(record.problem.difficulty),
      tags: [],
    },
    verdict: luoguVerdict(record.status),
    programmingLanguage: record.language || 'luogu',
    author: { participantType: 'PRACTICE' },
  };
}

export interface LuoguPage {
  count?: number;
  perPage?: number;
  result: LuoguRecord[];
}
export interface LuoguClientLike {
  user(uid: string): Promise<LuoguUser>;
  records(uid: string, page: number): Promise<LuoguPage>;
  cancel(): void;
}
interface LuoguEnvelope {
  code?: number;
  errorMessage?: string;
  currentData?: unknown;
}
export class LuoguClient implements LuoguClientLike {
  private tail: Promise<unknown> = Promise.resolve();
  private last = 0;
  private controller = new AbortController();
  constructor(
    private fetcher: typeof fetch = fetch,
    private interval = 2000,
    private base = 'https://www.luogu.com.cn',
  ) {}
  cancel() {
    this.controller.abort();
    this.controller = new AbortController();
  }
  private async request<T>(path: string, parse: (data: unknown) => T, retries = 3): Promise<T> {
    const signal = this.controller.signal;
    const next = this.tail.then(async () => {
      let error: unknown;
      for (let i = 0; i < retries; i++) {
        signal.throwIfAborted();
        const wait = Math.max(0, this.last + this.interval - Date.now());
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        this.last = Date.now();
        try {
          const response = await this.fetcher(`${this.base}${path}&_contentOnly=1`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
            headers: {
              Accept: 'application/json',
              'x-luogu-type': 'content-only',
              'User-Agent': 'contest-review/1.0',
            },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const envelope = (await response.json()) as LuoguEnvelope;
          if (envelope.code !== 200)
            throw new Error(envelope.errorMessage || `洛谷接口返回 ${envelope.code}`);
          return parse(envelope.currentData);
        } catch (e) {
          error = e;
          if (i < retries - 1) await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** i));
        }
      }
      const message = String(error);
      throw new Error(
        message.includes('Failed to fetch') || message.includes('fetch failed')
          ? '洛谷同步仅本地模式可用（浏览器直连被跨域拦截）'
          : '洛谷接口暂不可用：' + message,
      );
    });
    this.tail = next.catch(() => {});
    return next;
  }
  user(uid: string) {
    return this.request<LuoguUser>(`/user/${encodeURIComponent(uid)}?`, (data) => {
      const user = (data as { user?: Record<string, unknown> }).user;
      if (!user) throw new Error('洛谷用户不存在');
      return {
        uid: z.number().int().positive().parse(user.uid),
        name: z.string().min(1).parse(user.name),
        passedProblemCount: z.number().int().nonnegative().catch(0).parse(user.passedProblemCount),
        submittedProblemCount: z.number().int().nonnegative().catch(0).parse(user.submittedProblemCount),
      };
    });
  }
  records(uid: string, page: number) {
    return this.request<LuoguPage>(
      `/record/list?user=${encodeURIComponent(uid)}&page=${page}`,
      (data) => {
        const records = (data as { records?: unknown }).records;
        if (!records) throw new Error('提交记录不可见（可能需要登录或用户不存在）');
        const parsed = luoguRecordListSchema.parse(records);
        return { count: parsed.count, perPage: parsed.perPage, result: parsed.result };
      },
    );
  }
}

export class LuoguService {
  running: Promise<void> | null = null;
  private stopping = false;
  constructor(
    private store: CoreStore,
    readonly client: LuoguClientLike = new LuoguClient(),
    private persist: () => Promise<void> = async () => {},
  ) {}
  stop() {
    this.stopping = true;
    this.client.cancel();
  }
  user(uid: string) {
    return this.store.externalGet<LuoguUserSnapshot>(luoguNamespace(uid), 'user');
  }
  async bind(uid: string) {
    const id = luoguUidSchema.parse(uid),
      user = await this.client.user(id);
    const snapshot = luoguUserSnapshotSchema.parse({
      uid: id,
      name: user.name,
      passedProblemCount: user.passedProblemCount,
      submittedProblemCount: user.submittedProblemCount,
      rating: null,
      fetchedAt: new Date().toISOString(),
    });
    this.store.externalPut(luoguNamespace(id), 'user', snapshot);
    this.store.activateLuogu(id);
    await this.persist();
    return snapshot;
  }
  start(uid: string, mode: 'full' | 'incremental' = 'incremental', resume = false): SyncJob {
    if (this.running) throw new Error('洛谷同步正在进行');
    const id = luoguUidSchema.parse(uid),
      profile = luoguProfile(id),
      old = this.store.latestJob(profile);
    this.stopping = false;
    const continued = resume && old && ['failed', 'interrupted'].includes(old.status);
    const job: SyncJob = continued
      ? { ...old, status: 'running', finishedAt: undefined }
      : {
          id: crypto.randomUUID(),
          handle: id,
          mode,
          status: 'running',
          processed: 0,
          cursor: 1,
          message: '准备读取洛谷提交记录',
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
      let snapshot = this.user(job.handle);
      try {
        const fresh = await this.client.user(job.handle);
        snapshot = luoguUserSnapshotSchema.parse({
          uid: job.handle,
          name: fresh.name,
          passedProblemCount: fresh.passedProblemCount,
          submittedProblemCount: fresh.submittedProblemCount,
          rating: null,
          fetchedAt: new Date().toISOString(),
        });
        this.store.externalPut(luoguNamespace(job.handle), 'user', snapshot);
      } catch {
        job.message = '用户信息刷新失败，继续同步提交记录';
      }
      const incremental = job.mode === 'incremental',
        prevMaxId = incremental
          ? this.store
              .all<CFSubmission>('submissions', profile)
              .reduce((n, s) => Math.max(n, s.id), 0)
          : 0;
      let page = job.cursor,
        pagesThisRun = 0,
        knownPages = 0;
      while (true) {
        if (this.stopping) throw new Error('同步已中断');
        const data = await this.client.records(job.handle, page);
        pagesThisRun++;
        knownPages = Math.ceil((data.count ?? 0) / (data.perPage || 20)) || knownPages;
        const fresh = prevMaxId ? data.result.filter((r) => r.id > prevMaxId) : data.result;
        if (fresh.length) this.store.ingestLuogu(profile, fresh);
        job.processed += fresh.length;
        job.cursor = page + 1;
        job.message = `已读取 ${job.processed} 条提交`;
        await save();
        if (!data.result.length) break;
        if (prevMaxId && data.result.some((r) => r.id <= prevMaxId)) break;
        if (knownPages && page >= knownPages) break;
        page++;
        if (pagesThisRun >= LUOGU_MAX_PAGES_PER_RUN) {
          job.cursor = page;
          await save();
          throw new Error('已达单次同步页数上限，再次点击同步可继续');
        }
      }
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
}
