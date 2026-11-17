import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import {
  selectProblems,
  weakTags,
  categoryNames,
  recommendationDifficulty,
  type Catalog,
  type MasteryArea,
} from '../shared/training.js';
import { buildArc, estimateForRating, phaseCount } from '../shared/program-planner.js';
import {
  programAssignment,
  programNamespace,
  programProgress,
  type TrainingProgram,
} from '../shared/program-domain.js';
import { ProgramService } from '../shared/program-service.js';
import { growthSummary } from '../shared/growth.js';
import { localDay } from '../shared/core-store.js';
import type { CFSubmission } from '../shared/domain.js';

const problem = (key: string, rating: number, tags: string[], solvedCount?: number): Catalog['problems'][number] => {
  const [contestId, index] = key.split(':');
  return {
    key,
    contestId: Number(contestId),
    index,
    name: 'Task ' + key,
    rating,
    tags,
    url: `https://codeforces.com/contest/${contestId}/problem/${index}`,
    solvedCount,
  };
};
const band = { minimum: 1400, maximum: 1700, preferred: 1500, basis: 'test' };
const mastery: MasteryArea[] = categoryNames.map((name) => ({ name, score: 50, samples: 5 }));

test('arc templates ramp monotonically and special days reduce the load', () => {
  for (const duration of [7, 14] as const) {
    const arc = buildArc(band, duration);
    assert.equal(arc.length, duration);
    const training = arc.filter((d) => ['foundation', 'reinforce', 'transfer'].includes(d.phase));
    const preferred = training.map((d) => d.preferred);
    assert.deepEqual(
      [...preferred].sort((a, b) => a - b),
      preferred,
      `training-day difficulty must never decrease (${duration}d)`,
    );
    for (const day of arc)
      assert.ok(day.preferred >= day.minimum - 100 && day.preferred <= day.maximum + 100);
  }
  const seven = buildArc(band, 7);
  assert.equal(seven.at(-1)?.phase, 'challenge');
  const fourteen = buildArc(band, 14);
  assert.equal(fourteen[0].phase, 'foundation');
  assert.equal(fourteen.at(-1)?.phase, 'summary');
  assert.ok(fourteen.some((d) => d.phase === 'checkpoint'));
  assert.ok(fourteen.filter((d) => d.phase === 'transfer').length === 2);
  assert.ok(phaseCount('checkpoint', 8) < 8);
  assert.ok(phaseCount('challenge', 8) <= 3);
  assert.ok(phaseCount('summary', 8) <= 2);
});

test('selection stays inside the band by default, relaxes on demand and honors roles', () => {
  const pool: Catalog['problems'] = [
    problem('1:A', 1300, ['dp'], 2000),
    problem('1:B', 1400, ['dp'], 3000),
    problem('1:C', 1500, ['dp'], 4000),
    problem('1:D', 1600, ['dp'], 5000),
    problem('1:E', 1700, ['dp'], 6000),
    problem('1:F', 1800, ['dp'], 7000),
  ];
  const strict = selectProblems(pool, new Set(), mastery, { date: '2026-11-16', count: 4, band });
  assert.ok(strict.picks.every((p) => {
    const rating = pool.find((x) => x.key === p.key)!.rating!;
    return rating >= 1400 && rating <= 1700;
  }));
  const relaxed = selectProblems(pool, new Set(), mastery, {
    date: '2026-11-16',
    count: 6,
    band,
    relax: true,
  });
  assert.ok(relaxed.picks.some((p) => ['1:A', '1:F'].includes(p.key)));
  const warmupOnly = selectProblems(pool, new Set(), mastery, {
    date: '2026-11-16',
    count: 1,
    band,
    role: 'warmup',
  });
  assert.deepEqual(
    warmupOnly.picks.map((p) => p.role),
    ['warmup'],
  );
  assert.equal(warmupOnly.picks[0].key, '1:B');
});

