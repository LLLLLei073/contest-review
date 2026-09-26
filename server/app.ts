import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { attemptSchema, reviewSchema, type ProblemRow } from '../shared/domain.js';
import { Store, contestReviewSchema, localDay } from './store.js';
import { CodeforcesClient, SyncService, type CFClient } from './sync.js';
import { AnalysisService } from '../shared/analysis-service.js';
import { ContestHub } from '../shared/contest-hub.js';
import { TrainingService } from '../shared/training-service.js';
import type { XcpcClient } from '../shared/xcpc.js';

export async function buildApp(
  store: Store,
  cf: CFClient = new CodeforcesClient(),
  options: { dev?: boolean; logger?: boolean; pageSize?: number; xcpc?: XcpcClient } = {},
) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 100 * 1024 * 1024 });
  const sync = new SyncService(store, cf, options.pageSize);
  const analysis = new AnalysisService(store, cf);
  const hub = new ContestHub(store, sync, analysis, async () => {}, options.xcpc);
  const training = new TrainingService(store, cf);
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))
      return reply.code(403).send({ error: '仅允许本机访问' });
    const origin = req.headers.origin;
    const allowed = [
      `http://${host}`,
      ...(options.dev ? ['http://127.0.0.1:5173', 'http://localhost:5173'] : []),
    ];
    if (origin && !allowed.includes(origin)) return reply.code(403).send({ error: '请求来源不受信任' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-review-app'] !== '1')
      return reply.code(403).send({ error: '缺少本地应用标识' });
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: '输入格式不正确',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 5),
      });
    const e = error as Error & { statusCode?: number };
    return reply.code(e.statusCode || 400).send({ error: e.message || '操作失败' });
  });
  const profile = () => {
    const h = store.active();
    if (!h) throw new Error('请先在设置中绑定 Codeforces 用户名');
    return h;
  };
  const idle = () => {
    if (sync.running || analysis.running || hub.isBusy()) throw new Error('请等待当前同步或比赛分析完成');
  };
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/settings', async () => ({
    activeHandle: store.active(),
    handles: store.handles(),
    xcpcPlayer: hub.binding(),
    xcpcMode: hub.mode(),
  }));
  app.get('/api/xcpc/search', async (req) =>
    hub.search(z.object({ name: z.string() }).parse(req.query).name),
  );
  app.post('/api/xcpc/binding', async (req) =>
    hub.bind(z.object({ key: z.string().min(1).max(300) }).parse(req.body).key),
  );
  app.post('/api/xcpc/mode', async (req) => {
    hub.setMode(z.object({ mode: z.enum(['official', 'all']) }).parse(req.body).mode);
    return { mode: hub.mode() };
  });
  app.get('/api/review/contests', async () => hub.rows());
  app.get('/api/review/batch', async () => hub.latestJob());
  app.post('/api/review/batch', async () => hub.startBatch());
  app.post('/api/review/batch/stop', async () => {
    hub.stop();
    return hub.latestJob();
  });
  app.get<{ Params: { slug: string } }>('/api/xcpc/contests/:slug/analysis', async (req) =>
    hub.getReport(req.params.slug),
  );
  app.post<{ Params: { slug: string } }>('/api/xcpc/contests/:slug/analysis/refresh', async (req) =>
    hub.startReport(req.params.slug),
  );
  app.put<{ Params: { slug: string } }>('/api/xcpc/contests/:slug/review', async (req) =>
    hub.saveReview(req.params.slug, contestReviewSchema.parse(req.body)),
  );
  app.post('/api/settings/handle', async (req) => {
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
      .parse(req.body);
    const known = store.handles().find((h) => h.toLowerCase() === handle.toLowerCase());
    if (known) store.activate(known);
    else {
      const users = await cf.call<{ handle: string }[]>('user.info', { handles: handle });
      if (!users[0]?.handle) throw new Error('无法确认该 Codeforces 用户');
      idle();
      store.activate(users[0].handle);
    }
    return { activeHandle: store.active(), handles: store.handles() };
  });
  app.get('/api/sync', async () => store.latestJob(store.active()));
  app.get('/api/training/day', async () => store.trainingDay(profile()));
  app.post('/api/training/recent', async (req) => {
    const h = profile();
    if (sync.running) return { checkedAt: store.get<{ recentCheckedAt: string | null }>('training_meta', h, 'recent')?.recentCheckedAt ?? null, error: '完整同步正在进行' };
    const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    return training.recent(h, force);
  });
  app.post('/api/sync', async (req) => {
    if (analysis.running || hub.isBusy()) throw new Error('请等待比赛分析完成');
    const { mode, resume } = z
      .object({
        mode: z.enum(['full', 'incremental']).default('incremental'),
        resume: z.boolean().default(false),
      })
      .parse(req.body);
    return sync.start(profile(), mode, resume);
  });
  app.get('/api/problems', async (req) => {
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
      .parse(req.query);
    let rows = store.problems(store.active());
    rows = rows.filter(
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
    return { items: rows.slice((q.page - 1) * q.size, q.page * q.size), total: rows.length, page: q.page };
  });
  app.get('/api/tags', async () => {
    const rows = store.problems(store.active());
    return {
      tags: [...new Set(rows.flatMap((p) => p.tags))].sort(),
      reasons: [...new Set(rows.flatMap((p) => p.review.reasons))].sort(),
    };
  });
  app.post('/api/problems', async (req) => {
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
      .parse(req.body);
    return { key: store.manualProblem(profile(), input) };
  });
  app.get<{ Params: { key: string } }>('/api/problems/:key', async (req, reply) => {
    const data = store.detail(profile(), req.params.key);
    return data || reply.code(404).send({ error: '题目不存在' });
  });
  app.put<{ Params: { key: string } }>('/api/problems/:key/review', async (req) => {
    const body = z
      .object({ review: reviewSchema, action: z.enum(['save', 'complete', 'restart']).default('save') })
      .parse(req.body);
    return store.updateReview(profile(), req.params.key, body.review, body.action);
  });
  app.post<{ Params: { key: string } }>('/api/problems/:key/attempts', async (req) =>
    store.attempt(profile(), req.params.key, attemptSchema.parse(req.body)),
  );
  app.get('/api/contests', async () => store.contests(store.active()));
  app.get<{ Params: { id: string } }>('/api/contests/:id/analysis', async (req) =>
    analysis.get(profile(), z.coerce.number().int().positive().parse(req.params.id)),
  );
  app.post<{ Params: { id: string } }>('/api/contests/:id/analysis/refresh', async (req) => {
    if (sync.running || hub.isBusy()) throw new Error('请等待当前同步完成');
    return analysis.start(profile(), z.coerce.number().int().positive().parse(req.params.id));
  });
  app.put<{ Params: { id: string } }>('/api/contests/:id/review', async (req) => {
    const id = z.coerce.number().int().positive().parse(req.params.id),
      h = profile();
    const row = store.contests(h).find((c) => c.id === id);
    if (!row) throw new Error('比赛不存在');
    if (!store.get('contests', h, String(id))) store.put('contests', h, String(id), { id, name: row.name });
    const review = contestReviewSchema.parse(req.body);
    store.put('contest_reviews', h, String(id), review);
    return review;
  });
  app.get('/api/statistics', async () => store.statistics(store.active()));
  app.get('/api/backup', async (req, reply) => {
    idle();
    return reply
      .header('Content-Disposition', `attachment; filename="contest-review-${Date.now()}.json"`)
      .header('Cache-Control', 'no-store')
      .send(store.backup());
  });
  app.post('/api/backup/restore', async (req) => {
    idle();
    const result = store.restore(req.body);
    analysis.reset();
    hub.reset();
    return result;
  });
  const dist = resolve('dist');
  if (existsSync(dist)) {
    await app.register(staticPlugin, { root: dist });
    app.setNotFoundHandler(async (req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: '接口不存在' })
        : reply.sendFile('index.html'),
    );
  }
  return { app, sync, analysis, hub };
}
