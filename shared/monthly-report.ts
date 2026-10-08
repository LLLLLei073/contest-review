import { z } from 'zod';
import { type CoreStore, problemKey } from './core-store.js';
import { AtcoderService, atcoderProfile, atcoderHistoryContestId } from './atcoder.js';
import { failures, type Attempt, type CFSubmission, type SyncJob } from './domain.js';
import { fingerprint, learningNamespace, type LearningRecord } from './learning-domain.js';
import type { DailyPlan } from './training.js';
import type { ReasonSnapshot, Simulation } from './training-extras.js';
import { xcpcScore, type XcpcHistory } from './xcpc.js';

const DAY = 86400000,
  OFFSET = 8 * 3600000;
export const beijingDay = (time: number | Date) => new Date(Number(time) + OFFSET).toISOString().slice(0, 10);
export const monthlyQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .refine((s) => Number(s.slice(0, 4)) >= 1970)
    .optional(),
  source: z.enum(['all', 'cf', 'atcoder']).default('all'),
});
export type MonthlySource = z.infer<typeof monthlyQuerySchema>['source'];
export interface MonthlyEvidence {
  id: string;
  text: string;
  url: string;
}
export interface MonthlyFinding {
  title: string;
  cause: string;
  action: string;
  evidenceIds: string[];
}
export interface MonthlyContest {
  key: string;
  source: 'cf' | 'atcoder' | 'xcpc';
  name: string;
  startAt: string;
  kind: 'official' | 'virtual' | 'other' | 'window';
  url: string;
  solved: number | null;
  score: number | null;
  scoreLabel?: string;
  rank: number | null;
  rating: {
    old: number | null;
    new: number | null;
    performance: number | null;
    bound?: 'lower' | 'upper' | null;
  } | null;
  upsolveAssigned: number;
  upsolveCompleted: number;
  teamName?: string;
}
export interface MonthlyMetrics {
  attempted: number;
  accepted: number;
  firstAccepted: number;
  submissions: number;
  ac: number;
  failed: number;
  pending: number;
  other: number;
  activeDays: number;
  contests: number;
  official: number;
  virtual: number;
  otherContests: number;
  window: number;
  reviewAssigned: number;
  reviewCompleted: number;
  independent: number;
  hint: number;
  redoFailed: number;
  hintSessions: number;
  transferIndependent: number;
  transferHint: number;
  transferFailed: number;
}
export interface MonthlyAlgorithmReport {
  month: string;
  source: MonthlySource;
  timezone: 'Asia/Shanghai';
  startAt: string;
  endAt: string;
  generatedAt: string;
  current: boolean;
  fingerprint: string;
  metrics: MonthlyMetrics;
  firstAcceptedLabel: string;
  comparison: {
    month: string;
    endAt: string;
    hasBaseline: boolean;
    metrics: MonthlyMetrics;
    changes: Record<
      'attempted' | 'submissions' | 'contests' | 'activeDays',
      { delta: number; percent: number | null } | null
    >;
  };
  days: { date: string; attempted: number; submissions: number; accepted: number }[];
  contests: MonthlyContest[];
  evidence: MonthlyEvidence[];
  findings: MonthlyFinding[];
  warnings: string[];
  completeness: { source: string; fullHistory: boolean; latestSync: string | null }[];
}
export const monthlyAiSchema = z.object({
  findings: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        cause: z.string().min(1).max(3000),
        action: z.string().min(1).max(3000),
        evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(20),
      }),
    )
    .max(8),
  warnings: z.array(z.string().max(1000)).max(10),
});
export type MonthlyAiReport = z.infer<typeof monthlyAiSchema> & { fingerprint: string };
const monthStart = (month: string) => Date.parse(month + '-01T00:00:00+08:00');
const nextMonth = (month: string, offset = 1) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7);
};
const emptyMetrics = (): MonthlyMetrics => ({
  attempted: 0,
  accepted: 0,
  firstAccepted: 0,
  submissions: 0,
  ac: 0,
  failed: 0,
  pending: 0,
  other: 0,
  activeDays: 0,
  contests: 0,
  official: 0,
  virtual: 0,
  otherContests: 0,
  window: 0,
  reviewAssigned: 0,
  reviewCompleted: 0,
  independent: 0,
  hint: 0,
  redoFailed: 0,
  hintSessions: 0,
  transferIndependent: 0,
  transferHint: 0,
  transferFailed: 0,
});