test('quality prior prefers widely solved problems and weakTags drive targeting', () => {
  const obscure = Array.from({ length: 5 }, (_, i) => problem(`10${i}:A`, 1500, ['greedy'], 20));
  const classic = Array.from({ length: 5 }, (_, i) => problem(`20${i}:A`, 1500, ['greedy'], 9000));
  const qualityPick = selectProblems(
    [...obscure, ...classic],
    new Set(),
    mastery,
    { date: '2026-11-16', count: 5, band },
  );
  assert.ok(qualityPick.picks.every((p) => p.key.startsWith('20')), 'classic problems must outrank obscure ones');
  const history: CFSubmission[] = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    contestId: 30,
    creationTimeSeconds: 1700000000 + i,
    problem: { contestId: 30, index: String(i), name: 'f', rating: 1500, tags: ['segment tree'] },
    verdict: 'WRONG_ANSWER',
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  }));
  const failedProblems = history.map((s) => ({
    key: `30:${s.problem.index}`,
    contestId: 30,
    index: s.problem.index,
    name: 'f',
    rating: 1500,
    tags: ['segment tree'],
    url: '',
    manual: false,
  }));
  const weak = weakTags(
    failedProblems,
    history,
    [],
    new Map(),
    (s) => `${s.contestId}:${s.problem.index}`,
  );
  assert.ok((weak.get('segment tree') ?? 0) > 0.9);
  const segProblems = Array.from({ length: 6 }, (_, i) => problem(`40${i}:A`, 1500, ['segment tree']));
  const greedyProblems = Array.from({ length: 6 }, (_, i) => problem(`50${i}:A`, 1500, ['greedy']));
  const targeted = selectProblems([...segProblems, ...greedyProblems], new Set(), mastery, {
    date: '2026-11-16',
    count: 6,
    band,
    weak,
  });
  const segCount = targeted.picks.filter((p) => p.key.startsWith('40')).length;
  assert.ok(segCount >= 4, `weak tags must dominate targeting, got ${segCount}/6`);
});

test('selection is deterministic and caps two problems per contest', () => {
  const pool = Array.from({ length: 8 }, (_, i) => problem(`60${i}:A`, 1500, ['dp']));
  const a = selectProblems(pool, new Set(), mastery, { date: '2026-11-16', count: 6, band });
  const b = selectProblems(pool, new Set(), mastery, { date: '2026-11-16', count: 6, band });
  assert.deepEqual(a, b);
  const mixed = [
    ...Array.from({ length: 6 }, (_, i) => problem(`7000:A${i}`, 1500, ['dp'])),
    ...Array.from({ length: 6 }, (_, i) => problem(`7001:B${i}`, 1500, ['greedy'])),
    ...Array.from({ length: 6 }, (_, i) => problem(`7002:C${i}`, 1500, ['graphs'])),
  ];
  const picks = selectProblems(mixed, new Set(), mastery, { date: '2026-11-16', count: 6, band });
  const perContest = new Map<number, number>();
  for (const pick of picks.picks) {
    const contestId = mixed.find((p) => p.key === pick.key)!.contestId;
    perContest.set(contestId, (perContest.get(contestId) ?? 0) + 1);
  }
  assert.ok([...perContest.values()].every((n) => n <= 2), 'same-contest picks must be capped at two');
});

test('program assignment carries missed problems forward and progress tracks completion', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03'].map((date, i) => ({
    date,
    phase: 'reinforce' as const,
    theme: `T${i}`,
    focus: ['动态规划' as const],
    band: { minimum: 1400, maximum: 1700, preferred: 1500 },
    problems: [
      { key: `${9000 + i}:A`, role: 'core' as const },
      { key: `${9000 + i}:B`, role: 'warmup' as const },
    ],
    reasons: {},
    shortage: null,
    estimateMinutes: 60,
  }));
  const program = {
    id: 'p1',
    createdAt: '2026-11-01T00:00:00.000Z',
    duration: 3,
    dailyCount: 8,
    focus: ['动态规划'],
    basis: 'test',
    days,
    status: 'active',
  } as unknown as TrainingProgram;
  const accepted = new Map([
    ['9000:B', '2026-11-01'],
    ['9001:A', '2026-11-02'],
  ]);
  const assignment = programAssignment(program, '2026-11-02', accepted);
  assert.equal(assignment.keys.filter((k) => k.startsWith('9001')).length, 2);
  assert.ok(assignment.keys.includes('9000:A'), 'missed day-1 problem must carry forward');
  assert.match(assignment.reasons['9000:A'] ?? '', /补做/);
  assert.equal(assignment.carryCount, 1);
  const ended = programAssignment(program, '2026-11-10', accepted);
  assert.equal(ended.dayIndex, null);
  const progress = programProgress(program, '2026-11-02', accepted);
  assert.equal(progress.days[0].status, 'missed');
  assert.equal(progress.days[1].status, 'partial');
  assert.equal(progress.days[2].status, 'todo');
  assert.equal(progress.currentIndex, 1);
  assert.equal(progress.percent, 33);
});

