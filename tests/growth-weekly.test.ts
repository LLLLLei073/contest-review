import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import { emptyReview, type CFSubmission } from '../shared/domain.js';
import {
  baseGrowthEvents,
  growthEvents,
  growthSummary,
  growthStages,
  growthRoute,
  growthNamespace,
} from '../shared/growth.js';
import { weeklyGrowth } from '../shared/growth-weekly.js';
import { weekStart } from '../shared/weekly.js';
const week = weekStart(new Date());
const time = (day = 0) =>
  new Date(Date.parse(week + 'T00:00:00+08:00') + day * 86400000 + 3600000).toISOString();
function sub(id: number, key: string, at: string, tags = ['math']): CFSubmission {
  return {
    id,
    contestId: 9700,
    creationTimeSeconds: Date.parse(at) / 1000,
    problem: { contestId: 9700, index: key, name: 'Weekly ' + key, tags },
    verdict: 'OK',
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  };
}
function setup(balanced = false) {
  const s = new Store(':memory:');
  s.activate('weekly_grow');
  s.saveWeeklyGoal({
    mode: balanced ? 'balanced' : 'focus',
    categories: balanced ? ['数学', '动态规划'] : ['数学'],
  });
  return s;
}
function evidence(s: Store) {
  s.ingest('weekly_grow', [
    sub(1, 'A', '2020-01-01T00:00:00Z'),
    sub(2, 'B', '2020-01-01T00:00:00Z'),
    ...['A', 'B', 'C', 'D', 'E'].map((k, i) => sub(100 + i, k, time(), i === 2 ? ['dp'] : ['math'])),
  ]);
  for (const k of ['A', 'B'])
    s.put('attempts', 'weekly_grow', k, {
      id: k,
      problemKey: '9700:' + k,
      result: 'independent',
      createdAt: time(),
      minutes: 20,
      note: '',
    });
  for (const k of ['A', 'B', 'D'])
    s.put('reviews', 'weekly_grow', '9700:' + k, {
      ...emptyReview(),
      solution: '有效思路',
      firstReflectionAt: time(),
    });
}
test('higher stage gates require every condition, old stages remain level-only', () => {
  for (const c of [
    { level: 10, n: 10, days: 90 },
    { level: 15, n: 30, days: 150 },
    { level: 20, n: 60, days: 240 },
    { level: 30, n: 120, days: 365 },
  ]) {
    const counts = { independent: c.n, reflection: c.n, days: c.days };
    assert.equal(growthStages(c.level, counts).find((s) => s.level === c.level)!.unlocked, true);
    assert.equal(growthStages(c.level - 1, counts).find((s) => s.level === c.level)!.unlocked, false);
    for (const key of ['independent', 'reflection', 'days'] as const)
      assert.equal(
        growthStages(c.level, { ...counts, [key]: counts[key] - 1 }).find((s) => s.level === c.level)!
          .unlocked,
        false,
      );
  }
  assert.equal(growthStages(5, { independent: 0, reflection: 0, days: 0 })[2]!.unlocked, true);
});
test('full weekly goals add exactly 180 XP without adding training days; stable evidence and duplicate writes', () => {
  const s = setup(true);
  evidence(s);
  const sum = growthSummary(s);
  assert.equal(sum.weekly.earned, 180);
  assert.equal(sum.counts.weeks, 1);
  assert.equal(sum.xp, baseGrowthEvents(s).reduce((n, e) => n + e.xp, 0) + 180);
  assert.equal(sum.counts.days, new Set(baseGrowthEvents(s).map((e) => e.day)).size);
  const before = growthEvents(s);
  s.activateGrowthWeek();
  s.activateGrowthWeek();
  assert.deepEqual(growthEvents(s), before);
  assert.equal(sum.achievements.length, 26);
  assert.equal(before.filter((e) => e.kind === 'weekly').length, 3);
  assert.ok(before.filter((e) => e.kind === 'weekly').every((e) => e.evidence?.length && e.condition));
  s.close();
});
test('week target snapshot stays fixed after target edits; no client XP or scope override', () => {
  const s = setup();
  const first = growthSummary(s).weekly.goal;
  s.saveWeeklyGoal({ mode: 'focus', categories: ['图与树'] });
  assert.deepEqual(growthSummary(s).weekly.goal, first);
  assert.throws(() => growthRoute(s, 'weekly/activate', 'POST', { xp: 100 }));
  assert.throws(() => growthRoute(s, 'weekly/activate', 'POST', { scope: 'growth:other:-' }), /账号已切换/);
  s.close();
});
test('balanced coverage uses distinct questions, one multi-label question cannot cover two fields', () => {
  const s = setup(true);
  s.ingest(
    'weekly_grow',
    Array.from({ length: 5 }, (_, i) => sub(i + 1, String(i), time(), ['math'])),
  );
  assert.equal(growthSummary(s).weekly.tasks[0]!.complete, false);
  s.ingest('weekly_grow', [sub(20, '6', time(), ['math', 'dp'])]);
  assert.equal(growthSummary(s).weekly.tasks[0]!.complete, true);
  const scoped = weeklyGrowth(s, growthNamespace(s), [
    {
      id: 'one',
      profile: 'weekly_grow',
      problemKey: '9700:6',
      title: 'multi',
      url: null,
      canReview: false,
      kind: 'ac',
      at: time(),
      day: week,
      xp: 20,
    },
  ]);
  assert.equal(scoped.current.tasks[0]!.coverage.length, 1);
  s.close();
});
test('hint downgrade and repeated same-question days cannot complete independent weekly task', () => {
  const s = setup();
  evidence(s);
  s.externalPut('learning-source:weekly_grow', 'hint', {
    kind: 'hint',
    id: 'hint',
    createdAt: time(),
    problemKey: '9700:A',
    session: week + ':first',
    level: 1,
    content: '提示',
  });
  assert.equal(growthSummary(s).weekly.tasks[1]!.progress, 1);
  assert.equal(growthSummary(s).weekly.tasks[1]!.complete, false);
  s.close();
});
test('history before activation is not backfilled and the current week may use preactivation evidence', () => {
  const s = new Store(':memory:');
  s.activate('weekly_grow');
  evidence(s);
  assert.equal(growthSummary(s).weekly.earned, 0);
  assert.equal(growthEvents(s).filter((e) => e.kind === 'weekly').length, 0);
  s.saveWeeklyGoal({ mode: 'balanced', categories: ['数学', '动态规划'] });
  assert.equal(growthSummary(s).weekly.earned, 180);
  s.close();
});
test('Beijing Monday boundary and next week isolation retain archived reward history', () => {
  assert.equal(weekStart(new Date('2026-10-11T15:59:59Z')), '2026-10-05');
  assert.equal(weekStart(new Date('2026-10-11T16:00:00Z')), '2026-10-12');
  const s = setup(true);
  evidence(s);
  const next = new Date(Date.parse(week + 'T00:00:00+08:00') + 7 * 86400000);
  const value = weeklyGrowth(s, growthNamespace(s), baseGrowthEvents(s), next);
  assert.equal(value.current.earned, 0);
  assert.equal(value.bonus.length, 3);
  s.close();
});
test('preparing a future training goal cannot activate future-dated weekly rewards or break restore', () => {
  const s = new Store(':memory:');
  s.activate('future_goal');
  const tomorrow = new Date(Date.now() + 86400000);
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] }, tomorrow);
  assert.equal(s.externalAll(growthNamespace(s)).length, 0);
  const r = new Store(':memory:');
  r.restore(s.backup());
  assert.equal(growthSummary(r).weekly.earned, 0);
  s.close();
  r.close();
});
test('AtCoder requires manual categories and account combinations do not share weekly snapshots', () => {
  const s = new Store(':memory:');
  s.activateAtcoder('week_ac');
  s.ingestAtcoder(
    'ac~week_ac',
    Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      epoch_second: Date.parse(time()) / 1000,
      problem_id: 'abc001_' + i,
      contest_id: 'abc001',
      user_id: 'week_ac',
      language: 'C++',
      result: 'AC',
    })),
  );
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] });
  assert.equal(growthSummary(s).weekly.earned, 0);
  assert.equal(growthSummary(s).weekly.unclassified, 5);
  for (let i = 0; i < 5; i++)
    s.put('reviews', 'ac~week_ac', 'atcoder:abc001_' + i, { ...emptyReview(), categories: ['数学'] });
  assert.equal(growthSummary(s).weekly.earned, 60);
  s.activate('additional_cf');
  assert.equal(growthSummary(s).weekly.earned, 0);
  s.close();
});
test('v10 backup keeps snapshots, legacy backup creates none, invalid ownership/version rejected atomically', () => {
  const s = setup(true);
  evidence(s);
  const backup = s.backup();
  assert.equal(backup.version, 10);
  const restored = new Store(':memory:');
  restored.restore(backup);
  assert.equal(growthSummary(restored).weekly.earned, 180);
  const bad = structuredClone(backup);
  (bad.external.find((e) => e.key === 'weekly:' + week)!.value as any).scope = 'growth:other:-';
  assert.throws(() => restored.restore(bad), /快照不一致/);
  assert.equal(growthSummary(restored).weekly.earned, 180);
  const old = structuredClone(backup);
  old.version = 9;
  old.external = old.external.filter((e) => (e.value as any).kind !== 'weekly');
  restored.restore(old);
  assert.equal(growthSummary(restored).weekly.earned, 0);
  s.close();
  restored.close();
});
test('server activation is idempotent and summary/history remain equal to shared implementation', async () => {
  const s = setup(true);
  evidence(s);
  const { app } = await buildApp(s);
  await app.ready();
  for (let i = 0; i < 2; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/growth/weekly/activate',
      headers: { 'x-review-app': '1' },
      payload: {},
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().weekly.earned, 180);
  }
  const res = await app.inject({ method: 'GET', url: '/api/growth/summary' });
  assert.deepEqual(res.json(), growthSummary(s));
  await app.close();
  s.close();
});