// Derived only: never refresh external services or create/repair a training plan here.
export function monthlyReport(
  store: CoreStore,
  input: unknown = {},
  now = new Date(),
): MonthlyAlgorithmReport {
  const query = monthlyQuerySchema.parse(input),
    currentMonth = beijingDay(now).slice(0, 7);
  const month = query.month ?? currentMonth,
    source = query.source;
  if (month > currentMonth) throw new Error('请选择当月或历史月份');
  const start = monthStart(month),
    end = Math.min(monthStart(nextMonth(month)), now.getTime());
  const previousMonth = nextMonth(month, -1),
    previousStart = monthStart(previousMonth);
  const previousEnd = month === currentMonth ? Math.min(start, previousStart + (end - start)) : start;
  const profiles = [
    ...(source !== 'atcoder' && store.active() ? [store.active()] : []),
    ...(source !== 'cf' && store.activeAtcoder() ? [atcoderProfile(store.activeAtcoder())] : []),
  ];
  const warnings = new Set<string>();
  const completeness = profiles.map((p) => {
    const jobs = store.all<SyncJob>('jobs', p);
    const latest = jobs
      .filter((j) => j.status === 'completed')
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    const fullHistory = jobs.some((j) => j.mode === 'full' && j.status === 'completed');
    if (!fullHistory)
      warnings.add(
        `${p.startsWith('ac~') ? 'AtCoder' : 'Codeforces'} 历史可能不完整，首次通过仅指已导入记录中的首次通过。`,
      );
    if (!latest) warnings.add(`${p} 尚无成功同步记录，报告仅反映已保存数据。`);
    return {
      source: p.startsWith('ac~') ? 'atcoder' : 'cf',
      fullHistory,
      latestSync: latest?.finishedAt ?? latest?.startedAt ?? null,
    };
  });
  const submissions = profiles.flatMap((profile) => {
    const unique = new Map(store.all<CFSubmission>('submissions', profile).map((s) => [s.id, s]));
    return [...unique.values()].map((s) => ({ ...s, profile, key: problemKey(s) }));
  });
  const attempts = profiles.flatMap((profile) =>
    [...new Map(store.all<Attempt>('attempts', profile).map((a) => [a.id, a])).values()].map((a) => ({
      ...a,
      profile,
    })),
  );
  const records = [
    learningNamespace(store.active(), store.activeAtcoder()),
    ...profiles.map((p) => 'learning-source:' + p),
  ]
    .flatMap((ns) => store.externalAll<LearningRecord>(ns))
    .filter(
      (r) =>
        !('problemKey' in r) ||
        profiles.includes(store.profileForKey(r.kind === 'transfer' ? r.targetKey : r.problemKey)),
    );
  const allContests: MonthlyContest[] = [];
  const missingStarts = new Set<string>();
  const upsolve = store.upsolveItems();
  const addContest = (c: MonthlyContest) => {
    if (!Number.isFinite(Date.parse(c.startAt))) {
      missingStarts.add(c.name);
      return;
    }
    const old = allContests.findIndex((x) => x.key === c.key);
    const priority = { official: 4, virtual: 3, other: 2, window: 1 };
    if (old < 0) allContests.push(c);
    else if (priority[c.kind] > priority[allContests[old].kind]) allContests[old] = c;
  };
  const contestUrl = (key: string) => '/contests?contest=' + encodeURIComponent(key);
  if (source !== 'atcoder' && store.active()) {
    for (const c of store.contests(store.active())) {
      const kind = c.types.includes('CONTESTANT')
        ? 'official'
        : c.types.includes('VIRTUAL')
          ? 'virtual'
          : c.types.includes('OUT_OF_COMPETITION')
            ? 'other'
            : null;
      if (!kind) continue;
      const virtualStart = submissions.find(
        (s) => s.profile === store.active() && s.contestId === c.id && s.author.participantType === 'VIRTUAL',
      )?.author.startTimeSeconds;
      const time = kind === 'virtual' ? virtualStart : c.startTimeSeconds;
      if (!time) {
        missingStarts.add(c.name);
        continue;
      }
      const tasks = upsolve.filter((u) => u.source === 'cf' && u.contestKey === String(c.id));
      allContests.push({
        key: 'cf:' + c.id,
        source: 'cf',
        name: c.name,
        startAt: new Date(time * 1000).toISOString(),
        kind,
        url: contestUrl('cf:' + c.id),
        solved: c.inContestSolved,
        score: c.analysisScore,
        scoreLabel: c.analysisStatus,
        rank: c.rating?.rank ?? null,
        rating: c.rating
          ? {
              old: c.rating.oldRating,
              new: c.rating.newRating,
              performance: c.performanceRating,
              bound: c.performanceBound,
            }
          : null,
        upsolveAssigned: tasks.length,
        upsolveCompleted: tasks.filter((u) => u.completed).length,
      });
    }
    for (const s of store.externalAll<Simulation>('simulation:' + store.active())) {
      // Manual sessions are explicit virtual participation; repeated sessions count once per contest.
      addContest({
        key: 'cf:' + s.contestId,
        source: 'cf',
        name: s.contestName,
        startAt: s.startedAt,
        kind: 'virtual',
        url: '/simulation',
        solved: store.simulationReport(s).solved,
        score: null,
        rank: null,
        rating: null,
        upsolveAssigned: 0,
        upsolveCompleted: 0,
      });
    }
  }
  if (source !== 'cf' && store.activeAtcoder()) {
    const ac = new AtcoderService(store),
      catalog = store.externalGet<{ contests: { id: string; start_epoch_second: number }[] }>(
        'atcoder-meta',
        'catalog',
      );
    for (const c of ac.contests()) {
      if (!c.types.some((t) => ['ATCODER_OFFICIAL', 'ATCODER_WINDOW'].includes(t))) continue;
      // History EndTime is not a start time. Do not assign it to a month when catalog metadata is absent.
      const startTime = catalog?.contests.find((m) => m.id === c.id)?.start_epoch_second;
      if (!startTime) {
        missingStarts.add(c.name);
        continue;
      }
      const official = ac
        .history(store.activeAtcoder())
        ?.entries.find((e) => atcoderHistoryContestId(e) === c.id);
      const tasks = upsolve.filter((u) => u.source === 'atcoder' && u.contestKey === c.id);
      addContest({
        key: c.key,
        source: 'atcoder',
        name: c.name,
        startAt: new Date(startTime * 1000).toISOString(),
        kind: official ? 'official' : 'window',
        url: contestUrl(c.key),
        solved: c.inContestSolved,
        score: c.analysisScore,
        rank: c.officialPlace,
        rating: official
          ? {
              old: official.OldRating >= 0 ? official.OldRating : null,
              new: official.NewRating >= 0 ? official.NewRating : null,
              performance: c.officialPerformance,
            }
          : null,
        upsolveAssigned: tasks.length,
        upsolveCompleted: tasks.filter((u) => u.completed).length,
      });
    }
  }
  if (source === 'all' && store.setting('xcpc-active')) {
    for (const c of store.externalAllPrefix<XcpcHistory>(
      'xcpc:' + store.setting('xcpc-active'),
      'history:',
    )) {
      addContest({
        key: 'xcpc:' + c.contestId,
        source: 'xcpc',
        name: c.title,
        startAt: c.startAt,
        kind: c.official ? 'official' : 'other',
        url: contestUrl('xcpc:' + c.contestId),
        solved: c.solved ?? null,
        score: xcpcScore(c, store.setting('xcpc-mode') === 'all' ? 'all' : 'official'),
        rank: store.setting('xcpc-mode') === 'all' ? c.rank : (c.rankOfficial ?? c.rank),
        teamName: c.teamName,
        rating: null,
        upsolveAssigned: 0,
        upsolveCompleted: 0,
      });
    }
    warnings.add('XCPC 仅为队伍成绩证据，不计入个人做题量或提交量。');
  }
  const within = (t: number, a: number, b: number) => Number.isFinite(t) && t >= a && t < b;
  if (missingStarts.size)
    warnings.add(
      `${missingStarts.size} 场比赛缺少比赛开始时间，未计入比赛数（示例：${[...missingStarts].slice(0, 3).join('、')}）。`,
    );
  const firstAc = new Map<string, number>();
  for (const s of submissions.filter((s) => s.verdict === 'OK')) {
    const key = s.profile + ':' + s.key;
    firstAc.set(key, Math.min(firstAc.get(key) ?? Infinity, s.creationTimeSeconds * 1000));
  }
  const plans = profiles.flatMap((p) => store.all<DailyPlan>('daily_plans', p));
  if (store.activeAtcoder())
    plans.push(
      ...store.externalAll<DailyPlan>(
        `daily:${store.active() || '-'}:${store.activeAtcoder().toLowerCase()}`,
      ),
    );
  const summarize = (a: number, b: number) => {
    const m = emptyMetrics(),
      subs = submissions.filter((s) => within(s.creationTimeSeconds * 1000, a, b));
    const redo = attempts.filter((r) => within(Date.parse(r.createdAt), a, b));
    m.attempted = new Set(subs.map((s) => s.profile + ':' + s.key)).size;
    m.accepted = new Set(subs.filter((s) => s.verdict === 'OK').map((s) => s.profile + ':' + s.key)).size;
    m.firstAccepted = [...firstAc.values()].filter((t) => within(t, a, b)).length;
    m.submissions = subs.length;
    m.ac = subs.filter((s) => s.verdict === 'OK').length;
    m.failed = subs.filter((s) => failures.has(s.verdict ?? '')).length;
    m.pending = subs.filter(
      (s) => !s.verdict || ['TESTING', 'SUBMITTED', 'RUNNING', 'WJ', 'JUDGING'].includes(s.verdict),
    ).length;
    m.other = m.submissions - m.ac - m.failed - m.pending;
    const active = new Set([
      ...subs.map((s) => beijingDay(s.creationTimeSeconds * 1000)),
      ...redo.map((r) => beijingDay(Date.parse(r.createdAt))),
    ]);
    m.independent = redo.filter((r) => r.result === 'independent').length;
    m.hint = redo.filter((r) => r.result === 'hint').length;
    m.redoFailed = redo.filter((r) => r.result === 'failed').length;
    const sessions = new Set<string>();
    for (const r of records) {
      if (r.kind === 'hint' && within(Date.parse(r.createdAt), a, b)) {
        sessions.add(r.problemKey + ':' + r.session);
        active.add(beijingDay(Date.parse(r.createdAt)));
      }
      if (r.kind === 'transfer' && r.evaluatedAt && within(Date.parse(r.evaluatedAt), a, b)) {
        active.add(beijingDay(Date.parse(r.evaluatedAt)));
        if (r.result === 'independent') m.transferIndependent++;
        if (r.result === 'hint') m.transferHint++;
        if (r.result === 'failed') m.transferFailed++;
      }
    }
    m.hintSessions = sessions.size;
    m.activeDays = active.size;
    const assigned = new Set<string>(),
      completed = new Set<string>();
    for (const plan of plans) {
      if (!within(Date.parse(plan.date + 'T00:00:00+08:00'), a, b)) continue;
      for (const item of plan.review) {
        const p = store.profileForKey(item.key);
        if (!profiles.includes(p)) continue;
        const key = p + ':' + plan.date + ':' + item.key;
        assigned.add(key);
        const review = store.review(p, item.key);
        const reflectionDone =
          !review.firstReflectionRequired ||
          !!(
            review.firstReflectionAt &&
            Date.parse(review.firstReflectionAt) < b &&
            beijingDay(Date.parse(review.firstReflectionAt)) <= plan.date
          );
        const accepted = subs.some(
          (s) =>
            s.profile === p &&
            s.key === item.key &&
            s.verdict === 'OK' &&
            beijingDay(s.creationTimeSeconds * 1000) === plan.date,
        );
        const evaluated = redo.some(
          (r) =>
            r.profile === p && r.problemKey === item.key && beijingDay(Date.parse(r.createdAt)) === plan.date,
        );
        if (
          reflectionDone &&
          (accepted || evaluated || (item.completedAt && Date.parse(item.completedAt) < b))
        )
          completed.add(key);
      }
    }
    m.reviewAssigned = assigned.size;
    m.reviewCompleted = completed.size;
    for (const c of allContests.filter((c) => within(Date.parse(c.startAt), a, b))) {
      if (c.kind === 'window') m.window++;
      else {
        m.contests++;
        if (c.kind === 'official') m.official++;
        else if (c.kind === 'virtual') m.virtual++;
        else m.otherContests++;
      }
    }
    return m;
  };
  const metrics = summarize(start, end),
    previous = summarize(previousStart, previousEnd);
  const monthlySubs = submissions.filter((s) => within(s.creationTimeSeconds * 1000, start, end));
  const contests = allContests
    .filter((c) => within(Date.parse(c.startAt), start, end))
    .sort((a, b) => b.startAt.localeCompare(a.startAt));
  const days: MonthlyAlgorithmReport['days'] = [];
  for (let t = start; t < end; t += DAY) {
    const subs = monthlySubs.filter((s) => within(s.creationTimeSeconds * 1000, t, Math.min(t + DAY, end)));
    days.push({
      date: beijingDay(t),
      attempted: new Set(subs.map((s) => s.profile + ':' + s.key)).size,
      submissions: subs.length,
      accepted: new Set(subs.filter((s) => s.verdict === 'OK').map((s) => s.profile + ':' + s.key)).size,
    });
  }
  const evidence: MonthlyEvidence[] = [],
    findings: MonthlyFinding[] = [];
  const evidenceOf = (id: string, text: string, url = '') => {
    evidence.push({ id, text, url });
    return id;
  };
  const volumeId = evidenceOf(
    'monthly:volume',
    `${month}：尝试 ${metrics.attempted} 题，通过 ${metrics.accepted} 题，首次通过 ${metrics.firstAccepted} 题；提交 ${metrics.submissions} 条（AC ${metrics.ac}、明确失败 ${metrics.failed}、待评测 ${metrics.pending}、其他 ${metrics.other}）；活跃 ${metrics.activeDays} 天。`,
  );
  findings.push({
    title: '训练规模与连续性',
    cause: metrics.submissions
      ? `已有 ${metrics.attempted} 道题的提交证据，活跃 ${metrics.activeDays} 天。`
      : '尚无当月提交记录，无法评价做题表现。',
    action: '下月安排可持续的固定练习时段，优先完成现有训练题单。',
    evidenceIds: [volumeId],
  });
  if (metrics.ac + metrics.failed)
    findings.push({
      title: '提交与通过情况',
      cause: `已明确判定的提交通过率为 ${Math.round((metrics.ac / (metrics.ac + metrics.failed)) * 100)}%；重复 AC 也计入提交量，不能据此判定掌握。`,
      action: metrics.failed
        ? '挑选失败记录复盘，检查反复出现的边界与实现问题。'
        : '结合独立重做和迁移验证学习效果。',
      evidenceIds: [volumeId],
    });
  const reviewId = evidenceOf(
    'monthly:review',
    `复习题单 ${metrics.reviewAssigned} 项、完成 ${metrics.reviewCompleted} 项；重做评价：独立 ${metrics.independent}、提示 ${metrics.hint}、未完成 ${metrics.redoFailed}；提示会话 ${metrics.hintSessions} 次；迁移：独立 ${metrics.transferIndependent}、提示 ${metrics.transferHint}、未完成 ${metrics.transferFailed}。这些维度可能描述同一次练习，不相加作为总量。`,
    '/knowledge?view=diagnosis',
  );
  findings.push({
    title: '复习与独立完成',
    cause: `独立重做 ${metrics.independent} 次，借助提示 ${metrics.hint} 次；迁移结果单列，不替代掌握规则。`,
    action: '优先完成到期复习；借助提示的题目在后续练习中独立重做。',
    evidenceIds: [reviewId],
  });
  const problemGroups = new Map<string, typeof monthlySubs>();
  const algorithms = new Map<string, string[]>();
  for (const s of monthlySubs) {
    const id = s.profile + ':' + s.key;
    const group = problemGroups.get(id) ?? [];
    group.push(s);
    problemGroups.set(id, group);
  }
  for (const [id, subs] of problemGroups) {
    const s = subs[0],
      saved = store.get('reviews', s.profile, s.key);
    const url = saved
      ? '/problems/' + encodeURIComponent(s.key)
      : s.source === 'atcoder'
        ? `https://atcoder.jp/contests/${s.contestKey}/tasks/${s.problem.index}`
        : s.problem.contestId || s.contestId
          ? `https://codeforces.com/${(s.contestId ?? s.problem.contestId ?? 0) >= 100000 ? 'gym' : 'contest'}/${s.problem.contestId ?? s.contestId}/problem/${s.problem.index}`
          : 'https://codeforces.com/problemset';
    const eid = evidenceOf(
      'problem:' + id,
      `${s.problem.name}：${subs.length} 条提交，AC ${subs.filter((s) => s.verdict === 'OK').length}，失败 ${subs.filter((s) => failures.has(s.verdict ?? '')).length}；标签 ${s.problem.tags.join('、') || '缺失'}。`,
      url,
    );
    if (subs.some((s) => failures.has(s.verdict ?? '')))
      for (const tag of new Set(s.problem.tags)) {
        const ids = algorithms.get(tag) ?? [];
        ids.push(eid);
        algorithms.set(tag, ids);
      }
  }
  for (const [tag, ids] of [...algorithms].sort((a, b) => b[1].length - a[1].length).slice(0, 2))
    findings.push({
      title: '需要复核的算法：' + tag,
      cause: `${ids.length} 道带此标签的题出现明确失败；标签相关性不能证明失败原因。`,
      action: '核对关联题目的错因与知识卡，再确定下月专项训练方向。',
      evidenceIds: ids.slice(0, 20),
    });
  for (const a of attempts.filter((a) => within(Date.parse(a.createdAt), start, end)))
    evidenceOf(
      'attempt:' + a.profile + ':' + a.id,
      `${a.problemKey}：重做评价 ${a.result}；手工用时 ${a.minutes} 分钟，记录时间 ${a.createdAt}。`,
      '/problems/' + encodeURIComponent(a.problemKey),
    );
  const reasons = new Map<string, { count: number; ids: string[] }>();
  for (const p of profiles) {
    const snapshots = new Map<string, ReasonSnapshot>();
    for (const r of store
      .externalAll<ReasonSnapshot>('reason:' + p)
      .filter((r) => within(Date.parse(r.savedAt), start, end)))
      if (!snapshots.has(r.problemKey) || snapshots.get(r.problemKey)!.savedAt < r.savedAt)
        snapshots.set(r.problemKey, r);
    for (const r of snapshots.values()) {
      const id = evidenceOf(
        'reason:' + p + ':' + r.problemKey,
        `当月保存的错因：${r.reasons.join('、') || '无'}。`,
        '/problems/' + encodeURIComponent(r.problemKey),
      );
      for (const reason of new Set(r.reasons)) {
        const value = reasons.get(reason) ?? { count: 0, ids: [] };
        value.count++;
        value.ids.push(id);
        reasons.set(reason, value);
      }
    }
  }
  for (const [reason, value] of [...reasons].sort((a, b) => b[1].count - a[1].count).slice(0, 3))
    findings.push({
      title: '复盘错因：' + reason,
      cause: `${value.count} 道题在当月保存的复盘中出现该错因。`,
      action: '进入关联复盘核对原因，在下月题单中安排相关知识点与独立重做。',
      evidenceIds: value.ids.slice(0, 20),
    });
  if (!reasons.size)
    warnings.add('当月缺少错因快照，无法确认期间新增的错因；当前复盘标签不作为月度历史事实。');
  const contestIds = contests.map((c) =>
    evidenceOf(
      'contest:' + c.key,
      `${c.name}（${c.kind}）：${c.teamName ? '队伍 ' + c.teamName + '；' : ''}解题 ${c.solved ?? '未知'}、排名 ${c.rank ?? '未知'}、${c.scoreLabel || '已有评分'} ${c.score ?? '未知'}；补题 ${c.upsolveCompleted}/${c.upsolveAssigned}。${c.rating ? '本平台 Rating ' + (c.rating.old ?? '未知') + ' → ' + (c.rating.new ?? '未知') : ''}`,
      c.url,
    ),
  );
  if (contestIds.length)
    findings.push({
      title: '比赛与补题',
      cause: `确认参赛 ${metrics.contests} 场，另有仅赛时提交记录 ${metrics.window} 场；各平台表现分开考量。`,
      action: '打开比赛报告，优先补齐未完成题目并记录下一场的策略改进。',
      evidenceIds: contestIds.slice(0, 20),
    });
  warnings.add('用时仅来自手工练习记录；提交间隔不代表思考时间。缺少题面或比赛报告时不能确认解题过程。');
  warnings.add('补题状态反映当前已保存的 AC，并非一定发生在报告月份。');
  if (metrics.attempted < 5) warnings.add('做题样本不足，分析仅供参考。');
  if (!profiles.length) warnings.add('所选来源未绑定账号，个人训练数据尚不可用。');
  const hasBaseline = previous.submissions > 0 || previous.contests > 0 || previous.activeDays > 0;
  const changes = Object.fromEntries(
    (['attempted', 'submissions', 'contests', 'activeDays'] as const).map((key) => [
      key,
      hasBaseline
        ? {
            delta: metrics[key] - previous[key],
            percent: previous[key] ? ((metrics[key] - previous[key]) / previous[key]) * 100 : null,
          }
        : null,
    ]),
  ) as MonthlyAlgorithmReport['comparison']['changes'];
  const firstAcceptedLabel =
    completeness.length && completeness.every((c) => c.fullHistory)
      ? '历史首次通过'
      : '已导入记录中的首次通过';
  const data = {
    month,
    source,
    timezone: 'Asia/Shanghai' as const,
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    current: month === currentMonth,
    metrics,
    firstAcceptedLabel,
    comparison: {
      month: previousMonth,
      endAt: new Date(previousEnd).toISOString(),
      hasBaseline,
      metrics: previous,
      changes,
    },
    days,
    contests,
    evidence,
    findings,
    warnings: [...warnings],
    completeness,
  };
  // Clock-only changes do not invalidate an AI response; evidence/data changes do.
  return {
    ...data,
    generatedAt: now.toISOString(),
    fingerprint: fingerprint({
      ...data,
      endAt: undefined,
      comparison: { ...data.comparison, endAt: undefined },
    }),
  };
}
