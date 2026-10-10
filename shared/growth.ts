import { z } from 'zod';
import type { CoreStore } from './core-store.js';
import { problemKey } from './core-store.js';
import { hasReflection, type Attempt, type CFSubmission, type Problem, type Review } from './domain.js';
import { weeklyGrowth } from './growth-weekly.js';
import type { LearningRecord } from './learning-domain.js';
import { fingerprint } from './learning-domain.js';

import {
  equipmentSchema,
  growthRecordSchema,
  growthCosmetics,
  type GrowthEquipment,
  type GrowthEvent,
  type GrowthSummary,
} from './growth-domain.js';
export * from './growth-domain.js';

export function beijingDay(at: string | number): string | null {
  const time = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(time) || time <= 0) return null;
  const date = new Date(time + 8 * 3600000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}
const validAt = (at: string) => Number.isFinite(Date.parse(at)) && Date.parse(at) > 0;
export function growthNamespace(store: CoreStore) {
  return `growth:${store.active() || '-'}:${store.activeAtcoder() ? 'ac~' + store.activeAtcoder().toLowerCase() : '-'}`;
}
export function growthProfiles(store: CoreStore) {
  return [store.active(), store.activeAtcoder() ? 'ac~' + store.activeAtcoder().toLowerCase() : ''].filter(
    Boolean,
  );
}
export function levelForXp(xp: number) {
  return Math.floor((1 + Math.sqrt(1 + (Math.max(0, xp) * 4) / 50)) / 2);
}
export function baseGrowthEvents(store: CoreStore): GrowthEvent[] {
  const events: GrowthEvent[] = [];
  for (const profile of growthProfiles(store)) {
    const problems = new Map(store.all<Problem>('problems', profile).map((p) => [p.key, p]));
    const reviews = new Map(
      (
        store.db.prepare('SELECT key,value FROM reviews WHERE profile=?').all(profile) as {
          key: string;
          value: string;
        }[]
      ).map((row) => [row.key, JSON.parse(row.value) as Review]),
    );
    const first = new Map<string, CFSubmission>();
    const acDays = new Set<string>();
    for (const sub of store.all<CFSubmission>('submissions', profile)) {
      const at = sub.creationTimeSeconds * 1000,
        day = beijingDay(at);
      if (sub.verdict !== 'OK' || !day || at > Date.now()) continue;
      const key = problemKey(sub);
      acDays.add(key + ':' + day);
      if (!first.has(key) || first.get(key)!.creationTimeSeconds > sub.creationTimeSeconds)
        first.set(key, sub);
    }
    const add = (key: string, kind: GrowthEvent['kind'], at: string, xp: number) => {
      const day = beijingDay(at);
      if (!day || Date.parse(at) > Date.now()) return;
      events.push({
        id: JSON.stringify([profile, key, kind === 'independent' || kind === 'hint' ? 'redo:' + day : kind]),
        profile,
        problemKey: key,
        title: problems.get(key)?.name ?? first.get(key)?.problem.name ?? key,
        url: problems.get(key)?.url ?? null,
        canReview: !!problems.get(key)?.manual || reviews.has(key),
        kind,
        at,
        day,
        xp,
      });
    };
    for (const [key, sub] of first)
      add(key, 'ac', new Date(sub.creationTimeSeconds * 1000).toISOString(), 20);
    for (const [key] of problems) {
      const review = reviews.get(key);
      if (review?.firstReflectionAt && hasReflection(review) && validAt(review.firstReflectionAt))
        add(key, 'reflection', review.firstReflectionAt, 15);
    }
    const hintSessions = new Set(
      store
        .externalAll<LearningRecord>('learning-source:' + profile)
        .filter((r) => r.kind === 'hint')
        .map((h) => JSON.stringify([h.problemKey, h.session])),
    );
    const daily = new Map<string, { attempt: Attempt; kind: 'independent' | 'hint'; xp: number }>();
    const previous = new Map<string, string>();
    const attempts = store
      .all<Attempt>('attempts', profile)
      .filter((a) => validAt(a.createdAt))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const attempt of attempts) {
      const key = attempt.problemKey,
        day = beijingDay(attempt.createdAt)!;
      const session = day + ':' + (previous.get(key) ?? 'first');
      previous.set(key, attempt.id);
      if (
        !problems.has(key) ||
        attempt.result === 'failed' ||
        !first.has(key) ||
        Date.parse(attempt.createdAt) > Date.now() ||
        first.get(key)!.creationTimeSeconds * 1000 > Date.parse(attempt.createdAt) ||
        beijingDay(first.get(key)!.creationTimeSeconds * 1000) === day
      )
        continue;
      const hinted = hintSessions.has(JSON.stringify([key, session]));
      const kind = attempt.result === 'independent' && !hinted ? 'independent' : 'hint';
      // An independent result must still have same-day accepted submission evidence.
      if (kind === 'independent' && !acDays.has(key + ':' + day)) continue;
      const xp = kind === 'independent' ? 30 : 10,
        id = key + ':' + day;
      if (!daily.has(id) || daily.get(id)!.xp < xp) daily.set(id, { attempt, kind, xp });
    }
    for (const { attempt, kind, xp } of daily.values()) add(attempt.problemKey, kind, attempt.createdAt, xp);
  }
  return events.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
