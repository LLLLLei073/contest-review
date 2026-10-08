import { z } from 'zod';
import { aiConfigSchema, aiReviewRecordSchema } from './ai-review.js';
import { learningRecordSchema, type LearningRecord } from './learning-domain.js';
import { knowledgeCards } from './knowledge.js';
import { fingerprint } from './learning-domain.js';
import { chooseWeeklyProblems, weekStart, weeklyGoalSchema, type WeeklyGoal } from './weekly.js';
import {
  upsolveSchema,
  reasonSnapshotSchema,
  simulationSchema,
  simulationEvents,
  type UpsolveItem,
  type ReasonSnapshot,
  type Simulation,
} from './training-extras.js';
import {
  catalogSchema,
  dailyPlanSchema,
  trainingMetaSchema,
  masteryAreas,
  recommendationDifficulty,
  categories,
  type Catalog,
  type DailyPlan,
  type TrainingDay,
} from './training.js';
import { xcpcRecordSchema } from './xcpc.js';
import {
  atcoderHandleSchema,
  atcoderProfile,
  atcoderKey,
  normalizeAtcoder,
  atcoderSubmissionSchema,
  atcoderProblemSchema,
  atcoderReportSchema,
  atcoderCatalogSchema,
  atcoderHistorySchema,
  type AtcoderSubmission,
} from './atcoder.js';
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
  source: z.enum(['cf', 'atcoder']).optional(),
  contestKey: z.string().optional(),
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
const profileSchema = z.union([handleSchema, z.string().regex(/^ac~[a-z0-9_]{1,64}$/)]);
const backupSchema = z.object({
  format: z.literal('contest-review'),
  version: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
  ]),
  exportedAt: z.string().datetime(),
  activeHandle: z.string(),
  profiles: z.array(profileSchema).max(1000),
  activeAtcoder: z.string().optional(),
  tables: z.object(
    Object.fromEntries(
      tables.map((t) => [
        t,
        z.array(z.object({ profile: profileSchema, key: z.string().min(1).max(200), value: z.unknown() })),
      ]),
    ) as Record<
      Table,
      z.ZodArray<z.ZodObject<{ profile: typeof profileSchema; key: z.ZodString; value: z.ZodUnknown }>>
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
  learningEpoch = 0;
  constructor(
    public db: DatabaseLike,
    private beforeRestore?: (backup: unknown) => string | null,
  ) {
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = Number(
      (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
    if (version > 6) throw new Error('数据库来自更新版本，请升级程序');
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
          this.db.exec(
            `CREATE TABLE IF NOT EXISTS ${table} (profile TEXT NOT NULL REFERENCES profiles(handle), key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(profile,key));`,
          );
        this.db.exec('PRAGMA user_version=4');
      });
    if (version <= 4) this.db.exec('PRAGMA user_version=5');
    if (version <= 5) this.db.exec('PRAGMA user_version=6');
    for (const h of [...this.handles(), ...this.atcoderHandles().map(atcoderProfile)])
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
  externalDelete(namespace: string, key: string) {
    this.db.prepare('DELETE FROM external WHERE namespace=? AND key=?').run(namespace, key);
  }
  setting(key: string): string {
    return (
      (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)
        ?.value || ''
    );
  }
  setSetting(key: string, value: string) {
    if (['active', 'atcoder-active', 'xcpc-active'].includes(key) && this.setting(key) !== value)
      this.learningEpoch++;
    this.db
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  handles(): string[] {
    return (
      this.db.prepare("SELECT handle FROM profiles WHERE handle NOT LIKE 'ac~%' ORDER BY handle").all() as {
        handle: string;
      }[]
    ).map((r) => r.handle);
  }
  atcoderHandles(): string[] {
    return (
      this.db.prepare("SELECT handle FROM profiles WHERE handle LIKE 'ac~%' ORDER BY handle").all() as {
        handle: string;
      }[]
    ).map((r) => r.handle.slice(3));
  }
  activeAtcoder(): string {
    return this.setting('atcoder-active');
  }
  profileForKey(key: string): string {
    if (key.startsWith('atcoder:')) {
      if (!this.activeAtcoder()) throw new Error('请先绑定 AtCoder 用户名');
      return atcoderProfile(this.activeAtcoder());
    }
    if (!this.active()) throw new Error('请先绑定 Codeforces 用户名');
    return this.active();
  }
  combinedProblems(): ProblemRow[] {
    return [
      ...(this.active() ? this.problems(this.active()) : []),
      ...(this.activeAtcoder() ? this.problems(atcoderProfile(this.activeAtcoder())) : []),
    ];
  }
  activateAtcoder(handle: string) {
    const name = atcoderHandleSchema.parse(handle),
      profile = atcoderProfile(name);
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO profiles(handle) VALUES(?)').run(profile);
      this.setSetting('atcoder-active', name);
    });
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
    if (this.active() !== handle) this.learningEpoch++;
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
    const next = reviewSchema.parse({
      ...review,
      firstRedoAt: old.firstRedoAt,
      firstReflectionAt: old.firstReflectionAt,
      firstReflectionRequired: old.firstReflectionRequired,
      awaitingEvaluation: old.awaitingEvaluation,
      lastEvaluatedDay: old.lastEvaluatedDay,
    });
    if (old.firstReflectionRequired && old.firstRedoAt && !old.firstReflectionAt && hasReflection(next))
      next.firstReflectionAt = new Date().toISOString();
    this.put('reviews', h, key, next);
    if (next.reasons.length && JSON.stringify(old.reasons) !== JSON.stringify(next.reasons)) {
      const savedAt = new Date().toISOString();
      const snapshot = reasonSnapshotSchema.parse({
        id: crypto.randomUUID(),
        problemKey: key,
        savedAt,
        reasons: next.reasons,
      });
      this.externalPut(`reason:${h}`, snapshot.id, snapshot);
    }
    return next;
  }
  updateReview(h: string, key: string, review: Review, action: 'save' | 'complete' | 'restart') {
    const old = this.review(h, key);
    const next = {
      ...review,
      stage: old.stage,
      status: old.status,
      nextReview: old.awaitingEvaluation ? null : review.nextReview,
    };
    if (action === 'restart') {
      next.status = 'reviewing';
      next.stage = 0;
      next.ignored = false;
      next.nextReview = new Date(Date.now() + 86400000).toISOString();
    }
    if (action === 'complete' && !old.firstRedoAt) throw new Error('请先重做题目，再保存复盘');
    if (next.status === 'mastered') next.nextReview = null;
    if (next.status === 'reviewing' && !next.nextReview && !old.awaitingEvaluation && action !== 'complete')
      throw new Error('复习中的题目需要设置下次日期');
    return this.saveReview(h, key, reviewSchema.parse(next));
  }
  private repairLegacyReview(h: string, key: string): Review {
    let review = this.review(h, key);
    if (
      review.firstReflectionRequired &&
      review.firstRedoAt &&
      !review.firstReflectionAt &&
      hasReflection(review)
    ) {
      review = { ...review, firstReflectionAt: new Date().toISOString() };
      this.put('reviews', h, key, review);
    }
    if (
      review.awaitingEvaluation &&
      review.lastEvaluatedDay &&
      review.lastEvaluatedDay >= review.awaitingEvaluation.date
    ) {
      const evaluated = this.all<Attempt>('attempts', h)
        .filter(
          (attempt) =>
            attempt.problemKey === key && localDay(new Date(attempt.createdAt)) === review.lastEvaluatedDay,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (evaluated || review.awaitingEvaluation.previousNextReview) {
        const days = evaluated?.result === 'independent' ? [3, 7, 14, 30][review.stage - 1] : 1;
        const recoveredDate =
          evaluated && days !== undefined
            ? new Date(new Date(review.awaitingEvaluation.redoAt).getTime() + days * 86400000).toISOString()
            : null;
        review = {
          ...review,
          awaitingEvaluation: null,
          nextReview:
            review.status === 'mastered'
              ? null
              : (review.awaitingEvaluation.previousNextReview ?? recoveredDate),
        };
        this.put('reviews', h, key, review);
      }
    }
    return review;
  }
  private repairLegacyReviews(h: string) {
    const rows = this.db.prepare('SELECT key FROM reviews WHERE profile=?').all(h) as { key: string }[];
    for (const row of rows) this.repairLegacyReview(h, row.key);
  }
  private reconcileAcceptedRedo(h: string, date: string) {
    const plan = this.combinedPlan(date) ?? this.get<DailyPlan>('daily_plans', h, date);
    if (!plan) return;
    const submissions = this.all<CFSubmission>('submissions', h);
    for (const item of plan.review.filter(
      (item) => h.startsWith('ac~') === item.key.startsWith('atcoder:'),
    )) {
      const review = this.repairLegacyReview(h, item.key);
      if (
        review.ignored ||
        review.status === 'mastered' ||
        (review.lastEvaluatedDay && review.lastEvaluatedDay >= date)
      )
        continue;
      const accepted = submissions
        .filter(
          (s) =>
            !s.author.teamId &&
            problemKey(s) === item.key &&
            s.verdict === 'OK' &&
            localDay(new Date(s.creationTimeSeconds * 1000)) === date,
        )
        .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id)[0];
      if (accepted) {
        const redoAt = new Date(accepted.creationTimeSeconds * 1000).toISOString();
        if (review.awaitingEvaluation?.submissionId !== accepted.id || !review.firstRedoAt) {
          this.put('reviews', h, item.key, {
            ...review,
            firstRedoAt: review.firstRedoAt ?? redoAt,
            firstReflectionRequired: review.firstReflectionRequired || review.status === 'pending',
            firstReflectionAt:
              !review.firstReflectionAt && review.status === 'pending' && hasReflection(review)
                ? new Date().toISOString()
                : review.firstReflectionAt,
            awaitingEvaluation: {
              date,
              submissionId: accepted.id,
              redoAt,
              previousNextReview: review.awaitingEvaluation?.previousNextReview ?? review.nextReview,
            },
            nextReview: null,
          });
        }
      } else if (review.awaitingEvaluation?.date === date) {
        this.put('reviews', h, item.key, {
          ...review,
          awaitingEvaluation: null,
          nextReview: review.awaitingEvaluation.previousNextReview,
          firstRedoAt: review.status === 'pending' ? null : review.firstRedoAt,
        });
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
  ingestAtcoder(profile: string, input: AtcoderSubmission[]) {
    const meta = this.externalGet<{
      problems: z.infer<typeof atcoderProblemSchema>[];
      models: Record<string, { difficulty?: number }>;
    }>('atcoder-meta', 'catalog');
    const names = new Map(meta?.problems.map((p) => [p.id, p]) ?? []);
    const normalized = z
      .array(atcoderSubmissionSchema)
      .parse(input)
      .filter((s) => !s.contest_id.startsWith('ahc'))
      .map((s) => normalizeAtcoder(s, names.get(s.problem_id), meta?.models[s.problem_id]?.difficulty));
    const affected = new Set(normalized.map((s) => localDay(new Date(s.creationTimeSeconds * 1000))));
    this.transaction(() => {
      for (const s of normalized) {
        const key = problemKey(s),
          old = this.get<Problem>('problems', profile, key);
        const contestId = s.contestKey!;
        this.put(
          'problems',
          profile,
          key,
          problemSchema.parse({
            key,
            source: 'atcoder',
            contestId: null,
            index: s.problem.index,
            name: s.problem.name,
            rating: s.problem.rating ?? old?.rating ?? null,
            tags: [],
            manual: false,
            url: `https://atcoder.jp/contests/${contestId}/tasks/${s.problem.index}`,
          }),
        );
        this.put('submissions', profile, String(s.id), s);
        if (failures.has(s.verdict ?? '') && !this.get('reviews', profile, key))
          this.put('reviews', profile, key, emptyReview());
      }
      for (const day of affected) this.reconcileAcceptedRedo(profile, day);
    });
  }
  enrichAtcoder(profile: string) {
    const meta = this.externalGet<{
      problems: z.infer<typeof atcoderProblemSchema>[];
      models: Record<string, { difficulty?: number }>;
    }>('atcoder-meta', 'catalog');
    if (!meta) return;
    this.transaction(() => {
      for (const item of meta.problems) {
        const key = atcoderKey(item.id),
          old = this.get<Problem>('problems', profile, key);
        if (!old) continue;
        const d = meta.models[item.id]?.difficulty;
        this.put('problems', profile, key, {
          ...old,
          name: item.name,
          rating: typeof d === 'number' && d >= 0 ? Math.round(d) : null,
          url: `https://atcoder.jp/contests/${item.contest_id}/tasks/${item.id}`,
        });
      }
      for (const s of this.all<CFSubmission>('submissions', profile)) {
        const p = this.get<Problem>('problems', profile, problemKey(s));
        if (p && (s.problem.name !== p.name || s.problem.rating !== p.rating))
          this.put('submissions', profile, String(s.id), {
            ...s,
            problem: { ...s.problem, name: p.name, rating: p.rating ?? undefined },
          });
      }
    });
  }
  private combinedNamespace() {
    return `daily:${this.active() || '-'}:${this.activeAtcoder().toLowerCase() || '-'}`;
  }
  private weeklyNamespace() {
    return `weekly:${this.active() || '-'}:${this.activeAtcoder().toLowerCase() || '-'}`;
  }
  weeklyGoal(now = new Date()): WeeklyGoal | null {
    return this.externalGet<WeeklyGoal>(this.weeklyNamespace(), weekStart(now)) ?? null;
  }
  saveWeeklyGoal(input: unknown, now = new Date()): WeeklyGoal {
    const week = weekStart(now);
    const goal = weeklyGoalSchema.parse({ ...(input as object), week, updatedAt: now.toISOString() });
    this.externalPut(this.weeklyNamespace(), week, goal);
    return goal;
  }
  weeklyProgress(now = new Date()) {
    const goal = this.weeklyGoal(now),
      cf = this.active();
    if (!goal || !cf) return { goal, assigned: 0, completed: 0, coverage: {} as Record<string, number> };
    const plans = this.all<DailyPlan>('daily_plans', cf).filter(
      (p) => p.date >= goal.week && p.date <= localDay(now),
    );
    const catalog = this.get<Catalog>('catalog_cache', cf, 'current');
    const byKey = new Map(catalog?.problems.map((p) => [p.key, p]));
    const submissions = this.all<CFSubmission>('submissions', cf);
    const coverage: Record<string, number> = {};
    let assigned = 0,
      completed = 0;
    for (const plan of plans)
      for (const key of plan.newKeys) {
        const p = byKey.get(key);
        if (!p || !categories(p.tags).some((c) => goal.categories.includes(c))) continue;
        assigned++;
        for (const c of categories(p.tags).filter((c) => goal.categories.includes(c)))
          coverage[c] = (coverage[c] ?? 0) + 1;
        if (
          submissions.some(
            (s) =>
              problemKey(s) === key &&
              s.verdict === 'OK' &&
              localDay(new Date(s.creationTimeSeconds * 1000)) === plan.date,
          )
        )
          completed++;
      }
    return { goal, assigned, completed, coverage };
  }
  upsolveItems(): UpsolveItem[] {
    const profiles = [this.active(), this.activeAtcoder() && atcoderProfile(this.activeAtcoder())].filter(
      Boolean,
    );
    return profiles
      .flatMap((profile) => {
        const submissions = this.all<CFSubmission>('submissions', profile);
        return this.externalAll<z.infer<typeof upsolveSchema>>(`upsolve:${profile}`).map((item) => ({
          ...item,
          completed: submissions.some((s) => problemKey(s) === item.key && s.verdict === 'OK'),
          attempted: submissions.some((s) => problemKey(s) === item.key),
        }));
      })
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  addUpsolve(input: unknown): UpsolveItem {
    const item = upsolveSchema.parse({ ...(input as object), addedAt: new Date().toISOString() });
    const profile =
      item.source === 'cf' ? this.active() : this.activeAtcoder() && atcoderProfile(this.activeAtcoder());
    if (!profile) throw new Error('请先绑定对应平台账号');
    if (
      (item.source === 'cf' &&
        (!/^\d+:[A-Za-z0-9]+$/.test(item.key) || !item.url.startsWith('https://codeforces.com/'))) ||
      (item.source === 'atcoder' &&
        (!item.key.startsWith('atcoder:') || !item.url.startsWith('https://atcoder.jp/')))
    )
      throw new Error('补题来源与题号不一致');
    const previous = this.externalGet<z.infer<typeof upsolveSchema>>(`upsolve:${profile}`, item.key);
    this.externalPut(`upsolve:${profile}`, item.key, previous ?? item);
    return this.upsolveItems().find((p) => p.source === item.source && p.key === item.key)!;
  }
  addContestUpsolve(source: 'cf' | 'atcoder', contestId: string): UpsolveItem[] {
    if (source === 'cf') {
      const profile = this.active();
      if (!profile || !/^\d+$/.test(contestId)) throw new Error('请先绑定 Codeforces 并选择有效比赛');
      const contest =
        (this.externalGet<CFContest[]>(`cf-contests:${profile}`, 'current') ?? []).find(
          (c) => c.id === Number(contestId),
        ) ?? this.contests(profile).find((c) => c.id === Number(contestId));
      const catalog = this.get<Catalog>('catalog_cache', profile, 'current');
      if (!contest || !catalog) throw new Error('请先同步比赛题目目录');
      const solved = new Set(
        this.all<CFSubmission>('submissions', profile)
          .filter((s) => s.verdict === 'OK')
          .map(problemKey),
      );
      return catalog.problems
        .filter((p) => p.contestId === Number(contestId) && !solved.has(p.key))
        .map((p) =>
          this.addUpsolve({
            key: p.key,
            source,
            contestKey: contestId,
            contestName: contest.name,
            name: p.name,
            url: p.url,
            rating: p.rating,
          }),
        );
    }
    const handle = this.activeAtcoder();
    if (!handle) throw new Error('请先绑定 AtCoder');
    const profile = atcoderProfile(handle);
    const catalog = this.externalGet<z.infer<typeof atcoderCatalogSchema>>('atcoder-meta', 'catalog');
    const contest = catalog?.contests.find((c) => c.id === contestId);
    if (!catalog || !contest) throw new Error('请先同步 AtCoder 比赛题目目录');
    const solved = new Set(
      this.all<CFSubmission>('submissions', profile)
        .filter((s) => s.verdict === 'OK')
        .map(problemKey),
    );
    return catalog.problems
      .filter((p) => p.contest_id === contestId && !solved.has(atcoderKey(p.id)))
      .map((p) =>
        this.addUpsolve({
          key: atcoderKey(p.id),
          source,
          contestKey: contestId,
          contestName: contest.title,
          name: p.name,
          url: `https://atcoder.jp/contests/${contestId}/tasks/${p.id}`,
          rating: catalog.models[p.id]?.difficulty ?? null,
        }),
      );
  }
  removeUpsolve(source: 'cf' | 'atcoder', key: string) {
    const profile =
      source === 'cf' ? this.active() : this.activeAtcoder() && atcoderProfile(this.activeAtcoder());
    if (!profile) throw new Error('请先绑定对应平台账号');
    this.db.prepare('DELETE FROM external WHERE namespace=? AND key=?').run(`upsolve:${profile}`, key);
  }
  reasonTrend(source: 'all' | 'cf' | 'atcoder' = 'all') {
    const profiles = [
      ...(source !== 'atcoder' && this.active() ? [this.active()] : []),
      ...(source !== 'cf' && this.activeAtcoder() ? [atcoderProfile(this.activeAtcoder())] : []),
    ];
    const latest = new Map<string, ReasonSnapshot>();
    for (const profile of profiles)
      for (const item of this.externalAll<ReasonSnapshot>(`reason:${profile}`)) {
        const week = weekStart(new Date(item.savedAt));
        const key = `${week}:${profile}:${item.problemKey}`;
        if (!latest.has(key) || latest.get(key)!.savedAt < item.savedAt) latest.set(key, item);
      }
    const byWeek = new Map<string, Map<string, Set<string>>>();
    for (const [key, item] of latest) {
      const week = weekStart(new Date(item.savedAt));
      const reasons = byWeek.get(week) ?? new Map<string, Set<string>>();
      byWeek.set(week, reasons);
      for (const reason of item.reasons) {
        const keys = reasons.get(reason) ?? new Set<string>();
        keys.add(key);
        reasons.set(reason, keys);
      }
    }
    return [...byWeek]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, reasons]) => ({
        week,
        samples: [...latest.keys()].filter((key) => key.startsWith(`${week}:`)).length,
        reasons: [...reasons]
          .map(([name, keys]) => ({ name, count: keys.size }))
          .sort((a, b) => b.count - a.count),
      }));
  }
  dataHealth() {
    const cf = this.active(),
      ac = this.activeAtcoder();
    const catalog = cf ? this.get<Catalog>('catalog_cache', cf, 'current') : undefined;
    const acCatalog = this.externalGet<z.infer<typeof atcoderCatalogSchema>>('atcoder-meta', 'catalog');
    const submissions = [
      ...(cf ? this.all<CFSubmission>('submissions', cf) : []),
      ...(ac ? this.all<CFSubmission>('submissions', atcoderProfile(ac)) : []),
    ];
    return {
      cf: {
        handle: cf,
        sync: cf ? (this.latestJob(cf)?.finishedAt ?? null) : null,
        catalog: catalog?.fetchedAt ?? null,
        problems: catalog?.problems.length ?? 0,
        rated: catalog?.problems.filter((p) => p.rating !== null).length ?? 0,
      },
      atcoder: {
        handle: ac,
        sync: ac ? (this.latestJob(atcoderProfile(ac))?.finishedAt ?? null) : null,
        catalog: acCatalog?.fetchedAt ?? null,
        problems: acCatalog?.problems.length ?? 0,
        rated:
          acCatalog?.problems.filter((p) => typeof acCatalog.models[p.id]?.difficulty === 'number').length ??
          0,
      },
      pendingVerdicts: submissions.filter((s) => !s.verdict || ['TESTING', 'SUBMITTED'].includes(s.verdict))
        .length,
      lastBackup: this.setting('last-backup') || null,
    };
  }
  markBackupExported() {
    this.setSetting('last-backup', new Date().toISOString());
  }
  simulationContests(now = new Date()) {
    const h = this.active();
    if (!h) return [];
    const catalog = this.get<Catalog>('catalog_cache', h, 'current');
    const problems = catalog?.problems ?? [];
    return (this.externalGet<CFContest[]>(`cf-contests:${h}`, 'current') ?? [])
      .filter(
        (c) =>
          c.phase === 'FINISHED' &&
          !!c.startTimeSeconds &&
          !!c.durationSeconds &&
          (c.startTimeSeconds! + c.durationSeconds!) * 1000 < now.getTime() &&
          problems.some((p) => p.contestId === c.id),
      )
      .sort((a, b) => (b.startTimeSeconds ?? 0) - (a.startTimeSeconds ?? 0));
  }
  simulations() {
    const h = this.active();
    if (!h) return [];
    return this.externalAll<Simulation>(`simulation:${h}`)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((session) => this.simulationReport(session));
  }
  simulationReport(session: Simulation) {
    const h = this.active();
    if (!h) throw new Error('请先绑定 Codeforces');
    const catalog = this.get<Catalog>('catalog_cache', h, 'current');
    const problems = catalog?.problems.filter((p) => p.contestId === session.contestId) ?? [];
    const submissions = this.all<CFSubmission>('submissions', h);
    const events = simulationEvents(session, submissions);
    return {
      ...session,
      problems: problems.map((p) => ({
        key: p.key,
        name: p.name,
        index: p.index,
        url: p.url,
        rating: p.rating,
        tags: p.tags,
        seenBefore: submissions.some(
          (s) => problemKey(s) === p.key && s.creationTimeSeconds * 1000 < Date.parse(session.startedAt),
        ),
      })),
      events,
      solved: new Set(events.filter((e) => e.verdict === 'OK').map((e) => e.problemKey)).size,
      ended:
        !!session.finishedAt || Date.now() >= Date.parse(session.startedAt) + session.durationSeconds * 1000,
    };
  }
  startSimulation(contestId: number): ReturnType<CoreStore['simulationReport']> {
    const h = this.active();
    if (!h) throw new Error('请先绑定 Codeforces');
    const contest = this.simulationContests().find((c) => c.id === contestId);
    if (!contest?.durationSeconds) throw new Error('比赛资料不完整或尚未结束');
    if (this.simulations().some((s) => !s.ended)) throw new Error('请先结束正在进行的模拟赛');
    const session = simulationSchema.parse({
      id: crypto.randomUUID(),
      contestId,
      contestName: contest.name,
      startedAt: new Date().toISOString(),
      durationSeconds: contest.durationSeconds,
      finishedAt: null,
      manual: [],
    });
    this.externalPut(`simulation:${h}`, session.id, session);
    return this.simulationReport(session);
  }
  updateSimulation(id: string, action: 'finish' | 'record', input?: unknown) {
    const h = this.active();
    if (!h) throw new Error('请先绑定 Codeforces');
    const current = this.externalGet<Simulation>(`simulation:${h}`, id);
    if (!current) throw new Error('模拟赛不存在');
    const report = this.simulationReport(current);
    if (report.ended) throw new Error('模拟赛已结束');
    const next: Simulation = structuredClone(current);
    if (action === 'finish') next.finishedAt = new Date().toISOString();
    else {
      const record = z.object({ problemKey: z.string(), verdict: z.enum(['OK', 'FAILED']) }).parse(input);
      if (!report.problems.some((p) => p.key === record.problemKey)) throw new Error('题目不属于本场比赛');
      next.manual.push({ ...record, at: new Date().toISOString() });
    }
    this.externalPut(`simulation:${h}`, id, simulationSchema.parse(next));
    return this.simulationReport(next);
  }
  private priorNewKeys(profile: string, date: string): Set<string> {
    return new Set(
      this.all<DailyPlan>('daily_plans', profile)
        .filter((plan) => plan.date < date)
        .flatMap((plan) => plan.newKeys),
    );
  }
  private weeklyCoverage(profile: string, date: string): Record<string, number> {
    const counts: Record<string, number> = {};
    const catalog = this.get<Catalog>('catalog_cache', profile, 'current');
    const byKey = new Map(catalog?.problems.map((p) => [p.key, p]));
    for (const plan of this.all<DailyPlan>('daily_plans', profile)) {
      if (plan.date < weekStart(new Date(`${date}T12:00:00`)) || plan.date >= date) continue;
      for (const key of plan.newKeys) {
        const problem = byKey.get(key);
        if (!problem) continue;
        for (const category of categories(problem.tags)) counts[category] = (counts[category] ?? 0) + 1;
      }
    }
    return counts;
  }
  private combinedPlan(date: string): DailyPlan | undefined {
    return this.activeAtcoder() ? this.externalGet<DailyPlan>(this.combinedNamespace(), date) : undefined;
  }
  combinedTrainingDay(now = new Date()): TrainingDay {
    const cf = this.active(),
      ac = this.activeAtcoder();
    if (!ac) return this.trainingDay(cf, now);
    const date = localDay(now),
      acProfile = atcoderProfile(ac);
    if (cf) this.repairLegacyReviews(cf);
    this.repairLegacyReviews(acProfile);
    const cfPlan = cf ? this.get<DailyPlan>('daily_plans', cf, date) : undefined;
    const inherited = cf ? this.externalGet<DailyPlan>(`daily:-:${ac.toLowerCase()}`, date) : undefined;
    let plan = this.combinedPlan(date);
    const weeklyGoal = this.weeklyGoal(now);
    if (!plan || (!plan.catalogReady && !!weeklyGoal && !plan.newKeys.length)) {
      const rows = [...(cf ? this.problems(cf) : []), ...this.problems(acProfile)].filter(
        (p) => !p.review.ignored,
      );
      const carry = rows
        .filter(
          (p) =>
            p.review.awaitingEvaluation ||
            (p.review.firstReflectionRequired && p.review.firstRedoAt && !p.review.firstReflectionAt),
        )
        .sort(
          (a, b) =>
            (a.review.firstRedoAt ?? '').localeCompare(b.review.firstRedoAt ?? '') ||
            a.key.localeCompare(b.key),
        );
      const due = rows
        .filter(
          (p) =>
            !p.review.awaitingEvaluation &&
            p.review.status === 'reviewing' &&
            p.review.nextReview &&
            localDay(new Date(p.review.nextReview)) <= date,
        )
        .sort(
          (a, b) => a.review.nextReview!.localeCompare(b.review.nextReview!) || a.key.localeCompare(b.key),
        );
      const pending = rows
        .filter((p) => p.review.status === 'pending' && !p.review.awaitingEvaluation && !p.review.firstRedoAt)
        .sort((a, b) => b.failures - a.failures || a.key.localeCompare(b.key));
      const review =
        cfPlan?.review ??
        inherited?.review ??
        [
          ...carry.map((p) => ({
            key: p.key,
            kind: (p.review.firstRedoAt && !p.review.firstReflectionAt ? 'reflection' : 'evaluation') as
              'reflection' | 'evaluation',
          })),
          ...due
            .filter((p) => !carry.some((c) => c.key === p.key))
            .map((p) => ({ key: p.key, kind: 'due' as const })),
          ...pending.map((p) => ({ key: p.key, kind: 'pending' as const })),
        ].slice(0, 5);
      // A plan already issued today remains fixed even when a second account is bound.
      const cfCatalog = cf ? this.get<Catalog>('catalog_cache', cf, 'current') : undefined;
      const cfKnown = cf ? this.all<Problem>('problems', cf) : [];
      const cfSubmissions = cf ? this.all<CFSubmission>('submissions', cf) : [];
      const picked =
        cf && weeklyGoal
          ? chooseWeeklyProblems(
              cfCatalog?.problems ?? [],
              new Set([
                ...cfKnown.map((p) => p.key),
                ...review.map((p) => p.key),
                ...this.priorNewKeys(cf, date),
              ]),
              this.combinedStatistics('all', now).mastery,
              recommendationDifficulty(cfKnown, cfSubmissions, problemKey, this.latestOfficialRating(cf)),
              date,
              weeklyGoal,
              this.weeklyCoverage(cf, date),
            )
          : { keys: [], reasons: {}, shortage: null };
      const newKeys =
        cfPlan?.catalogReady || cfPlan?.newKeys.length
          ? cfPlan.newKeys
          : inherited
            ? inherited.newKeys
            : picked.keys;
      plan = dailyPlanSchema.parse({
        date,
        review,
        newKeys,
        newReasons: cfPlan?.newReasons ?? picked.reasons,
        newShortage: cfPlan?.newShortage ?? picked.shortage,
        catalogReady: !!cfCatalog && !!weeklyGoal,
        createdAt: now.toISOString(),
      });
      this.externalPut(this.combinedNamespace(), date, plan);
    }
    if (cf && (!cfPlan || (!cfPlan.catalogReady && plan.catalogReady)))
      this.put(
        'daily_plans',
        cf,
        date,
        dailyPlanSchema.parse({
          date,
          review: plan.review.filter((p) => !p.key.startsWith('atcoder:')),
          newKeys: plan.newKeys,
          newReasons: plan.newReasons,
          newShortage: plan.newShortage,
          catalogReady: plan.catalogReady,
          createdAt: plan.createdAt,
        }),
      );
    if (cf) this.reconcileAcceptedRedo(cf, date);
    this.reconcileAcceptedRedo(acProfile, date);
    const cfDay = cf ? this.trainingDay(cf, now) : null;
    const acDay = this.trainingDay(acProfile, now);
    const available = new Map([...(cfDay?.review ?? []), ...acDay.review].map((p) => [p.key, p]));
    return {
      date,
      review: plan.review.flatMap((item) => (available.get(item.key) ? [available.get(item.key)!] : [])),
      newProblems: cfDay?.newProblems.filter((p) => plan.newKeys.includes(p.key)) ?? [],
      catalogFetchedAt: cfDay?.catalogFetchedAt ?? null,
      recentCheckedAt: [cfDay?.recentCheckedAt, acDay.recentCheckedAt].filter(Boolean).sort().at(0) ?? null,
      catalogCount: cfDay?.catalogCount ?? 0,
      mastery: this.combinedStatistics('all', now).mastery,
      weeklyGoal,
      newShortage: plan.newShortage ?? null,
    };
  }
  enrich(h: string, contests: CFContest[], ratings: CFRating[], problems: CFSubmission['problem'][]) {
    const relevant = new Set(this.all<Problem>('problems', h).map((p) => p.contestId));
    this.transaction(() => {
      if (contests.length)
        this.externalPut(`cf-contests:${h}`, 'current', z.array(contestSchema).parse(contests));
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
            key,
            contestId: p.contestId,
            index: p.index,
            name: p.name,
            rating: p.rating ?? null,
            tags: p.tags,
            url: `https://codeforces.com/contest/${p.contestId}/problem/${p.index}`,
          });
        }
        this.put(
          'catalog_cache',
          h,
          'current',
          catalogSchema.parse({ fetchedAt: new Date().toISOString(), problems: [...catalog.values()] }),
        );
      }
    });
  }
  private latestOfficialRating(h: string): number | undefined {
    return this.all<CFContest & { rating?: CFRating }>('contests', h)
      .map((contest) => contest.rating)
      .filter(
        (rating): rating is CFRating => !!rating && Number.isFinite(rating.newRating) && rating.newRating > 0,
      )
      .sort(
        (a, b) =>
          (b.ratingUpdateTimeSeconds ?? 0) - (a.ratingUpdateTimeSeconds ?? 0) || b.contestId - a.contestId,
      )[0]?.newRating;
  }
  trainingDay(h: string, now = new Date()): TrainingDay {
    const date = localDay(now);
    this.repairLegacyReviews(h);
    this.reconcileAcceptedRedo(h, date);
    const catalog = this.get<Catalog>('catalog_cache', h, 'current');
    const rows = this.problems(h);
    const submissions = this.all<CFSubmission>('submissions', h);
    const attempts = this.all<Attempt>('attempts', h);
    const known = this.all<Problem>('problems', h);
    const reviews = new Map(rows.map((p) => [p.key, p.review]));
    const mastery = masteryAreas(known, submissions, attempts, reviews, problemKey);
    let plan = this.get<DailyPlan>('daily_plans', h, date);
    const weeklyGoal = h === this.active() ? this.weeklyGoal(now) : null;
    if (!plan || (!plan.catalogReady && catalog && !!weeklyGoal && !plan.newKeys.length)) {
      const eligible = rows.filter((p) => !p.review.ignored);
      const carry = eligible
        .filter(
          (p) =>
            p.review.awaitingEvaluation ||
            (p.review.firstReflectionRequired && p.review.firstRedoAt && !p.review.firstReflectionAt),
        )
        .sort(
          (a, b) =>
            (a.review.firstRedoAt ?? '').localeCompare(b.review.firstRedoAt ?? '') ||
            a.key.localeCompare(b.key),
        );
      const due = eligible
        .filter(
          (p) =>
            !p.review.awaitingEvaluation &&
            p.review.status === 'reviewing' &&
            p.review.nextReview &&
            localDay(new Date(p.review.nextReview)) <= date,
        )
        .sort(
          (a, b) => a.review.nextReview!.localeCompare(b.review.nextReview!) || a.key.localeCompare(b.key),
        );
      const pending = eligible
        .filter((p) => p.review.status === 'pending' && !p.review.awaitingEvaluation && !p.review.firstRedoAt)
        .sort((a, b) => b.failures - a.failures || a.key.localeCompare(b.key));
      const review =
        plan?.review ??
        [
          ...carry.map((p) => ({
            key: p.key,
            kind: (p.review.firstRedoAt && !p.review.firstReflectionAt ? 'reflection' : 'evaluation') as
              'reflection' | 'evaluation',
          })),
          ...due
            .filter((p) => !carry.some((c) => c.key === p.key))
            .map((p) => ({ key: p.key, kind: 'due' as const })),
          ...pending.map((p) => ({ key: p.key, kind: 'pending' as const })),
        ].slice(0, 5);
      const blocked = new Set([
        ...known.map((p) => p.key),
        ...review.map((p) => p.key),
        ...this.priorNewKeys(h, date),
      ]);
      const picked = weeklyGoal
        ? chooseWeeklyProblems(
            catalog?.problems ?? [],
            blocked,
            mastery,
            recommendationDifficulty(known, submissions, problemKey, this.latestOfficialRating(h)),
            date,
            weeklyGoal,
            this.weeklyCoverage(h, date),
          )
        : { keys: [] as string[], reasons: {} as Record<string, string>, shortage: null };
      plan = dailyPlanSchema.parse({
        date,
        review,
        newKeys: picked.keys,
        newReasons: picked.reasons,
        newShortage: picked.shortage,
        catalogReady: !!catalog && !!weeklyGoal,
        createdAt: plan?.createdAt ?? now.toISOString(),
      });
      if (
        known.length ||
        catalog ||
        this.all<SyncJob>('jobs', h).some((j) => j.mode === 'full' && j.status === 'completed')
      )
        this.put('daily_plans', h, date, plan);
    }
    this.reconcileAcceptedRedo(h, date);
    const byKey = new Map(known.map((p) => [p.key, p]));
    const catalogByKey = new Map(catalog?.problems.map((p) => [p.key, p]) ?? []);
    const attemptsToday = new Set(
      attempts.filter((a) => localDay(new Date(a.createdAt)) === date).map((a) => a.problemKey),
    );
    const submittedToday = new Set(
      submissions.filter((s) => localDay(new Date(s.creationTimeSeconds * 1000)) === date).map(problemKey),
    );
    const acceptedToday = new Set(
      submissions
        .filter(
          (s) =>
            !s.author.teamId &&
            s.verdict === 'OK' &&
            localDay(new Date(s.creationTimeSeconds * 1000)) === date,
        )
        .map(problemKey),
    );
    const review: TrainingDay['review'] = plan.review.flatMap(({ key, kind, completedAt }) => {
      const p = byKey.get(key),
        r = this.review(h, key);
      if (!p || !r || r.ignored) return [];
      const redoAccepted = acceptedToday.has(key) || !!r.awaitingEvaluation;
      const attempted = attemptsToday.has(key);
      const needsReflection = r.firstReflectionRequired && !!r.firstRedoAt && !r.firstReflectionAt;
      const needsEvaluation = !!r.awaitingEvaluation;
      const phase = needsReflection
        ? 'reflection'
        : needsEvaluation
          ? 'evaluation'
          : redoAccepted || attempted || !!completedAt
            ? 'done'
            : 'redo';
      return [
        {
          key,
          source: p.source ?? 'cf',
          name: p.name,
          rating: p.rating,
          tags: p.tags,
          url: p.url,
          kind,
          phase,
          redoAccepted,
          completed: !needsReflection && !needsEvaluation && (redoAccepted || attempted || !!completedAt),
          attempted,
          nextReview: r.nextReview,
        },
      ];
    });
    const newProblems: TrainingDay['newProblems'] = plan.newKeys.flatMap((key) => {
      const p = catalogByKey.get(key) ?? byKey.get(key);
      if (!p) return [];
      return [
        {
          key,
          source: 'cf' as const,
          name: p.name,
          rating: p.rating,
          tags: p.tags,
          url: p.url,
          kind: 'new' as const,
          phase: acceptedToday.has(key) ? ('done' as const) : ('redo' as const),
          redoAccepted: acceptedToday.has(key),
          completed: acceptedToday.has(key),
          attempted: submittedToday.has(key),
          nextReview: null,
          recommendationReason: plan.newReasons?.[key],
        },
      ];
    });
    return {
      date,
      review,
      newProblems,
      catalogFetchedAt: catalog?.fetchedAt ?? null,
      recentCheckedAt:
        this.get<{ recentCheckedAt: string | null }>('training_meta', h, 'recent')?.recentCheckedAt ?? null,
      catalogCount: catalog?.problems.length ?? 0,
      mastery,
      weeklyGoal,
      newShortage: plan.newShortage ?? null,
    };
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
    const previous = this.all<Attempt>('attempts', h)
      .filter((a) => a.problemKey === key)
      .at(-1);
    if (!this.get('problems', h, key)) throw new Error('题目不存在');
    this.reconcileAcceptedRedo(h, localDay(now));
    const current = this.review(h, key);
    const currentRedoDay = current.awaitingEvaluation?.date ?? localDay(now);
    const hinted = this.externalAll<LearningRecord>('learning-source:' + h).some(
      (r) =>
        r.kind === 'hint' &&
        r.problemKey === key &&
        r.session === currentRedoDay + ':' + (previous?.id ?? 'first'),
    );
    if (hinted && data.result === 'independent') data.result = 'hint';
    if (current.status === 'mastered' || current.ignored) throw new Error('此题未处于复习流程');
    if (current.lastEvaluatedDay === localDay(now)) throw new Error('今天已评价过这道题');
    if (data.result === 'independent' && !current.awaitingEvaluation)
      throw new Error('未检测到当天 AC，不能记录独立做对');
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
      this.put('reviews', h, key, {
        ...next,
        firstRedoAt: current.firstRedoAt ?? now.toISOString(),
        firstReflectionRequired: current.firstReflectionRequired || current.status === 'pending',
        awaitingEvaluation: null,
        lastEvaluatedDay: localDay(now),
      });
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
      const ac = new Set(
        submissions
          .filter((s) => s.verdict === 'OK' && localDay(new Date(s.creationTimeSeconds * 1000)) === date)
          .map(problemKey),
      );
      dailyTraining.push({
        date,
        reviewAssigned: plan?.review.length ?? 0,
        reviewCompleted:
          plan?.review.filter((item) => {
            const r = reviews.get(item.key);
            const reflectionDone =
              !r?.firstReflectionRequired ||
              !!(r.firstReflectionAt && localDay(new Date(r.firstReflectionAt)) <= date);
            return reflectionDone && (ac.has(item.key) || completedDue.has(item.key) || !!item.completedAt);
          }).length ?? 0,
        newAssigned: plan?.newKeys.length ?? 0,
        newCompleted: plan?.newKeys.filter((key) => ac.has(key)).length ?? 0,
      });
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
      tags: count(rows.flatMap((p) => [...new Set(p.source === 'atcoder' ? p.review.categories : p.tags)])),
      trend,
      mastery,
      dailyTraining,
    };
  }
  combinedStatistics(source: 'all' | 'cf' | 'atcoder' = 'all', now = new Date()): Statistics {
    const profiles = [
      ...(source !== 'atcoder' && this.active() ? [this.active()] : []),
      ...(source !== 'cf' && this.activeAtcoder() ? [atcoderProfile(this.activeAtcoder())] : []),
    ];
    if (profiles.length === 1) return this.statistics(profiles[0], now);
    const parts = profiles.map((h) => this.statistics(h, now));
    const empty = () => this.statistics('', now);
    if (!parts.length) return empty();
    const sum = (key: 'total' | 'unsolved' | 'mastered' | 'pending' | 'due' | 'submissions') =>
      parts.reduce((n, p) => n + p[key], 0);
    const count = (key: 'reasons' | 'tags') => {
      const values = new Map<string, number>();
      for (const part of parts)
        for (const [name, n] of part[key]) values.set(name, (values.get(name) ?? 0) + n);
      return [...values].sort((a, b) => b[1] - a[1]);
    };
    const problems = profiles.flatMap((h) => this.all<Problem>('problems', h));
    const submissions = profiles.flatMap((h) => this.all<CFSubmission>('submissions', h));
    const attempts = profiles.flatMap((h) => this.all<Attempt>('attempts', h));
    const reviews = new Map(profiles.flatMap((h) => this.problems(h).map((p) => [p.key, p.review] as const)));
    const mastery = masteryAreas(problems, submissions, attempts, reviews, problemKey);
    const dailyTraining = parts[0].dailyTraining.map((t, i) => {
      const merged = {
        date: t.date,
        reviewAssigned: parts.reduce((n, p) => n + p.dailyTraining[i].reviewAssigned, 0),
        reviewCompleted: parts.reduce((n, p) => n + p.dailyTraining[i].reviewCompleted, 0),
        newAssigned: parts.reduce((n, p) => n + p.dailyTraining[i].newAssigned, 0),
        newCompleted: parts.reduce((n, p) => n + p.dailyTraining[i].newCompleted, 0),
      };
      const plan = this.combinedPlan(t.date);
      if (plan && source === 'all') {
        merged.reviewAssigned = plan.review.length;
        const ac = new Set(
          submissions
            .filter((s) => s.verdict === 'OK' && localDay(new Date(s.creationTimeSeconds * 1000)) === t.date)
            .map(problemKey),
        );
        const attempted = new Set(
          attempts.filter((a) => localDay(new Date(a.createdAt)) === t.date).map((a) => a.problemKey),
        );
        merged.reviewCompleted = plan.review.filter((item) => {
          const r = reviews.get(item.key);
          return (
            (!r?.firstReflectionRequired ||
              !!(r.firstReflectionAt && localDay(new Date(r.firstReflectionAt)) <= t.date)) &&
            (ac.has(item.key) || attempted.has(item.key) || !!item.completedAt)
          );
        }).length;
      }
      return merged;
    });
    return {
      total: sum('total'),
      unsolved: sum('unsolved'),
      mastered: sum('mastered'),
      pending: sum('pending'),
      due: sum('due'),
      submissions: sum('submissions'),
      reasons: count('reasons'),
      tags: count('tags'),
      mastery,
      trend: parts[0].trend.map((t, i) => ({
        date: t.date,
        independent: parts.reduce((n, p) => n + p.trend[i].independent, 0),
        hint: parts.reduce((n, p) => n + p.trend[i].hint, 0),
        failed: parts.reduce((n, p) => n + p.trend[i].failed, 0),
      })),
      dailyTraining,
    };
  }
  latestJob(h: string) {
    return this.all<SyncJob>('jobs', h).at(-1) || null;
  }
  backup() {
    return {
      format: 'contest-review',
      version: 8,
      exportedAt: new Date().toISOString(),
      activeHandle: this.active(),
      profiles: [...this.handles(), ...this.atcoderHandles().map(atcoderProfile)],
      activeAtcoder: this.activeAtcoder(),
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
    if (
      input &&
      typeof input === 'object' &&
      'version' in input &&
      Number(input.version) < 4 &&
      'tables' in input &&
      input.tables &&
      typeof input.tables === 'object'
    )
      input = {
        ...input,
        tables: { ...input.tables, catalog_cache: [], daily_plans: [], training_meta: [] },
      };
    const data = backupSchema.parse(input);
    if (data.version === 5 && data.activeAtcoder === undefined)
      throw new Error('v5 备份缺少 AtCoder 账号字段');
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
      if (row.namespace.startsWith('weekly:')) {
        const parts = row.namespace.split(':');
        if (
          parts.length !== 3 ||
          (parts[1] !== '-' && !data.profiles.includes(parts[1])) ||
          (parts[2] !== '-' && !data.profiles.includes(`ac~${parts[2]}`))
        )
          throw new Error('备份每周目标账号不一致');
      }
      if (
        ['upsolve:', 'reason:', 'simulation:', 'cf-contests:'].some((prefix) =>
          row.namespace.startsWith(prefix),
        )
      ) {
        const profile = row.namespace.slice(row.namespace.indexOf(':') + 1);
        if (!data.profiles.includes(profile)) throw new Error('备份训练数据账号不一致');
      }
      if (row.namespace.startsWith('learning-xcpc:')) {
        const player = row.namespace.slice('learning-xcpc:'.length),
          record = learningRecordSchema.parse(row.value);
        if (
          !external.some((r) => r.namespace === 'player' && r.key === player) ||
          record.kind !== 'coach' ||
          !record.contestKey.startsWith('xcpc:') ||
          record.id !== row.key
        )
          throw new Error('学习比赛报告账号不一致');
        row.value = record;
      } else if (row.namespace.startsWith('learning:') || row.namespace.startsWith('learning-source:')) {
        const parts = row.namespace.split(':');
        const owners = row.namespace.startsWith('learning-source:')
          ? parts.slice(1)
          : parts.slice(1).filter((p) => p !== '-');
        if (
          (row.namespace.startsWith('learning:') && parts.length !== 3) ||
          (row.namespace.startsWith('learning-source:') && parts.length !== 2) ||
          owners.some((p) => !data.profiles.includes(p))
        )
          throw new Error('学习数据账号不一致');
        const record = learningRecordSchema.parse(row.value);
        if (
          !owners.length ||
          (row.namespace.startsWith('learning:') &&
            ((parts[1] !== '-' && parts[1].startsWith('ac~')) ||
              (parts[2] !== '-' && !parts[2].startsWith('ac~'))))
        )
          throw new Error('学习账号组合不一致');
        if (row.namespace.startsWith('learning-source:') !== ['card', 'hint', 'bundle'].includes(record.kind))
          throw new Error('学习记录存储分区不一致');
        if (record.id !== row.key) throw new Error('学习记录编号不一致');
        if (
          'problemKey' in record &&
          !data.tables.problems.some((p) => owners.includes(p.profile) && p.key === record.problemKey)
        )
          throw new Error('学习记录缺少关联题目');
        if (
          'knowledgeIds' in record &&
          record.knowledgeIds.some((id) => !knowledgeCards.some((k) => k.id === id))
        )
          throw new Error('学习记录关联未知知识点');
        if (
          record.kind === 'bundle' &&
          (fingerprint(record.code) !== record.codeHash ||
            record.reports.some((r) => r.bundleId !== record.id || r.codeHash !== record.codeHash))
        )
          throw new Error('对拍代码快照不一致');
        if (
          record.kind === 'transfer' &&
          !data.tables.catalog_cache.some(
            (c) =>
              c.profile === parts[1] && (c.value as Catalog).problems.some((p) => p.key === record.targetKey),
          )
        )
          throw new Error('迁移任务缺少关联题库');
        if (record.kind === 'revision') {
          record.before = dailyPlanSchema.parse(record.before);
          record.after = dailyPlanSchema.parse(record.after);
          if (record.before.date !== record.date || record.after.date !== record.date)
            throw new Error('计划版本日期不一致');
        }
        row.value = record;
      } else if (row.namespace === 'ai' && row.key === 'config') row.value = aiConfigSchema.parse(row.value);
      else if (row.namespace.startsWith('ai-review:')) {
        const owner = row.namespace.slice('ai-review:'.length),
          record = aiReviewRecordSchema.parse(row.value);
        if (
          !data.profiles.includes(owner) ||
          row.key !== record.problemKey + ':' + record.id ||
          !data.tables.problems.some((p) => p.profile === owner && p.key === record.problemKey)
        )
          throw new Error('AI 留档关联不一致');
        row.value = record;
      } else if (row.namespace === 'atcoder-meta' && row.key === 'catalog')
        row.value = atcoderCatalogSchema.parse(row.value);
      else if (row.namespace.startsWith('daily:')) row.value = dailyPlanSchema.parse(row.value);
      else if (row.namespace.startsWith('weekly:')) {
        row.value = weeklyGoalSchema.parse(row.value);
        if ((row.value as WeeklyGoal).week !== row.key) throw new Error('备份每周目标日期不一致');
      } else if (row.namespace.startsWith('upsolve:')) {
        row.value = upsolveSchema.parse(row.value);
        if ((row.value as z.infer<typeof upsolveSchema>).key !== row.key)
          throw new Error('备份补题编号不一致');
      } else if (row.namespace.startsWith('reason:')) {
        row.value = reasonSnapshotSchema.parse(row.value);
        const item = row.value as ReasonSnapshot;
        if (item.id !== row.key) throw new Error('备份错因快照编号不一致');
      } else if (row.namespace.startsWith('simulation:')) {
        row.value = simulationSchema.parse(row.value);
        if ((row.value as Simulation).id !== row.key) throw new Error('备份模拟赛编号不一致');
      } else if (row.namespace.startsWith('cf-contests:')) {
        row.value = z.array(contestSchema).parse(row.value);
        if (row.key !== 'current') throw new Error('备份 CF 比赛目录编号不一致');
      } else if (row.namespace.startsWith('atcoder:') && row.key === 'history')
        row.value = atcoderHistorySchema.parse(row.value);
      else if (row.namespace.startsWith('atcoder:') && row.key.startsWith('report:'))
        row.value = atcoderReportSchema.parse(row.value);
      else if (row.namespace.startsWith('atcoder:') && row.key.startsWith('review:'))
        row.value = contestReviewSchema.parse(row.value);
      else row.value = xcpcRecordSchema(row.namespace, row.key).parse(row.value);
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
      (data.activeHandle && !data.profiles.includes(data.activeHandle)) ||
      (data.activeAtcoder && !data.profiles.includes(atcoderProfile(data.activeAtcoder)))
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
          (t === 'jobs' &&
            (row.profile.startsWith('ac~')
              ? atcoderProfile(String(v.handle)) !== row.profile
              : v.handle !== row.profile))
        )
          throw new Error('备份记录编号不一致');
        if (
          t === 'problems' &&
          ((v.source === 'atcoder' && atcoderKey(String(v.index)) !== row.key) ||
            (v.source !== 'atcoder' && v.contestId && `${v.contestId}:${v.index}` !== row.key))
        )
          throw new Error('备份题号不一致');
        if (
          (t === 'catalog_cache' && row.key !== 'current') ||
          (t === 'training_meta' && row.key !== 'recent') ||
          (t === 'daily_plans' && v.date !== row.key)
        )
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
      if (
        new Set(keys).size !== keys.length ||
        Object.keys(plan.newReasons ?? {}).some((key) => !plan.newKeys.includes(key)) ||
        plan.review.some((item) => !known.get('problems')!.has(`${row.profile}\0${item.key}`)) ||
        plan.newKeys.some(
          (key) =>
            !catalogKeys.get(row.profile)?.has(key) && !known.get('problems')!.has(`${row.profile}\0${key}`),
        )
      )
        throw new Error('备份题单包含重复或不存在的题目');
    }
    for (const row of external.filter((r) => r.namespace.startsWith('daily:'))) {
      const plan = row.value as DailyPlan;
      if (plan.date !== row.key) throw new Error('备份合并题单日期不一致');
      const keys = [...plan.review.map((i) => i.key), ...plan.newKeys];
      if (
        new Set(keys).size !== keys.length ||
        Object.keys(plan.newReasons ?? {}).some((key) => !plan.newKeys.includes(key)) ||
        plan.review.some((i) => !data.profiles.some((h) => known.get('problems')!.has(`${h}\0${i.key}`))) ||
        plan.newKeys.some(
          (k) =>
            !data.tables.catalog_cache.some((c) => (c.value as Catalog).problems.some((p) => p.key === k)) &&
            !data.profiles.some((h) => known.get('problems')!.has(`${h}\0${k}`)),
        )
      )
        throw new Error('备份合并题单包含重复或不存在的题目');
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
      this.setSetting('atcoder-active', data.activeAtcoder ?? '');
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
    this.learningEpoch++;
    return { backupPath };
  }
}
export function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
