import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { localDay, problemKey } from '../shared/core-store.js';
import { emptyReview, type CFSubmission } from '../shared/domain.js';
import {
  categoryNames,
  chooseNewProblems,
  masteryAreas,
  recommendationDifficulty,
  type Catalog,
} from '../shared/training.js';
import { TrainingService } from '../shared/training-service.js';
import { buildApp } from '../server/app.js';

const now = new Date();
now.setHours(12, 0, 0, 0);
const tomorrow = new Date(now);
tomorrow.setDate(tomorrow.getDate() + 1);
const make = (id: number, index: string, verdict = 'WRONG_ANSWER', time = now): CFSubmission => ({
  id,
  contestId: 2000,
  creationTimeSeconds: Math.floor(time.getTime() / 1000),
  problem: { contestId: 2000, index, name: 'Problem ' + index, rating: 1000, tags: ['math'] },
  verdict,
  programmingLanguage: 'GNU C++20',
  author: { participantType: 'PRACTICE' },
});
const catalog = (): CFSubmission['problem'][] =>
  Array.from({ length: 20 }, (_, i) => ({
    contestId: 2001 + i,
    index: 'A',
    name: 'New ' + i,
    rating: 1000 + (i % 4) * 100,
    tags: [i % 2 ? 'math' : 'dp'],
  }));

test('difficulty band honors official Rating, unique AC fallback and strict boundaries', () => {
  const solved = [make(1, 'A', 'OK'), make(2, 'A', 'OK'), make(3, 'B', 'OK')];
  const known = [
    {
      key: '2000:A',
      contestId: 2000,
      index: 'A',
      name: 'A',
      rating: 800,
      tags: [],
      url: 'https://codeforces.com/problemset',
      manual: false,
    },
    {
      key: '2000:B',
      contestId: 2000,
      index: 'B',
      name: 'B',
      rating: 1200,
      tags: [],
      url: 'https://codeforces.com/problemset',
      manual: false,
    },
  ];
  assert.deepEqual(recommendationDifficulty(known, solved, problemKey), {
    minimum: 900,
    maximum: 1200,
    preferred: 1000,
    basis: '暂无官方 Rating，按唯一已 AC 题中位难度 800 加 100',
  });
  assert.deepEqual(recommendationDifficulty([], [], problemKey).minimum, 1000);
  assert.deepEqual(recommendationDifficulty(known, solved, problemKey, 700).minimum, 800);
  const band = recommendationDifficulty(known, solved, problemKey, 1450);
  assert.deepEqual([band.minimum, band.maximum, band.preferred], [1450, 1750, 1550]);
  const candidates: Catalog['problems'] = [1400, 1450, 1600, 1750, 1800, null].map((rating, i) => ({
    key: `${4000 + i}:A`,
    contestId: 4000 + i,
    index: 'A',
    name: 'Candidate',
    rating,
    tags: ['math'],
    url: 'https://codeforces.com/problemset',
  }));
  const mastery = categoryNames.map((name) => ({ name, score: 50, samples: 0 }));
  assert.deepEqual(
    new Set(chooseNewProblems(candidates, new Set(), mastery, band, '2026-09-30')),
    new Set(['4001:A', '4002:A', '4003:A']),
  );
});
function store() {
  const s = new Store(':memory:');
  s.activate('tester');
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] }, now);
  return s;
}

test('daily lanes select overdue first, then pending; shortage stays below five and remains fixed', () => {
  const s = store();
  for (let i = 0; i < 4; i++) {
    const key = `2000:${String.fromCharCode(65 + i)}`;
    s.ingest('tester', [make(i + 1, key.split(':')[1])]);
    if (i < 2)
      s.saveReview('tester', key, {
        ...emptyReview(),
        status: 'reviewing',
        nextReview: new Date(now.getTime() - (i + 1) * 86400000).toISOString(),
      });
  }
  s.enrich('tester', [], [], catalog());
  const first = s.trainingDay('tester', now);
  assert.deepEqual(
    first.review.map((p) => [p.key, p.kind]),
    [
      ['2000:B', 'due'],
      ['2000:A', 'due'],
      ['2000:C', 'pending'],
      ['2000:D', 'pending'],
    ],
  );
  assert.equal(first.newProblems.length, 5);
  assert.equal(new Set([...first.review, ...first.newProblems].map((p) => p.key)).size, 9);
  s.ingest('tester', [make(100, 'E')]);
  const again = s.trainingDay('tester', now);
  assert.deepEqual(
    again.review.map((p) => p.key),
    first.review.map((p) => p.key),
  );
  assert.deepEqual(
    again.newProblems.map((p) => p.key),
    first.newProblems.map((p) => p.key),
  );
  s.close();
});

