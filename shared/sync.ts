import type { CFContest, CFRating, CFSubmission, SyncJob } from './domain.js';
import type { CoreStore as Store } from './core-store.js';

export interface CFClient {
  call<T>(method: string, params?: Record<string, string | number>): Promise<T>;
  cancel?(): void;
}
export class CodeforcesClient implements CFClient {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  private controller = new AbortController();
  constructor(
    private fetcher: typeof fetch = fetch,
    private interval = 2100,
  ) {}
  cancel() {
    this.controller.abort();
    this.controller = new AbortController();
  }
  call<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
    const controller = this.controller;
    const request = this.tail.then(async () => {
      let error: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        controller.signal.throwIfAborted();
        const wait = Math.max(0, this.lastStart + this.interval - Date.now());
        if (wait) await new Promise((r) => setTimeout(r, wait));
        this.lastStart = Date.now();
        try {
          const url = new URL(`https://codeforces.com/api/${method}`);
          Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
          const response = await this.fetcher(url, {
            signal: AbortSignal.any([AbortSignal.timeout(20000), controller.signal]),
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) throw new Error(`Codeforces HTTP ${response.status}`);
          const body = (await response.json()) as { status: string; result: T; comment?: string };
          if (body.status !== 'OK') throw new Error(body.comment || 'Codeforces 返回失败');
          return body.result;
        } catch (e) {
          controller.signal.throwIfAborted();
          error = e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
      throw new Error(`无法读取 Codeforces：${error instanceof Error ? error.message : String(error)}`);
    });
    this.tail = request.catch(() => {});
    return request;
  }
}

export class SyncService {
  running: Promise<void> | null = null;
  private stopping = false;
  constructor(
    private store: Store,
    private cf: CFClient,
    private pageSize = 1000,
    private persist: () => Promise<void> = async () => {},
  ) {}
  stop() {
    this.stopping = true;
    this.cf.cancel?.();
  }
  private checkpoint() {
    if (this.stopping) throw new Error('同步已安全中断，已保存的记录会保留。');
  }
  start(handle: string, mode: 'full' | 'incremental', resume = false): SyncJob {
    if (this.running) throw new Error('已有同步任务正在运行');
    this.stopping = false;
    const old = this.store.latestJob(handle);
    const canResume = resume && old && ['failed', 'interrupted'].includes(old.status);
    const job: SyncJob = canResume
      ? { ...old, status: 'running', message: '正在继续同步', finishedAt: undefined }
      : {
          id: crypto.randomUUID(),
          handle,
          mode,
          status: 'running',
          processed: 0,
          cursor: 1,
          message: '准备读取提交记录',
          startedAt: new Date().toISOString(),
        };
    // An incomplete first import must never be treated as an incremental baseline.
    if (!this.store.all<SyncJob>('jobs', handle).some((j) => j.mode === 'full' && j.status === 'completed'))
      job.mode = 'full';
    this.store.put('jobs', handle, job.id, job);
    this.running = this.run(job).finally(() => {
      this.running = null;
    });
    return job;
  }
  private async run(job: SyncJob) {
    const save = async () => {
      this.store.put('jobs', job.handle, job.id, job);
      await this.persist();
    };
    try {
      const existing = this.store.all<CFSubmission>('submissions', job.handle);
      const known = new Set(existing.map((s) => s.id));
      const boundary = existing.reduce((max, s) => Math.max(max, s.id), 0);
      const originalCursor = job.cursor;
      // Re-scan from the head on resume: positional offsets can shift during an interruption.
      let from = 1,
        observed = new Set<number>(),
        crossed = false;
      const overlap = Math.min(50, Math.max(1, Math.floor(this.pageSize / 10)));
      const step = this.pageSize - overlap;
      while (true) {
        this.checkpoint();
        job.message = `读取提交记录（第 ${from} 条起）`;
        await save();
        const page = await this.cf.call<CFSubmission[]>('user.status', {
          handle: job.handle,
          from,
          count: this.pageSize,
        });
        this.store.ingest(job.handle, page);
        const fresh = page.filter((s) => !observed.has(s.id));
        page.forEach((s) => observed.add(s.id));
        job.processed = observed.size;
        job.cursor = from;
        await save();
        this.checkpoint();
        if (!page.length || page.length < this.pageSize) break;
        if (!fresh.length) throw new Error('分页没有前进，已保留数据，请稍后重试');
        const reachedKnown = page.some((s) => s.id <= boundary && known.has(s.id));
        // Read one extra overlapping page beyond the previous head, and past saved resume progress.
        if (job.mode === 'incremental' && crossed && from >= originalCursor) break;
        crossed = reachedKnown;
        from += step;
      }
      // Refresh previously pending judgements even when they are older than the incremental window.
      const pending = existing
        .filter((s) => !s.verdict || ['TESTING', 'SUBMITTED'].includes(s.verdict))
        .filter((s) => !observed.has(s.id));
      for (const contestId of new Set(
        pending.map((s) => s.contestId).filter((n): n is number => n !== undefined),
      )) {
        let offset = 1;
        while (true) {
          this.checkpoint();
          const page = await this.cf.call<CFSubmission[]>('contest.status', {
            contestId,
            handle: job.handle,
            from: offset,
            count: this.pageSize,
          });
          this.store.ingest(job.handle, page);
          await this.persist();
          if (page.length < this.pageSize) break;
          offset += this.pageSize;
        }
      }
      job.message = '提交记录已保存，正在补全比赛、评级与题目标签';
      await save();
      const warnings: string[] = [];
      const safe = async <T>(method: string, fallback: T): Promise<T> => {
        try {
          this.checkpoint();
          return await this.cf.call<T>(method);
        } catch (e) {
          this.checkpoint();
          warnings.push(e instanceof Error ? e.message : String(e));
          return fallback;
        }
      };
      const contests = await safe<CFContest[]>('contest.list', []);
      let ratings: CFRating[] = [];
      try {
        this.checkpoint();
        ratings = await this.cf.call<CFRating[]>('user.rating', { handle: job.handle });
      } catch (e) {
        this.checkpoint();
        warnings.push(e instanceof Error ? e.message : String(e));
      }
      const problemset = await safe<{ problems: CFSubmission['problem'][] }>('problemset.problems', {
        problems: [],
      });
      this.store.enrich(job.handle, contests, ratings, problemset.problems);
      this.checkpoint();
      job.status = 'completed';
      job.message = warnings.length
        ? `提交同步完成；补全信息部分失败，可重新同步。${warnings.join('；')}`
        : `同步完成，本次读取 ${job.processed} 条提交`;
      job.finishedAt = new Date().toISOString();
      await save();
    } catch (e) {
      job.status = this.stopping ? 'interrupted' : 'failed';
      job.message = this.stopping
        ? '同步已安全中断，已保存的记录会保留。'
        : e instanceof Error
          ? e.message
          : String(e);
      job.finishedAt = new Date().toISOString();
      await save();
    }
  }
}
