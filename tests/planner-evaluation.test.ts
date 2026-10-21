import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateKnowledgePredictions } from '../shared/planner-evaluation';
import type { KnowledgeObservation } from '../shared/knowledge-tracing';
test('prediction replay never sees later or simultaneous outcomes and keeps insufficient calibration explicit', () => {
  const observations: KnowledgeObservation[] = Array.from({ length: 4 }, (_, i) => ({
    id: String(i),
    problemKey: String(i),
    session: String(i),
    at: `2026-10-${10 + i}T00:00:00Z`,
    skillIds: ['dp'],
    result: 'independent',
    accepted: true,
    assisted: false,
  }));
  const first = evaluateKnowledgePredictions(observations, ['dp'], '2026-10-11T00:00:00Z');
  assert.equal(first.samples, 2);
  assert.equal(first.rows[0].priorSamples, 0);
  assert.ok(Math.abs(first.rows[0].probability - 0.34) < 1e-12);
  assert.equal(first.rows[1].priorSamples, 1);
  assert.equal(first.insufficient, true);
  observations[3].result = 'failed';
  assert.deepEqual(evaluateKnowledgePredictions(observations, ['dp'], '2026-10-11T00:00:00Z'), first);
  observations[1].at = observations[0].at;
  assert.equal(
    evaluateKnowledgePredictions(observations, ['dp'], '2026-10-11T00:00:00Z').rows[1].priorSamples,
    0,
  );
});
