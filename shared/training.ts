import { z } from 'zod';
import { failures, type Attempt, type CFSubmission, type Problem, type ProblemRow } from './domain.js';

export const categoryNames = [
  '实现与模拟',
  '贪心与构造',
  '数学',
  '数据结构',
  '图与树',
  '动态规划',
  '字符串',
  '搜索与技巧',
] as const;
export type CategoryName = (typeof categoryNames)[number];
export interface MasteryArea {
  name: CategoryName;
  score: number;
  samples: number;
}
export interface TrainingTask {
  key: string;
  source?: 'cf' | 'atcoder' | 'luogu';
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
  recommendationReason?: string;
}
export interface TrainingDay {
  date: string;
  review: TrainingTask[];
  newProblems: TrainingTask[];
  catalogFetchedAt: string | null;
  recentCheckedAt: string | null;
  catalogCount: number;
  mastery: MasteryArea[];
  weeklyGoal?: { week: string; mode: 'focus' | 'balanced'; categories: string[] } | null;
  newShortage?: string | null;
  /** 长期计划当日信息（无计划时为 null）；特殊日由 Dashboard 提示节奏。 */
  programDay?: { index: number; phase: string; theme: string; carryCount: number } | null;
}
export const catalogSchema = z.object({
  fetchedAt: z.string().datetime(),
  problems: z.array(
    z.object({
      key: z.string().min(1).max(200),
      contestId: z.number().int().positive(),
      index: z.string().min(1).max(40),
      name: z.string().min(1).max(1000),
      rating: z.number().nonnegative().nullable(),
      tags: z.array(z.string().max(100)).max(100),
      url: z.url(),
      solvedCount: z.number().int().nonnegative().nullable().optional(),
    }),
  ),
});
export type Catalog = z.infer<typeof catalogSchema>;
export interface DifficultyBand {
  minimum: number;
  maximum: number;
  preferred: number;
  basis: string;
}
export const dailyPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  review: z
    .array(
      z.object({
        key: z.string(),
        kind: z.enum(['due', 'pending', 'reflection', 'evaluation']),
        completedAt: z.string().datetime().optional(),
      }),
    )
    .max(5),
  newKeys: z.array(z.string()).max(10),
  newReasons: z.record(z.string(), z.string().max(500)).optional(),
  newShortage: z.string().max(500).nullable().optional(),
  catalogReady: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type DailyPlan = z.infer<typeof dailyPlanSchema>;
export const trainingMetaSchema = z.object({ recentCheckedAt: z.string().datetime().nullable() });

