import { z } from 'zod';
import { attemptSchema, reviewSchema } from '../../shared/domain';
import { contestReviewSchema, localDay } from '../../shared/core-store';
import { browserRuntime } from './database';
import { atcoderHandleSchema, atcoderProfile, atcoderNamespace } from '../../shared/atcoder';

export async function browserApi<T>(path: string, body?: unknown, method = 'GET'): Promise<T> {
  const runtime = await browserRuntime(),
    { store, sync, cf, analysis, hub, training, atcoder } = runtime;
  const url = new URL(path, 'https://local.invalid'),
    route = url.pathname;
  const profile = () => {
    const h = store.active();
    if (!h) throw new Error('请先在设置中绑定 Codeforces 用户名');
    return h;
  };
  const idle = () => {
    if (sync.running || analysis.running || hub.isBusy() || atcoder.running)
      throw new Error('请等待当前同步或比赛分析完成');
  };
  const isWrite = !['GET', 'HEAD'].includes(method);
  if (isWrite) runtime.assertWritable();
  let result: unknown;
  try {
    if (route === '/settings' && method === 'GET')
      result = {
        activeHandle: store.active(),
        handles: store.handles(),
        activeAtcoder: store.activeAtcoder(),
        atcoderHandles: store.atcoderHandles(),
        xcpcPlayer: hub.binding(),
        xcpcMode: hub.mode(),
      };
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
    } else if (route === '/atcoder/binding' && method === 'GET')
      result = {
        activeHandle: store.activeAtcoder(),
        handles: store.atcoderHandles(),
        verified: !!(
          store.activeAtcoder() && store.all('submissions', atcoderProfile(store.activeAtcoder())).length
        ),
        job: store.activeAtcoder() ? store.latestJob(atcoderProfile(store.activeAtcoder())) : null,
      };
    else if (route === '/atcoder/binding' && method === 'POST') {
      idle();
      const handle = atcoderHandleSchema.parse(z.object({ handle: z.string() }).parse(body).handle);
      store.activateAtcoder(handle);
      result = {
        activeHandle: store.activeAtcoder(),
        handles: store.atcoderHandles(),
        verified: store.all('submissions', atcoderProfile(handle)).length > 0,
      };
    } else if (route === '/atcoder/sync' && method === 'GET')
      result = store.activeAtcoder() ? store.latestJob(atcoderProfile(store.activeAtcoder())) : null;
    else if (route === '/atcoder/sync' && method === 'POST') {
      if (sync.running || analysis.running || hub.isBusy()) throw new Error('请等待当前同步完成');
      const { mode, resume } = z
        .object({
          mode: z.enum(['full', 'incremental']).default('incremental'),
          resume: z.boolean().default(false),
        })
        .parse(body);
      if (!store.activeAtcoder()) throw new Error('请先绑定 AtCoder');
      result = atcoder.start(store.activeAtcoder(), mode, resume);
    } else if (/^\/atcoder\/contests\/[^/]+\/analysis$/.test(route) && method === 'GET') {
      result = atcoder.report(decodeURIComponent(route.split('/')[3]));
      await runtime.flush();
    } else if (/^\/atcoder\/contests\/[^/]+\/analysis\/refresh$/.test(route) && method === 'POST') {
      if (sync.running || analysis.running || hub.isBusy()) throw new Error('请等待当前同步或分析完成');
      result = await atcoder.refresh(decodeURIComponent(route.split('/')[3]));
    } else if (/^\/atcoder\/contests\/[^/]+\/review$/.test(route) && method === 'PUT') {
      if (!store.activeAtcoder()) throw new Error('请先绑定 AtCoder');
      const review = contestReviewSchema.parse(body);
      store.externalPut(
        atcoderNamespace(store.activeAtcoder()),
        'review:' + decodeURIComponent(route.split('/')[3]),
        review,
      );
      result = review;
    } else if (route === '/xcpc/search' && method === 'GET')
      result = await hub.search(url.searchParams.get('name') ?? '');
    else if (route === '/xcpc/binding' && method === 'POST')
      result = await hub.bind(z.object({ key: z.string().min(1).max(300) }).parse(body).key);
    else if (route === '/xcpc/mode' && method === 'POST') {
      hub.setMode(z.object({ mode: z.enum(['official', 'all']) }).parse(body).mode);
      result = { mode: hub.mode() };
    } else if (route === '/review/contests' && method === 'GET')
      result = [...hub.rows(), ...atcoder.contests()].sort(
        (a, b) => (b.startTimeSeconds ?? 0) - (a.startTimeSeconds ?? 0),
      );
    else if (route === '/review/batch' && method === 'GET') result = hub.latestJob();
    else if (route === '/review/batch' && method === 'POST') result = hub.startBatch();
    else if (route === '/review/batch/stop' && method === 'POST') {
      hub.stop();
      result = hub.latestJob();
    } else if (/^\/xcpc\/contests\/[^/]+\/analysis$/.test(route) && method === 'GET')
      result = hub.getReport(decodeURIComponent(route.split('/')[3]));
    else if (/^\/xcpc\/contests\/[^/]+\/analysis\/refresh$/.test(route) && method === 'POST')
      result = hub.startReport(decodeURIComponent(route.split('/')[3]));
    else if (/^\/xcpc\/contests\/[^/]+\/review$/.test(route) && method === 'PUT')
      result = hub.saveReview(decodeURIComponent(route.split('/')[3]), contestReviewSchema.parse(body));
    else if (route === '/sync' && method === 'GET') result = store.latestJob(store.active());
    else if (route === '/training/day' && method === 'GET') {
      result = store.combinedTrainingDay();
      await runtime.flush();
    } else if (route === '/training/recent' && method === 'POST') {
      const h = store.active();
      const { force } = z.object({ force: z.boolean().default(false) }).parse(body ?? {});
      result = !h
        ? store.activeAtcoder()
          ? (() => {
              const p = atcoderProfile(store.activeAtcoder()),
                last = store.latestJob(p);
              if (
                !atcoder.running &&
                !sync.running &&
                !analysis.running &&
                !hub.isBusy() &&
                (force || !last?.finishedAt || Date.now() - Date.parse(last.finishedAt) > 300000)
              )
                atcoder.start(store.activeAtcoder(), 'incremental');
              return {
                checkedAt:
                  store.get<{ recentCheckedAt: string }>('training_meta', p, 'recent')?.recentCheckedAt ??
                  null,
                error: null,
              };
            })()
          : { checkedAt: null, error: '尚未绑定 Codeforces' }
        : sync.running
          ? {
              checkedAt:
                store.get<{ recentCheckedAt: string | null }>('training_meta', h, 'recent')
                  ?.recentCheckedAt ?? null,
              error: '完整同步正在进行',
            }
          : await training.recent(h, force);
      if (h && store.activeAtcoder() && !atcoder.running && !analysis.running && !hub.isBusy()) {
        const last = store.latestJob(atcoderProfile(store.activeAtcoder()));
        if (force || !last?.finishedAt || Date.now() - Date.parse(last.finishedAt) > 300000)
          atcoder.start(store.activeAtcoder(), 'incremental');
      }
    } else if (route === '/sync' && method === 'POST') {
      if (analysis.running || hub.isBusy() || atcoder.running) throw new Error('请等待比赛分析完成');
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
          source: z.enum(['all', 'cf', 'atcoder']).default('all'),
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
        .combinedProblems()
        .filter(
          (p) =>
            (q.ignored === 'yes' ? p.review.ignored : !p.review.ignored) &&
            (q.source === 'all' || (p.source ?? 'cf') === q.source) &&
            (!q.q || `${p.name} ${p.contestId ?? ''}${p.index}`.toLowerCase().includes(q.q.toLowerCase())) &&
            (!q.tag || (p.source === 'atcoder' ? p.review.categories : p.tags).includes(q.tag)) &&
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
      const rows = store.combinedProblems();
      result = {
        tags: [
          ...new Set(rows.flatMap((p) => (p.source === 'atcoder' ? p.review.categories : p.tags))),
        ].sort(),
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
      result = store.detail(
        store.profileForKey(decodeURIComponent(route.split('/')[2])),
        decodeURIComponent(route.split('/')[2]),
      );
      if (!result) throw new Error('题目不存在');
    } else if (/^\/problems\/[^/]+\/review$/.test(route) && method === 'PUT') {
      const key = decodeURIComponent(route.split('/')[2]),
        data = z
          .object({ review: reviewSchema, action: z.enum(['save', 'complete', 'restart']).default('save') })
          .parse(body);
      result = store.updateReview(store.profileForKey(key), key, data.review, data.action);
    } else if (/^\/problems\/[^/]+\/attempts$/.test(route) && method === 'POST')
      result = store.attempt(
        store.profileForKey(decodeURIComponent(route.split('/')[2])),
        decodeURIComponent(route.split('/')[2]),
        attemptSchema.parse(body),
      );
    else if (route === '/contests' && method === 'GET') result = store.contests(store.active());
    else if (/^\/contests\/\d+\/analysis$/.test(route) && method === 'GET')
      result = analysis.get(profile(), z.coerce.number().int().positive().parse(route.split('/')[2]));
    else if (/^\/contests\/\d+\/analysis\/refresh$/.test(route) && method === 'POST') {
      if (sync.running || hub.isBusy() || atcoder.running) throw new Error('请等待当前同步完成');
      result = analysis.start(profile(), z.coerce.number().int().positive().parse(route.split('/')[2]));
    } else if (/^\/contests\/\d+\/review$/.test(route) && method === 'PUT') {
      const id = Number(route.split('/')[2]),
        h = profile(),
        row = store.contests(h).find((c) => c.id === id);
      if (!row) throw new Error('比赛不存在');
      if (!store.get('contests', h, String(id))) store.put('contests', h, String(id), { id, name: row.name });
      const review = contestReviewSchema.parse(body);
      store.put('contest_reviews', h, String(id), review);
      result = review;
    } else if (route === '/statistics' && method === 'GET')
      result = store.combinedStatistics(
        z
          .object({ source: z.enum(['all', 'cf', 'atcoder']).default('all') })
          .parse(Object.fromEntries(url.searchParams)).source,
      );
    else if (route === '/backup' && method === 'GET') {
      idle();
      result = store.backup();
    } else if (route === '/backup/previous' && method === 'GET') {
      result = await runtime.previousBackup();
      if (!result) throw new Error('尚无恢复前备份');
    } else if (route === '/backup/restore' && method === 'POST') {
      idle();
      result = store.restore(body);
      analysis.reset();
      hub.reset();
    } else throw new Error('未知操作');
    if (isWrite && route !== '/training/recent') await runtime.flush();
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
