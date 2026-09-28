import { z } from 'zod';
import { categories, categoryNames, chooseNewProblems, type Catalog, type MasteryArea } from './training.js';

export const weeklyGoalSchema = z
  .object({
    week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mode: z.enum(['focus', 'balanced']),
    categories: z.array(z.enum(categoryNames)).min(1).max(8),
    updatedAt: z.string().datetime(),
  })
  .refine((value) => value.mode !== 'focus' || value.categories.length === 1, '专注模式只能选择一个领域')
  .refine((value) => value.mode !== 'balanced' || value.categories.length >= 2, '均衡模式至少选择两个领域');
export type WeeklyGoal = z.infer<typeof weeklyGoalSchema>;

export function weekStart(date: Date): string {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function hash(value: string): number {
  let n = 2166136261;
  for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 0;
}

export interface PickResult {
  keys: string[];
  reasons: Record<string, string>;
  goalCount: number;
  shortage: string | null;
}
export function chooseWeeklyProblems(
  catalog: Catalog['problems'],
  blocked: Set<string>,
  mastery: MasteryArea[],
  targetRating: number,
  date: string,
  goal: WeeklyGoal,
  priorCoverage: Record<string, number> = {},
): PickResult {
  const available = catalog.filter((p) => !blocked.has(p.key));
  const scores = new Map(mastery.map((a) => [a.name, a.score]));
  const order = (a: Catalog['problems'][number], b: Catalog['problems'][number]) =>
    (a.rating === null ? 10000 : Math.abs(a.rating - targetRating)) -
      (b.rating === null ? 10000 : Math.abs(b.rating - targetRating)) ||
    hash(`${date}:${a.key}`) - hash(`${date}:${b.key}`) ||
    a.key.localeCompare(b.key);
  const keys: string[] = [];
  const reasons: Record<string, string> = {};
  const used = new Set(blocked);
  let goalCount = 0;
  for (let i = 0; i < 2; i++) {
    const eligible = available.filter(
      (p) => !used.has(p.key) && categories(p.tags).some((c) => goal.categories.includes(c)),
    );
    if (!eligible.length) break;
    const category = [...goal.categories].sort(
      (a, b) =>
        (priorCoverage[a] ?? 0) - (priorCoverage[b] ?? 0) ||
        (scores.get(a) ?? 50) - (scores.get(b) ?? 50) ||
        a.localeCompare(b),
    )[0];
    const selected =
      eligible.filter((p) => categories(p.tags).includes(category)).sort(order)[0] ?? eligible.sort(order)[0];
    const matched = categories(selected.tags).filter((c) => goal.categories.includes(c));
    keys.push(selected.key);
    used.add(selected.key);
    goalCount++;
    for (const c of matched) priorCoverage[c] = (priorCoverage[c] ?? 0) + 1;
    reasons[selected.key] =
      `本周目标：${matched.join('、')}；难度${selected.rating ?? '未知'}，参考难度${targetRating}`;
  }
  const byKey = new Map(available.map((p) => [p.key, p]));
  for (const key of chooseNewProblems(catalog, new Set(used), mastery, targetRating, date).slice(
    0,
    5 - keys.length,
  )) {
    const selected = byKey.get(key)!;
    keys.push(key);
    const weak = categories(selected.tags).sort((a, b) => (scores.get(a) ?? 50) - (scores.get(b) ?? 50))[0];
    reasons[key] =
      `薄弱领域：${weak}（掌握度 ${scores.get(weak) ?? 50}）；难度${selected.rating ?? '未知'}，参考难度${targetRating}`;
  }
  return {
    keys,
    reasons,
    goalCount,
    shortage:
      goalCount < 2
        ? `本周目标领域仅找到 ${goalCount} 道符合条件的新题`
        : keys.length < 5
          ? `仅找到 ${keys.length} 道符合条件的新题`
          : null,
  };
}
