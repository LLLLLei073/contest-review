import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import { emptyReview, type CFSubmission, type Attempt } from '../shared/domain.js';
import {
  growthEvents,
  growthSummary,
  growthRoute,
  growthNamespace,
  levelForXp,
  beijingDay,
} from '../shared/growth.js';

function setup() {
  const s = new Store(':memory:');
  s.activate('grow');
  return s;
}
function sub(id: number, index = 'A', at = '2020-10-01T00:00:00Z', verdict = 'OK'): CFSubmission {
  return {
    id,
    contestId: 9000,
    creationTimeSeconds: Date.parse(at) / 1000,
    problem: { contestId: 9000, index, name: 'Growth ' + index, tags: [] },
    verdict,
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  };
}
function attempt(
  s: Store,
  id: string,
  at: string,
  result: Attempt['result'] = 'independent',
  profile = 'grow',
  key = '9000:A',
) {
  s.put('attempts', profile, id, { id, problemKey: key, createdAt: at, result, minutes: 20, note: '' });
}
test('first AC includes AC-only problems, repeated sync is idempotent, invalid dates and pending excluded', () => {
  const s = setup();
  s.ingest('grow', [
    sub(1),
    sub(2),
    sub(3, 'B', undefined, 'TESTING'),
    sub(4, 'C', undefined, 'WRONG_ANSWER'),
  ]);
  s.ingest('grow', [sub(1)]);
  assert.equal(growthSummary(s).xp, 20);
  assert.equal(growthSummary(s).counts.ac, 1);
  assert.equal(growthEvents(s)[0]!.canReview, false);
  assert.ok(growthEvents(s)[0]!.url?.startsWith('https://codeforces.com/'));
  const before = s.backup();
  growthSummary(s);
  growthEvents(s);
  assert.deepEqual(s.backup().external, before.external);
  assert.equal(beijingDay('invalid'), null);
  assert.equal(beijingDay(1e90), null);
  assert.equal(beijingDay('2020-10-01T16:00:00Z'), '2020-10-02');
  s.close();
});
test('same first AC day does not stack, later redo takes highest daily value, failed excluded', () => {
  const s = setup();
  s.ingest('grow', [sub(1), sub(2, 'A', '2020-10-02T00:00:00Z'), sub(3, 'A', '2020-10-03T00:00:00Z')]);
  attempt(s, 'first', '2020-10-01T01:00:00Z');
  attempt(s, 'hint', '2020-10-02T01:00:00Z', 'hint');
  attempt(s, 'independent', '2020-10-02T02:00:00Z');
  attempt(s, 'again', '2020-10-02T03:00:00Z');
  attempt(s, 'failed', '2020-10-03T01:00:00Z', 'failed');
  assert.equal(growthSummary(s).xp, 50);
  assert.equal(growthSummary(s).counts.independent, 1);
  assert.equal(growthSummary(s).counts.days, 2);
  s.close();
});
test('same-day hint evidence downgrades independent result and unsupported independent claims earn nothing', () => {
  const s = setup();
  s.ingest('grow', [sub(1), sub(2, 'A', '2020-10-02T00:00:00Z')]);
  s.externalPut('learning-source:grow', 'hint', {
    kind: 'hint',
    id: 'hint',
    createdAt: '2020-10-02T00:30:00Z',
    problemKey: '9000:A',
    session: '2020-10-02:first',
    level: 1,
    content: '提示',
  });
  attempt(s, 'a', '2020-10-02T01:00:00Z');
  attempt(s, 'unsupported', '2020-10-03T01:00:00Z');
  assert.equal(growthSummary(s).xp, 30);
  assert.equal(growthSummary(s).counts.independent, 0);
  s.close();
});
test('reflection needs content and timestamp; edits preserve first date and do not duplicate', () => {
  const s = setup();
  s.ingest('grow', [sub(1)]);
  s.put('reviews', 'grow', '9000:A', { ...emptyReview(), solution: 'old without date' });
  assert.equal(growthSummary(s).counts.reflection, 0);
  s.saveReview('grow', '9000:A', { ...emptyReview(), code: 'int main(){}' });
  assert.equal(growthSummary(s).counts.reflection, 0);
  s.saveReview('grow', '9000:A', { ...emptyReview(), solution: '明确思路' });
  const at = s.review('grow', '9000:A').firstReflectionAt;
  assert.ok(at);
  s.saveReview('grow', '9000:A', { ...emptyReview(), solution: '更完整的思路' });
  assert.equal(s.review('grow', '9000:A').firstReflectionAt, at);
  assert.equal(growthSummary(s).xp, 35);
  s.close();
});
test('level thresholds are exact and historical achievements derive from evidence', () => {
  for (const [xp, level] of [
    [0, 1],
    [99, 1],
    [100, 2],
    [299, 2],
    [300, 3],
    [999, 4],
    [1000, 5],
  ])
    assert.equal(levelForXp(xp!), level);
  const s = setup();
  s.ingest(
    'grow',
    Array.from({ length: 50 }, (_, i) =>
      sub(i + 1, String(i), `2020-10-${String((i % 30) + 1).padStart(2, '0')}T00:00:00Z`),
    ),
  );
  const value = growthSummary(s);
  assert.equal(value.xp, 1000);
  assert.equal(value.level, 5);
  assert.equal(value.counts.days, 30);
  assert.ok(value.achievements.find((a) => a.id === 'ac:50')?.unlocked);
  assert.ok(value.achievements.find((a) => a.id === 'days:30')?.unlocked);
  s.close();
});
test('CF and AtCoder evidence is isolated then combined; equipment is scoped to selected account combination', () => {
  const s = setup();
  s.activateAtcoder('grow_ac');
  s.ingest('grow', [sub(1)]);
  s.ingestAtcoder('ac~grow_ac', [
    {
      id: 1,
      epoch_second: Date.parse('2020-10-01T00:00:00Z') / 1000,
      problem_id: 'abc001_a',
      contest_id: 'abc001',
      user_id: 'grow_ac',
      language: 'C++',
      result: 'AC',
    },
  ]);
  assert.equal(growthSummary(s).xp, 40);
  assert.equal(growthSummary(s).counts.ac, 2);
  s.ingest(
    'grow',
    Array.from({ length: 15 }, (_, i) => sub(i + 10, String(i))),
  );
  growthRoute(s, 'equipment', 'PUT', { appearance: 'orbit', palette: 'gold' });
  assert.equal(growthSummary(s).equipment.appearance, 'orbit');
  s.activate('other');
  assert.equal(growthSummary(s).xp, 20);
  assert.equal(growthSummary(s).equipment.appearance, 'signal');
  s.activate('grow');
  assert.equal(growthSummary(s).equipment.palette, 'gold');
  const oldScope = growthNamespace(s),
    oldRevision = growthSummary(s).revision;
  s.activate('other');
  assert.throws(
    () => growthRoute(s, 'equipment', 'PUT', { appearance: 'signal', palette: 'cyan', scope: oldScope }),
    /账号已切换/,
  );
  assert.throws(() => growthRoute(s, 'notice', 'PUT', { revision: oldRevision }), /已更新/);
  s.close();
});
test('locked equipment and client-supplied XP rejected, lost progress falls back to unlocked equipment', () => {
  const s = setup();
  assert.throws(
    () => growthRoute(s, 'equipment', 'PUT', { appearance: 'nova', palette: 'coral' }),
    /尚未解锁/,
  );
  assert.throws(() =>
    growthRoute(s, 'equipment', 'PUT', { appearance: 'signal', palette: 'cyan', xp: 100000 }),
  );
  s.externalPut(growthNamespace(s), 'equipment', { kind: 'equipment', appearance: 'nova', palette: 'coral' });
  assert.deepEqual(growthSummary(s).equipment, { appearance: 'signal', palette: 'cyan' });
  s.close();
});
test('history pagination is bounded and deterministically ordered', () => {
  const s = setup();
  s.ingest(
    'grow',
    Array.from({ length: 25 }, (_, i) => sub(i + 1, String(i))),
  );
  const page = growthRoute(s, 'history', 'GET', undefined, { page: 2, pageSize: 20 }) as {
    items: unknown[];
    total: number;
  };
  assert.equal(page.items.length, 5);
  assert.equal(page.total, 25);
  assert.throws(() => growthRoute(s, 'history', 'GET', undefined, { pageSize: 1000 }));
  s.close();
});
test('notification acknowledgement is derived and rejects a stale summary', () => {
  const s = setup();
  s.ingest('grow', [sub(1)]);
  const summary = growthSummary(s);
  assert.equal(summary.notice.initialized, false);
  s.ingest('grow', [sub(2, 'B')]);
  assert.throws(() => growthRoute(s, 'notice', 'PUT', { revision: summary.revision }), /已更新/);
  growthRoute(s, 'notice', 'PUT', { revision: growthSummary(s).revision });
  assert.equal(growthSummary(s).notice.xp, 40);
  assert.equal(growthSummary(s).notice.initialized, true);
  s.close();
});
test('backup round trip preserves preferences and acknowledgement, old backup recalculates, invalid owners rejected atomically', () => {
  const s = setup();
  s.ingest(
    'grow',
    Array.from({ length: 15 }, (_, i) => sub(i + 1, String(i))),
  );
  growthRoute(s, 'equipment', 'PUT', { appearance: 'orbit', palette: 'gold' });
  growthRoute(s, 'notice', 'PUT', { revision: growthSummary(s).revision });
  const backup = s.backup(),
    restored = new Store(':memory:');
  restored.restore(backup);
  assert.equal(growthSummary(restored).xp, 300);
  assert.equal(growthSummary(restored).equipment.palette, 'gold');
  assert.equal(growthSummary(restored).notice.initialized, true);
  const bad = structuredClone(backup);
  bad.external.find((r) => r.namespace.startsWith('growth:'))!.namespace = 'growth:missing:-';
  assert.throws(() => restored.restore(bad), /成长数据账号/);
  assert.equal(growthSummary(restored).xp, 300);
  const invalid = structuredClone(backup);
  invalid.external.find((r) => r.key === 'equipment')!.value = {
    kind: 'equipment',
    appearance: 'signal',
    palette: 'cyan',
    xp: 9,
  };
  assert.throws(() => restored.restore(invalid));
  const old = structuredClone(backup);
  old.external = old.external.filter((r) => !r.namespace.startsWith('growth:'));
  restored.restore(old);
  assert.equal(growthSummary(restored).xp, 300);
  assert.equal(growthSummary(restored).notice.initialized, false);
  s.close();
  restored.close();
});
test('server routes enforce write boundary and equipment unlock; summary and history match shared calculation', async () => {
  const s = setup();
  s.ingest('grow', [sub(1)]);
  const { app } = await buildApp(s);
  const summary = await app.inject({ method: 'GET', url: '/api/growth/summary' });
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.json().xp, 20);
  const history = await app.inject({ method: 'GET', url: '/api/growth/history?page=1&pageSize=1' });
  assert.equal(history.json().items.length, 1);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/growth/equipment',
        payload: { appearance: 'signal', palette: 'cyan' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/growth/equipment',
        headers: { 'x-review-app': '1' },
        payload: { appearance: 'nova', palette: 'coral' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/growth/equipment',
        headers: { 'x-review-app': '1' },
        payload: { appearance: 'signal', palette: 'cyan' },
      })
    ).statusCode,
    200,
  );
  await app.close();
  s.close();
});
