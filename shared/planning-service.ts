import { z } from 'zod';
import { plannerOutcomes } from './planner-outcomes.js';
import { CoreStore, localDay, problemKey } from './core-store.js';
import type { CFSubmission } from './domain.js';
import { knowledgeCards, knowledgeFor } from './knowledge.js';
import { fingerprint, learningNamespace, type LearningRecord } from './learning-domain.js';
import { BKT_VERSION, DEFAULT_BKT, traceKnowledge, type KnowledgeObservation } from './knowledge-tracing.js';
import { buildLearningPath } from './learning-path.js';
import { estimateMinutes, optimizePlan, OPTIMIZER_VERSION, type PlanCandidate } from './plan-optimizer.js';
import {
  categories,
  categoryNames,
  dailyPlanSchema,
  recommendationDifficulty,
  type Catalog,
  type DailyPlan,
} from './training.js';
import { chooseWeeklyProblems, weekStart, weeklyGoalSchema } from './weekly.js';
import {
  learningPathSchema,
  planDecisionSchema,
  planRequestSchema,
  planningNamespace,
  planningOptionsSchema,
  planningPreferenceSchema,
  planningRecordSchema,
  planningStateSchema,
  pathRecordSchema,
  planningDateSchema,
  type PlanDecision,
  type PlanningRecord,
} from './planning-domain.js';

export const KNOWLEDGE_GRAPH_VERSION =
  'knowledge-' + fingerprint(knowledgeCards.map((c) => [c.id, c.tags, c.prerequisites]));
