import { z } from 'zod';
import type { CoreStore } from './core-store.js';
import { localDay, problemKey } from './core-store.js';
import type { CFContest, CFRating, CFSubmission, Attempt } from './domain.js';
import type { LearningRecord } from './learning-domain.js';
import { knowledgeCards } from './knowledge.js';
import { recommendationDifficulty, type Catalog } from './training.js';
import {
  BATTLE_RULE_VERSION,
  battleSessionSchema,
  battleRewards,
  type BattleSession,
} from './battle-domain.js';
import type { TrainingService } from './training-service.js';
import type { CFClient } from './sync.js';

export const battleNamespace = (handle: string) => 'battle:' + handle;
function assistedItems(store: CoreStore, session: BattleSession) {
  const hints = store
    .externalAll<LearningRecord>('learning-source:' + session.handle)
    .filter((r) => r.kind === 'hint');
  const attempts = store.all<Attempt>('attempts', session.handle);
  const assisted = new Set(
    session.items
      .filter(
        (item) =>
          hints.some(
            (r) =>
              r.kind === 'hint' &&
              r.problemKey === item.problem.key &&
              Date.parse(r.createdAt) >= Date.parse(item.issuedAt) &&
              Date.parse(r.createdAt) <= Date.parse(item.evaluatedAt ?? item.closedAt ?? session.updatedAt),
          ) ||
          attempts.some(
            (a) =>
              a.problemKey === item.problem.key &&
              a.result === 'hint' &&
              Date.parse(a.createdAt) >= Date.parse(item.issuedAt) &&
              localDay(new Date(a.createdAt)) === localDay(new Date(item.acceptedAt ?? item.issuedAt)),
          ),
      )
      .map((i) => i.id),
  );
  return assisted;
}
export function sessionRewards(store: CoreStore, session: BattleSession) {
  return battleRewards(
    session,
    store.all<CFSubmission>('submissions', session.handle),
    assistedItems(store, session),
  );
}
export function allBattleRewards(store: CoreStore, handle: string) {
  if (!handle || handle.startsWith('ac~') || handle.startsWith('lg~')) return [];
  return store
    .externalAll<BattleSession>(battleNamespace(handle))
    .flatMap((s) => sessionRewards(store, s).rewards)
    .filter((r) => !store.review(handle, r.problemKey).ignored);
}
const commandSchema = z.object({
  handle: z.string().min(1),
  operationId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  action: z.enum(['sync', 'evaluate', 'skip', 'fail', 'pause', 'resume', 'end', 'difficulty', 'refresh']),
  itemId: z.string().uuid().optional(),
  result: z.enum(['independent', 'hint', 'failed']).optional(),
  minimum: z.number().int().min(800).max(4000).optional(),
  maximum: z.number().int().min(800).max(4000).optional(),
});
export class BattleService {
  constructor(
    private store: CoreStore,
    private now: () => Date = () => new Date(),
  ) {}
  private handle(expected?: string) {
    const h = this.store.active();
    if (!h) throw new Error('请先绑定 Codeforces 账号');
    if (expected && h !== expected) throw new Error('连战账号已变化，请刷新页面');
    return h;
  }
  state(id?: string) {
    const h = this.store.active();
    const sessions = h
      ? this.store
          .externalAll<BattleSession>(battleNamespace(h))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      : [];
    const session =
      (id
        ? sessions.find((s) => s.id === id)
        : (sessions.find((s) => s.status !== 'ended') ?? sessions[0])) ?? null;
    return {
      handle: h,
      session,
      activeId: sessions.find((s) => s.status !== 'ended')?.id ?? null,
      history: sessions.map((s) => ({
        id: s.id,
        skillId: s.skillId,
        createdAt: s.createdAt,
        status: s.status,
      })),
      ...(session ? sessionRewards(this.store, session) : { rewards: [], streak: 0, pending: 0 }),
    };
  }
  private save(s: BattleSession) {
    this.store.externalPut(battleNamespace(s.handle), s.id, battleSessionSchema.parse(s));
    return this.state(s.id);
  }
  private issue(s: BattleSession) {
    const now = this.now();
    const day = this.store.combinedTrainingDay(now);
    const blocked = new Set([
      ...this.store.all<CFSubmission>('submissions', s.handle).map(problemKey),
      ...this.store
        .problems(s.handle)
        .filter((p) => p.review.ignored)
        .map((p) => p.key),
      ...s.items.map((i) => i.problem.key),
      ...day.review.map((p) => p.key),
      ...day.newProblems.map((p) => p.key),
    ]);
    const catalog = this.store.get<Catalog>('catalog_cache', s.handle, 'current');
    const skill = knowledgeCards.find((k) => k.id === s.skillId)!;
    const hash = (key: string) => {
      let n = 2166136261;
      for (const c of s.id + key) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
      return n >>> 0;
    };
    const candidate = catalog?.problems
      .filter(
        (p) =>
          !blocked.has(p.key) &&
          p.rating !== null &&
          p.rating >= s.minimum &&
          p.rating <= s.maximum &&
          p.tags.some((t) => skill.tags.includes(t)),
      )
      .sort(
        (a, b) =>
          Math.abs(a.rating! - s.preferred) - Math.abs(b.rating! - s.preferred) ||
          hash(a.key) - hash(b.key) ||
          a.key.localeCompare(b.key),
      )[0];
    if (!candidate) {
      s.exhausted = true;
      s.status = 'paused';
      return;
    }
    s.exhausted = false;
    s.items.push({
      id: crypto.randomUUID(),
      problem: candidate,
      issuedAt: now.toISOString(),
      closedAt: null,
      outcome: 'current',
      submissionId: null,
      acceptedAt: null,
      evaluation: null,
      evaluatedAt: null,
    });
  }
  start(input: unknown) {
    const data = z
      .object({ handle: z.string(), skillId: z.string(), operationId: z.string().uuid() })
      .parse(input);
    const h = this.handle(data.handle);
    const sessions = this.store.externalAll<BattleSession>(battleNamespace(h));
    if (sessions.some((s) => s.operations.includes(data.operationId))) return this.state();
    if (sessions.some((s) => s.status !== 'ended')) throw new Error('请先结束当前连战，再开始新的知识点');
    if (!knowledgeCards.some((k) => k.id === data.skillId)) throw new Error('知识点不存在');
    const ratings = this.store
      .all<CFContest & { rating?: CFRating }>('contests', h)
      .map((c) => c.rating)
      .filter((r): r is CFRating => !!r && r.newRating > 0)
      .sort((a, b) => (b.ratingUpdateTimeSeconds ?? 0) - (a.ratingUpdateTimeSeconds ?? 0));
    const band = recommendationDifficulty(
      this.store.problems(h),
      this.store.all<CFSubmission>('submissions', h),
      problemKey,
      ratings[0]?.newRating,
    );
    const at = this.now().toISOString();
    const session: BattleSession = {
      id: crypto.randomUUID(),
      handle: h,
      skillId: data.skillId,
      ruleVersion: BATTLE_RULE_VERSION,
      revision: 0,
      createdAt: at,
      updatedAt: at,
      status: 'active',
      exhausted: false,
      minimum: Math.min(4000, band.minimum),
      maximum: Math.min(4000, band.maximum),
      preferred: Math.min(4000, band.preferred),
      items: [],
      operations: [data.operationId],
    };
    return this.store.transaction(() => {
      this.issue(session);
      return this.save(session);
    });
  }
  private current(id: string, data: z.infer<typeof commandSchema>) {
    const h = this.handle(data.handle);
    const s = this.store.externalGet<BattleSession>(battleNamespace(h), id);
    if (!s) throw new Error('连战不存在');
    if (s.operations.includes(data.operationId)) return { session: s, duplicate: true };
    if (s.revision !== data.revision) throw new Error('连战进度已变化，请刷新后重试');
    return { session: s, duplicate: false };
  }
  command(id: string, input: unknown) {
    const data = commandSchema.parse(input);
    const { session: s, duplicate } = this.current(id, data);
    if (duplicate) return this.state(s.id);
    if (s.status === 'ended' && data.action !== 'evaluate') throw new Error('这轮连战已结束');
    return this.store.transaction(() => {
      const at = this.now().toISOString();
      const original = JSON.stringify(s);
      const item = s.items.find((i) => i.outcome === 'current');
      switch (data.action) {
        case 'pause':
          s.status = 'paused';
          break;
        case 'end':
          s.status = 'ended';
          s.exhausted = false;
          break;
        case 'difficulty':
          if (data.minimum === undefined || data.maximum === undefined || data.minimum > data.maximum)
            throw new Error('请填写有效的难度区间');
          s.minimum = data.minimum;
          s.maximum = data.maximum;
          s.preferred = Math.max(s.minimum, Math.min(s.maximum, s.preferred));
          break;
        case 'evaluate': {
          const target = s.items.find((i) => i.id === data.itemId);
          if (!target || target.outcome !== 'accepted' || !data.result)
            throw new Error('只能评价已通过的连战题目');
          target.evaluation = data.result;
          target.evaluatedAt = at;
          if (data.result === 'independent' && assistedItems(this.store, s).has(target.id))
            target.evaluation = 'hint';
          break;
        }
        case 'skip':
        case 'fail':
          if (!item || s.status !== 'active') throw new Error('请先继续连战');
          item.outcome = data.action === 'skip' ? 'skipped' : 'failed';
          item.closedAt = at;
          if (data.action === 'fail') {
            item.evaluation = 'failed';
            item.evaluatedAt = at;
            if (!this.store.get('problems', s.handle, item.problem.key))
              this.store.put('problems', s.handle, item.problem.key, {
                ...item.problem,
                source: 'cf',
                manual: false,
              });
          }
          this.issue(s);
          break;
        case 'resume':
        case 'sync':
          if (data.action === 'resume') {
            s.status = 'active';
            s.exhausted = false;
          }
          if (s.status !== 'active') break;
          if (item) {
            const accepted = this.store
              .all<CFSubmission>('submissions', s.handle)
              .filter(
                (sub) =>
                  problemKey(sub) === item.problem.key &&
                  sub.verdict === 'OK' &&
                  !sub.author.teamId &&
                  sub.author.members?.length === 1 &&
                  sub.author.members[0].handle.toLowerCase() === s.handle.toLowerCase() &&
                  sub.creationTimeSeconds * 1000 >= Date.parse(item.issuedAt) &&
                  sub.creationTimeSeconds * 1000 <= Date.parse(at),
              )
              .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id)[0];
            if (accepted) {
              item.outcome = 'accepted';
              item.submissionId = accepted.id;
              item.acceptedAt = new Date(accepted.creationTimeSeconds * 1000).toISOString();
              item.closedAt = at;
              this.issue(s);
            }
          } else this.issue(s);
          break;
        case 'refresh':
          break;
      }
      // Empty poll results need no new session revision or ever-growing operation history.
      if (data.action === 'sync' && JSON.stringify(s) === original) return this.state(s.id);
      s.revision++;
      s.updatedAt = at;
      s.operations.push(data.operationId);
      return this.save(s);
    });
  }
  async route(
    path: string,
    method: string,
    input: unknown,
    training: TrainingService,
    cf: CFClient,
    busy: () => boolean,
  ) {
    if (method === 'GET') return this.state(path || undefined);
    if (method !== 'POST') throw new Error('不支持的连战操作');
    if (!path) return this.start(input);
    const data = commandSchema.parse(input);
    const { duplicate, session } = this.current(path, data);
    const epoch = this.store.learningEpoch;
    if (duplicate) return this.state(session.id);
    if (data.action === 'sync' && session.status === 'active') {
      if (busy()) throw new Error('正在同步其他训练数据，请稍后重试');
      const outcome = await training.recent(data.handle, false, 30_000);
      if (outcome.error) throw new Error(outcome.error);
    }
    if (data.action === 'refresh') {
      if (busy()) throw new Error('正在同步其他训练数据，请稍后重试');
      const catalog = this.store.get<Catalog>('catalog_cache', data.handle, 'current');
      if (!catalog || this.now().getTime() - Date.parse(catalog.fetchedAt) >= 60_000) {
        const response = await cf.call<{ problems: CFSubmission['problem'][] }>('problemset.problems');
        if (epoch !== this.store.learningEpoch) throw new Error('账号或数据已变化，请重新刷新题库');
        this.current(path, data); // async work must not apply to a changed account or revision
        this.store.enrich(data.handle, [], [], response.problems);
      }
    }
    if (epoch !== this.store.learningEpoch) throw new Error('账号或数据已变化，请重试连战操作');
    return this.command(path, data);
  }
}
export type BattleState = ReturnType<BattleService['state']>;
