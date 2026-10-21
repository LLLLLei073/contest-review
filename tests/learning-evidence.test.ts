import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learningEvidence } from '../shared/learning-evidence';
import { emptyReview } from '../shared/domain';
import { bundleSchema, cardSchema } from '../shared/learning-domain';
test('evidence preserves real timestamps and does not fabricate verification or reflection completion', () => {
  const bundle = bundleSchema.parse({
    id: 'b',
    kind: 'bundle',
    createdAt: '2026-10-10T00:00:00Z',
    problemKey: '1:A',
    language: 'cpp',
    code: 'x',
    codeHash: 'h',
    oracle: 'x',
    generator: 'x',
    reports: [
      {
        format: 'contest-review-stress',
        version: 1,
        bundleId: 'b',
        codeHash: 'h',
        seed: 7,
        rounds: 3,
        status: 'passed',
        round: 3,
      },
    ],
  });
  const card = cardSchema.parse({
    id: 'c',
    kind: 'card',
    createdAt: '2026-10-10T00:00:00Z',
    problemKey: '1:A',
    title: 'Card',
    content: 'Draft',
    knowledgeIds: [],
    sourceHash: 'h',
  });
  const input = {
    problemKey: '1:A',
    submissions: [],
    attempts: [],
    review: emptyReview(),
    records: [bundle, card],
  };
  const evidence = learningEvidence(input);
  assert.equal(evidence.length, 3);
  assert.equal(evidence.at(-1)!.at, null);
  assert.equal(evidence.find((e) => e.id === 'card:c')!.status, 'draft');
  assert.equal(
    evidence.some((e) => e.kind === 'reflection'),
    false,
  );
  assert.deepEqual(learningEvidence({ ...input, records: input.records.slice().reverse() }), evidence);
  assert.equal(learningEvidence({ ...input, problemKey: '2:B' }).length, 0);
});
