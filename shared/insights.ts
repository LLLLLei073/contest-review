import { z } from 'zod';
import type { CoreStore } from './core-store.js';
import { localDay, problemKey } from './core-store.js';
import { allBattleRewards } from './battle-service.js';
import { masteryAreas, type MasteryArea } from './training.js';
import { atcoderProfile, atcoderNamespace, atcoderHistorySchema } from './atcoder.js';
import { luoguProfile, luoguNamespace, luoguUserSnapshotSchema } from './luogu.js';
import type { Attempt, CFSubmission, Problem, ProblemRow } from './domain.js';

const masteryAreaSchema = z.object({
  name: z.string(),
  score: z.number(),
  samples: z.number(),
});
export const insightsSchema = z.object({
  generatedAt: z.string().datetime(),
  accounts: z
    .array(
      z.object({
        platform: z.enum(['cf', 'atcoder', 'luogu']),
        handle: z.string(),
        name: z.string(),
        bound: z.boolean(),
        rating: z.number().nullable(),
        solved: z.number().int().nonnegative(),
        officialSolved: z.number().int().nonnegative().nullable(),
        submissions: z.number().int().nonnegative(),
        lastSync: z.string().nullable(),
      }),
    )
    .length(3),
  totals: z.object({
    solved: z.number().int().nonnegative(),
    submissions: z.number().int().nonnegative(),
    activeDays: z.number().int().nonnegative(),
  }),
  ratings: z.object({
    cf: z.array(z.object({ t: z.number(), rating: z.number() })),
    atcoder: z.array(z.object({ t: z.number(), rating: z.number() })),
  }),
  mastery: z.object({
    all: z.array(masteryAreaSchema),
    cf: z.array(masteryAreaSchema),
    atcoder: z.array(masteryAreaSchema),
    luogu: z.array(masteryAreaSchema),
  }),
  difficulty: z.array(
    z.object({
      label: z.string(),
      cf: z.number().int().nonnegative(),
      atcoder: z.number().int().nonnegative(),
      luogu: z.number().int().nonnegative(),
    }),
  ),
  activity: z.array(
    z.object({
      month: z.string(),
      cf: z.number().int().nonnegative(),
      atcoder: z.number().int().nonnegative(),
      luogu: z.number().int().nonnegative(),
    }),
  ),
});
export type InsightsPayload = z.infer<typeof insightsSchema>;

export const difficultyBuckets = [
  { label: '≤999', min: 0, max: 1000 },
  { label: '1000-1199', min: 1000, max: 1200 },
  { label: '1200-1399', min: 1200, max: 1400 },
  { label: '1400-1599', min: 1400, max: 1600 },
  { label: '1600-1899', min: 1600, max: 1900 },
  { label: '1900-2199', min: 1900, max: 2200 },
  { label: '2200-2599', min: 2200, max: 2600 },
  { label: '2600+', min: 2600, max: Infinity },
] as const;

function profileMastery(store: CoreStore, profiles: string[]): MasteryArea[] {
  const problems = profiles.flatMap((h) => store.all<Problem>('problems', h));
  const submissions = profiles.flatMap((h) => store.all<CFSubmission>('submissions', h));
  const attempts = profiles.flatMap((h) => store.all<Attempt>('attempts', h));
  const reviews = new Map(
    profiles.flatMap((h) => store.problems(h).map((p) => [p.key, p.review] as const)),
  );
  return masteryAreas(
    problems,
    submissions,
    attempts,
    reviews,
    problemKey,
    profiles.flatMap((h) => allBattleRewards(store, h)),
  );
}

// 错题库视图（store.problems）只包含有复习记录的题；通过数与难度分布
// 需要按提交里的 OK 记录对 problemKey 去重，再回查题目难度。
function solvedProblems(store: CoreStore, profile: string): Problem[] {
  const solved = new Set(
    store
      .all<CFSubmission>('submissions', profile)
      .filter((s) => s.verdict === 'OK')
      .map(problemKey),
  );
  return [...solved]
    .map((key) => store.get<Problem>('problems', profile, key))
    .filter((p): p is Problem => !!p);
}

const emptyMastery = () =>
  masteryAreas([], [], [], new Map<string, ProblemRow['review']>(), problemKey);

