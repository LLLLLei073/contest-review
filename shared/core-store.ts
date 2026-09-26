import { z } from 'zod';
import { catalogSchema, dailyPlanSchema, trainingMetaSchema, masteryAreas, chooseNewProblems, targetDifficulty, type Catalog, type DailyPlan, type TrainingDay } from './training.js';
import { xcpcRecordSchema } from './xcpc.js';
import {
  analysisCacheSchema,
  analyzeContest,
  contestSessions,
  type AnalysisCache,
  type AnalysisReport,
} from './contest-analysis.js';
import {
  attemptSchema,
  emptyReview,
  hasReflection,
  failures,
  nextReviewState,
  problemSchema,
  reviewSchema,
  type Attempt,
  type AttemptInput,
  type CFContest,
  type CFRating,
  type CFSubmission,
  type ContestReview,
  type ContestRow,
  type Problem,
  type ProblemRow,
  type Review,
  type Statistics,
  type SyncJob,
} from './domain.js';

export const tables = [
  'problems',
  'submissions',
  'reviews',
  'contests',
  'contest_reviews',
  'attempts',
  'jobs',
  'analysis_cache',
  'catalog_cache',
  'daily_plans',
  'training_meta',
] as const;
export type Table = (typeof tables)[number];
export const submissionSchema = z.object({
  id: z.number().int().positive(),
  contestId: z.number().int().positive().optional(),
  creationTimeSeconds: z.number().nonnegative(),
  relativeTimeSeconds: z.number().optional(),
  problem: z.object({
    contestId: z.number().int().positive().optional(),
    problemsetName: z.string().optional(),
    index: z.string().min(1),
    name: z.string().min(1),
    rating: z.number().optional(),
    tags: z.array(z.string()),
  }),
  verdict: z.string().optional(),
  programmingLanguage: z.string(),
  author: z.object({
    participantType: z.string(),
    startTimeSeconds: z.number().optional(),
    teamId: z.number().optional(),
    members: z.array(z.object({ handle: z.string() })).optional(),
    ghost: z.boolean().optional(),
  }),
});
export const contestReviewSchema = z.object({
  timeAllocation: z.string().max(100000),
  mistakes: z.string().max(100000),
  improvements: z.string().max(100000),
});
const contestSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  startTimeSeconds: z.number().optional(),
  durationSeconds: z.number().optional(),
  phase: z.string().optional(),
  type: z.enum(['CF', 'IOI', 'ICPC']).optional(),
  frozen: z.boolean().optional(),
  rating: z
    .object({
      contestId: z.number().int().positive(),
      contestName: z.string(),
      oldRating: z.number(),
      newRating: z.number(),
      rank: z.number(),
      ratingUpdateTimeSeconds: z.number().optional(),
    })
    .optional(),
});
export const jobSchema = z.object({
  id: z.string(),
  handle: z.string(),
  mode: z.enum(['full', 'incremental']),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  processed: z.number().int().nonnegative(),
  cursor: z.number().int().positive(),
  message: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
});
const payloadSchemas: Record<Table, z.ZodType> = {
  problems: problemSchema,
  submissions: submissionSchema,
  reviews: reviewSchema,
  contests: contestSchema,
  contest_reviews: contestReviewSchema,
  attempts: attemptSchema.extend({
    id: z.string(),
    problemKey: z.string(),
    createdAt: z.string().datetime(),
  }),
  jobs: jobSchema,
  analysis_cache: analysisCacheSchema,
  catalog_cache: catalogSchema,
  daily_plans: dailyPlanSchema,
  training_meta: trainingMetaSchema,
};
const handleSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/);
const backupSchema = z.object({
  format: z.literal('contest-review'),
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  exportedAt: z.string().datetime(),
  activeHandle: z.string(),
  profiles: z.array(handleSchema).max(1000),
  tables: z.object(
    Object.fromEntries(
      tables.map((t) => [
        t,
        z.array(z.object({ profile: handleSchema, key: z.string().min(1).max(200), value: z.unknown() })),
      ]),
    ) as Record<
      Table,
      z.ZodArray<z.ZodObject<{ profile: typeof handleSchema; key: z.ZodString; value: z.ZodUnknown }>>
    >,
  ),
  external: z
    .array(
      z.object({
        namespace: z.string().min(1).max(300),
        key: z.string().min(1).max(300),
        value: z.unknown(),
      }),
    )
    .optional(),
  xcpcActive: z.string().max(300).optional(),
  xcpcMode: z.enum(['official', 'all']).optional(),
});
export function problemKey(s: CFSubmission): string {
  return s.problem.contestId
    ? `${s.problem.contestId}:${s.problem.index}`
    : `${s.problem.problemsetName || 'other'}:${s.problem.index}`;
}

