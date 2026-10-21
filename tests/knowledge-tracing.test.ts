import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceKnowledge, updateKnowledge, type KnowledgeObservation } from '../shared/knowledge-tracing';
const at = '2026-10-18T00:00:00Z';
const observation = (id: string, extra: Partial<KnowledgeObservation> = {}): KnowledgeObservation => ({
  id,
  problemKey: id,
  session: 'one',
  at,
  skillIds: ['dp'],
  result: 'independent',
  accepted: true,
  assisted: false,
  ...extra,
});
test('BKT matches hand calculation and handles extreme and invalid parameters', () => {
  assert.ok(Math.abs(updateKnowledge(0.2, true) - (0.18 / 0.34 + (1 - 0.18 / 0.34) * 0.05)) < 1e-12);
  assert.ok(Math.abs(updateKnowledge(0.2, false) - (0.02 / 0.66 + (1 - 0.02 / 0.66) * 0.05)) < 1e-12);
  assert.equal(updateKnowledge(0, true, { initial: 0, learn: 0, guess: 0, slip: 0 }), 0);
  assert.equal(updateKnowledge(1, false, { initial: 1, learn: 0, guess: 0, slip: 0 }), 1);
  assert.throws(() => updateKnowledge(NaN, true));
  assert.throws(() => updateKnowledge(0.5, true, { initial: 0.2, learn: 2, guess: 0, slip: 0 }));
});
test('credible independent evidence is chronological, unique and never spread across ambiguous skills', () => {
  const observations = [
    observation('a'),
    observation('b'),
    observation('c'),
    observation('mixed', { skillIds: ['dp', 'graphs'] }),
    observation('hint', { result: 'hint' }),
    observation('raw', { result: 'accepted' }),
    observation('unknown', { skillIds: ['mystery'] }),
    observation('future', { at: '2026-10-19T00:00:00Z' }),
    observation('invalid', { at: 'no-date' }),
    observation('old', {
      problemKey: 'repeat',
      at: '2026-10-17T00:00:00Z',
      result: 'failed',
      accepted: false,
    }),
    observation('new', { problemKey: 'repeat', assisted: true }),
  ];
  const traced = traceKnowledge(['dp', 'graphs'], observations, at);
  assert.deepEqual(traceKnowledge(['dp', 'graphs'], observations.slice().reverse(), at), traced);
  const dp = traced.states.find((s) => s.skillId === 'dp')!;
  assert.equal(dp.samples, 3);
  assert.equal(dp.insufficient, false);
  assert.equal(dp.independentProblems, 3);
  assert.equal(traced.states.find((s) => s.skillId === 'graphs')!.samples, 0);
  assert.deepEqual(
    new Set(traced.excluded.map((e) => e.reason)),
    new Set(['mixed', 'assisted', 'unverified', 'unmapped', 'future', 'invalid-time', 'duplicate']),
  );
});
test('multiple sessions on one problem are not three independent problem samples; failure removes current verification', () => {
  const traced = traceKnowledge(
    ['dp'],
    [
      observation('a', { problemKey: 'same' }),
      observation('b', { problemKey: 'same', session: 'two' }),
      observation('c', { problemKey: 'same', session: 'three', result: 'failed', accepted: false }),
    ],
    at,
  );
  assert.equal(traced.states[0].samples, 3);
  assert.equal(traced.states[0].distinctProblems, 1);
  assert.equal(traced.states[0].insufficient, true);
  assert.equal(traced.states[0].independentProblems, 0);
  assert.equal(
    traceKnowledge(
      ['dp'],
      [observation('assigned', { skillIds: ['dp', 'graphs'], attributedSkillId: 'dp' })],
      at,
    ).states[0].samples,
    1,
  );
});