test('program service: generate preview, confirm, feed the daily lane, swap and abandon', () => {
  const s = new Store(':memory:');
  s.activate('alice');
  const catalog = Array.from({ length: 120 }, (_, i) => ({
    contestId: 3100 + (i % 60),
    index: i < 60 ? 'A' : 'B',
    name: 'P' + i,
    rating: 1000 + (i % 4) * 100,
    tags: [i % 2 ? 'dp' : 'greedy'],
  }));
  s.enrich('alice', [], [], catalog);
  const service = new ProgramService(s);
  const state = service.generate({ duration: 7, dailyCount: 8, focus: ['动态规划'] });
  assert.ok(state.draft);
  assert.equal(state.draft!.days.length, 7);
  const trainingDays = state.draft!.days.filter((d) =>
    ['foundation', 'reinforce', 'transfer'].includes(d.phase),
  );
  assert.ok(trainingDays.every((d) => d.problems.length === 8));
  assert.ok(state.draft!.days.every((d) => d.problems.length <= 8));
  const draftKeys = new Set(state.draft!.days.flatMap((d) => d.problems.map((p) => p.key)));
  assert.equal(draftKeys.size, state.draft!.days.reduce((sum, d) => sum + d.problems.length, 0));
  const confirmed = service.confirm({ id: state.draft!.id });
  assert.ok(confirmed.active);
  assert.equal(confirmed.draft, null);
  assert.throws(() => service.generate({ duration: 7 }), /已有进行中的长期计划/);
  const day = s.trainingDay('alice', new Date());
  const day1 = confirmed.active!.days[0];
  assert.deepEqual(
    day.newProblems.map((p) => p.key),
    day1.problems.map((p) => p.key),
  );
  assert.ok(day.newProblems.every((p) => p.recommendationReason));
  const savedPlan = s.get<{ catalogReady: boolean }>('daily_plans', 'alice', localDay(new Date()));
  assert.equal(savedPlan?.catalogReady, true);
  const active = service.active()!;
  const swapKey = day1.problems[0].key;
  const swapped = service.swap({ id: active.id, date: day1.date, key: swapKey });
  const swappedDay = swapped.active!.days[0];
  assert.ok(!swappedDay.problems.some((p) => p.key === swapKey));
  assert.equal(swappedDay.problems.length, day1.problems.length);
  const abandoned = service.abandon({ id: active.id });
  assert.equal(abandoned.active, null);
  // 当日已发出的题单保持固定（与规划器「今日固定」原则一致），次日恢复常规选题。
  assert.equal(s.trainingDay('alice', new Date()).newProblems.length, 8);
  const again = service.generate({ duration: 14, dailyCount: 6 });
  assert.equal(again.draft!.days.length, 14);
  assert.ok(again.draft!.days.filter((d) => ['foundation', 'reinforce', 'transfer'].includes(d.phase)).every((d) => d.problems.length === 6));
  s.close();
});

test('program recommendation difficulty follows the official rating basis', () => {
  const s = new Store(':memory:');
  s.activate('alice');
  s.enrich('alice', [], [], Array.from({ length: 20 }, (_, i) => ({
    contestId: 3200 + i,
    index: 'A',
    name: 'P' + i,
    rating: 1000 + (i % 4) * 100,
    tags: ['dp'],
  })));
  const band = recommendationDifficulty([], [], (submission: CFSubmission) =>
    `${submission.contestId}:${submission.problem.index}`,
  );
  assert.equal(band.minimum, 1000);
  const service = new ProgramService(s);
  const state = service.generate({ duration: 7, dailyCount: 8 });
  assert.ok(state.draft!.basis.length > 0);
  assert.equal(state.catalog && Object.keys(state.catalog).length > 0, true);
  s.close();
});

test('estimateForRating scales with difficulty relative to the day target', () => {
  assert.equal(estimateForRating(30, 1500, 1500), 30);
  assert.equal(estimateForRating(30, 1800, 1500), 42);
  assert.equal(estimateForRating(30, 1200, 1500), 24);
  assert.equal(estimateForRating(30, 2000, 1500), 42);
  assert.equal(estimateForRating(30, null, 1500), 30);
});