// One derived snapshot per live store; evidence and restoration epochs invalidate it.
const tracingCache = new WeakMap<CoreStore, { key: string; value: ReturnType<typeof traceKnowledge> }>();
const UTILITY_WEIGHTS = {
  version: 'learning-utility-2',
  base: 30,
  gap: 20,
  goal: 20,
  path: 20,
  unlock: 5,
  coverage: 10,
  challenge: 10,
};
export class PlanningService {
  constructor(
    readonly store: CoreStore,
    private now: () => Date = () => new Date(),
  ) {}
  scope() {
    if (!this.store.active() && !this.store.activeAtcoder()) throw new Error('请先绑定训练账号');
    return planningNamespace(this.store.active(), this.store.activeAtcoder());
  }
  records() {
    return this.store.externalAll<PlanningRecord>(this.scope()).map((r) => planningRecordSchema.parse(r));
  }
  options() {
    const preference = this.records().find((r) => r.kind === 'preferences');
    return planningOptionsSchema.parse(preference?.kind === 'preferences' ? preference.options : {});
  }
  private save(record: PlanningRecord) {
    const parsed = planningRecordSchema.parse(record);
    if (parsed.scope !== this.scope()) throw new Error('规划账号已变化');
    this.store.externalPut(this.scope(), parsed.id, parsed);
    // Keep bounded histories; applied/reverted decisions remain inspectable for the latest 100 runs.
    const records = this.records()
      .filter((r) => r.kind === parsed.kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const referenced = new Set(
      this.learning().flatMap((r) =>
        r.kind === 'revision' && r.planningDecisionId ? [r.planningDecisionId] : [],
      ),
    );
    for (const old of records.slice(parsed.kind === 'path' ? 30 : 100))
      if (!referenced.has(old.id)) this.store.externalDelete(this.scope(), old.id);
    return parsed;
  }
  private profiles() {
    return [
      this.store.active(),
      this.store.activeAtcoder() ? 'ac~' + this.store.activeAtcoder().toLowerCase() : '',
    ].filter(Boolean);
  }
  private learning() {
    return [
      learningNamespace(this.store.active(), this.store.activeAtcoder()),
      ...this.profiles().map((p) => 'learning-source:' + p),
    ].flatMap((ns) => this.store.externalAll<LearningRecord>(ns));
  }
  observations(asOf = this.now().toISOString()): KnowledgeObservation[] {
    const cutoff = Date.parse(asOf),
      records = this.learning(),
      observations: KnowledgeObservation[] = [];
    for (const row of this.store.combinedProblems().filter((p) => !p.review.ignored)) {
      const detail = this.store.detail(this.store.profileForKey(row.key), row.key)!;
      const attempts = detail.attempts
        .filter((a) => Date.parse(a.createdAt) <= cutoff)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      for (let i = 0; i < attempts.length; i++) {
        const a = attempts[i],
          time = Date.parse(a.createdAt),
          previous = i ? Date.parse(attempts[i - 1].createdAt) : 0;
        const accepted = detail.submissions.some(
          (s) =>
            s.verdict === 'OK' &&
            !s.author.teamId &&
            s.creationTimeSeconds * 1000 <= time &&
            s.creationTimeSeconds * 1000 > previous &&
            localDay(new Date(s.creationTimeSeconds * 1000)) === localDay(new Date(a.createdAt)),
        );
        const assisted = records.some(
          (r) =>
            r.kind === 'hint' &&
            r.problemKey === row.key &&
            Date.parse(r.createdAt) > previous &&
            Date.parse(r.createdAt) <= time,
        );
        observations.push({
          id: a.id,
          problemKey: row.key,
          session: localDay(new Date(a.createdAt)),
          at: a.createdAt,
          skillIds: knowledgeFor(row.tags),
          result: a.result,
          accepted,
          assisted,
        });
      }
    }
    return observations;
  }
  tracing() {
    const asOf = this.now().toISOString();
    const observations = this.observations(asOf);
    const key = fingerprint([
      this.scope(),
      this.store.learningEpoch,
      BKT_VERSION,
      DEFAULT_BKT,
      KNOWLEDGE_GRAPH_VERSION,
      observations,
    ]);
    let cached = tracingCache.get(this.store);
    if (!cached || cached.key !== key) {
      cached = {
        key,
        value: traceKnowledge(
          knowledgeCards.map((c) => c.id),
          observations,
          asOf,
        ),
      };
      tracingCache.set(this.store, cached);
    }
    // Callers cannot mutate the shared snapshot; cache contents are never backed up.
    return structuredClone(cached.value);
  }
  path(input?: unknown) {
    const options = planningOptionsSchema.parse(input ?? this.options());
    return learningPathSchema.parse(
      buildLearningPath(knowledgeCards, options.targets, this.tracing().states),
    );
  }
  state() {
    const records = this.records(),
      options = this.options(),
      tracing = this.tracing();
    return planningStateSchema.parse({
      evidence: this.observations().map((o) => ({
        id: o.id,
        problemKey: o.problemKey,
        at: o.at,
        result: o.result,
      })),
      followup: {
        overdue: this.store
          .combinedProblems()
          .filter(
            (p) =>
              !p.review.ignored &&
              p.review.status === 'reviewing' &&
              p.review.nextReview &&
              localDay(new Date(p.review.nextReview)) < localDay(this.now()),
          ).length,
        transferEvaluated: this.learning().filter((r) => r.kind === 'transfer' && r.result !== 'pending')
          .length,
        transferIndependent: this.learning().filter(
          (r) => r.kind === 'transfer' && r.result === 'independent',
        ).length,
        transferPending: this.learning().filter((r) => r.kind === 'transfer' && r.result === 'pending')
          .length,
      },
      outcomes: plannerOutcomes(
        records.filter((r): r is PlanDecision => r.kind === 'decision'),
        this.profiles().flatMap((p) => this.store.all<import('./domain.js').Attempt>('attempts', p)),
        this.observations(),
        this.now().toISOString(),
      ),
      scope: this.scope(),
      options,
      tracing,
      path: buildLearningPath(knowledgeCards, options.targets, tracing.states),
      decisions: records
        .filter((r) => r.kind === 'decision')
        .slice(-100)
        .reverse(),
      paths: records
        .filter((r) => r.kind === 'path')
        .slice()
        .reverse(),
      algorithm: OPTIMIZER_VERSION,
      graphVersion: KNOWLEDGE_GRAPH_VERSION,
    });
  }
  preferences(input: unknown) {
    const options = planningOptionsSchema.parse(input),
      path = this.path(options);
    if (!path.valid) throw new Error('学习目标包含未知节点或先修关系错误');
    const createdAt = this.now().toISOString(),
      scope = this.scope();
    this.store.transaction(() => {
      this.save(
        planningPreferenceSchema.parse({ kind: 'preferences', id: 'preferences', scope, createdAt, options }),
      );
      this.save(
        pathRecordSchema.parse({
          kind: 'path',
          id: crypto.randomUUID(),
          scope,
          createdAt,
          path,
          fingerprint: fingerprint([options, this.observations()]),
          graphVersion: KNOWLEDGE_GRAPH_VERSION,
        }),
      );
    });
    return this.state();
  }
  private planNamespace() {
    return `daily:${this.store.active() || '-'}:${this.store.activeAtcoder().toLowerCase() || '-'}`;
  }
  readPlan(date: string): DailyPlan | null {
    return (
      (this.store.activeAtcoder()
        ? this.store.externalGet<DailyPlan>(this.planNamespace(), date)
        : this.store.get<DailyPlan>('daily_plans', this.store.active(), date)) ?? null
    );
  }
  private writePlan(plan: DailyPlan | null, date: string) {
    if (this.store.activeAtcoder()) {
      if (plan) this.store.externalPut(this.planNamespace(), date, dailyPlanSchema.parse(plan));
      else this.store.externalDelete(this.planNamespace(), date);
    } else if (plan) this.store.put('daily_plans', this.store.active(), date, dailyPlanSchema.parse(plan));
    else
      this.store.db
        .prepare('DELETE FROM daily_plans WHERE profile=? AND key=?')
        .run(this.store.active(), date);
  }
  private snapshot(request: z.infer<typeof planRequestSchema>) {
    const cf = this.store.active(),
      rows = this.store.combinedProblems().filter((p) => !p.review.ignored);
    const plans = [
      ...this.store.all<DailyPlan>('daily_plans', cf),
      ...this.store.externalAll<DailyPlan>(this.planNamespace()),
    ];
    const catalog = this.store.get<Catalog>('catalog_cache', cf, 'current');
    const submissions = this.store.all<CFSubmission>('submissions', cf);
    const goal = this.store.weeklyGoal(new Date(request.date + 'T12:00:00+08:00'));
    const observations = this.observations(),
      tracing = traceKnowledge(
        knowledgeCards.map((c) => c.id),
        observations,
        this.now().toISOString(),
      );
    const path = buildLearningPath(knowledgeCards, request.targets, tracing.states);
    const before = this.readPlan(request.date),
      learning = this.learning();
    const reserved = learning
      .filter((r) => r.kind === 'transfer' && r.result === 'pending' && r.date === request.date)
      .map((r) => (r.kind === 'transfer' ? r.targetKey : ''));
    const source = {
      scope: this.scope(),
      date: localDay(this.now()),
      request,
      before,
      rows,
      observations,
      catalog,
      goal,
      plans,
      reserved,
      preferences: this.options(),
      submissions,
      graph: KNOWLEDGE_GRAPH_VERSION,
      algorithm: OPTIMIZER_VERSION,
    };
    return {
      cf,
      rows,
      plans,
      catalog,
      submissions,
      goal,
      tracing,
      path,
      before,
      reserved,
      hash: fingerprint(source),
    };
  }
  private validateFuture(date: string) {
    if (date <= localDay(this.now())) throw new Error('只能调整未来题单，今日与历史安排保持固定');
    if (Date.parse(date + 'T12:00:00+08:00') - this.now().getTime() > 31 * 86400000)
      throw new Error('请安排未来 31 天以内的计划');
  }
  preview(input: unknown): PlanDecision {
    const request = planRequestSchema.parse(input);
    this.validateFuture(request.date);
    const s = this.snapshot(request),
      warnings: string[] = [];
    if (!s.path.valid) throw new Error('先修图存在错误，请调整目标后重试');
    if (s.cf && !s.goal) warnings.push('目标周尚未选择训练领域，本次仅安排复习；请先设置对应周目标');
    const submitted = new Set([
      ...this.store.all<CFSubmission>('submissions', s.cf).map(problemKey),
      ...this.store.problems(s.cf).map((p) => p.key),
    ]);
    for (const plan of s.plans)
      if (plan.date !== request.date) for (const key of plan.newKeys) submitted.add(key);
    const official = this.store
      .contests(s.cf)
      .filter((c) => c.rating)
      .sort((a, b) => (b.rating?.ratingUpdateTimeSeconds ?? 0) - (a.rating?.ratingUpdateTimeSeconds ?? 0))[0]
      ?.rating?.newRating;
    const band = recommendationDifficulty(this.store.problems(s.cf), s.submissions, problemKey, official);
    const knowledge = new Map(s.tracing.states.map((k) => [k.skillId, k]));
    const readySkill = (id: string) =>
      knowledgeCards
        .find((c) => c.id === id)!
        .prerequisites.every((p) => (knowledge.get(p)?.independentProblems ?? 0) >= 3);
    const available = (s.catalog?.problems ?? []).filter(
      (p) =>
        !submitted.has(p.key) && p.rating !== null && p.rating >= band.minimum && p.rating <= band.maximum,
    );
    const eligible = available.filter(
      (p) => !request.targets.length || knowledgeFor(p.tags).every(readySkill),
    );
    if (eligible.length < available.length)
      warnings.push(
        `${available.length - eligible.length} 道候选建议先补基础，暂不自动安排；仍可手动打开学习`,
      );
    const allMinutes = this.profiles()
      .flatMap((profile) => this.store.all<import('./domain.js').Attempt>('attempts', profile))
      .filter((a) => a.result === 'independent');
    const estimate = (tags: string[], lane: 'review' | 'new') =>
      estimateMinutes(
        allMinutes
          .filter((a) => {
            const row = s.rows.find((p) => p.key === a.problemKey);
            return (
              row &&
              knowledgeFor(row.tags).some((id) => knowledgeFor(tags).includes(id)) &&
              s.tracing.states.some((k) => k.evidenceIds.includes(a.id))
            );
          })
          .map((a) => a.minutes),
        lane,
      );
    const reviewRows = s.rows.filter(
      (p) =>
        p.review.awaitingEvaluation ||
        (p.review.firstRedoAt && !p.review.firstReflectionAt) ||
        (p.review.status === 'reviewing' &&
          p.review.nextReview &&
          localDay(new Date(p.review.nextReview)) <= request.date) ||
        p.review.status === 'pending',
    );
    const kind = (p: (typeof reviewRows)[number]): DailyPlan['review'][number]['kind'] =>
      p.review.firstRedoAt && !p.review.firstReflectionAt
        ? 'reflection'
        : p.review.awaitingEvaluation
          ? 'evaluation'
          : p.review.status === 'reviewing'
            ? 'due'
            : 'pending';
    const order = { evaluation: 0, reflection: 1, due: 2, pending: 3 };
    reviewRows.sort(
      (a, b) =>
        order[kind(a)] - order[kind(b)] ||
        (a.review.nextReview ?? '').localeCompare(b.review.nextReview ?? '') ||
        a.key.localeCompare(b.key),
    );
    const baseline =
      s.before ??
      dailyPlanSchema.parse({
        date: request.date,
        review: reviewRows.slice(0, 5).map((p) => ({ key: p.key, kind: kind(p) })),
        newKeys: s.goal
          ? chooseWeeklyProblems(
              available,
              submitted,
              this.store.combinedStatistics().mastery,
              band,
              request.date,
              s.goal,
            ).keys
          : [],
        catalogReady: !!s.catalog && !!s.goal,
        createdAt: request.date + 'T04:00:00.000Z',
      });
    let candidates: PlanCandidate[] = reviewRows.map((p) => {
      const duration = estimate(p.tags, 'review');
      const required = baseline.review.some((r) => r.key === p.key && r.kind !== 'pending');
      return {
        key: p.key,
        lane: 'review',
        minutes: duration.minutes,
        utility: 100 - order[kind(p)] * 15,
        goal: false,
        required,
        reason: `${{ evaluation: '待评价', reflection: '待完成复盘', due: '到期复习', pending: '待复盘错题' }[kind(p)]}；${duration.basis}`,
      };
    });
    const categoryFrequency = new Map(
      categoryNames.map((category) => [
        category,
        eligible.filter((p) => categories(p.tags).includes(category)).length,
      ]),
    );
    if (s.goal)
      for (const p of eligible) {
        const skills = knowledgeFor(p.tags),
          target = skills.some((id) => s.path.nodes.some((n) => n.id === id)),
          duration = estimate(p.tags, 'new');
        const goal = categories(p.tags).some((c) => s.goal!.categories.includes(c));
        const gap =
          skills.length === 1 && knowledge.get(skills[0]) && !knowledge.get(skills[0])!.insufficient
            ? 1 - knowledge.get(skills[0])!.probability
            : 0.5;
        candidates.push({
          key: p.key,
          lane: 'new',
          minutes: duration.minutes,
          utility: Math.round(
            UTILITY_WEIGHTS.base +
              gap * UTILITY_WEIGHTS.gap +
              Number(goal) * UTILITY_WEIGHTS.goal +
              Number(target) * UTILITY_WEIGHTS.path +
              Math.min(
                4,
                skills.reduce(
                  (sum, id) => sum + (s.path.nodes.find((n) => n.id === id)?.successors.length ?? 0),
                  0,
                ),
              ) *
                UTILITY_WEIGHTS.unlock +
              Math.max(
                0,
                ...categories(p.tags).map(
                  (c) => UTILITY_WEIGHTS.coverage / Math.sqrt(categoryFrequency.get(c) || 1),
                ),
              ) +
              Math.max(0, UTILITY_WEIGHTS.challenge - Math.abs(p.rating! - band.preferred) / 100),
          ),
          required: s.reserved.includes(p.key),
          goal,
          reason: `${goal ? '本周目标；' : ''}${target ? '学习路径节点与后继解锁；' : ''}${skills.length === 1 ? '知识缺口与适度挑战' : '领域与难度规则'}；兼顾候选中较少覆盖的领域；${duration.basis}`,
        });
      }
    for (const key of s.reserved)
      if (!candidates.some((c) => c.key === key && c.required))
        throw new Error(`已预约迁移题 ${key} 不再符合当前候选或先修条件，请先处理预约后重新规划`);
    if (candidates.some((c) => c.required && request.excludeKeys.includes(c.key)))
      throw new Error('必保留任务不能通过换题移除，请先处理原预约或复盘');
    candidates = candidates.filter((c) => !request.excludeKeys.includes(c.key));
    const result = optimizePlan({ candidates, budget: request.budget });
    const selected = new Set(result.selected.map((c) => c.key));
    const after = dailyPlanSchema.parse({
      ...baseline,
      review: reviewRows.filter((p) => selected.has(p.key)).map((p) => ({ key: p.key, kind: kind(p) })),
      newKeys: result.selected.filter((c) => c.lane === 'new').map((c) => c.key),
      newReasons: Object.fromEntries(
        result.selected.filter((c) => c.lane === 'new').map((c) => [c.key, c.reason]),
      ),
      newShortage:
        result.selected.filter((c) => c.lane === 'new').length < 5
          ? '按预算、先修与有效候选安排，不以旧题补足数量'
          : null,
    });
    if (!s.catalog && s.cf) warnings.push('尚无公开题库，已有复习仍可安排');
    if (!s.tracing.states.some((k) => !k.insufficient))
      warnings.push('可信样本不足，使用保守领域规则；知识概率尚未校准');
    const record = planDecisionSchema.parse({
      kind: 'decision',
      id: crypto.randomUUID(),
      scope: this.scope(),
      createdAt: this.now().toISOString(),
      status: 'preview',
      request,
      inputFingerprint: s.hash,
      algorithm: OPTIMIZER_VERSION,
      graphVersion: KNOWLEDGE_GRAPH_VERSION,
      parameters: DEFAULT_BKT,
      utilityWeights: UTILITY_WEIGHTS,
      before: s.before,
      after,
      path: s.path,
      result,
      warnings,
      candidates: candidates
        .filter((c) => !result.excluded.some((e) => e.key === c.key && e.reason === '候选上限'))
        .slice(0, 80),
    });
    this.save(record);
    return record;
  }
  apply(input: unknown, onApplied?: () => void) {
    const { id } = z.object({ id: z.string() }).parse(input);
    const found = this.records().find((r) => r.id === id);
    if (!found || found.kind !== 'decision') throw new Error('计划预览不存在或不属于当前账号');
    if (found.status === 'applied') return found;
    if (found.status !== 'preview' || !found.result.feasible) throw new Error('计划预览已失效或存在约束冲突');
    this.validateFuture(found.request.date);
    if (found.inputFingerprint !== this.snapshot(found.request).hash)
      throw new Error('账号、证据、目录、目标或题单已变化，请重新预览');
    this.store.transaction(() => {
      this.writePlan(found.after, found.request.date);
      found.status = 'applied';
      found.appliedFingerprint = this.snapshot(found.request).hash;
      this.save(found);
      onApplied?.();
    });
    return planDecisionSchema.parse(found);
  }
  revert(input: unknown, onReverted?: () => void) {
    const { id } = z.object({ id: z.string() }).parse(input);
    const found = this.records().find((r) => r.id === id);
    if (!found || found.kind !== 'decision' || found.status !== 'applied')
      throw new Error('此计划版本不可撤回');
    this.validateFuture(found.request.date);
    if (found.appliedFingerprint !== this.snapshot(found.request).hash)
      throw new Error('证据或题单已变化，不能覆盖后续安排，请重新预览');
    this.store.transaction(() => {
      this.writePlan(found.before, found.request.date);
      found.status = 'reverted';
      this.save(found);
      onReverted?.();
    });
    return planDecisionSchema.parse(found);
  }
  route(action: string, method: string, input?: unknown) {
    if (action === 'goal' && method === 'POST') {
      const value = z
        .object({
          date: planningDateSchema,
          mode: z.enum(['focus', 'balanced']),
          categories: z.array(z.enum(categoryNames)).min(1).max(8),
        })
        .parse(input);
      this.scope();
      this.validateFuture(value.date);
      const goal = weeklyGoalSchema.parse({
        ...value,
        week: weekStart(new Date(value.date + 'T12:00:00+08:00')),
        updatedAt: this.now().toISOString(),
      });
      this.store.externalPut(
        `weekly:${this.store.active() || '-'}:${this.store.activeAtcoder().toLowerCase() || '-'}`,
        goal.week,
        goal,
      );
      if (goal.week === weekStart(this.now())) this.store.activateGrowthWeek(this.now());
      return goal;
    }
    if (action === 'state' && method === 'GET') return this.state();
    if (action === 'state' && method === 'PUT') return this.preferences(input);
    if (action === 'path' && method === 'GET') return this.path();
    if (action === 'path' && method === 'POST') return this.path(input);
    if (action === 'preview' && method === 'POST') return this.preview(input);
    if (action === 'apply' && method === 'POST') return this.apply(input);
    if (action === 'revert' && method === 'POST') return this.revert(input);
    throw new Error('未知规划操作');
  }
}