export function growthSummary(store: CoreStore): GrowthSummary {
  const baseEvents = baseGrowthEvents(store),
    weekly = weeklyGrowth(store, growthNamespace(store), baseEvents);
  const events = [...baseEvents, ...weekly.bonus].sort(
      (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
    ),
    xp = events.reduce((sum, e) => sum + e.xp, 0),
    level = levelForXp(xp);
  const counts = {
    ac: events.filter((e) => e.kind === 'ac').length,
    independent: events.filter((e) => e.kind === 'independent').length,
    reflection: events.filter((e) => e.kind === 'reflection').length,
    days: new Set(baseEvents.map((e) => e.day)).size,
    weeks: weekly.weeks,
  };
  const definitions = [
    ['ac', '首次突破', 1],
    ['ac', '解题新锐', 10],
    ['ac', '五十道星光', 50],
    ['independent', '独立回解', 1],
    ['independent', '再解十次', 10],
    ['reflection', '思路存档', 1],
    ['reflection', '反思收藏家', 10],
    ['days', '七日足迹', 7],
    ['days', '三十日航程', 30],
    ['ac', '百题星图', 100],
    ['ac', '解题远征', 250],
    ['ac', '五百星辰', 500],
    ['ac', '千题航标', 1000],
    ['independent', '独立推演', 25],
    ['independent', '回解进阶', 50],
    ['independent', '百次回解', 100],
    ['reflection', '复盘研习', 25],
    ['reflection', '思路典藏', 50],
    ['reflection', '百题档案', 100],
    ['days', '九十日星轨', 90],
    ['days', '半年航程', 180],
    ['days', '全年足迹', 365],
    ['weeks', '周任务起航', 3],
    ['weeks', '十周践行', 10],
    ['weeks', '长期研习', 25],
    ['weeks', '五十周航程', 50],
  ] as const;
  const labels = {
    ac: '累计首次 AC',
    independent: '独立重做',
    reflection: '有效题目复盘',
    days: '累计训练天数',
    weeks: '完整完成周任务',
  };
  const achievements = definitions.map(([key, title, target]) => ({
    id: key + ':' + target,
    title,
    description: `${labels[key]} ${target}${key === 'days' ? ' 天' : key === 'weeks' ? ' 周' : key === 'ac' || key === 'reflection' ? ' 题' : ' 次'}`,
    progress: counts[key],
    target,
    unlocked: counts[key] >= target,
    group: key,
  }));
  const scope = growthNamespace(store),
    saved = store.externalGet(scope, 'equipment');
  const parsed = growthRecordSchema.safeParse(saved);
  const equipment: GrowthEquipment =
    parsed.success && parsed.data.kind === 'equipment'
      ? { appearance: parsed.data.appearance, palette: parsed.data.palette }
      : { appearance: 'signal', palette: 'cyan' };
  const stages = growthStages(level, counts);
  if (!stages.find((c) => c.appearance === equipment.appearance)!.unlocked) equipment.appearance = 'signal';
  if (!stages.find((c) => c.palette === equipment.palette)!.unlocked) equipment.palette = 'cyan';
  const noticeRecord = growthRecordSchema.safeParse(store.externalGet(scope, 'notice'));
  const notice =
    noticeRecord.success && noticeRecord.data.kind === 'notice'
      ? noticeRecord.data
      : { xp: 0, achievements: [], initialized: false };
  return {
    scope,
    profiles: growthProfiles(store),
    xp,
    level,
    levelStart: 50 * level * (level - 1),
    nextLevel: 50 * level * (level + 1),
    equipment,
    achievements,
    events: events.slice(0, 6),
    counts,
    stages,
    currentStage: [...stages].reverse().find((s) => s.unlocked)!,
    nextStage: stages.find((s) => !s.unlocked) ?? null,
    weekly: weekly.current,
    notice,
    revision: JSON.stringify([
      scope,
      xp,
      achievements.filter((a) => a.unlocked).map((a) => a.id),
      fingerprint(events.map((e) => e.id)),
    ]),
  };
}
export function growthStages(
  level: number,
  counts: { independent: number; reflection: number; days: number },
) {
  return growthCosmetics.map((c) => {
    const criteria = [
      { key: 'level', label: '成长等级', progress: level, target: c.level },
      ...('independent' in c
        ? [
            { key: 'independent', label: '独立重做', progress: counts.independent, target: c.independent },
            { key: 'reflection', label: '有效复盘', progress: counts.reflection, target: c.reflection },
            { key: 'days', label: '训练天数', progress: counts.days, target: c.days },
          ]
        : []),
    ];
    const conditions = criteria.map((c) => ({ ...c, met: c.progress >= c.target }));
    return { ...c, conditions, unlocked: conditions.every((c) => c.met) };
  });
}
export function growthEvents(store: CoreStore): GrowthEvent[] {
  const base = baseGrowthEvents(store);
  return [...base, ...weeklyGrowth(store, growthNamespace(store), base).bonus].sort(
    (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
  );
}
export function growthRoute(
  store: CoreStore,
  action: string,
  method: string,
  body?: unknown,
  query: unknown = {},
) {
  if (action === 'weekly/activate' && method === 'POST') {
    const data = z
      .object({ scope: z.string().max(300).optional() })
      .strict()
      .parse(body ?? {});
    if (data.scope && data.scope !== growthNamespace(store)) throw new Error('训练账号已切换，请刷新后重试');
    store.activateGrowthWeek();
    return growthSummary(store);
  }
  if (action === 'summary' && method === 'GET') return growthSummary(store);
  if (action === 'history' && method === 'GET') {
    const { page, pageSize } = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(query);
    const all = growthEvents(store);
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
  }
  if (action === 'equipment' && method === 'PUT') {
    const { scope, ...equipment } = equipmentSchema
        .extend({ scope: z.string().max(300).optional() })
        .parse(body),
      summary = growthSummary(store);
    if (scope && scope !== summary.scope) throw new Error('训练账号已切换，请刷新后重试');
    if (!summary.profiles.length) throw new Error('请先绑定训练账号');
    if (
      !summary.stages.find((c) => c.appearance === equipment.appearance)!.unlocked ||
      !summary.stages.find((c) => c.palette === equipment.palette)!.unlocked
    )
      throw new Error('尚未解锁此收藏');
    store.externalPut(summary.scope, 'equipment', { kind: 'equipment', ...equipment });
    return growthSummary(store);
  }
  if (action === 'notice' && method === 'PUT') {
    const { revision } = z
        .object({ revision: z.string().max(2000) })
        .strict()
        .parse(body),
      summary = growthSummary(store);
    if (summary.revision !== revision) throw new Error('成长记录已更新，请刷新后重试');
    if (summary.profiles.length)
      store.externalPut(summary.scope, 'notice', {
        kind: 'notice',
        xp: summary.xp,
        achievements: summary.achievements.filter((a) => a.unlocked).map((a) => a.id),
        initialized: true,
      });
    return { ok: true };
  }
  throw new Error('成长接口不存在');
}