test('weakTags decay weights recent failures above stale ones', () => {
  const now = new Date('2026-11-17T12:00:00+08:00');
  const failed = (id: number, contestId: number, index: string, tags: string[], ageDays: number): CFSubmission => ({
    id,
    contestId,
    creationTimeSeconds: Math.floor((now.getTime() - ageDays * 86400000) / 1000),
    problem: { contestId, index, name: index, rating: 1500, tags },
    verdict: 'WRONG_ANSWER',
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  });
  const problems = [
    { key: '50:A', contestId: 50, index: 'A', name: 'r', rating: 1500, tags: ['segment tree'], url: '', manual: false },
    { key: '51:A', contestId: 51, index: 'A', name: 'o', rating: 1500, tags: ['greedy'], url: '', manual: false },
  ];
  const weak = weakTags(
    problems,
    [failed(1, 50, 'A', ['segment tree'], 5), failed(2, 51, 'A', ['greedy'], 60)],
    [],
    new Map(),
    (s) => `${s.contestId}:${s.problem.index}`,
    now,
  );
  assert.equal(weak.get('segment tree'), 1);
  assert.ok(Math.abs((weak.get('greedy') ?? 0) - 0.35) < 0.01, `stale weight should decay to 0.35, got ${weak.get('greedy')}`);
});

test('reserved transfer keys merge into the program day assignment', () => {
  const s = new Store(':memory:');
  s.activate('alice');
  s.enrich('alice', [], [], [
    ...Array.from({ length: 60 }, (_, i) => ({
      contestId: 3100 + (i % 60),
      index: 'A',
      name: 'P' + i,
      rating: 1000 + (i % 4) * 100,
      tags: ['dp'],
    })),
    { contestId: 7999, index: 'A', name: 'Reserved variant', rating: 1100, tags: ['dp'] },
  ]);
  const service = new ProgramService(s);
  const state = service.generate({ duration: 7, dailyCount: 8, focus: ['动态规划'] });
  const confirmed = service.confirm({ id: state.draft!.id });
  const today = localDay(new Date());
  const learningNs = `learning:alice:-`;
  s.externalPut(learningNs, 't1', {
    id: 't1',
    kind: 'transfer',
    createdAt: new Date().toISOString(),
    problemKey: '3100:A',
    targetKey: '7999:A',
    knowledgeIds: ['binary'],
    date: today,
    reason: '变式',
    result: 'pending',
  });
  const day = s.trainingDay('alice', new Date());
  assert.equal(day.newProblems[0].key, '7999:A');
  assert.match(day.newProblems[0].recommendationReason ?? '', /迁移/);
  assert.equal(confirmed.active!.days[0].problems.length, 8);
  s.close();
});