export type SQLValue = string | number | null | Uint8Array;
export interface DatabaseLike {
  exec(sql: string): unknown;
  close(): void;
  prepare(sql: string): {
    get(...params: SQLValue[]): Record<string, unknown> | undefined;
    all(...params: SQLValue[]): Record<string, unknown>[];
    run(...params: SQLValue[]): unknown;
  };
}
export class CoreStore {
  constructor(
    public db: DatabaseLike,
    private beforeRestore?: (backup: unknown) => string | null,
  ) {
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = Number(
      (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
    if (version > 4) throw new Error('数据库来自更新版本，请升级程序');
    if (version === 0)
      this.transaction(() => {
        this.db.exec(
          'CREATE TABLE profiles (handle TEXT PRIMARY KEY); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
        );
        for (const table of tables)
          this.db.exec(
            `CREATE TABLE ${table} (profile TEXT NOT NULL REFERENCES profiles(handle), key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(profile,key));`,
          );
        this.db.exec('PRAGMA user_version=2');
      });
    if (version === 1)
      this.transaction(() => {
        this.db.exec(
          'CREATE TABLE analysis_cache (profile TEXT NOT NULL REFERENCES profiles(handle), key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(profile,key)); PRAGMA user_version=2;',
        );
      });
    if (version <= 2)
      this.transaction(() => {
        this.db.exec(
          'CREATE TABLE external (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)); PRAGMA user_version=3;',
        );
      });
    if (version <= 3)
      this.transaction(() => {
        for (const table of ['catalog_cache', 'daily_plans', 'training_meta'])
          this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (profile TEXT NOT NULL REFERENCES profiles(handle), key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(profile,key));`);
        this.db.exec('PRAGMA user_version=4');
      });
    for (const h of this.handles())
      for (const job of this.all<SyncJob>('jobs', h))
        if (job.status === 'running')
          this.put('jobs', h, job.id, { ...job, status: 'interrupted', message: '程序已重启，可继续同步。' });
  }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.db.close();
  }
  all<T>(table: Table, profile: string): T[] {
    return (
      this.db.prepare(`SELECT value FROM ${table} WHERE profile=? ORDER BY rowid`).all(profile) as {
        value: string;
      }[]
    ).map((r) => JSON.parse(r.value) as T);
  }
  get<T>(table: Table, profile: string, key: string): T | undefined {
    const r = this.db.prepare(`SELECT value FROM ${table} WHERE profile=? AND key=?`).get(profile, key) as
      { value: string } | undefined;
    return r ? JSON.parse(r.value) : undefined;
  }
  put(table: Table, profile: string, key: string, value: unknown) {
    this.db
      .prepare(
        `INSERT INTO ${table}(profile,key,value) VALUES(?,?,?) ON CONFLICT(profile,key) DO UPDATE SET value=excluded.value`,
      )
      .run(profile, key, JSON.stringify(value));
  }
  externalGet<T>(namespace: string, key: string): T | undefined {
    const row = this.db
      .prepare('SELECT value FROM external WHERE namespace=? AND key=?')
      .get(namespace, key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  externalAll<T>(namespace: string): T[] {
    return (
      this.db.prepare('SELECT value FROM external WHERE namespace=? ORDER BY rowid').all(namespace) as {
        value: string;
      }[]
    ).map((row) => JSON.parse(row.value) as T);
  }
  externalAllPrefix<T>(namespace: string, prefix: string): T[] {
    return (
      this.db
        .prepare('SELECT value FROM external WHERE namespace=? AND substr(key,1,?)=? ORDER BY rowid')
        .all(namespace, prefix.length, prefix) as { value: string }[]
    ).map((row) => JSON.parse(row.value) as T);
  }
  externalPut(namespace: string, key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO external(namespace,key,value) VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value',
      )
      .run(namespace, key, JSON.stringify(value));
  }
  setting(key: string): string {
    return (
      (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)
        ?.value || ''
    );
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  handles(): string[] {
    return (this.db.prepare('SELECT handle FROM profiles ORDER BY handle').all() as { handle: string }[]).map(
      (r) => r.handle,
    );
  }
  active(): string {
    return (
      (
        this.db.prepare("SELECT value FROM settings WHERE key='active'").get() as
          { value: string } | undefined
      )?.value || ''
    );
  }
  activate(handle: string) {
    handleSchema.parse(handle);
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO profiles(handle) VALUES(?)').run(handle);
      this.db
        .prepare(
          "INSERT INTO settings(key,value) VALUES('active',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(handle);
    });
  }
  review(h: string, key: string): Review {
    return reviewSchema.parse(this.get<Review>('reviews', h, key) || emptyReview());
  }
  saveReview(h: string, key: string, review: Review) {
    if (!this.get('problems', h, key)) throw new Error('题目不存在');
    const old = this.review(h, key);
    const next = reviewSchema.parse({ ...review, firstRedoAt: old.firstRedoAt,
      firstReflectionAt: old.firstReflectionAt, firstReflectionRequired: old.firstReflectionRequired,
      awaitingEvaluation: old.awaitingEvaluation,
      lastEvaluatedDay: old.lastEvaluatedDay });
    if (old.firstReflectionRequired && old.firstRedoAt && !old.firstReflectionAt && hasReflection(next)) next.firstReflectionAt = new Date().toISOString();
    this.put('reviews', h, key, next);
    return next;
  }
  updateReview(h: string, key: string, review: Review, action: 'save' | 'complete' | 'restart') {
    const old = this.review(h, key);
    const next = { ...review, stage: old.stage, status: old.status,
      nextReview: old.awaitingEvaluation ? null : review.nextReview };
    if (action === 'restart') {
      next.status = 'reviewing'; next.stage = 0; next.ignored = false;
      next.nextReview = new Date(Date.now() + 86400000).toISOString();
    }
    if (action === 'complete' && !old.firstRedoAt) throw new Error('请先重做题目，再保存复盘');
    if (next.status === 'mastered') next.nextReview = null;
    if (next.status === 'reviewing' && !next.nextReview && !old.awaitingEvaluation && action !== 'complete')
      throw new Error('复习中的题目需要设置下次日期');
    return this.saveReview(h, key, reviewSchema.parse(next));
  }
  private reconcileAcceptedRedo(h: string, date: string) {
    const plan = this.get<DailyPlan>('daily_plans', h, date);
    if (!plan) return;
    const submissions = this.all<CFSubmission>('submissions', h);
    for (const item of plan.review) {
      const review = this.review(h, item.key);
      if (review.ignored || review.status === 'mastered' || review.lastEvaluatedDay === date) continue;
      const accepted = submissions.filter((s) => !s.author.teamId && problemKey(s) === item.key && s.verdict === 'OK' && localDay(new Date(s.creationTimeSeconds * 1000)) === date)
        .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id)[0];
      if (accepted) {
        const redoAt = new Date(accepted.creationTimeSeconds * 1000).toISOString();
        if (review.awaitingEvaluation?.submissionId !== accepted.id || !review.firstRedoAt) {
          this.put('reviews', h, item.key, { ...review, firstRedoAt: review.firstRedoAt ?? redoAt,
            firstReflectionRequired: review.firstReflectionRequired || review.status === 'pending',
            awaitingEvaluation: { date, submissionId: accepted.id, redoAt,
              previousNextReview: review.awaitingEvaluation?.previousNextReview ?? review.nextReview }, nextReview: null });
        }
      } else if (review.awaitingEvaluation?.date === date) {
        this.put('reviews', h, item.key, { ...review, awaitingEvaluation: null,
          nextReview: review.awaitingEvaluation.previousNextReview,
          firstRedoAt: review.status === 'pending' ? null : review.firstRedoAt });
      }
    }
  }
  manualProblem(
    h: string,
    data: { contestId: number; index: string; name: string; tags: string[]; rating: number | null },
  ) {
    const key = `${data.contestId}:${data.index}`;
    const old = this.get<Problem>('problems', h, key);
    this.put(
      'problems',
      h,
      key,
      problemSchema.parse({
        ...data,
        ...old,
        key,
        manual: true,
        url: `https://codeforces.com/contest/${data.contestId}/problem/${data.index}`,
      }),
    );
    if (!this.get('reviews', h, key)) this.put('reviews', h, key, emptyReview());
    return key;
  }
  ingest(h: string, input: CFSubmission[]) {
    const submissions = z.array(submissionSchema).parse(input);
    const affectedDays = new Set(submissions.map((s) => localDay(new Date(s.creationTimeSeconds * 1000))));
    this.transaction(() => {
      for (const s of submissions) {
        const key = problemKey(s),
          old = this.get<Problem>('problems', h, key);
        const p: Problem = {
          key,
          contestId: s.problem.contestId ?? null,
          index: s.problem.index,
          name: s.problem.name,
          rating: s.problem.rating ?? old?.rating ?? null,
          tags: s.problem.tags,
          manual: old?.manual || false,
          url: s.problem.contestId
            ? `https://codeforces.com/${s.problem.contestId >= 100000 ? 'gym' : 'contest'}/${s.problem.contestId}/problem/${s.problem.index}`
            : 'https://codeforces.com/problemset',
        };
        this.put('problems', h, key, p);
        this.put('submissions', h, String(s.id), s);
        if (failures.has(s.verdict || '') && !this.get('reviews', h, key))
          this.put('reviews', h, key, emptyReview());
      }
      for (const date of affectedDays) this.reconcileAcceptedRedo(h, date);
    });
  }
  enrich(h: string, contests: CFContest[], ratings: CFRating[], problems: CFSubmission['problem'][]) {
    const relevant = new Set(this.all<Problem>('problems', h).map((p) => p.contestId));
    this.transaction(() => {
      for (const c of contests)
        if (relevant.has(c.id) || ratings.some((r) => r.contestId === c.id))
          this.put('contests', h, String(c.id), {
            ...c,
            rating:
              ratings.find((r) => r.contestId === c.id) ??
              this.get<CFContest & { rating?: CFRating }>('contests', h, String(c.id))?.rating,
          });
      for (const r of ratings)
        this.put('contests', h, String(r.contestId), {
          id: r.contestId,
          name: r.contestName,
          ...this.get<CFContest>('contests', h, String(r.contestId)),
          rating: r,
        });
      for (const p of problems) {
        const key = `${p.contestId}:${p.index}`,
          old = this.get<Problem>('problems', h, key);
        if (old)
          this.put('problems', h, key, { ...old, name: p.name, tags: p.tags, rating: p.rating ?? null });
      }
      if (problems.length) {
        const catalog = new Map<string, Catalog['problems'][number]>();
        for (const p of problems) {
          if (!p.contestId || p.contestId >= 100000 || !p.index || !p.name) continue;
          const key = `${p.contestId}:${p.index}`;
          catalog.set(key, {
            key, contestId: p.contestId, index: p.index, name: p.name,
            rating: p.rating ?? null, tags: p.tags,
            url: `https://codeforces.com/contest/${p.contestId}/problem/${p.index}`,
          });
        }
        this.put('catalog_cache', h, 'current', catalogSchema.parse({ fetchedAt: new Date().toISOString(), problems: [...catalog.values()] }));
      }
    });
  }
  trainingDay(h: string, now = new Date()): TrainingDay {
    const date = localDay(now);
    this.reconcileAcceptedRedo(h, date);
    const catalog = this.get<Catalog>('catalog_cache', h, 'current');
    const rows = this.problems(h);
    const submissions = this.all<CFSubmission>('submissions', h);
    const attempts = this.all<Attempt>('attempts', h);
    const known = this.all<Problem>('problems', h);
    const reviews = new Map(rows.map((p) => [p.key, p.review]));
    const mastery = masteryAreas(known, submissions, attempts, reviews, problemKey);
    let plan = this.get<DailyPlan>('daily_plans', h, date);
    if (!plan || (!plan.catalogReady && catalog)) {
      const eligible = rows.filter((p) => !p.review.ignored);
      const carry = eligible.filter((p) => p.review.awaitingEvaluation || (p.review.firstReflectionRequired && p.review.firstRedoAt && !p.review.firstReflectionAt))
        .sort((a, b) => (a.review.firstRedoAt ?? '').localeCompare(b.review.firstRedoAt ?? '') || a.key.localeCompare(b.key));
      const due = eligible.filter((p) => !p.review.awaitingEvaluation && p.review.status === 'reviewing' && p.review.nextReview && localDay(new Date(p.review.nextReview)) <= date)
        .sort((a, b) => a.review.nextReview!.localeCompare(b.review.nextReview!) || a.key.localeCompare(b.key));
      const pending = eligible.filter((p) => p.review.status === 'pending' && !p.review.awaitingEvaluation && !p.review.firstRedoAt)
        .sort((a, b) => b.failures - a.failures || a.key.localeCompare(b.key));
      const review = plan?.review ?? [...carry.map((p) => ({ key: p.key, kind: (p.review.firstRedoAt && !p.review.firstReflectionAt ? 'reflection' : 'evaluation') as 'reflection' | 'evaluation' })), ...due.filter((p) => !carry.some((c) => c.key === p.key)).map((p) => ({ key: p.key, kind: 'due' as const })), ...pending.map((p) => ({ key: p.key, kind: 'pending' as const }))].slice(0, 5);
      const blocked = new Set([...known.map((p) => p.key), ...review.map((p) => p.key)]);
      plan = dailyPlanSchema.parse({ date, review, newKeys: chooseNewProblems(catalog?.problems ?? [], blocked, mastery, targetDifficulty(known, submissions, problemKey), date), catalogReady: !!catalog, createdAt: plan?.createdAt ?? now.toISOString() });
      if (known.length || catalog || this.all<SyncJob>('jobs', h).some((j) => j.mode === 'full' && j.status === 'completed'))
        this.put('daily_plans', h, date, plan);
    }
    this.reconcileAcceptedRedo(h, date);
    const byKey = new Map(known.map((p) => [p.key, p]));
    const catalogByKey = new Map(catalog?.problems.map((p) => [p.key, p]) ?? []);
    const attemptsToday = new Set(attempts.filter((a) => localDay(new Date(a.createdAt)) === date).map((a) => a.problemKey));
    const submittedToday = new Set(submissions.filter((s) => localDay(new Date(s.creationTimeSeconds * 1000)) === date).map(problemKey));
    const acceptedToday = new Set(submissions.filter((s) => !s.author.teamId && s.verdict === 'OK' && localDay(new Date(s.creationTimeSeconds * 1000)) === date).map(problemKey));
    const review: TrainingDay['review'] = plan.review.flatMap(({ key, kind, completedAt }) => {
      const p = byKey.get(key), r = this.review(h, key);
      if (!p || !r || r.ignored) return [];
      const redoAccepted = acceptedToday.has(key) || !!r.awaitingEvaluation;
      const attempted = attemptsToday.has(key);
      const needsReflection = r.firstReflectionRequired && !!r.firstRedoAt && !r.firstReflectionAt;
      const needsEvaluation = !!r.awaitingEvaluation;
      const phase = needsReflection ? 'reflection' : needsEvaluation ? 'evaluation' : (redoAccepted || attempted || !!completedAt) ? 'done' : 'redo';
      return [{ key, name: p.name, rating: p.rating, tags: p.tags, url: p.url, kind,
        phase, redoAccepted, completed: !needsReflection && (redoAccepted || attempted || !!completedAt), attempted, nextReview: r.nextReview }];
    });
    const newProblems: TrainingDay['newProblems'] = plan.newKeys.flatMap((key) => {
      const p = catalogByKey.get(key) ?? byKey.get(key);
      if (!p) return [];
      return [{ key, name: p.name, rating: p.rating, tags: p.tags, url: p.url, kind: 'new' as const,
        phase: acceptedToday.has(key) ? 'done' as const : 'redo' as const, redoAccepted: acceptedToday.has(key),
        completed: acceptedToday.has(key), attempted: submittedToday.has(key), nextReview: null }];
    });
    return { date, review, newProblems, catalogFetchedAt: catalog?.fetchedAt ?? null,
      recentCheckedAt: this.get<{ recentCheckedAt: string | null }>('training_meta', h, 'recent')?.recentCheckedAt ?? null,
      catalogCount: catalog?.problems.length ?? 0, mastery };
  }
  markRecentChecked(h: string, now = new Date()) {
    this.put('training_meta', h, 'recent', trainingMetaSchema.parse({ recentCheckedAt: now.toISOString() }));
  }
  problems(h: string): ProblemRow[] {
    const subs = this.all<CFSubmission>('submissions', h);
    const aggregate = new Map<string, { solved: boolean; failures: number; submissionCount: number }>();
    for (const s of subs) {
      const key = problemKey(s),
        a = aggregate.get(key) || { solved: false, failures: 0, submissionCount: 0 };
      a.submissionCount++;
      if (s.verdict === 'OK') a.solved = true;
      if (failures.has(s.verdict || '')) a.failures++;
      aggregate.set(key, a);
    }
    const reviews = new Map(
      (
        this.db.prepare('SELECT key,value FROM reviews WHERE profile=?').all(h) as {
          key: string;
          value: string;
        }[]
      ).map((r) => [r.key, reviewSchema.parse(JSON.parse(r.value))]),
    );
    return this.all<Problem>('problems', h)
      .filter((p) => p.manual || reviews.has(p.key))
      .map((p) => ({
        ...p,
        review: reviews.get(p.key) || emptyReview(),
        ...(aggregate.get(p.key) || { solved: false, failures: 0, submissionCount: 0 }),
      }));
  }
  detail(h: string, key: string) {
    const problem = this.problems(h).find((p) => p.key === key);
    if (!problem) return null;
    return {
      problem,
      submissions: this.all<CFSubmission>('submissions', h)
        .filter((s) => problemKey(s) === key)
        .sort((a, b) => b.id - a.id),
      attempts: this.all<Attempt>('attempts', h)
        .filter((a) => a.problemKey === key)
        .reverse(),
    };
  }
  attempt(h: string, key: string, input: AttemptInput, now = new Date()) {
    const data = attemptSchema.parse(input);
    if (!this.get('problems', h, key)) throw new Error('题目不存在');
    this.reconcileAcceptedRedo(h, localDay(now));
    const current = this.review(h, key);
    if (current.status === 'mastered' || current.ignored) throw new Error('此题未处于复习流程');
    if (current.lastEvaluatedDay === localDay(now)) throw new Error('今天已评价过这道题');
    if (data.result === 'independent' && !current.awaitingEvaluation) throw new Error('未检测到当天 AC，不能记录独立做对');
    const redoAt = current.awaitingEvaluation ? new Date(current.awaitingEvaluation.redoAt) : now;
    const attempt: Attempt = {
      ...data,
      id: crypto.randomUUID(),
      problemKey: key,
      createdAt: now.toISOString(),
    };
    this.transaction(() => {
      this.put('attempts', h, attempt.id, attempt);
      const next = nextReviewState(current, data.result, redoAt);
      this.put('reviews', h, key, { ...next, firstRedoAt: current.firstRedoAt ?? now.toISOString(),
        firstReflectionRequired: current.firstReflectionRequired || current.status === 'pending',
        awaitingEvaluation: null, lastEvaluatedDay: localDay(now) });
    });
    return attempt;
  }
  contests(h: string): ContestRow[] {
    const submissions = this.all<CFSubmission>('submissions', h),
      problems = this.all<Problem>('problems', h);
    const saved = this.all<CFContest & { rating?: CFRating }>('contests', h);
    const ids = new Set([
      ...saved.map((c) => c.id),
      ...problems.map((p) => p.contestId).filter((n): n is number => n !== null),
    ]);
    return [...ids]
      .map((id) => {
        const c = saved.find((c) => c.id === id),
          subs = submissions.filter((s) => s.contestId === id || s.problem.contestId === id);
        const cached = this.get<AnalysisCache>('analysis_cache', h, String(id));
        const sessions = contestSessions(
          { ...c, ...cached?.standings.contest, id, name: c?.name ?? `Codeforces ${id}` },
          subs,
        );
        const primary = sessions.find((s) => s.type === 'CONTESTANT') ?? sessions[0];
        const reports = cached ? this.analysis(h, id, submissions).sessions : [];
        const result =
          reports.find((s) => s.session.type === 'CONTESTANT') ??
          reports.find((s) => s.session.key === primary?.key) ??
          reports[0];
        return {
          id,
          name: c?.name || `Codeforces ${id}`,
          startTimeSeconds: c?.startTimeSeconds,
          types: [
            ...new Set([
              ...subs.map((s) => s.author.participantType),
              ...(c?.rating || result?.session.type === 'CONTESTANT' ? ['CONTESTANT'] : []),
            ]),
          ],
          problemCount: new Set(subs.map(problemKey)).size,
          solvedCount: new Set(subs.filter((s) => s.verdict === 'OK').map(problemKey)).size,
          rating: c?.rating,
          inContestSolved:
            result && result.session.start !== null && result.session.duration !== null
              ? result.solved
              : primary?.start !== null && primary?.duration != null
                ? new Set(primary.submissions.filter((s) => s.verdict === 'OK').map(problemKey)).size
                : null,
          analysisStatus: result
            ? result.score === null
              ? '数据不足'
              : result.provisional
                ? '暂估分'
                : '综合分'
            : primary || c?.rating
              ? '待分析'
              : '仅练习 / 无参赛记录',
          analysisScore: result?.score ?? null,
          performanceRating: result?.performanceRating.value ?? null,
          performanceBound: result?.performanceRating.bound ?? null,
          review: this.get<ContestReview>('contest_reviews', h, String(id)) || {
            timeAllocation: '',
            mistakes: '',
            improvements: '',
          },
        };
      })
      .sort((a, b) => (b.startTimeSeconds || b.id) - (a.startTimeSeconds || a.id));
  }
  analysis(
    h: string,
    id: number,
    submissions = this.all<CFSubmission>('submissions', h),
  ): Omit<AnalysisReport, 'task'> {
    const contests = this.all<CFContest & { rating?: CFRating }>('contests', h);
    const cache = this.get<AnalysisCache>('analysis_cache', h, String(id));
    const contest = contests.find((c) => c.id === id) ?? { id, name: `Codeforces ${id}` };
    const problems = this.all<Problem>('problems', h)
      .filter((p) => p.contestId === id)
      .map((p) => ({ ...p, contestId: p.contestId ?? undefined, rating: p.rating ?? undefined }));
    if (!cache && !contests.some((c) => c.id === id) && !problems.length) throw new Error('比赛不存在');
    const complete = this.all<SyncJob>('jobs', h).some((j) => j.mode === 'full' && j.status === 'completed');
    return {
      handle: h,
      contestId: id,
      fetchedAt: cache?.fetchedAt ?? null,
      sessions: analyzeContest({ handle: h, contest, contests, submissions, problems, cache, complete }),
      practiceCount: submissions.filter(
        (s) => (s.contestId ?? s.problem.contestId) === id && s.author.participantType === 'PRACTICE',
      ).length,
      practiceSubmissions: submissions
        .filter((s) => (s.contestId ?? s.problem.contestId) === id && s.author.participantType === 'PRACTICE')
        .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds)
        .map((s) => ({
          id: s.id,
          index: s.problem.index,
          time: s.creationTimeSeconds,
          verdict: s.verdict ?? 'UNKNOWN',
        })),
      warnings: cache?.warnings ?? ['尚未获取完整榜单和题集，联网后可补充分析。'],
    };
  }
  statistics(h: string, now = new Date()): Statistics {
    const allRows = this.problems(h),
      rows = allRows.filter((p) => !p.review.ignored),
      attempts = this.all<Attempt>('attempts', h);
    const submissions = this.all<CFSubmission>('submissions', h);
    const known = this.all<Problem>('problems', h);
    const reviews = new Map(allRows.map((p) => [p.key, p.review]));
    const mastery = masteryAreas(known, submissions, attempts, reviews, problemKey);
    const count = (items: string[]) => {
      const map = new Map<string, number>();
      items.forEach((s) => map.set(s, (map.get(s) || 0) + 1));
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
    const trend: Statistics['trend'] = [];
    const dailyTraining: Statistics['dailyTraining'] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const date = localDay(d);
      const a = attempts.filter((a) => localDay(new Date(a.createdAt)) === date);
      trend.push({
        date,
        independent: a.filter((a) => a.result === 'independent').length,
        hint: a.filter((a) => a.result === 'hint').length,
        failed: a.filter((a) => a.result === 'failed').length,
      });
      const plan = this.get<DailyPlan>('daily_plans', h, date);
      const completedDue = new Set(a.map((item) => item.problemKey));
      const ac = new Set(submissions.filter((s) => s.verdict === 'OK' && localDay(new Date(s.creationTimeSeconds * 1000)) === date).map(problemKey));
      dailyTraining.push({ date, reviewAssigned: plan?.review.length ?? 0,
        reviewCompleted: plan?.review.filter((item) => {
          const r = reviews.get(item.key);
          const reflectionDone = !r?.firstReflectionRequired || !!(r.firstReflectionAt && localDay(new Date(r.firstReflectionAt)) <= date);
          return reflectionDone && (ac.has(item.key) || completedDue.has(item.key) || !!item.completedAt);
        }).length ?? 0,
        newAssigned: plan?.newKeys.length ?? 0,
        newCompleted: plan?.newKeys.filter((key) => ac.has(key)).length ?? 0 });
    }
    return {
      total: rows.length,
      unsolved: rows.filter((p) => !p.solved).length,
      mastered: rows.filter((p) => p.review.status === 'mastered').length,
      pending: rows.filter((p) => p.review.status === 'pending').length,
      due: rows.filter(
        (p) =>
          p.review.status === 'reviewing' &&
          !p.review.awaitingEvaluation &&
          p.review.nextReview &&
          localDay(new Date(p.review.nextReview)) <= localDay(now),
      ).length,
      submissions: this.all('submissions', h).length,
      reasons: count(rows.flatMap((p) => [...new Set(p.review.reasons)])),
      tags: count(rows.flatMap((p) => [...new Set(p.tags)])),
      trend,
      mastery,
      dailyTraining,
    };
  }
  latestJob(h: string) {
    return this.all<SyncJob>('jobs', h).at(-1) || null;
  }
  backup() {
    return {
      format: 'contest-review',
      version: 4,
      exportedAt: new Date().toISOString(),
      activeHandle: this.active(),
      profiles: this.handles(),
      xcpcActive: this.setting('xcpc-active'),
      xcpcMode: this.setting('xcpc-mode') === 'all' ? 'all' : 'official',
      external: (
        this.db.prepare('SELECT namespace,key,value FROM external ORDER BY namespace,key').all() as {
          namespace: string;
          key: string;
          value: string;
        }[]
      ).map((row) => ({ ...row, value: JSON.parse(row.value) })),
      tables: Object.fromEntries(
        tables.map((t) => [
          t,
          (
            this.db.prepare(`SELECT profile,key,value FROM ${t}`).all() as {
              profile: string;
              key: string;
              value: string;
            }[]
          ).map((r) => ({ ...r, value: JSON.parse(r.value) })),
        ]),
      ),
    };
  }
  restore(input: unknown) {
    if (
      input &&
      typeof input === 'object' &&
      'version' in input &&
      input.version === 3 &&
      (!('external' in input) || !('xcpcActive' in input) || !('xcpcMode' in input))
    )
      throw new Error('v3 备份缺少 XCPC 数据字段');
    // Upgrade legacy backups in memory before validation, without mutating the caller's object.
    if (
      input &&
      typeof input === 'object' &&
      'version' in input &&
      input.version === 1 &&
      'tables' in input &&
      input.tables &&
      typeof input.tables === 'object'
    )
      input = { ...input, tables: { ...input.tables, analysis_cache: [] } };
    if (input && typeof input === 'object' && 'version' in input && Number(input.version) < 4 &&
      'tables' in input && input.tables && typeof input.tables === 'object')
      input = { ...input, tables: { ...input.tables, catalog_cache: [], daily_plans: [], training_meta: [] } };
    const data = backupSchema.parse(input);
    if (
      data.version >= 3 &&
      (data.external === undefined || data.xcpcActive === undefined || data.xcpcMode === undefined)
    )
      throw new Error('v3 备份缺少 XCPC 数据字段');
    const external = data.external ?? [];
    const externalKeys = new Set<string>();
    for (const row of external) {
      const id = `${row.namespace}\0${row.key}`;
      if (externalKeys.has(id)) throw new Error('备份包含重复的 XCPC 记录');
      externalKeys.add(id);
      row.value = xcpcRecordSchema(row.namespace, row.key).parse(row.value);
    }
    if (data.xcpcActive && !externalKeys.has(`player\0${data.xcpcActive}`))
      throw new Error('备份缺少绑定的 XCPC 选手');
    for (const row of external) {
      if (row.namespace.startsWith('xcpc:')) {
        if (!externalKeys.has(`player\0${row.namespace.slice(5)}`)) throw new Error('备份缺少 XCPC 选手档案');
        if (
          (row.key.startsWith('review:') || row.key.startsWith('report:')) &&
          !externalKeys.has(`${row.namespace}\0history:${row.key.slice(row.key.indexOf(':') + 1)}`)
        )
          throw new Error('备份缺少 XCPC 比赛记录');
      }
      if (row.namespace === 'player')
        for (const item of (row.value as { history: { contestId: string }[] }).history)
          if (!externalKeys.has(`xcpc:${row.key}\0history:${item.contestId}`))
            throw new Error('备份缺少 XCPC 选手比赛历史');
    }
    if (
      new Set(data.profiles).size !== data.profiles.length ||
      (data.activeHandle && !data.profiles.includes(data.activeHandle))
    )
      throw new Error('备份账号信息不完整');
    const known = new Map<Table, Set<string>>();
    for (const t of tables) {
      const keys = new Set<string>();
      known.set(t, keys);
      for (const row of data.tables[t]) {
        const id = `${row.profile}\0${row.key}`;
        if (!data.profiles.includes(row.profile) || keys.has(id))
          throw new Error('备份包含重复记录或未知账号');
        keys.add(id);
        row.value = payloadSchemas[t].parse(row.value);
        const v = row.value as Record<string, unknown>;
        if (
          (t === 'problems' && v.key !== row.key) ||
          (['submissions', 'contests', 'attempts', 'jobs', 'analysis_cache'].includes(t) &&
            String(v.id) !== row.key) ||
          (t === 'jobs' && v.handle !== row.profile)
        )
          throw new Error('备份记录编号不一致');
        if (t === 'problems' && v.contestId && `${v.contestId}:${v.index}` !== row.key)
          throw new Error('备份题号不一致');
        if ((t === 'catalog_cache' && row.key !== 'current') || (t === 'training_meta' && row.key !== 'recent') ||
          (t === 'daily_plans' && v.date !== row.key))
          throw new Error('备份训练记录编号不一致');
      }
    }
    const catalogKeys = new Map<string, Set<string>>();
    for (const row of data.tables.catalog_cache) {
      const problems = (row.value as Catalog).problems;
      const keys = new Set<string>();
      for (const problem of problems) {
        if (problem.key !== `${problem.contestId}:${problem.index}` || keys.has(problem.key))
          throw new Error('备份题目目录有重复或编号不一致');
        keys.add(problem.key);
      }
      catalogKeys.set(row.profile, keys);
    }
    for (const row of data.tables.daily_plans) {
      const plan = row.value as DailyPlan;
      const keys = [...plan.review.map((item) => item.key), ...plan.newKeys];
      if (new Set(keys).size !== keys.length ||
        plan.review.some((item) => !known.get('problems')!.has(`${row.profile}\0${item.key}`)) ||
        plan.newKeys.some((key) => !catalogKeys.get(row.profile)?.has(key) && !known.get('problems')!.has(`${row.profile}\0${key}`)))
        throw new Error('备份题单包含重复或不存在的题目');
    }
    for (const t of ['reviews', 'attempts', 'submissions'] as const)
      for (const row of data.tables[t]) {
        const key =
          t === 'reviews'
            ? row.key
            : t === 'attempts'
              ? (row.value as Attempt).problemKey
              : problemKey(row.value as CFSubmission);
        if (!known.get('problems')!.has(`${row.profile}\0${key}`)) throw new Error('备份缺少关联题目');
      }
    for (const row of data.tables.contest_reviews)
      if (!known.get('contests')!.has(`${row.profile}\0${row.key}`)) throw new Error('备份缺少关联比赛');
    for (const row of data.tables.analysis_cache)
      if (!known.get('contests')!.has(`${row.profile}\0${row.key}`)) throw new Error('备份缺少分析关联比赛');
    const backupPath = this.beforeRestore?.(this.backup()) ?? null;
    this.transaction(() => {
      for (const t of tables) this.db.exec(`DELETE FROM ${t}`);
      this.db.exec('DELETE FROM profiles; DELETE FROM settings; DELETE FROM external;');
      for (const h of data.profiles) this.db.prepare('INSERT INTO profiles VALUES(?)').run(h);
      this.db.prepare("INSERT INTO settings VALUES('active',?)").run(data.activeHandle);
      this.setSetting('xcpc-active', data.xcpcActive ?? '');
      this.setSetting('xcpc-mode', data.xcpcMode ?? 'official');
      for (const row of external) {
        if (row.namespace === 'batch' && (row.value as { status: string }).status === 'running')
          row.value = {
            ...(row.value as Record<string, unknown>),
            status: 'interrupted',
            phase: '从备份恢复，可再次一键复盘',
            finishedAt: new Date().toISOString(),
          };
        this.externalPut(row.namespace, row.key, row.value);
      }
      for (const t of tables)
        for (const row of data.tables[t]) {
          if (t === 'jobs' && (row.value as SyncJob).status === 'running')
            row.value = {
              ...(row.value as SyncJob),
              status: 'interrupted',
              message: '从备份恢复，可继续同步。',
            };
          this.put(t, row.profile, row.key, row.value);
        }
    });
    return { backupPath };
  }
}
export function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
