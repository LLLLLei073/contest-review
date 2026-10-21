import { z } from 'zod';

export const OPTIMIZER_VERSION = 'budget-dp-1';
export const candidateSchema = z.object({
  key: z.string().min(1).max(200),
  lane: z.enum(['review', 'new']),
  minutes: z.number().positive().max(1440),
  utility: z.number().finite().min(0).max(10000),
  goal: z.boolean(),
  required: z.boolean(),
  reason: z.string().max(500),
});
export type PlanCandidate = z.infer<typeof candidateSchema>;
const inputSchema = z.object({
  candidates: z.array(candidateSchema).max(20000),
  budget: z.number().int().min(15).max(240).nullable().default(null),
});
interface Choice {
  items: PlanCandidate[];
  cost: number;
  value: number;
  review: number;
  fresh: number;
  goal: number;
}
const cost = (c: PlanCandidate) => Math.ceil(c.minutes / 5);
function better(a: Choice, b?: Choice) {
  return (
    !b ||
    a.value > b.value ||
    (a.value === b.value &&
      (a.cost < b.cost ||
        (a.cost === b.cost && a.items.map((c) => c.key).join('\n') < b.items.map((c) => c.key).join('\n'))))
  );
}

/** Optimal only over the bounded candidate set and conservative five-minute model. */
export function optimizePlan(input: z.input<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const unique = new Map<string, PlanCandidate>();
  for (const c of parsed.candidates) {
    const old = unique.get(c.key);
    if (old && JSON.stringify(old) !== JSON.stringify(c)) throw new Error(`候选题存在冲突定义：${c.key}`);
    unique.set(c.key, c);
  }
  const all = [...unique.values()].sort((a, b) => a.key.localeCompare(b.key));
  const required = all.filter((c) => c.required);
  const goalQuota = Math.min(2, all.filter((c) => c.lane === 'new' && c.goal).length);
  const requiredReview = required.filter((c) => c.lane === 'review').length;
  const requiredNew = required.length - requiredReview;
  const requiredGoal = required.filter((c) => c.lane === 'new' && c.goal).length;
  const goalNeeded = Math.max(0, goalQuota - requiredGoal);
  const cheapGoals = all
    .filter((c) => c.lane === 'new' && c.goal && !c.required)
    .sort((a, b) => cost(a) - cost(b) || b.utility - a.utility || a.key.localeCompare(b.key))
    .slice(0, goalNeeded);
  const minimumMinutes = 5 * [...required, ...cheapGoals].reduce((sum, c) => sum + cost(c), 0);
  const conflicts: string[] = [];
  if (requiredReview > 5 || requiredNew + goalNeeded > 5)
    conflicts.push('必保留任务与周目标配额超过每栏五题限制');
  if (parsed.budget !== null && minimumMinutes > parsed.budget)
    conflicts.push(`至少需要 ${minimumMinutes} 分钟才能保留预约任务并满足周目标`);
  // Preserve mandatory tasks and the cheapest quota witnesses before capping candidates.
  const shortlist = new Map([...required, ...cheapGoals].map((c) => [c.key, c]));
  const ranked = all
    .filter((c) => !shortlist.has(c.key))
    .sort((a, b) => b.utility - a.utility || cost(a) - cost(b) || a.key.localeCompare(b.key));
  const lanes = [ranked.filter((c) => c.lane === 'review'), ranked.filter((c) => c.lane === 'new')];
  for (let i = 0; shortlist.size < 80 && i < ranked.length; i++) {
    for (const lane of lanes) if (lane[i] && shortlist.size < 80) shortlist.set(lane[i].key, lane[i]);
  }
  const candidates = [...shortlist.values()].sort((a, b) => a.key.localeCompare(b.key));
  const base = {
    version: OPTIMIZER_VERSION,
    budget: parsed.budget,
    goalQuota,
    minimumMinutes,
    candidateCount: all.length,
    consideredCount: Math.min(80, candidates.length),
    truncated: all.length > 80,
  };
  const excluded = (selected: PlanCandidate[]) =>
    all
      .filter((c) => !selected.some((s) => s.key === c.key))
      .map((c) => ({
        key: c.key,
        reason: !shortlist.has(c.key)
          ? '候选上限'
          : conflicts.length
            ? '约束冲突，未应用变更'
            : '预算、题量或组合效用优先级',
      }));
  if (conflicts.length)
    return {
      ...base,
      feasible: false as const,
      conflicts,
      selected: [] as PlanCandidate[],
      allocatedMinutes: 0,
      estimatedMinutes: 0,
      utility: 0,
      excluded: excluded([]),
    };
  const initial: Choice = {
    items: required,
    cost: required.reduce((sum, c) => sum + cost(c), 0),
    value: required.reduce((sum, c) => sum + c.utility, 0),
    review: requiredReview,
    fresh: requiredNew,
    goal: Math.min(goalQuota, requiredGoal),
  };
  const key = (s: Choice) => `${parsed.budget === null ? 0 : s.cost}:${s.review}:${s.fresh}:${s.goal}`;
  let dp = new Map<string, Choice>([[key(initial), initial]]);
  for (const c of candidates.filter((c) => !c.required)) {
    const next = new Map(dp);
    for (const old of dp.values()) {
      const choice: Choice = {
        items: [...old.items, c].sort((a, b) => a.key.localeCompare(b.key)),
        cost: old.cost + cost(c),
        value: old.value + c.utility,
        review: old.review + Number(c.lane === 'review'),
        fresh: old.fresh + Number(c.lane === 'new'),
        goal: Math.min(goalQuota, old.goal + Number(c.lane === 'new' && c.goal)),
      };
      if (
        choice.review > 5 ||
        choice.fresh > 5 ||
        (parsed.budget !== null && choice.cost * 5 > parsed.budget)
      )
        continue;
      const k = key(choice);
      if (better(choice, next.get(k))) next.set(k, choice);
    }
    dp = next;
  }
  let best: Choice | undefined;
  for (const choice of dp.values()) if (choice.goal >= goalQuota && better(choice, best)) best = choice;
  if (!best) throw new Error('计划求解失败：可行性预检与动态规划不一致');
  return {
    ...base,
    feasible: true as const,
    conflicts,
    selected: best.items,
    allocatedMinutes: best.cost * 5,
    estimatedMinutes: best.items.reduce((sum, c) => sum + c.minutes, 0),
    utility: best.value,
    excluded: excluded(best.items),
  };
}

export function estimateMinutes(samples: number[], lane: 'review' | 'new') {
  const valid = samples.filter((n) => Number.isFinite(n) && n > 0 && n <= 240).sort((a, b) => a - b);
  if (valid.length < 3)
    return {
      minutes: lane === 'review' ? 20 : 35,
      basis: '样本不足，使用保守默认估时',
      samples: valid.length,
    };
  const middle = Math.floor(valid.length / 2);
  const median = valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
  return { minutes: Math.max(5, median), basis: '同类独立尝试有效耗时中位数', samples: valid.length };
}
