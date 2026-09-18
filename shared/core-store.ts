import { z } from 'zod';
import {
  attemptSchema,
  emptyReview,
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
  author: z.object({ participantType: z.string(), startTimeSeconds: z.number().optional() }),
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
  rating: z
    .object({
      contestId: z.number().int().positive(),
      contestName: z.string(),
      oldRating: z.number(),
      newRating: z.number(),
      rank: z.number(),
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
};
const handleSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/);
const backupSchema = z.object({
  format: z.literal('contest-review'),
  version: z.literal(1),
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
    if (version > 1) throw new Error('数据库来自更新版本，请升级程序');
    if (version === 0)
      this.transaction(() => {
        this.db.exec(
          'CREATE TABLE profiles (handle TEXT PRIMARY KEY); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
        );
        for (const table of tables)
          this.db.exec(
            `CREATE TABLE ${table} (profile TEXT NOT NULL REFERENCES profiles(handle), key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(profile,key));`,
          );
        this.db.exec('PRAGMA user_version=1');
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
    return this.get<Review>('reviews', h, key) || emptyReview();
  }
  saveReview(h: string, key: string, review: Review) {
    if (!this.get('problems', h, key)) throw new Error('题目不存在');
    this.put('reviews', h, key, reviewSchema.parse(review));
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
    });
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
      ).map((r) => [r.key, JSON.parse(r.value) as Review]),
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
    const current = this.review(h, key);
    if (!this.get('problems', h, key)) throw new Error('题目不存在');
    if (current.status !== 'reviewing' || current.ignored) throw new Error('请先完成复盘或重新加入复习');
    const attempt: Attempt = {
      ...data,
      id: crypto.randomUUID(),
      problemKey: key,
      createdAt: now.toISOString(),
    };
    this.transaction(() => {
      this.put('attempts', h, attempt.id, attempt);
      this.saveReview(h, key, nextReviewState(current, data.result, now));
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
        return {
          id,
          name: c?.name || `Codeforces ${id}`,
          startTimeSeconds: c?.startTimeSeconds,
          types: [...new Set(subs.map((s) => s.author.participantType))],
          problemCount: new Set(subs.map(problemKey)).size,
          solvedCount: new Set(subs.filter((s) => s.verdict === 'OK').map(problemKey)).size,
          rating: c?.rating,
          review: this.get<ContestReview>('contest_reviews', h, String(id)) || {
            timeAllocation: '',
            mistakes: '',
            improvements: '',
          },
        };
      })
      .sort((a, b) => (b.startTimeSeconds || b.id) - (a.startTimeSeconds || a.id));
  }
  statistics(h: string, now = new Date()): Statistics {
    const rows = this.problems(h).filter((p) => !p.review.ignored),
      attempts = this.all<Attempt>('attempts', h);
    const count = (items: string[]) => {
      const map = new Map<string, number>();
      items.forEach((s) => map.set(s, (map.get(s) || 0) + 1));
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
    const trend: Statistics['trend'] = [];
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
    }
    return {
      total: rows.length,
      unsolved: rows.filter((p) => !p.solved).length,
      mastered: rows.filter((p) => p.review.status === 'mastered').length,
      pending: rows.filter((p) => p.review.status === 'pending').length,
      due: rows.filter(
        (p) =>
          p.review.status === 'reviewing' &&
          p.review.nextReview &&
          localDay(new Date(p.review.nextReview)) <= localDay(now),
      ).length,
      submissions: this.all('submissions', h).length,
      reasons: count(rows.flatMap((p) => [...new Set(p.review.reasons)])),
      tags: count(rows.flatMap((p) => [...new Set(p.tags)])),
      trend,
    };
  }
  latestJob(h: string) {
    return this.all<SyncJob>('jobs', h).at(-1) || null;
  }
  backup() {
    return {
      format: 'contest-review',
      version: 1,
      exportedAt: new Date().toISOString(),
      activeHandle: this.active(),
      profiles: this.handles(),
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
    const data = backupSchema.parse(input);
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
          (['submissions', 'contests', 'attempts', 'jobs'].includes(t) && String(v.id) !== row.key) ||
          (t === 'jobs' && v.handle !== row.profile)
        )
          throw new Error('备份记录编号不一致');
        if (t === 'problems' && v.contestId && `${v.contestId}:${v.index}` !== row.key)
          throw new Error('备份题号不一致');
      }
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
    const backupPath = this.beforeRestore?.(this.backup()) ?? null;
    this.transaction(() => {
      for (const t of tables) this.db.exec(`DELETE FROM ${t}`);
      this.db.exec('DELETE FROM profiles; DELETE FROM settings;');
      for (const h of data.profiles) this.db.prepare('INSERT INTO profiles VALUES(?)').run(h);
      this.db.prepare("INSERT INTO settings VALUES('active',?)").run(data.activeHandle);
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