test('recalibrate raises the difficulty after strong completion and eases after weak completion', () => {
  const s = new Store(':memory:');
  s.activate('alice');
  const catalog = Array.from({ length: 120 }, (_, i) => ({
    contestId: 3300 + (i % 60),
    index: i < 60 ? 'A' : 'B',
    name: 'P' + i,
    rating: 800 + (i % 15) * 100,
    tags: ['dp'],
  }));
  s.enrich('alice', [], [], catalog);
  const service = new ProgramService(s);
  const state = service.generate({ duration: 7, dailyCount: 8, focus: ['动态规划'] });
  const confirmed = service.confirm({ id: state.draft!.id });
  const program = confirmed.active!;
  // 把前三天移到过去，并模拟全部完成 → 高完成率。
  const now = new Date();
  const past = (offset: number) => {
    const d = new Date(now.getTime() - offset * 86400000);
    return localDay(d);
  };
  const shifted = {
    ...program,
    days: program.days.map((day, i) =>
      i < 3 ? { ...day, date: past(3 - i) } : day,
    ),
  };
  s.externalPut(programNamespace('alice', ''), program.id, shifted);
  let index = 400;
  for (const day of shifted.days.filter((d) => d.date < now.toISOString().slice(0, 10)))
    for (const p of day.problems) {
      const [contestId, idx] = p.key.split(':');
      s.ingest('alice', [
        {
          id: index++,
          contestId: Number(contestId),
          creationTimeSeconds: Math.floor((Date.parse(day.date + 'T12:00:00+08:00')) / 1000),
          problem: { contestId: Number(contestId), index: idx, name: p.key, rating: 1500, tags: ['dp'] },
          verdict: 'OK',
          programmingLanguage: 'C++',
          author: { participantType: 'PRACTICE' },
        },
      ]);
    }
  const later = new ProgramService(s, () => new Date(now.getTime() + 8 * 3600000));
  const recalibrated = later.recalibrate({ id: program.id });
  assert.ok(recalibrated.active!.recalibrations?.length === 1);
  assert.match(recalibrated.active!.recalibrations![0].note, /上调/);
  const todayStr = localDay(now);
  const remaining = recalibrated.active!.days.filter((d) => d.date >= todayStr);
  const beforePreferred = shifted.days.filter((d) => d.date >= todayStr).map((d) => d.band.preferred);
  const afterPreferred = remaining.map((d) => d.band.preferred);
  assert.deepEqual(
    afterPreferred.map((n) => n - 100),
    beforePreferred,
    'strong completion must raise remaining bands by exactly 100',
  );
  assert.ok(remaining.every((d) => d.problems.length > 0));
  assert.ok(
    recalibrated.active!.days
      .filter((d) => d.date >= todayStr)
      .every((d) => Object.values(d.reasons).some((r) => r.includes('校准后'))),
  );

  // 低完成率：全新计划，零 AC → 难度 −100 且训练日题量 −1。
  const s2 = new Store(':memory:');
  s2.activate('alice');
  const bigCatalog = Array.from({ length: 300 }, (_, i) => ({
    contestId: 3300 + (i % 150),
    index: i < 150 ? 'A' : 'B',
    name: 'P' + i,
    rating: 800 + (i % 15) * 100,
    tags: ['dp'],
  }));
  s2.enrich('alice', [], [], bigCatalog);
  const service2 = new ProgramService(s2);
  const state2 = service2.generate({ duration: 7, dailyCount: 8, focus: ['动态规划'] });
  const confirmed2 = service2.confirm({ id: state2.draft!.id });
  const program2 = confirmed2.active!;
  const shifted2 = {
    ...program2,
    days: program2.days.map((day, i) => (i < 3 ? { ...day, date: past(3 - i) } : day)),
  };
  s2.externalPut(programNamespace('alice', ''), program2.id, shifted2);
  const later2 = new ProgramService(s2, () => new Date(now.getTime() + 8 * 3600000));
  const eased = later2.recalibrate({ id: program2.id });
  assert.match(eased.active!.recalibrations![0].note, /回落/);
  const easedRemaining = eased.active!.days.filter(
    (d) => d.date >= todayStr && ['foundation', 'reinforce', 'transfer'].includes(d.phase),
  );
  // dailyCount 8→7，训练日按同一 dailyCount 换算并 clamp 4。
  assert.ok(easedRemaining.every((d) => d.problems.length === 7), `training days should drop to 7, got ${easedRemaining.map((d) => d.problems.length)}`);
  const easedPreferred = easedRemaining.map((d) => d.band.preferred);
  const expectedEased = shifted2.days
    .filter(
      (d) => d.date >= todayStr && ['foundation', 'reinforce', 'transfer'].includes(d.phase),
    )
    .map((d) => d.band.preferred - 100);
  assert.deepEqual(easedPreferred, expectedEased);
  s.close();
  s2.close();
});

test('completing a program feeds the derived growth achievement', () => {
  const s = new Store(':memory:');
  s.activate('alice');
  const completed = {
    id: 'done1',
    createdAt: '2026-10-10T00:00:00.000Z',
    duration: 7,
    dailyCount: 6,
    focus: ['动态规划'],
    basis: '',
    days: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-10-${10 + i}`,
      phase: 'reinforce',
      theme: 't',
      focus: ['动态规划'],
      band: { minimum: 1400, maximum: 1700, preferred: 1500 },
      problems: [],
      reasons: {},
      shortage: null,
      estimateMinutes: 0,
    })),
    status: 'completed',
  };
  s.externalPut(programNamespace('alice', ''), 'done1', completed);
  const summary = growthSummary(s);
  assert.equal(summary.counts.programs, 1);
  assert.ok(summary.achievements.find((a) => a.id === 'programs:1')?.unlocked);
  assert.ok(!summary.achievements.find((a) => a.id === 'programs:3')?.unlocked);
  assert.equal(summary.achievements.find((a) => a.id === 'programs:1')?.group, 'programs');
  s.close();
});
