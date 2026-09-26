import { z } from 'zod';
import { failures, type Attempt, type CFSubmission, type Problem, type ProblemRow } from './domain.js';

export const categoryNames = [
  '实现与模拟', '贪心与构造', '数学', '数据结构', '图与树', '动态规划', '字符串', '搜索与技巧',
] as const;
export type CategoryName = (typeof categoryNames)[number];
export interface MasteryArea { name: CategoryName; score: number; samples: number }
export interface TrainingTask {
  key: string;
  name: string;
  rating: number | null;
  tags: string[];
  url: string;
  kind: 'due' | 'pending' | 'reflection' | 'evaluation' | 'new';
  phase: 'redo' | 'reflection' | 'evaluation' | 'done';
  redoAccepted: boolean;
  completed: boolean;
  attempted: boolean;
  nextReview: string | null;
}
export interface TrainingDay {
  date: string;
  review: TrainingTask[];
  newProblems: TrainingTask[];
  catalogFetchedAt: string | null;
  recentCheckedAt: string | null;
  catalogCount: number;
  mastery: MasteryArea[];
}
export const catalogSchema = z.object({
  fetchedAt: z.string().datetime(),
  problems: z.array(z.object({
    key: z.string().min(1).max(200),
    contestId: z.number().int().positive(),
    index: z.string().min(1).max(40),
    name: z.string().min(1).max(1000),
    rating: z.number().nonnegative().nullable(),
    tags: z.array(z.string().max(100)).max(100),
    url: z.url(),
  })),
});
export type Catalog = z.infer<typeof catalogSchema>;
export const dailyPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  review: z.array(z.object({ key: z.string(), kind: z.enum(['due', 'pending', 'reflection', 'evaluation']), completedAt: z.string().datetime().optional() })).max(5),
  newKeys: z.array(z.string()).max(5),
  catalogReady: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type DailyPlan = z.infer<typeof dailyPlanSchema>;
export const trainingMetaSchema = z.object({ recentCheckedAt: z.string().datetime().nullable() });

const tagCategories: Record<string, CategoryName> = {
  implementation: '实现与模拟', 'brute force': '实现与模拟', 'two pointers': '实现与模拟',
  greedy: '贪心与构造', 'constructive algorithms': '贪心与构造', sortings: '贪心与构造',
  math: '数学', 'number theory': '数学', combinatorics: '数学', probabilities: '数学',
  'data structures': '数据结构', 'binary search': '数据结构', 'segment tree': '数据结构',
  graphs: '图与树', trees: '图与树', dsu: '图与树', 'shortest paths': '图与树',
  dp: '动态规划', 'bitmasks': '动态规划',
  strings: '字符串', 'string suffix structures': '字符串', 'string hashing': '字符串',
  'dfs and similar': '搜索与技巧', 'meet-in-the-middle': '搜索与技巧',
  games: '搜索与技巧', 'divide and conquer': '搜索与技巧',
};
export function categories(tags: string[]): CategoryName[] {
  const found = [...new Set(tags.map((tag) => tagCategories[tag]).filter((name): name is CategoryName => !!name))];
  return found.length ? found : ['实现与模拟'];
}
export function masteryAreas(
  problems: Problem[], submissions: CFSubmission[], attempts: Attempt[], reviews: Map<string, ProblemRow['review']>,
  keyOf: (submission: CFSubmission) => string,
): MasteryArea[] {
  const subs = new Map<string, CFSubmission[]>();
  for (const submission of submissions) {
    const key = keyOf(submission);
    subs.set(key, [...(subs.get(key) ?? []), submission]);
  }
  const latest = new Map<string, Attempt>();
  for (const attempt of attempts)
    if (!latest.has(attempt.problemKey) || latest.get(attempt.problemKey)!.createdAt < attempt.createdAt)
      latest.set(attempt.problemKey, attempt);
  const buckets = new Map<CategoryName, number[]>(categoryNames.map((name) => [name, []]));
  for (const problem of problems) {
    const review = reviews.get(problem.key);
    if (review?.ignored) continue;
    const personal = subs.get(problem.key) ?? [];
    const attempt = latest.get(problem.key);
    let score: number | null = null;
    if (review?.status === 'mastered') score = 100;
    else if (attempt) score = { independent: 85, hint: 45, failed: 15 }[attempt.result];
    else if (personal.some((s) => s.verdict === 'OK')) score = 70;
    else if (personal.some((s) => failures.has(s.verdict ?? ''))) score = 20;
    if (score !== null)
      for (const name of categories(problem.tags)) buckets.get(name)!.push(score);
  }
  return categoryNames.map((name) => {
    const values = buckets.get(name)!;
    return { name, samples: values.length, score: Math.round((values.reduce((sum, n) => sum + n, 0) + 150) / (values.length + 3)) };
  });
}
function hash(value: string): number {
  let n = 2166136261;
  for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function chooseNewProblems(
  catalog: Catalog['problems'], blocked: Set<string>, mastery: MasteryArea[], targetRating: number, date: string,
): string[] {
  const available = catalog.filter((p) => !blocked.has(p.key));
  const buckets = new Map<CategoryName, Catalog['problems']>(categoryNames.map((name) => [name, []]));
  for (const problem of available)
    for (const category of categories(problem.tags)) buckets.get(category)!.push(problem);
  const order = (a: Catalog['problems'][number], b: Catalog['problems'][number]) =>
    (a.rating === null ? 10000 : Math.abs(a.rating - targetRating)) -
      (b.rating === null ? 10000 : Math.abs(b.rating - targetRating)) ||
    hash(`${date}:${a.key}`) - hash(`${date}:${b.key}`) || a.key.localeCompare(b.key);
  for (const bucket of buckets.values()) bucket.sort(order);
  const weights = new Map(mastery.map((area) => [area.name, 1 / (area.score + 10)]));
  const selected: string[] = [];
  const allocated = new Map<CategoryName, number>(categoryNames.map((name) => [name, 0]));
  while (selected.length < 5) {
    const active = categoryNames.filter((name) => buckets.get(name)!.some((p) => !blocked.has(p.key)));
    if (!active.length) break;
    const total = active.reduce((n, name) => n + weights.get(name)!, 0);
    active.sort((a, b) =>
      (5 * weights.get(b)! / total - allocated.get(b)!) -
        (5 * weights.get(a)! / total - allocated.get(a)!) ||
      categoryNames.indexOf(a) - categoryNames.indexOf(b),
    );
    const category = active[0];
    const problem = buckets.get(category)!.find((p) => !blocked.has(p.key))!;
    selected.push(problem.key);
    blocked.add(problem.key);
    allocated.set(category, allocated.get(category)! + 1);
  }
  return selected;
}
export function targetDifficulty(problems: Problem[], submissions: CFSubmission[], keyOf: (s: CFSubmission) => string): number {
  const solved = new Set(submissions.filter((s) => s.verdict === 'OK').map(keyOf));
  const rated = problems.filter((p) => p.rating !== null && solved.has(p.key)).map((p) => p.rating!).sort((a, b) => a - b);
  const attempted = problems.filter((p) => p.rating !== null).map((p) => p.rating!).sort((a, b) => a - b);
  const values = rated.length ? rated : attempted;
  return values.length ? values[Math.floor((values.length - 1) / 2)] : 800;
}
