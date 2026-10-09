import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { categories } from '../shared/training.js';
import { reviewQualityHints } from '../shared/training-extras.js';
import { emptyReview, type CFSubmission } from '../shared/domain.js';
import { weekStart } from '../shared/weekly.js';

const monday = new Date(2026, 8, 28, 12);
const tuesday = new Date(2026, 8, 29, 12);
const nextMonday = new Date(2026, 9, 5, 12);
const catalog = Array.from({ length: 18 }, (_, i) => ({
  contestId: 3000 + i,
  index: 'A',
  name: `Task ${i}`,
  rating: 1000 + (i % 4) * 100,
  tags: i < 5 ? ['math'] : i < 10 ? ['dp'] : ['graphs'],
}));
function fixture() {
  const s = new Store(':memory:');
  s.activate('alice');
  s.enrich(
    'alice',
    [
      {
        id: 3000,
        name: 'Old Round',
        startTimeSeconds: 1700000000,
        durationSeconds: 7200,
        phase: 'FINISHED',
        type: 'CF',
      },
    ],
    [],
    catalog,
  );
  return s;
}
function sub(id: number, key: string, verdict: string, date = new Date()): CFSubmission {
  const [contestId, index] = key.split(':');
  return {
    id,
    contestId: Number(contestId),
    creationTimeSeconds: Math.floor(date.getTime() / 1000),
    problem: { contestId: Number(contestId), index, name: key, tags: ['math'] },
    verdict,
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  };
}

test('Monday waits for goal; focus quota, fixed plan, no next-day duplicates and weekly reset', () => {
  const s = fixture();
  assert.equal(s.trainingDay('alice', monday).newProblems.length, 0);
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] }, monday);
  const first = s.trainingDay('alice', monday);
  assert.equal(first.newProblems.length, 5);
  assert.ok(first.newProblems.filter((p) => categories(p.tags).includes('数学')).length >= 2);
  assert.ok(first.newProblems.every((p) => p.recommendationReason));
  assert.deepEqual(
    s.trainingDay('alice', monday).newProblems.map((p) => p.key),
    first.newProblems.map((p) => p.key),
  );
  const next = s.trainingDay('alice', tuesday);
  assert.equal(next.newProblems.length, 5);
  assert.ok(next.newProblems.every((p) => !first.newProblems.some((old) => old.key === p.key)));
  assert.equal(s.trainingDay('alice', nextMonday).newProblems.length, 0);
  assert.equal(weekStart(monday), '2026-09-28');
  s.close();
});

test('balanced goal counts two total; shortages and profile isolation are explicit', () => {
  const s = fixture();
  s.saveWeeklyGoal({ mode: 'balanced', categories: ['数学', '动态规划'] }, monday);
  const first = s.trainingDay('alice', monday);
  assert.equal(first.newProblems.length, 5);
  assert.ok(
    first.newProblems.filter((p) => categories(p.tags).some((c) => ['数学', '动态规划'].includes(c)))
      .length >= 2,
  );
  s.activate('bob');
  s.enrich('bob', [], [], catalog.slice(0, 2));
  assert.equal(s.trainingDay('bob', monday).newProblems.length, 0);
  s.saveWeeklyGoal({ mode: 'focus', categories: ['字符串'] }, monday);
  const short = s.trainingDay('bob', monday);
  assert.equal(short.newProblems.length, 2);
  assert.match(short.newShortage ?? '', /0 道/);
  s.close();
});

test('latest official Rating controls the next plan, while todays plan and another account stay fixed', () => {
  const s = fixture();
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] }, monday);
  const first = s.trainingDay('alice', monday);
  assert.ok(first.newProblems.every((p) => (p.rating ?? 0) >= 1000 && (p.rating ?? 0) <= 1300));
  s.enrich(
    'alice',
    [],
    [
      {
        contestId: 90,
        contestName: 'Recent',
        oldRating: 1500,
        newRating: 1600,
        rank: 20,
        ratingUpdateTimeSeconds: 200,
      },
      {
        contestId: 80,
        contestName: 'Older',
        oldRating: 900,
        newRating: 1000,
        rank: 30,
        ratingUpdateTimeSeconds: 100,
      },
    ],
    [],
  );
  assert.deepEqual(
    s.trainingDay('alice', monday).newProblems.map((p) => p.key),
    first.newProblems.map((p) => p.key),
  );
  const next = s.trainingDay('alice', tuesday);
  assert.equal(next.newProblems.length, 0);
  assert.match(next.newShortage ?? '', /难度 1600–1900/);
  s.activate('bob');
  s.enrich('bob', [], [], catalog);
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] }, tuesday);
  assert.equal(s.trainingDay('bob', tuesday).newProblems.length, 5);
  assert.match(s.trainingDay('bob', tuesday).newProblems[0].recommendationReason ?? '', /暂无官方 Rating/);
  s.close();
});

test('upsolve AC, reason snapshots, quality hints, simulation evidence and v7 backup survive restore', () => {
  const s = fixture();
  const upsolve = s.addContestUpsolve('cf', '3000');
  assert.equal(upsolve.length, 1);
  assert.equal(s.addContestUpsolve('cf', '3000').length, 1);
  assert.equal(s.upsolveItems().length, 1);
  s.ingest('alice', [sub(1, '3000:A', 'OK', new Date(Date.now() - 86400000))]);
  assert.equal(s.upsolveItems()[0].completed, true);
  s.saveReview('alice', '3000:A', { ...emptyReview(), reasons: ['边界遗漏'] });
  assert.equal(s.reasonTrend()[0].reasons[0].name, '边界遗漏');
  assert.equal(reviewQualityHints(emptyReview()).length, 3);
  const simulation = s.startSimulation(3000);
  s.externalPut('simulation:alice', simulation.id, {
    ...simulation,
    startedAt: new Date(Date.now() - 60000).toISOString(),
    problems: undefined,
    events: undefined,
    solved: undefined,
    ended: undefined,
  });
  s.updateSimulation(simulation.id, 'record', { problemKey: '3000:A', verdict: 'FAILED' });
  const current = s.simulations()[0];
  assert.equal(current.events[0].source, 'manual');
  s.ingest('alice', [sub(2, '3000:A', 'OK')]);
  assert.ok(s.simulations()[0].events.some((e) => e.source === 'cf' && e.verdict === 'OK'));
  const backup = s.backup();
  assert.equal(backup.version, 9);
  const restored = new Store(':memory:');
  restored.restore(backup);
  assert.equal(restored.upsolveItems()[0].completed, true);
  assert.equal(restored.reasonTrend()[0].reasons[0].count, 1);
  assert.equal(restored.simulations()[0].events.length, 2);
  assert.throws(() =>
    restored.restore({
      ...backup,
      external: backup.external.map((row) =>
        row.namespace.startsWith('simulation:') ? { ...row, key: 'bad-id' } : row,
      ),
    }),
  );
  const legacy = {
    ...backup,
    version: 6,
    external: backup.external.filter(
      (row) =>
        !['weekly:', 'upsolve:', 'reason:', 'simulation:', 'cf-contests:'].some((prefix) =>
          row.namespace.startsWith(prefix),
        ),
    ),
  };
  restored.restore(legacy);
  assert.equal(restored.upsolveItems().length, 0);
  assert.equal(restored.reasonTrend().length, 0);
  restored.close();
  s.close();
});