const tagCategories: Record<string, CategoryName> = {
  implementation: '实现与模拟',
  'brute force': '实现与模拟',
  'two pointers': '实现与模拟',
  greedy: '贪心与构造',
  'constructive algorithms': '贪心与构造',
  sortings: '贪心与构造',
  math: '数学',
  'number theory': '数学',
  combinatorics: '数学',
  probabilities: '数学',
  'data structures': '数据结构',
  'binary search': '数据结构',
  'segment tree': '数据结构',
  graphs: '图与树',
  trees: '图与树',
  dsu: '图与树',
  'shortest paths': '图与树',
  dp: '动态规划',
  bitmasks: '动态规划',
  strings: '字符串',
  'string suffix structures': '字符串',
  'string hashing': '字符串',
  'dfs and similar': '搜索与技巧',
  'meet-in-the-middle': '搜索与技巧',
  games: '搜索与技巧',
  'divide and conquer': '搜索与技巧',
};
export function categories(tags: string[]): CategoryName[] {
  const found = [
    ...new Set(tags.map((tag) => tagCategories[tag]).filter((name): name is CategoryName => !!name)),
  ];
  return found.length ? found : ['实现与模拟'];
}
export function masteryAreas(
  problems: Problem[],
  submissions: CFSubmission[],
  attempts: Attempt[],
  reviews: Map<string, ProblemRow['review']>,
  keyOf: (submission: CFSubmission) => string,
  battle: import('./battle-domain.js').BattleReward[] = [],
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
    const reward = battle.filter((r) => r.problemKey === problem.key).sort((a, b) => b.at.localeCompare(a.at))[0];
    // A later ordinary practice supersedes the historical battle contribution. A same-day
    // ordinary evaluation of the same AC is one fact, not a second reward.
    const laterAttempt = attempt && reward && (
      personal.some((s) => s.verdict === 'OK' && s.creationTimeSeconds * 1000 > Date.parse(reward.at) &&
        s.creationTimeSeconds * 1000 <= Date.parse(attempt.createdAt)) ||
      (attempt.result === 'failed' && Date.parse(attempt.createdAt) > Date.parse(reward.evaluatedAt))
    );
    if (score !== null || reward) {
      const names = ['atcoder', 'luogu'].includes(problem.source ?? '')
        ? (review?.categories ?? [])
        : categories(problem.tags);
      for (const name of names) {
        const contribution = reward && !laterAttempt && review?.status !== 'mastered' && reward.category === name ? reward.score : score;
        if (contribution !== null) buckets.get(name)!.push(contribution);
      }
    }
  }
  return categoryNames.map((name) => {
    const values = buckets.get(name)!;
    return {
      name,
      samples: values.length,
      score: Math.round((values.reduce((sum, n) => sum + n, 0) + 150) / (values.length + 3)),
    };
  });
}
function hash(value: string): number {
  let n = 2166136261;
  for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function weakTags(
  problems: Problem[],
  submissions: CFSubmission[],
  attempts: Attempt[],
  reviews: Map<string, ProblemRow['review']>,
  keyOf: (submission: CFSubmission) => string,
  asOf: Date = new Date(),
): Map<string, number> {
  // 时间衰减：近期失败更能代表当前薄弱点（≤14 天全权重，逐级降权）。
  const decayOf = (atMs: number) => {
    if (!Number.isFinite(atMs)) return 1;
    const ageDays = (asOf.getTime() - atMs) / 86400000;
    return ageDays <= 14 ? 1 : ageDays <= 30 ? 0.6 : 0.35;
  };
  const solved = new Set(submissions.filter((s) => s.verdict === 'OK').map(keyOf));
  const failWeight = new Map<string, number>();
  for (const s of submissions) {
    if (s.verdict && failures.has(s.verdict) && !solved.has(keyOf(s))) {
      const key = keyOf(s);
      failWeight.set(key, (failWeight.get(key) ?? 0) + decayOf(s.creationTimeSeconds * 1000));
    }
  }
  const failedAttemptWeight = new Map<string, number>();
  for (const a of attempts)
    if (a.result === 'failed')
      failedAttemptWeight.set(
        a.problemKey,
        (failedAttemptWeight.get(a.problemKey) ?? 0) + decayOf(Date.parse(a.createdAt)),
      );
  const weights = new Map<string, number>();
  for (const p of problems) {
    if (!p.tags.length) continue;
    let w = failWeight.get(p.key) ?? 0;
    const review = reviews.get(p.key);
    if (review?.status === 'pending')
      w += decayOf(review.firstRedoAt ? Date.parse(review.firstRedoAt) : Number.NaN);
    w += failedAttemptWeight.get(p.key) ?? 0;
    w = Math.min(4, w);
    if (w <= 0) continue;
    for (const tag of p.tags) weights.set(tag, (weights.get(tag) ?? 0) + w);
  }
  const max = Math.max(0, ...weights.values());
  if (max > 0) for (const [tag, w] of weights) weights.set(tag, w / max);
  return weights;
}
const QUALITY_LOG = Math.log10(20000);
function qualityScore(solvedCount: number | null | undefined): number {
  if (solvedCount == null || !Number.isFinite(solvedCount) || solvedCount < 0) return 0.35;
  const base = Math.min(1, Math.log10(solvedCount + 1) / QUALITY_LOG);
  return Math.min(1, base + (solvedCount >= 500 ? 0.15 : 0));
}
export type ProblemRole = 'warmup' | 'core' | 'stretch';
export interface ProblemPick {
  key: string;
  role: ProblemRole;
}
export interface SelectionOptions {
  date: string;
  count: number;
  band: Pick<DifficultyBand, 'minimum' | 'maximum' | 'preferred'>;
  focus?: CategoryName[];
  weak?: Map<string, number>;
  /** 指定单档选题（换题时保持原槽位角色）；缺省按热身/核心/拉伸配额分档。 */
  role?: ProblemRole;
  /** 候选不足时逐级放宽难度窗口 ±100（长期计划保供给用）；每日路径默认严守推荐区间。 */
  relax?: boolean;
}
export interface SelectionResult {
  picks: ProblemPick[];
  shortage: string | null;
}
const roleTarget = (band: Pick<DifficultyBand, 'minimum' | 'maximum' | 'preferred'>, role: ProblemRole) =>
  role === 'warmup' ? band.preferred - 100 : role === 'stretch' ? band.preferred + 100 : band.preferred;
function staticScore(
  p: Catalog['problems'][number],
  masteryScores: Map<CategoryName, number>,
  focus: CategoryName[] | undefined,
  weak: Map<string, number> | undefined,
): number {
  const affinity = Math.min(1, p.tags.reduce((sum, tag) => sum + (weak?.get(tag) ?? 0), 0) / 2);
  const names = categories(p.tags);
  const categoryFit = focus?.length
    ? names.some((n) => focus.includes(n))
      ? 1
      : 0.2
    : 1 - Math.min(...names.map((n) => masteryScores.get(n) ?? 50)) / 100;
  const cold = p.solvedCount != null && p.solvedCount < 20 ? 0.3 : 0;
  return 1.2 * affinity + categoryFit + 0.8 * qualityScore(p.solvedCount) - cold;
}
/**
 * 统一选题引擎：针对性（weakTags 命中）+ 大类契合 + 质量先验（solvedCount）+ 难度贴合，
 * 单日按热身→核心→拉伸分档，同日同比赛/同子标签限两题，逐级放宽保供给，全程确定性排序。
 */
export function selectProblems(
  catalog: Catalog['problems'],
  blocked: Set<string>,
  mastery: MasteryArea[],
  options: SelectionOptions,
): SelectionResult {
  const { date, band, focus, weak } = options;
  const count = Math.max(1, Math.min(10, Math.round(options.count)));
  const masteryScores = new Map(mastery.map((a) => [a.name, a.score]));
  const hashOf = (key: string) => hash(`${date}:${key}`);
  const pool = catalog
    .filter((p) => p.rating !== null && !blocked.has(p.key))
    .map((p) => ({ p, base: staticScore(p, masteryScores, focus, weak) }));
  const used = new Set(blocked);
  const contestCount = new Map<number, number>();
  const tagCount = new Map<string, number>();
  const picks: ProblemPick[] = [];
  const warmup = Math.max(1, Math.round(count * 0.25));
  const stretch = Math.max(1, Math.round(count * 0.15));
  const quota: Record<ProblemRole, number> = options.role
    ? {
        warmup: options.role === 'warmup' ? count : 0,
        core: options.role === 'core' ? count : 0,
        stretch: options.role === 'stretch' ? count : 0,
      }
    : { warmup, core: count - warmup - stretch, stretch };
  const inWindow = (p: Catalog['problems'][number], expand: number) =>
    p.rating! >= band.minimum - expand && p.rating! <= band.maximum + expand;
  const order = (a: { p: Catalog['problems'][number]; score: number }, b: typeof a) =>
    b.score - a.score || hashOf(a.p.key) - hashOf(b.p.key) || a.p.key.localeCompare(b.p.key);
  for (const role of options.role ? [options.role] : (['warmup', 'core', 'stretch'] as const)) {
    let taken = 0;
    for (const expand of options.relax ? [0, 100] : [0]) {
      for (const limitTags of [true, false]) {
        const candidates = pool
          .filter(({ p }) => !used.has(p.key) && inWindow(p, expand))
          .map(({ p, base }) => ({ p, score: base + Math.max(0, 1 - Math.abs(p.rating! - roleTarget(band, role)) / 300) }))
          .sort(order);
        for (const { p } of candidates) {
          if (taken >= quota[role]) break;
          const limit = limitTags ? 2 : Number.POSITIVE_INFINITY;
          if ((contestCount.get(p.contestId) ?? 0) >= limit) continue;
          if (p.tags.some((t) => (tagCount.get(t) ?? 0) >= limit)) continue;
          used.add(p.key);
          contestCount.set(p.contestId, (contestCount.get(p.contestId) ?? 0) + 1);
          for (const t of p.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
          picks.push({ key: p.key, role });
          taken++;
        }
        if (taken >= quota[role]) break;
      }
      if (taken >= quota[role]) break;
    }
  }
  return {
    picks,
    shortage:
      picks.length < count
        ? `难度 ${band.minimum}–${band.maximum} 内仅选出 ${picks.length} 道未做过的合适题目（目标 ${count} 题）`
        : null,
  };
}
export function chooseNewProblems(
  catalog: Catalog['problems'],
  blocked: Set<string>,
  mastery: MasteryArea[],
  difficulty: DifficultyBand,
  date: string,
  count = 8,
  weak?: Map<string, number>,
): string[] {
  return selectProblems(catalog, blocked, mastery, { date, count, band: difficulty, weak }).picks.map(
    (p) => p.key,
  );
}
export function recommendationDifficulty(
  problems: Problem[],
  submissions: CFSubmission[],
  keyOf: (s: CFSubmission) => string,
  officialRating?: number,
): DifficultyBand {
  const solved = new Set(submissions.filter((s) => s.verdict === 'OK').map(keyOf));
  const rated = problems
    .filter((p) => p.rating !== null && solved.has(p.key))
    .map((p) => p.rating!)
    .sort((a, b) => a - b);
  const median = rated.length ? rated[Math.floor((rated.length - 1) / 2)] : null;
  const hasRating = officialRating !== undefined && Number.isFinite(officialRating) && officialRating > 0;
  const minimum = hasRating ? Math.max(800, officialRating) : median === null ? 1000 : median + 100;
  const maximum = hasRating ? Math.max(800, officialRating + 300) : minimum + 300;
  const preferred = Math.min(
    maximum,
    Math.max(
      minimum,
      hasRating ? Math.max(officialRating + 100, (median ?? officialRating) + 100) : minimum + 100,
    ),
  );
  return {
    minimum,
    maximum,
    preferred,
    basis: hasRating
      ? `CF 官方 Rating ${officialRating}`
      : median === null
        ? '暂无官方 Rating 和已 AC 难度，按 1000 起步'
        : `暂无官方 Rating，按唯一已 AC 题中位难度 ${median} 加 100`,
  };
}
