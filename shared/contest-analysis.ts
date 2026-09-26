import { z } from 'zod';
import { failures, type CFContest, type CFRating, type CFSubmission } from './domain.js';

const positive = z.number().int().positive();
export const analysisContestSchema = z.object({
  id: positive,
  name: z.string(),
  startTimeSeconds: z.number().optional(),
  durationSeconds: positive.optional(),
  phase: z.string().optional(),
  type: z.enum(['CF', 'IOI', 'ICPC']).optional(),
  frozen: z.boolean().optional(),
});
export const analysisProblemSchema = z.object({
  contestId: positive.optional(),
  index: z.string().min(1),
  name: z.string(),
  rating: z.number().positive().optional(),
  tags: z.array(z.string()).default([]),
});
export const standingsSchema = z.object({
  contest: analysisContestSchema,
  problems: z.array(analysisProblemSchema).min(1),
  rows: z.array(
    z.object({
      party: z.object({
        participantType: z.string(),
        members: z.array(z.object({ handle: z.string() })),
        teamId: z.number().optional(),
        ghost: z.boolean().optional(),
        startTimeSeconds: z.number().optional(),
      }),
      rank: positive,
      points: z.number(),
      penalty: z.number().optional(),
    }),
  ),
});
export const ratingChangesSchema = z.array(
  z.object({
    handle: z.string(),
    oldRating: z.number(),
    newRating: z.number(),
    ratingUpdateTimeSeconds: z.number().optional(),
  }),
);
export const analysisCacheSchema = z
  .object({
    id: positive,
    fetchedAt: z.string().datetime(),
    standings: standingsSchema,
    ratings: ratingChangesSchema,
    warnings: z.array(z.string()),
    submissionsComplete: z.boolean(),
  })
  .refine((x) => x.id === x.standings.contest.id, '比赛缓存编号不一致');
