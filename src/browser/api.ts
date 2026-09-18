import { z } from 'zod';
import { attemptSchema, reviewSchema } from '../../shared/domain';
import { contestReviewSchema, localDay } from '../../shared/core-store';
import { browserRuntime } from './database';

export async function browserApi<T>(path: string, body?: unknown, method = 'GET'): Promise<T> {
  const runtime = await browserRuntime(),
    { store, sync, cf } = runtime;
  const url = new URL(path, 'https://local.invalid'),
    route = url.pathname;
  const profile = () => {
    const h = store.active();
    if (!h) throw new Error('请先在设置中绑定 Codeforces 用户名');
    return h;
  };
  const idle = () => {
    if (sync.running) throw new Error('请等待当前同步完成');
  };
  const isWrite = !['GET', 'HEAD'].includes(method);
  if (isWrite) runtime.assertWritable();
  let result: unknown;
  try {
    if (route === '/settings' && method === 'GET')
      result = { activeHandle: store.active(), handles: store.handles() };
    else if (route === '/settings/handle' && method === 'POST') {
      idle();
      const { handle } = z
        .object({
          handle: z
            .string()
            .trim()
            .min(1)
            .max(64)
            .regex(/^[a-zA-Z0-9_.-]+$/),
        })
        .parse(body);
      const known = store.handles().find((h) => h.toLowerCase() === handle.toLowerCase());
      if (known) store.activate(known);
      else {
        const users = await cf.call<{ handle: string }[]>('user.info', { handles: handle });
        if (!users[0]?.handle) throw new Error('无法确认该 Codeforces 用户');
        idle();
        store.activate(users[0].handle);
      }
      result = { activeHandle: store.active(), handles: store.handles() };
      navigator.storage?.persist?.().catch(() => {});
    } else if (route === '/sync' && method === 'GET') result = store.latestJob(store.active());
    else if (route === '/sync' && method === 'POST') {
      const data = z
        .object({
          mode: z.enum(['full', 'incremental']).default('incremental'),
          resume: z.boolean().default(false),
        })
        .parse(body);
      result = sync.start(profile(), data.mode, data.resume);
      // Storage failures are surfaced by subsequent writes and the job status; never leave an unhandled rejection.
      void sync.running?.catch(() => {});
    } else if (route === '/problems' && method === 'GET') {
      const q = z
        .object({
          q: z.string().optional(),
          tag: z.string().optional(),
          reason: z.string().optional(),
          status: z.enum(['pending', 'reviewing', 'mastered']).optional(),
          solved: z.enum(['yes', 'no']).optional(),
          ignored: z.enum(['yes', 'no']).default('no'),
          min: z.coerce.number().optional(),
          max: z.coerce.number().optional(),
          contestId: z.coerce.number().optional(),
          due: z.enum(['yes']).optional(),
          page: z.coerce.number().int().min(1).default(1),
          size: z.coerce.number().int().min(1).max(100).default(30),
        })
        .parse(Object.fromEntries(url.searchParams));
      const rows = store
        .problems(store.active())
        .filter(
          (p) =>
            (q.ignored === 'yes' ? p.review.ignored : !p.review.ignored) &&
            (!q.q || `${p.name} ${p.contestId ?? ''}${p.index}`.toLowerCase().includes(q.q.toLowerCase())) &&
            (!q.tag || p.tags.includes(q.tag)) &&
            (!q.reason || p.review.reasons.includes(q.reason)) &&
            (!q.status || p.review.status === q.status) &&
            (!q.solved || p.solved === (q.solved === 'yes')) &&
            (q.min === undefined || (p.rating !== null && p.rating >= q.min)) &&
            (q.max === undefined || (p.rating !== null && p.rating <= q.max)) &&
            (!q.contestId || p.contestId === q.contestId) &&
            (!q.due ||
              (p.review.status === 'reviewing' &&
                !!p.review.nextReview &&
                localDay(new Date(p.review.nextReview)) <= localDay(new Date()))),
        );
      rows.sort(
        (a, b) =>
          (a.review.nextReview || '9999').localeCompare(b.review.nextReview || '9999') ||
          b.failures - a.failures ||
          a.key.localeCompare(b.key),
      );
      result = {
        items: rows.slice((q.page - 1) * q.size, q.page * q.size),
        total: rows.length,
        page: q.page,
      };
    } else if (route === '/tags' && method === 'GET') {
      const rows = store.problems(store.active());
      result = {
        tags: [...new Set(rows.flatMap((p) => p.tags))].sort(),
        reasons: [...new Set(rows.flatMap((p) => p.review.reasons))].sort(),
      };
    } else if (route === '/problems' && method === 'POST') {
      const input = z
        .object({
          contestId: z.number().int().positive(),
          index: z
            .string()
            .trim()
            .regex(/^[A-Za-z][0-9]*$/)
            .transform((s) => s.toUpperCase()),
          name: z.string().trim().min(1).max(1000),
          tags: z.array(z.string().max(100)).max(100).default([]),
          rating: z.number().int().nonnegative().nullable().default(null),
        })
        .parse(body);
      result = { key: store.manualProblem(profile(), input) };
    } else if (/^\/problems\/[^/]+$/.test(route) && method === 'GET') {
      result = store.detail(profile(), decodeURIComponent(route.split('/')[2]));
      if (!result) throw new Error('题目不存在');
    } else if (/^\/problems\/[^/]+\/review$/.test(route) && method === 'PUT') {
      const key = decodeURIComponent(route.split('/')[2]),
        data = z
          .object({ review: reviewSchema, action: z.enum(['save', 'complete', 'restart']).default('save') })
          .parse(body),
        h = profile(),
        old = store.review(h, key);
      const review = { ...data.review, stage: old.stage, status: old.status };
      if ((data.action === 'complete' && old.status === 'pending') || data.action === 'restart') {
        review.status = 'reviewing';
        review.stage = 0;
        review.ignored = false;
        review.nextReview = new Date(Date.now() + 86400000).toISOString();
      }
      if (review.status === 'mastered') review.nextReview = null;
      if (review.status === 'reviewing' && !review.nextReview)
        throw new Error('复习中的题目需要设置下次日期');
      store.saveReview(h, key, review);
      result = review;
    } else if (/^\/problems\/[^/]+\/attempts$/.test(route) && method === 'POST')
      result = store.attempt(profile(), decodeURIComponent(route.split('/')[2]), attemptSchema.parse(body));
    else if (route === '/contests' && method === 'GET') result = store.contests(store.active());
    else if (/^\/contests\/\d+\/review$/.test(route) && method === 'PUT') {
      const id = Number(route.split('/')[2]),
        h = profile(),
        row = store.contests(h).find((c) => c.id === id);
      if (!row) throw new Error('比赛不存在');
      if (!store.get('contests', h, String(id))) store.put('contests', h, String(id), { id, name: row.name });
      const review = contestReviewSchema.parse(body);
      store.put('contest_reviews', h, String(id), review);
      result = review;
    } else if (route === '/statistics' && method === 'GET') result = store.statistics(store.active());
    else if (route === '/backup' && method === 'GET') {
      idle();
      result = store.backup();
    } else if (route === '/backup/previous' && method === 'GET') {
      result = await runtime.previousBackup();
      if (!result) throw new Error('尚无恢复前备份');
    } else if (route === '/backup/restore' && method === 'POST') {
      idle();
      result = store.restore(body);
    } else throw new Error('未知操作');
    if (isWrite) await runtime.flush();
    return result as T;
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new Error(
        '输入格式不正确：' +
          error.issues
            .slice(0, 5)
            .map((i) => i.path.join('.') + ': ' + i.message)
            .join('；'),
      );
    throw error;
  }
}
