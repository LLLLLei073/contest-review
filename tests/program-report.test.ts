import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgramReport } from '../shared/program-report.js';
import { categoryNames, type MasteryArea } from '../shared/training.js';
import type { Attempt } from '../shared/domain.js';
import type { TrainingProgram } from '../shared/program-domain.js';

const day = (offset: number) => {
  const d = new Date('2026-11-10T12:00:00+08:00');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const program = {
  id: 'p1',
  createdAt: '2026-11-10T00:00:00.000Z',
  duration: 7,
  dailyCount: 6,
  focus: ['动态规划', '图与树'],
  basis: 'test',
  days: Array.from({ length: 7 }, (_, i) => ({
    date: day(i),
    phase: i === 5 ? 'challenge' : 'reinforce',
    theme: `T${i}`,
    focus: ['动态规划'],
    band: { minimum: 1400, maximum: 1700, preferred: 1500 },
    problems: [
      { key: `${9100 + i}:A`, role: 'core' },
      { key: `${9100 + i}:B`, role: 'warmup' },
    ],
    reasons: {},
    shortage: null,
    estimateMinutes: 60,
  })),
  status: 'active',
  baselineMastery: categoryNames.map((name) => ({
    name,
    score: name === '动态规划' ? 50 : 50,
    samples: 10,
  })),
} as unknown as TrainingProgram;
const withoutBaseline = {
  ...program,
  baselineMastery: undefined,
} as unknown as TrainingProgram;
const mastery = (score: number): MasteryArea[] =>
  categoryNames.map((name) => ({
    name,
    score: name === '动态规划' ? score : 50,
    samples: 10,
  }));
const attempt = (id: number, key: string, result: Attempt['result']): Attempt => ({
  id: String(id),
  problemKey: key,
  result,
  minutes: 20,
  note: '',
  createdAt: '2026-11-11T10:00:00.000Z',
});

test('high completion, independence and mastery delta trigger breakthrough findings with valid evidence', () => {
  const accepted = new Map<string, string>();
  for (const d of program.days) for (const p of d.problems) accepted.set(p.key, d.date);
  const attempts: Attempt[] = [];
  for (const d of program.days)
    for (const p of d.problems) attempts.push(attempt(attempts.length + 100, p.key, 'independent'));
  const report = buildProgramReport({
    program,
    acceptedDays: accepted,
    attempts,
    transfers: [],
    simulations: [{ startedAt: day(6) + 'T10:00:00.000Z', solved: 3, total: 6, ended: true }],
    currentMastery: mastery(62),
    today: day(7),
  });
  assert.equal(report.metrics.planned, 14);
  assert.equal(report.metrics.ac, 14);
  assert.equal(report.metrics.completionRate, 1);
  assert.equal(report.metrics.independentRate, 1);
  const titles = report.findings.map((f) => f.title);
  assert.ok(titles.some((t) => t.includes('执行力强')), titles.join('|'));
  assert.ok(titles.some((t) => t.includes('独立攻克')), titles.join('|'));
  assert.ok(titles.some((t) => t.includes('确认突破')), titles.join('|'));
  assert.ok(titles.some((t) => t.includes('模拟赛验证通过')), titles.join('|'));
  assert.ok(report.metrics.challengeAc >= 1);
  assert.equal(report.metrics.simulations.endedCount, 1);
  assert.equal(report.metrics.simulations.solvedAvg, 0.5);
  // 一键续期建议：独立率 100% → 难度 +100；完成率 100% → 题量不变；突破 → 轮换领域。
  assert.equal(report.nextRound.difficultyShift, 100);
  assert.equal(report.nextRound.dailyCountDelta, 0);
  assert.equal(report.nextRound.focus, 'rotate');
  const valid = new Set(report.evidence.map((e) => e.id));
  for (const f of report.findings)
    assert.ok(f.evidenceIds.every((id) => valid.has(id)), `evidence missing: ${f.title}`);
  assert.equal(report.focusDelta.find((d) => d.name === '动态规划')?.before, 50);
  assert.equal(report.focusDelta.find((d) => d.name === '动态规划')?.after, 62);
});

test('low completion and low independence recommend easing, low delta flags limited effect', () => {
  const accepted = new Map<string, string>([
    ['9100:A', day(0)],
    ['9101:A', day(1)],
  ]);
  const attempts = [attempt(1, '9100:A', 'hint'), attempt(2, '9101:A', 'hint')];
  const transfers = [
    { result: 'independent', problemKey: 'x', targetKey: 'y' },
    { result: 'hint', problemKey: 'x', targetKey: 'z' },
  ];
  const report = buildProgramReport({
    program: withoutBaseline,
    acceptedDays: accepted,
    attempts,
    transfers,
    simulations: [],
    currentMastery: mastery(51),
    today: day(7),
  });
  assert.equal(report.metrics.ac, 2);
  assert.equal(report.metrics.completionRate, 2 / 14);
  assert.ok(report.metrics.completionRate < 0.5);
  assert.ok(report.findings.some((f) => f.title.includes('训练量偏大')));
  assert.ok(report.findings.some((f) => f.title.includes('独立解题比例偏低')));
  assert.ok(report.findings.some((f) => f.title.includes('迁移')));
  assert.ok(report.warnings.some((w) => w.includes('掌握度快照')));
  // 一键续期建议：独立率 0（hint）→ 难度不变；完成率低 → 题量 −1；无突破 → 沿用领域。
  assert.equal(report.nextRound.difficultyShift, 0);
  assert.equal(report.nextRound.dailyCountDelta, -1);
  assert.equal(report.nextRound.focus, 'keep');
  const stable = buildProgramReport({
    program: withoutBaseline,
    acceptedDays: accepted,
    attempts,
    transfers,
    simulations: [],
    currentMastery: mastery(51),
    today: day(7),
  });
  assert.equal(stable.fingerprint, report.fingerprint);
  const changed = buildProgramReport({
    program: withoutBaseline,
    acceptedDays: new Map([...accepted, ['9102:A', day(2)]]),
    attempts,
    transfers,
    simulations: [],
    currentMastery: mastery(51),
    today: day(7),
  });
  assert.notEqual(changed.fingerprint, report.fingerprint);
});