export type AnalysisCache = z.infer<typeof analysisCacheSchema>;
export type AnalysisProblem = z.infer<typeof analysisProblemSchema>;
export interface ScorePart {
  id: 'rank' | 'difficulty' | 'stability' | 'pace';
  label: string;
  weight: number;
  score: number | null;
  reason: string;
  formula: string;
  samples: number;
}
export interface Advice {
  id: string;
  evidence: string;
  possibility: string;
  action: string;
  submissionIds: number[];
  problemIndex?: string;
}
export interface Session {
  key: string;
  type: string;
  start: number | null;
  duration: number | null;
  team: boolean;
  submissions: CFSubmission[];
  excluded: number;
}
export interface ProblemTimeline {
  index: string;
  name: string;
  rating?: number;
  first: number | null;
  ac: number | null;
  failures: number;
  events: { id: number; seconds: number; verdict: string; url: string }[];
}
export interface PerformanceRating {
  version: '1.0';
  value: number | null;
  bound: 'lower' | 'upper' | null;
  method: 'rank' | 'difficulty' | null;
  samples: number;
  reason: string;
  seed: number | null;
  targetRank: number | null;
}
export interface ContestAnalysis {
  contestId: number;
  version: '1.0';
  session: Omit<Session, 'submissions'>;
  score: number | null;
  performanceRating: PerformanceRating;
  provisional: boolean;
  eligibleWeight: number;
  parts: ScorePart[];
  warnings: string[];
  solved: number;
  attempted: number;
  submissions: number;
  firstAC: number | null;
  preRating: number | null;
  official: { rank: number; participants: number; points: number; percentile: number } | null;
  paceBaseline: number | null;
  paceValue: number | null;
  timeline: ProblemTimeline[];
  advice: Advice[];
}
export interface AnalysisReport {
  handle: string;
  contestId: number;
  fetchedAt: string | null;
  task: { status: 'idle' | 'running' | 'completed' | 'failed'; message: string };
  sessions: ContestAnalysis[];
  practiceCount: number;
  practiceSubmissions: { id: number; index: string; time: number; verdict: string }[];
  warnings: string[];
}
export interface AnalysisInput {
  handle: string;
  contest: CFContest & { rating?: CFRating };
  submissions: CFSubmission[];
  contests: (CFContest & { rating?: CFRating })[];
  cache?: AnalysisCache;
  problems: AnalysisProblem[];
  complete: boolean;
}
const types = new Set(['CONTESTANT', 'OUT_OF_COMPETITION', 'VIRTUAL']);
const median = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b);
  return (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2;
};
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const ratingChance = (candidate: number, opponent: number) => 1 / (1 + 10 ** ((candidate - opponent) / 400));
function inverseRating(target: number, expected: (rating: number) => number) {
  if (target >= expected(0)) return { value: 0, bound: 'lower' as const };
  if (target <= expected(4000)) return { value: 4000, bound: 'upper' as const };
  let low = 0,
    high = 4000;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (expected(mid) > target) low = mid;
    else high = mid;
  }
  return { value: Math.round((low + high) / 2), bound: null };
}
function estimatePerformance(
  session: Session,
  timeline: ProblemTimeline[],
  ranked: NonNullable<AnalysisCache['standings']>['rows'],
  ratings: AnalysisCache['ratings'],
  handle: string,
  ownRating: number | null,
  eligible: boolean,
): PerformanceRating {
  const base: PerformanceRating = {
    version: '1.0',
    value: null,
    bound: null,
    method: null,
    samples: 0,
    reason: '',
    seed: null,
    targetRank: null,
  };
  if (!eligible)
    return {
      ...base,
      reason: '需要已结束且未封榜的个人参赛、完整赛时提交及已确定的判定。',
    };
  if (session.type === 'CONTESTANT' && ownRating !== null) {
    const oldRatings = new Map(
      ratings.filter((r) => r.oldRating > 0).map((r) => [r.handle.toLowerCase(), r.oldRating]),
    );
    const own = ranked.find((r) => r.party.members[0].handle.toLowerCase() === handle.toLowerCase());
    if (own) {
      const opponents = ranked.flatMap((r) => {
        const name = r.party.members[0].handle.toLowerCase();
        const rating = oldRatings.get(name);
        return name !== handle.toLowerCase() && rating !== undefined ? [{ rank: r.rank, rating }] : [];
      });
      if (opponents.length >= 20) {
        const actualRank =
          1 +
          opponents.filter((r) => r.rank < own.rank).length +
          opponents.filter((r) => r.rank === own.rank).length / 2;
        const expected = (rating: number) =>
          1 + opponents.reduce((sum, r) => sum + ratingChance(rating, r.rating), 0);
        const seed = expected(ownRating);
        const targetRank = Math.sqrt(seed * actualRank);
        const inverse = inverseRating(targetRank, expected);
        return {
          ...base,
          ...inverse,
          method: 'rank',
          samples: opponents.length,
          seed,
          targetRank,
          reason: `同场 ${opponents.length} 名有赛前 Rating 的个人选手；预期名次 ${seed.toFixed(1)}，实际名次 ${actualRank.toFixed(1)}，几何平均 ${targetRank.toFixed(1)}。`,
        };
      }
    }
  }
  const rated = timeline.filter((p) => p.rating !== undefined && p.rating > 0);
  if (timeline.length < 3 || rated.length < 3 || rated.length / timeline.length < 0.8)
    return { ...base, reason: '名次对照不足；难度估算至少需要 3 道有难度的题，且覆盖完整题集的 80%。' };
  const solved = rated.filter((p) => p.ac !== null).length;
  const target = (rated.length * (solved + 0.5)) / (rated.length + 1);
  const expected = (rating: number) => rated.reduce((sum, p) => sum + 1 - ratingChance(rating, p.rating!), 0);
  // Expected solves increase with rating, unlike expected rank.
  let low = 0,
    high = 4000;
  let bound: PerformanceRating['bound'] = null;
  if (target <= expected(low)) bound = 'lower';
  else if (target >= expected(high)) bound = 'upper';
  else
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (expected(mid) < target) low = mid;
      else high = mid;
    }
  return {
    ...base,
    value: bound === 'lower' ? 0 : bound === 'upper' ? 4000 : Math.round((low + high) / 2),
    bound,
    method: 'difficulty',
    samples: rated.length,
    reason: `低置信度难度估算：${rated.length}/${timeline.length} 题有难度，赛时 AC ${solved} 题；平滑目标完成数 ${target.toFixed(2)}。`,
  };
}
const personal = (p: CFSubmission['author']) =>
  !p.teamId && !p.ghost && (!p.members || p.members.length === 1);