test('new lane is never-submitted, fixed all day and responds to AC, pending and rejudge', () => {
  const s = store();
  s.enrich('tester', [], [], catalog());
  s.manualProblem('tester', { contestId: 2001, index: 'A', name: 'Seen manually', tags: [], rating: 800 });
  const first = s.trainingDay('tester', now);
  assert.equal(first.newProblems.length, 5);
  assert.ok(!first.newProblems.some((p) => p.key === '2001:A'));
  const [ac, pending, fail] = first.newProblems;
  const makeFor = (id: number, key: string, verdict: string, time = now): CFSubmission => {
    const [contestId, index] = key.split(':');
    return {
      ...make(id, index, verdict, time),
      contestId: Number(contestId),
      problem: { contestId: Number(contestId), index, name: 'New task', tags: ['dp'], rating: 1000 },
    };
  };
  s.ingest('tester', [
    makeFor(101, ac.key, 'OK'),
    makeFor(102, pending.key, 'TESTING'),
    makeFor(103, fail.key, 'WRONG_ANSWER'),
  ]);
  const second = s.trainingDay('tester', now);
  assert.deepEqual(
    second.newProblems.map((p) => p.key),
    first.newProblems.map((p) => p.key),
  );
  assert.deepEqual(
    second.newProblems.slice(0, 3).map((p) => [p.completed, p.attempted]),
    [
      [true, true],
      [false, true],
      [false, true],
    ],
  );
  s.ingest('tester', [makeFor(102, pending.key, 'OK')]);
  assert.equal(s.trainingDay('tester', now).newProblems[1].completed, true);
  const next = s.trainingDay('tester', tomorrow);
  assert.equal(next.newProblems.length, 5);
  assert.ok(!next.newProblems.some((p) => [ac.key, pending.key, fail.key].includes(p.key)));
  assert.ok(next.review.some((p) => p.key === fail.key && p.kind === 'pending'));
  s.close();
});

test('same-day AC confirms redo, reflection then evaluation advance separately', () => {
  const s = store();
  s.ingest('tester', [make(1, 'A'), make(2, 'B')]);
  const first = s.trainingDay('tester', now);
  assert.throws(() => s.attempt('tester', '2000:A', { result: 'independent', minutes: 1, note: '' }, now));
  s.ingest('tester', [make(3, 'A', 'OK', now)]);
  assert.equal(s.trainingDay('tester', now).review.find((p) => p.key === '2000:A')?.phase, 'reflection');
  assert.equal(s.review('tester', '2000:A').nextReview, null);
  assert.equal(s.review('tester', '2000:A').stage, 0);
  s.saveReview('tester', '2000:A', { ...s.review('tester', '2000:A'), reasons: ['边界遗漏'] });
  assert.equal(s.trainingDay('tester', now).review.find((p) => p.key === '2000:A')?.phase, 'reflection');
  s.saveReview('tester', '2000:A', { ...s.review('tester', '2000:A'), solution: '分析后找到正确解法' });
  assert.equal(s.trainingDay('tester', now).review.find((p) => p.key === '2000:A')?.phase, 'evaluation');
  assert.equal(s.trainingDay('tester', now).review.find((p) => p.key === '2000:A')?.completed, false);
  s.ingest('tester', [make(4, 'A', 'OK', now)]);
  assert.equal(s.review('tester', '2000:A').stage, 0);
  s.attempt('tester', '2000:A', { result: 'independent', minutes: 15, note: '' }, now);
  assert.equal(s.review('tester', '2000:A').stage, 1);
  assert.equal(s.trainingDay('tester', now).review.find((p) => p.key === '2000:A')?.completed, true);
  assert.throws(() => s.attempt('tester', '2000:A', { result: 'independent', minutes: 1, note: '' }, now));
  assert.deepEqual(
    first.review.map((p) => p.key),
    s.trainingDay('tester', now).review.map((p) => p.key),
  );
  s.close();
});

