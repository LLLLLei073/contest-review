import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizePlan, estimateMinutes, type PlanCandidate } from '../shared/plan-optimizer';
const candidate = (key: string, extra: Partial<PlanCandidate> = {}): PlanCandidate => ({
  key,
  lane: 'new',
  minutes: 20,
  utility: 10,
  goal: false,
  required: false,
  reason: 'test',
  ...extra,
});
test('budget DP agrees with exhaustive optimum over small random inputs', () => {
  let seed = 4107;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let example = 0; example < 120; example++) {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      candidate(String(i), {
        lane: random() < 0.4 ? 'review' : 'new',
        minutes: 1 + Math.floor(random() * 30),
        utility: 1 + Math.floor(random() * 50),
        goal: random() < 0.5,
        required: random() < 0.12,
      }),
    );
    const budget = 15 + Math.floor(random() * 100),
      quota = Math.min(2, candidates.filter((c) => c.lane === 'new' && c.goal).length);
    let optimal = -1;
    for (let mask = 0; mask < 1 << candidates.length; mask++) {
      const selected = candidates.filter((_, i) => mask & (1 << i));
      if (candidates.some((c) => c.required && !selected.includes(c))) continue;
      if (
        selected.filter((c) => c.lane === 'new').length > 5 ||
        selected.filter((c) => c.lane === 'review').length > 5
      )
        continue;
      if (selected.filter((c) => c.lane === 'new' && c.goal).length < quota) continue;
      if (selected.reduce((s, c) => s + Math.ceil(c.minutes / 5) * 5, 0) > budget) continue;
      optimal = Math.max(
        optimal,
        selected.reduce((s, c) => s + c.utility, 0),
      );
    }
    const result = optimizePlan({ candidates, budget });
    assert.equal(result.feasible, optimal >= 0, `example ${example}`);
    if (result.feasible) assert.equal(result.utility, optimal, `example ${example}`);
    assert.deepEqual(optimizePlan({ candidates: candidates.slice().reverse(), budget }), result);
  }
});
test('mandatory tasks are counted once and conflicts return the minimum required time', () => {
  const a = candidate('a', { required: true, goal: true, minutes: 21 });
  const b = candidate('b', { goal: true, minutes: 11 });
  const result = optimizePlan({ candidates: [a, a, b], budget: 30 });
  assert.equal(result.feasible, false);
  assert.equal(result.minimumMinutes, 40);
  assert.equal(result.selected.length, 0);
  assert.equal(optimizePlan({ candidates: [a, a, b], budget: 40 }).selected.length, 2);
  assert.throws(() => optimizePlan({ candidates: [a, { ...a, minutes: 90 }] }));
  assert.equal(
    optimizePlan({
      candidates: Array.from({ length: 6 }, (_, i) => candidate(String(i), { required: true })),
    }).feasible,
    false,
  );
});
test('candidate cap retains low-ranked mandatory tasks and quota witnesses; no budget still enforces lane counts', () => {
  const candidates = Array.from({ length: 150 }, (_, i) =>
    candidate(String(i), { utility: i, goal: i < 2, required: i === 2 }),
  );
  const result = optimizePlan({ candidates });
  assert.equal(result.consideredCount, 80);
  assert.equal(result.truncated, true);
  assert.equal(result.selected.length, 5);
  for (const key of ['0', '1', '2']) assert.ok(result.selected.some((c) => c.key === key));
  assert.equal(estimateMinutes([0, NaN, -1, 10, 20], 'new').minutes, 35);
  assert.equal(estimateMinutes([10, 20, 30, 40], 'review').minutes, 25);
});