export function contestSessions(contest: CFContest, all: CFSubmission[]): Session[] {
  const groups = new Map<string, Session>();
  for (const s of all) {
    if ((s.contestId ?? s.problem.contestId) !== contest.id || !types.has(s.author.participantType)) continue;
    const type = s.author.participantType;
    const start =
      type === 'VIRTUAL'
        ? (s.author.startTimeSeconds ??
          (s.relativeTimeSeconds !== undefined && s.relativeTimeSeconds >= 0
            ? s.creationTimeSeconds - s.relativeTimeSeconds
            : null))
        : (contest.startTimeSeconds ?? null);
    const key = type + ':' + (start ?? 'unknown');
    const group = groups.get(key) ?? {
      key,
      type,
      start,
      duration: contest.durationSeconds && contest.durationSeconds > 0 ? contest.durationSeconds : null,
      team: false,
      submissions: [],
      excluded: 0,
    };
    group.team ||= !personal(s.author);
    const elapsed = start === null ? null : s.creationTimeSeconds - start;
    if (elapsed !== null && group.duration !== null && elapsed >= 0 && elapsed < group.duration)
      group.submissions.push(s);
    else group.excluded++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (b.start ?? 0) - (a.start ?? 0) || a.type.localeCompare(b.type));
}
function timelines(session: Session, problems: AnalysisProblem[], contestId: number): ProblemTimeline[] {
  const indices = new Map(problems.map((p) => [p.index, p]));
  for (const s of session.submissions)
    if (!indices.has(s.problem.index)) indices.set(s.problem.index, s.problem);
  return [...indices.values()]
    .sort((a, b) => a.index.localeCompare(b.index, undefined, { numeric: true }))
    .map((p) => {
      const events = session.submissions
        .filter((s) => s.problem.index === p.index)
        .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id)
        .map((s) => ({
          id: s.id,
          seconds: s.creationTimeSeconds - session.start!,
          verdict: s.verdict ?? 'UNKNOWN',
          url: `https://codeforces.com/contest/${contestId}/submission/${s.id}`,
        }));
      const acIndex = events.findIndex((s) => s.verdict === 'OK');
      return {
        ...p,
        first: events[0]?.seconds ?? null,
        ac: acIndex < 0 ? null : events[acIndex].seconds,
        failures: events.slice(0, acIndex < 0 ? undefined : acIndex).filter((s) => failures.has(s.verdict))
          .length,
        events,
      };
    });
}
function pace(session: Session): number | null {
  if (!session.duration || session.start === null) return null;
  const times = timelines(session, [], 0)
    .flatMap((p) => (p.ac === null ? [] : [p.ac]))
    .sort((a, b) => a - b);
  return times.length ? (times[0] + times[Math.ceil(times.length / 2) - 1]) / (2 * session.duration) : null;
}
export function analyzeContest(input: AnalysisInput): ContestAnalysis[] {
  const { handle, submissions, contests, cache } = input;
  const contest = { ...input.contest, ...cache?.standings.contest };
  const problems = cache?.standings.problems ?? input.problems;
  const sessions = contestSessions(contest, submissions);
  const officialParty = cache?.standings.rows.find(
    (r) =>
      r.party.participantType === 'CONTESTANT' &&
      r.party.members.some((m) => m.handle.toLowerCase() === handle.toLowerCase()),
  )?.party;
  if (!sessions.some((s) => s.type === 'CONTESTANT') && (officialParty || input.contest.rating))
    sessions.unshift({
      key: `CONTESTANT:${contest.startTimeSeconds ?? 'unknown'}`,
      type: 'CONTESTANT',
      start: contest.startTimeSeconds ?? null,
      duration: contest.durationSeconds ?? null,
      team: officialParty ? !personal(officialParty) : false,
      submissions: [],
      excluded: 0,
    });
  return sessions.map((session) => {
    if (session.type === 'CONTESTANT' && officialParty && !personal(officialParty)) session.team = true;
    const warnings = [...(cache?.warnings ?? [])];
    const complete = input.complete || !!cache?.submissionsComplete;
    if (!complete) warnings.push('提交历史尚未完整，暂不评分。请同步或刷新分析。');
    if (session.start === null || session.duration === null)
      warnings.push('缺少参赛开始时间或比赛时长，无法确定赛时窗口。');
    if (session.excluded) warnings.push(`${session.excluded} 条非赛时或无法定位时间的提交未计入。`);
    if (session.team) warnings.push('团队或非个人参赛仅展示事实，不生成个人综合分。');
    const finished = contest.phase === 'FINISHED' && !contest.frozen;
    const unsettled = session.submissions.some((s) => s.verdict !== 'OK' && !failures.has(s.verdict ?? ''));
    if (unsettled) warnings.push('存在待判、系统异常或未知判定，未计为失败，评分暂定。');
    if (!finished) warnings.push('比赛未终结、榜单冻结或状态缺失，当前分析为暂定。');
    const timeline = timelines(session, problems, contest.id),
      solved = timeline.filter((p) => p.ac !== null).length;
    const attempted = timeline.filter((p) => p.events.length).length;
    const firstAC = timeline.reduce<number | null>(
      (m, p) => (p.ac === null ? m : m === null ? p.ac : Math.min(m, p.ac)),
      null,
    );
    const ownChange = cache?.ratings.find((r) => r.handle.toLowerCase() === handle.toLowerCase());
    const earlier = contests
      .flatMap((c) =>
        c.rating &&
        c.rating.ratingUpdateTimeSeconds !== undefined &&
        c.rating.ratingUpdateTimeSeconds < (session.start ?? 0)
          ? [c.rating]
          : [],
      )
      .sort((a, b) => b.ratingUpdateTimeSeconds! - a.ratingUpdateTimeSeconds!);
    const rawRating =
      session.type === 'CONTESTANT'
        ? (ownChange?.oldRating ?? input.contest.rating?.oldRating ?? earlier[0]?.newRating)
        : earlier[0]?.newRating;
    const preRating = rawRating && rawRating > 0 ? rawRating : null;
    const parts: ScorePart[] = [
      {
        id: 'rank',
        label: '排名相对发挥',
        weight: 35,
        score: null,
        reason: '缺少正式个人榜单、有效赛前 Rating 或至少 20 人的同水平对照。',
        formula: 'clamp(70 + 100 × (超越比例 − 对照中位数))',
        samples: 0,
      },
      {
        id: 'difficulty',
        label: '难度完成情况',
        weight: 30,
        score: null,
        reason: '需要完整题集、至少 80% 难度覆盖和有效赛前 Rating。',
        formula: 'clamp(70 × 有难度题 AC 数 / Σ(1 / (1 + 10^((难度−Rating)/400))))；经验规则',
        samples: 0,
      },
      {
        id: 'stability',
        label: '提交稳定性',
        weight: 20,
        score: null,
        reason: '没有可评价的 AC 或明确失败提交。',
        formula: '100 × AC 题数 / (AC 题数 + 首次 AC 前及未 AC 题失败次数)',
        samples: 0,
      },
      {
        id: 'pace',
        label: '推进节奏',
        weight: 15,
        score: null,
        reason: '需要至少 3 场同类型、同计分制且时长相近的有效历史比赛。',
        formula: 'clamp(70 + 100 × (历史节奏中位数 − 本场节奏))；节奏=(首次AC时间+半数AC时间)/(2×时长)',
        samples: 0,
      },
    ];
    let official: ContestAnalysis['official'] = null,
      rankBaseline: number | null = null;
    const ranked =
      cache?.standings.rows
        .filter((r) => r.party.participantType === 'CONTESTANT' && personal(r.party))
        .sort((a, b) => a.rank - b.rank) ?? [];
    // Compute tied midpositions in linear time; never mix rating-update ranks with this snapshot.
    const percentiles = new Map<string, number>();
    for (let i = 0; i < ranked.length;) {
      let j = i + 1;
      while (j < ranked.length && ranked[j].rank === ranked[i].rank) j++;
      const p = ranked.length <= 1 ? 0.5 : 1 - (i + (j - 1 - i) / 2) / (ranked.length - 1);
      for (let k = i; k < j; k++) percentiles.set(ranked[k].party.members[0].handle.toLowerCase(), p);
      i = j;
    }
    const own = ranked.find((r) => r.party.members[0].handle.toLowerCase() === handle.toLowerCase());
    if (own && session.type === 'CONTESTANT' && !session.team) {
      official = {
        rank: own.rank,
        participants: ranked.length,
        points: own.points,
        percentile: percentiles.get(handle.toLowerCase())!,
      };
      if (preRating !== null) {
        const cohort = cache!.ratings
          .filter(
            (r) =>
              r.oldRating > 0 &&
              r.handle.toLowerCase() !== handle.toLowerCase() &&
              Math.abs(r.oldRating - preRating) <= 200,
          )
          .flatMap((r) =>
            percentiles.has(r.handle.toLowerCase()) ? [percentiles.get(r.handle.toLowerCase())!] : [],
          );
        parts[0].samples = cohort.length;
        if (cohort.length >= 20) {
          rankBaseline = median(cohort);
          parts[0].score = clamp(70 + 100 * (official.percentile - rankBaseline));
          parts[0].reason = `超越 ${(official.percentile * 100).toFixed(1)}%；同水平 ${cohort.length} 人中位 ${(rankBaseline * 100).toFixed(1)}%。`;
        }
      }
    }
    const rated = timeline.filter((p) => p.rating !== undefined && p.rating > 0);
    if (cache && preRating !== null && rated.length / timeline.length >= 0.8) {
      const expected = rated.reduce((sum, p) => sum + 1 / (1 + 10 ** ((p.rating! - preRating) / 400)), 0);
      parts[1].score = clamp((70 * rated.filter((p) => p.ac !== null).length) / expected);
      parts[1].samples = rated.length;
      parts[1].reason = `赛前 Rating ${preRating}；${rated.length}/${timeline.length} 题有难度，预期 ${expected.toFixed(2)} 题，实际 AC ${rated.filter((p) => p.ac !== null).length} 题。`;
    }
    const failCount = timeline.reduce((n, p) => n + p.failures, 0);
    if (solved + failCount > 0) {
      parts[2].score = (100 * solved) / (solved + failCount);
      parts[2].samples = solved + failCount;
      parts[2].reason = `赛时 ${solved} 题 AC，首次 AC 前及未 AC 题共 ${failCount} 次明确失败。`;
    }
    const historical = contests
      .filter(
        (c) =>
          c.id !== contest.id && c.type && c.type === contest.type && c.phase === 'FINISHED' && !c.frozen,
      )
      .flatMap((c) => contestSessions(c, submissions))
      .filter(
        (s) =>
          !s.team &&
          s.type === session.type &&
          s.start !== null &&
          s.duration !== null &&
          session.start !== null &&
          session.duration !== null &&
          s.start + s.duration <= session.start &&
          Math.abs(s.duration / session.duration - 1) <= 0.25,
      )
      .sort((a, b) => b.start! - a.start!)
      .flatMap((s) => {
        const p = pace(s);
        return p === null ? [] : [p];
      })
      .slice(0, 10);
    const paceValue = pace(session),
      paceBaseline = historical.length >= 3 ? median(historical) : null;
    parts[3].samples = historical.length;
    if (input.complete && paceBaseline !== null) {
      parts[3].score = paceValue === null ? 0 : clamp(70 + 100 * (paceBaseline - paceValue));
      parts[3].reason = `${historical.length} 场历史节奏中位 ${paceBaseline.toFixed(3)}；本场 ${paceValue?.toFixed(3) ?? '零 AC'}。`;
    } else if (!input.complete) parts[3].reason = '完整历史尚未同步，无法建立可靠节奏基线。';
    if (!complete || session.start === null || session.duration === null || session.team)
      for (const p of parts) {
        p.score = null;
        p.reason = '当前数据不满足个人赛时评分条件。';
      }
    const valid = parts.filter((p) => p.score !== null),
      eligibleWeight = valid.reduce((n, p) => n + p.weight, 0);
    const score =
      eligibleWeight >= 65 && valid.some((p) => p.id === 'rank' || p.id === 'difficulty')
        ? Math.round(valid.reduce((n, p) => n + p.weight * p.score!, 0) / eligibleWeight)
        : null;
    const contestOldRating = ownChange?.oldRating ?? input.contest.rating?.oldRating;
    const performanceRating = estimatePerformance(
      session,
      timeline,
      ranked,
      cache?.ratings ?? [],
      handle,
      session.type === 'CONTESTANT' && contestOldRating && contestOldRating > 0 ? contestOldRating : null,
      !!cache &&
        finished &&
        complete &&
        !unsettled &&
        session.start !== null &&
        session.duration !== null &&
        !session.team,
    );
    const advice: Advice[] = [];
    const add = (
      id: string,
      evidence: string,
      possibility: string,
      action: string,
      events: { id: number }[] = [],
      problemIndex?: string,
    ) =>
      advice.push({
        id,
        evidence,
        possibility,
        action,
        submissionIds: events.map((e) => e.id),
        problemIndex,
      });
    for (const p of timeline) {
      const before = p.events.slice(
        0,
        p.events.findIndex((e) => e.verdict === 'OK') < 0
          ? undefined
          : p.events.findIndex((e) => e.verdict === 'OK'),
      );
      const failed = before.filter((e) => failures.has(e.verdict));
      if (failed.length >= 3)
        add(
          'repeat-' + p.index,
          `${p.index} 题首次 AC 前或未 AC 时有 ${failed.length} 次失败。`,
          '可能缺少针对性的反例验证。',
          '先整理边界与反例，再提交下一版。',
          failed,
          p.index,
        );
      // Runs stop on unknown/pending/AC verdicts; gaps describe submissions, not thinking time.
      let run: typeof failed = [];
      for (const event of before) {
        if (failures.has(event.verdict)) run.push(event);
        else run = [];
        if (run.length >= 2 && session.duration && event.seconds - run[0].seconds >= session.duration * 0.2) {
          add(
            'gap-' + p.index,
            `${p.index} 题连续失败提交跨度 ${((event.seconds - run[0].seconds) / 60).toFixed(1)} 分钟。`,
            '重复提交可能尚未形成新的验证依据。',
            '下场设置切题检查点；此跨度不代表实际思考时间。',
            run,
            p.index,
          );
          break;
        }
      }
    }
    for (const [id, verdicts, possibility, action] of [
      [
        'runtime',
        ['COMPILATION_ERROR', 'RUNTIME_ERROR'],
        '实现或本地检查可能不充分。',
        '检查编译、越界和初始化，补充本地测试。',
      ],
      [
        'resources',
        ['TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED'],
        '复杂度或资源估算可能不足。',
        '先核算时间与空间上限，再选择实现方案。',
      ],
    ] as const) {
      const events = timeline.flatMap((p) => p.events.filter((e) => verdicts.some((v) => v === e.verdict)));
      if (events.length >= 2)
        add(
          id,
          `${events.length} 次 ${id === 'runtime' ? 'CE / RE' : 'TLE / MLE'}。`,
          possibility,
          action,
          events,
        );
    }
    if (preRating !== null && complete)
      for (const p of timeline
        .filter((p) => p.ac === null && p.rating !== undefined && p.rating <= preRating)
        .slice(0, 2))
        add(
          'upsolve-' + p.index,
          `${p.index} 难度 ${p.rating}，赛前 Rating ${preRating}，${p.events.length ? '赛时未 AC' : '未尝试'}。`,
          '可能存在可巩固的知识点；难度并不保证个人一定能完成。',
          '优先作为补题候选，独立尝试后记录具体卡点。',
          p.events,
          p.index,
        );
    if (official && rankBaseline !== null && official.percentile < rankBaseline - 0.1)
      add(
        'rank',
        parts[0].reason,
        '本场排名低于同水平参赛者基线。',
        '结合未 AC 题与失败记录选出一个最值得改进的环节。',
      );
    if (paceValue !== null && paceBaseline !== null && paceValue > paceBaseline + 0.1)
      add(
        'pace',
        parts[3].reason,
        '本场 AC 推进比相近历史比赛慢。',
        '回看首次提交与 AC 间隔，下场设置阶段性进度检查。',
      );
    if (!advice.length && solved > 0 && failCount === 0)
      add(
        'stable',
        `${solved} 题 AC，首次 AC 前无明确失败。`,
        '本场这些题的提交较稳定。',
        '保留提交前验证流程，并复查尚未尝试的题目。',
      );
    const { submissions: _, ...sessionInfo } = session;
    return {
      contestId: contest.id,
      version: '1.0',
      session: sessionInfo,
      score,
      performanceRating,
      provisional: valid.length < 4 || !finished || unsettled,
      eligibleWeight,
      parts,
      warnings,
      solved,
      attempted,
      submissions: session.submissions.length,
      firstAC,
      preRating,
      official,
      paceBaseline,
      paceValue,
      timeline,
      advice: advice.slice(0, 5),
    };
  });
}