test('pending and rejudged submissions do not confirm redo; no-AC attempt needs reflection', () => {
  const s = store();
  s.ingest('tester', [make(1, 'A')]);
  s.trainingDay('tester', now);
  s.ingest('tester', [make(2, 'A', 'TESTING')]);
  assert.equal(s.trainingDay('tester', now).review[0].redoAccepted, false);
  s.ingest('tester', [make(2, 'A', 'OK')]);
  assert.equal(s.trainingDay('tester', now).review[0].redoAccepted, true);
  s.ingest('tester', [make(2, 'A', 'WRONG_ANSWER')]);
  assert.equal(s.trainingDay('tester', now).review[0].redoAccepted, false);
  assert.equal(s.review('tester', '2000:A').awaitingEvaluation, null);
  s.attempt('tester', '2000:A', { result: 'hint', minutes: 10, note: '' }, now);
  assert.equal(s.trainingDay('tester', now).review[0].phase, 'reflection');
  assert.equal(s.review('tester', '2000:A').stage, 0);
  assert.equal(localDay(new Date(s.review('tester', '2000:A').nextReview!)), localDay(tomorrow));
  s.saveReview('tester', '2000:A', { ...s.review('tester', '2000:A'), rootCause: '遗漏边界' });
  assert.equal(s.trainingDay('tester', now).review[0].completed, true);
  s.activate('other');
  assert.equal(s.trainingDay('other', now).review.length, 0);
  s.close();
});

test('late subjective evaluation schedules from AC day, so overdue remains overdue', () => {
  const s = store();
  s.ingest('tester', [make(1, 'A')]);
  s.trainingDay('tester', now);
  s.ingest('tester', [make(2, 'A', 'OK')]);
  const late = new Date(now.getTime() + 5 * 86400000);
  assert.equal(s.trainingDay('tester', late).review[0].phase, 'reflection');
  s.saveReview('tester', '2000:A', { ...s.review('tester', '2000:A'), wrongIdea: '漏看条件' });
  assert.equal(s.trainingDay('tester', late).review[0].phase, 'evaluation');
  s.attempt('tester', '2000:A', { result: 'independent', minutes: 20, note: '' }, late);
  assert.equal(
    localDay(new Date(s.review('tester', '2000:A').nextReview!)),
    localDay(new Date(now.getTime() + 3 * 86400000)),
  );
  assert.equal(s.trainingDay('tester', late).review[0].completed, true);
  s.close();
});

test('ingesting older AC after late evaluation does not resurrect awaiting-evaluation', () => {
  const s = store();
  s.ingest('tester', [make(1, 'A')]);
  s.trainingDay('tester', now);
  s.ingest('tester', [make(2, 'A', 'OK')]);
  const late = new Date(now.getTime() + 86400000);
  assert.equal(s.trainingDay('tester', late).review[0].phase, 'reflection');
  s.saveReview('tester', '2000:A', { ...s.review('tester', '2000:A'), wrongIdea: '漏看条件' });
  assert.equal(s.trainingDay('tester', late).review[0].phase, 'evaluation');
  s.attempt('tester', '2000:A', { result: 'independent', minutes: 20, note: '' }, late);
  assert.equal(s.review('tester', '2000:A').awaitingEvaluation, null);
  assert.equal(s.review('tester', '2000:A').lastEvaluatedDay, localDay(late));

  // Re-ingest the same AC day submission (e.g. delayed sync or another AC on the same day).
  // It must not re-enter awaiting-evaluation, otherwise the dashboard shows "待评价"
  // but attempting again fails with "今天已评价过这道题".
  s.ingest('tester', [make(3, 'A', 'OK')]);
  assert.equal(s.review('tester', '2000:A').awaitingEvaluation, null);
  assert.equal(s.trainingDay('tester', late).review[0].phase, 'done');
  assert.throws(() => s.attempt('tester', '2000:A', { result: 'independent', minutes: 1, note: '' }, late), {
    message: '今天已评价过这道题',
  });
  s.close();
});