export function buildInsights(store: CoreStore, now = new Date()): InsightsPayload {
  const cfHandle = store.active(),
    atcoderHandle = store.activeAtcoder(),
    luoguUid = store.activeLuogu(),
    cfProfile = cfHandle,
    atcProfile = atcoderHandle ? atcoderProfile(atcoderHandle) : '',
    lgProfile = luoguUid ? luoguProfile(luoguUid) : '';
  const luoguSnapshot = luoguUid
    ? (store.externalGet(luoguNamespace(luoguUid), 'user') ?? null)
    : null;
  const luoguUser = luoguSnapshot ? luoguUserSnapshotSchema.parse(luoguSnapshot) : null;
  const accounts: InsightsPayload['accounts'] = [
    {
      platform: 'cf',
      handle: cfHandle,
      name: cfHandle,
      bound: !!cfHandle,
      rating:
        cfHandle && store.contests(cfHandle).length
          ? (store
              .contests(cfHandle)
              .map((r) => r.rating?.newRating ?? null)
              .filter((n): n is number => n !== null)
              .at(-1) ?? null)
          : null,
      solved: cfHandle ? solvedProblems(store, cfProfile).length : 0,
      officialSolved: null,
      submissions: cfHandle ? store.all('submissions', cfProfile).length : 0,
      lastSync: cfHandle ? (store.latestJob(cfProfile)?.finishedAt ?? null) : null,
    },
    {
      platform: 'atcoder',
      handle: atcoderHandle,
      name: atcoderHandle,
      bound: !!atcoderHandle,
      rating: (() => {
        if (!atcoderHandle) return null;
        const history = store.externalGet(atcoderNamespace(atcoderHandle), 'history');
        if (!history) return null;
        const entries = atcoderHistorySchema.parse(history).entries.filter((e) => e.IsRated);
        return entries.length ? entries.at(-1)!.NewRating : null;
      })(),
      solved: atcoderHandle ? solvedProblems(store, atcProfile).length : 0,
      officialSolved: null,
      submissions: atcoderHandle ? store.all('submissions', atcProfile).length : 0,
      lastSync: atcoderHandle ? (store.latestJob(atcProfile)?.finishedAt ?? null) : null,
    },
    {
      platform: 'luogu',
      handle: luoguUid,
      name: luoguUser?.name ?? luoguUid,
      bound: !!luoguUid,
      rating: null,
      solved: luoguUid ? solvedProblems(store, lgProfile).length : 0,
      officialSolved: luoguUser?.passedProblemCount ?? null,
      submissions: luoguUid ? store.all('submissions', lgProfile).length : 0,
      lastSync: luoguUid ? (store.latestJob(lgProfile)?.finishedAt ?? null) : null,
    },
  ];
  const profiles = [cfProfile, atcProfile, lgProfile].filter(Boolean);
  const days = new Set<string>();
  const activity = new Map<string, { cf: number; atcoder: number; luogu: number }>();
  const sources: Record<'cf' | 'atcoder' | 'luogu', string> = {
    cf: cfProfile,
    atcoder: atcProfile,
    luogu: lgProfile,
  };
  for (const platform of ['cf', 'atcoder', 'luogu'] as const) {
    const profile = sources[platform];
    if (!profile) continue;
    for (const s of store.all<CFSubmission>('submissions', profile)) {
      const day = localDay(new Date(s.creationTimeSeconds * 1000));
      days.add(day);
      const month = day.slice(0, 7);
      const slot = activity.get(month) ?? { cf: 0, atcoder: 0, luogu: 0 };
      slot[platform]++;
      activity.set(month, slot);
    }
  }
  const months: string[] = [];
  const anchor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const difficulty = difficultyBuckets.map((bucket) => ({
    label: bucket.label,
    cf: 0,
    atcoder: 0,
    luogu: 0,
  }));
  for (const platform of ['cf', 'atcoder', 'luogu'] as const) {
    const profile = sources[platform];
    if (!profile) continue;
    for (const row of solvedProblems(store, profile)) {
      if (row.rating === null) continue;
      const index = difficultyBuckets.findIndex((b) => row.rating! >= b.min && row.rating! < b.max);
      if (index >= 0) difficulty[index][platform]++;
    }
  }
  return insightsSchema.parse({
    generatedAt: now.toISOString(),
    accounts,
    totals: {
      solved: accounts.reduce((n, a) => n + a.solved, 0),
      submissions: accounts.reduce((n, a) => n + a.submissions, 0),
      activeDays: days.size,
    },
    ratings: {
      cf: cfHandle
        ? store
            .contests(cfHandle)
            .filter((r) => !!r.rating?.newRating)
            .map((r) => ({ t: r.rating!.ratingUpdateTimeSeconds ?? 0, rating: r.rating!.newRating }))
            .sort((a, b) => a.t - b.t)
        : [],
      atcoder: atcoderHandle
        ? (() => {
            const history = store.externalGet(atcoderNamespace(atcoderHandle), 'history');
            if (!history) return [];
            return atcoderHistorySchema
              .parse(history)
              .entries.filter((e) => e.IsRated && e.NewRating >= 0)
              .map((e) => ({ t: Math.round(Date.parse(e.EndTime) / 1000), rating: e.NewRating }))
              .sort((a, b) => a.t - b.t);
          })()
        : [],
    },
    mastery: {
      all: profileMastery(store, profiles),
      cf: cfHandle ? profileMastery(store, [cfProfile]) : emptyMastery(),
      atcoder: atcoderHandle ? profileMastery(store, [atcProfile]) : emptyMastery(),
      luogu: luoguUid ? profileMastery(store, [lgProfile]) : emptyMastery(),
    },
    difficulty,
    activity: months.map((month) => ({
      month,
      cf: activity.get(month)?.cf ?? 0,
      atcoder: activity.get(month)?.atcoder ?? 0,
      luogu: activity.get(month)?.luogu ?? 0,
    })),
  });
}