test('legacy evaluated record repairs stale waiting state without another attempt or stage change', () => {
  const s = store();
  s.ingest('tester', [make(1, 'A')]);
  s.trainingDay('tester', now);
  s.ingest('tester', [make(2, 'A', 'OK')]);
  s.saveReview('tester', '2000:A', { ...s.review('tester', '2000:A'), rootCause: '边界遗漏' });
  s.attempt('tester', '2000:A', { result: 'independent', minutes: 12, note: '完成' }, now);
  const evaluated = s.review('tester', '2000:A');
  s.put('reviews', 'tester', '2000:A', {
    ...evaluated,
    awaitingEvaluation: {
      date: localDay(now),
      submissionId: 2,
      redoAt: new Date(make(2, 'A', 'OK').creationTimeSeconds * 1000).toISOString(),
      previousNextReview: evaluated.nextReview,
    },
    nextReview: null,
    firstReflectionAt: null,
  });
  const nextDay = new Store(':memory:');
  nextDay.restore(s.backup());
  assert.equal(nextDay.trainingDay('tester', tomorrow).review.length, 0);
  assert.equal(nextDay.review('tester', '2000:A').nextReview, evaluated.nextReview);
  nextDay.close();
  const restored = new Store(':memory:');
  restored.restore(s.backup());
  const day = restored.trainingDay('tester', now);
  assert.equal(day.review[0].phase, 'done');
  assert.equal(day.review[0].completed, true);
  assert.equal(restored.review('tester', '2000:A').awaitingEvaluation, null);
  assert.equal(restored.review('tester', '2000:A').firstReflectionAt !== null, true);
  assert.equal(restored.review('tester', '2000:A').nextReview, evaluated.nextReview);
  assert.equal(restored.review('tester', '2000:A').stage, 1);
  restored.put('reviews', 'tester', '2000:A', {
    ...restored.review('tester', '2000:A'),
    awaitingEvaluation: {
      date: localDay(now),
      submissionId: 2,
      redoAt: new Date(make(2, 'A', 'OK').creationTimeSeconds * 1000).toISOString(),
      previousNextReview: null,
    },
    nextReview: null,
  });
  assert.equal(restored.trainingDay('tester', now).review[0].phase, 'done');
  assert.equal(restored.review('tester', '2000:A').nextReview, evaluated.nextReview);
  restored.ingest('tester', [make(3, 'A', 'OK')]);
  assert.equal(restored.trainingDay('tester', now).review[0].phase, 'done');
  assert.equal(restored.all('attempts', 'tester').length, 1);
  restored.close();
  s.close();
});

test('existing substantive notes complete first reflection while labels and code alone do not', () => {
  const s = store();
  s.ingest('tester', [make(1, 'A'), make(2, 'B')]);
  s.trainingDay('tester', now);
  s.saveReview('tester', '2000:A', { ...s.review('tester', '2000:A'), solution: '记录过正确解法' });
  s.saveReview('tester', '2000:B', {
    ...s.review('tester', '2000:B'),
    reasons: ['边界遗漏'],
    code: 'int main() {}',
  });
  s.ingest('tester', [make(3, 'A', 'OK'), make(4, 'B', 'OK')]);
  const day = s.trainingDay('tester', now);
  assert.equal(day.review.find((task) => task.key === '2000:A')?.phase, 'evaluation');
  assert.equal(day.review.find((task) => task.key === '2000:B')?.phase, 'reflection');
  assert.equal(day.review.filter((task) => task.completed).length, 0);
  s.close();
});

test('mastery uses unique problems, transparent shrinkage and inverse allocation', () => {
  const s = store();
  s.ingest('tester', [make(1, 'A'), make(2, 'A', 'OK'), make(3, 'B')]);
  const areas = masteryAreas(
    s.all('problems', 'tester'),
    s.all('submissions', 'tester'),
    [],
    new Map(s.problems('tester').map((p) => [p.key, p.review])),
    problemKey,
  );
  assert.equal(areas.find((a) => a.name === '数学')?.samples, 2);
  assert.equal(areas.find((a) => a.name === '数学')?.score, 48);
  assert.equal(areas.find((a) => a.name === '图与树')?.score, 50);
  const pool: Catalog['problems'] = categoryNames.flatMap((name, i) =>
    Array.from({ length: 5 }, (_, j) => ({
      key: `${3000 + i * 5 + j}:A`,
      contestId: 3000 + i * 5 + j,
      index: 'A',
      name: name,
      rating: 1000,
      tags: [
        (
          {
            实现与模拟: 'implementation',
            贪心与构造: 'greedy',
            数学: 'math',
            数据结构: 'data structures',
            图与树: 'graphs',
            动态规划: 'dp',
            字符串: 'strings',
            搜索与技巧: 'dfs and similar',
          } as Record<string, string>
        )[name],
      ],
      url: 'https://codeforces.com/problemset',
    })),
  );
  const skewed = categoryNames.map((name) => ({ name, score: name === '数学' ? 0 : 100, samples: 20 }));
  const chosen = chooseNewProblems(
    pool,
    new Set(),
    skewed,
    recommendationDifficulty([], [], problemKey),
    '2026-09-26',
  );
  assert.equal(chosen.length, 5);
  assert.equal(new Set(chosen).size, 5);
  assert.ok(
    chosen.filter((key) => Number(key.split(':')[0]) >= 3010 && Number(key.split(':')[0]) < 3015).length >= 2,
  );
  s.close();
});

test('catalog and daily plan survive backup; legacy v3 has no catalog and needs sync', () => {
  const s = store();
  s.enrich('tester', [], [], catalog());
  const original = s.trainingDay('tester', now);
  const backup = s.backup();
  assert.equal(backup.version, 9);
  s.restore(backup);
  assert.deepEqual(
    s.trainingDay('tester', now).newProblems.map((p) => p.key),
    original.newProblems.map((p) => p.key),
  );
  const legacy = structuredClone(backup);
  legacy.version = 3;
  delete legacy.tables.catalog_cache;
  delete legacy.tables.daily_plans;
  delete legacy.tables.training_meta;
  s.restore(legacy);
  assert.equal(s.trainingDay('tester', now).catalogCount, 0);
  assert.equal(s.trainingDay('tester', now).newProblems.length, 0);
  const corrupt = structuredClone(backup);
  corrupt.tables.daily_plans[0].value.newKeys[0] = 'missing:A';
  assert.throws(() => s.restore(corrupt));
  assert.equal(s.trainingDay('tester', now).catalogCount, 0);
  s.close();
});

test('daily plans and catalog remain isolated when switching handles', () => {
  const s = store();
  s.enrich('tester', [], [], catalog());
  const first = s.trainingDay('tester', now);
  assert.equal(first.newProblems.length, 5);
  s.activate('other');
  const empty = s.trainingDay('other', now);
  assert.equal(empty.catalogCount, 0);
  assert.equal(empty.newProblems.length, 0);
  s.enrich('other', [], [], catalog().slice(0, 2));
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] }, now);
  assert.equal(s.trainingDay('other', now).newProblems.length, 2);
  assert.deepEqual(
    s.trainingDay('tester', now).newProblems.map((p) => p.key),
    first.newProblems.map((p) => p.key),
  );
  s.close();
});

test('recent check preserves cache on failure and deduplicates concurrent refreshes', async () => {
  const s = store();
  let calls = 0;
  const service = new TrainingService(s, {
    call: async <T>() => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (calls === 2) throw new Error('offline');
      return [make(9, 'A', 'OK')] as T;
    },
  });
  const [a, b] = await Promise.all([service.recent('tester'), service.recent('tester')]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  const failed = await service.recent('tester', true);
  assert.equal(failed.error, 'offline');
  assert.equal(failed.checkedAt, a.checkedAt);
  assert.equal(s.all('submissions', 'tester').length, 1);
  assert.equal(localDay(new Date(a.checkedAt!)), localDay(new Date()));
  s.close();
});

test('local training endpoints return saved plan and recent-check status', async () => {
  const s = store();
  s.enrich('tester', [], [], catalog());
  const { app } = await buildApp(s, {
    call: async <T>(method: string) => (method === 'user.status' ? [make(900, 'Z', 'OK')] : []) as T,
  });
  const day = await app.inject({
    method: 'GET',
    url: '/api/training/day',
    headers: { host: '127.0.0.1:3210' },
  });
  assert.equal(day.statusCode, 200);
  assert.equal(day.json().newProblems.length, 5);
  const check = await app.inject({
    method: 'POST',
    url: '/api/training/recent',
    headers: { host: '127.0.0.1:3210', 'x-review-app': '1' },
  });
  assert.equal(check.statusCode, 200);
  assert.equal(check.json().error, null);
  assert.ok(check.json().checkedAt);
  assert.equal(s.all('submissions', 'tester').length, 1);
  await app.close();
  s.close();
});
