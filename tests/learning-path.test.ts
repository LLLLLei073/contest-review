import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningPath } from '../shared/learning-path';
import { knowledgeCards } from '../shared/knowledge';
test('built-in graph is valid and every prerequisite appears before its dependent', () => {
  const path = buildLearningPath(
    knowledgeCards,
    knowledgeCards.map((c) => c.id),
  );
  assert.equal(path.valid, true);
  assert.equal(path.nodes.length, knowledgeCards.length);
  path.nodes.forEach((n, i) =>
    n.prerequisites.forEach((p) => assert.ok(path.nodes.findIndex((x) => x.id === p) < i)),
  );
});
test('AND dependencies all survive; input ordering does not affect path and no probability implies verification', () => {
  const cards = [
    { id: 'end', title: 'Target', prerequisites: ['a', 'b'] },
    { id: 'a', title: 'A', prerequisites: [] },
    { id: 'b', title: 'B', prerequisites: [] },
  ];
  const path = buildLearningPath(cards, ['end']);
  assert.deepEqual(path, buildLearningPath(cards.slice().reverse(), ['end']));
  assert.deepEqual(
    path.nodes.map((n) => n.id),
    ['a', 'b', 'end'],
  );
  assert.equal(path.nodes[2].ready, false);
  assert.equal(path.next, 'a');
  assert.equal(path.nodes[0].estimatedMinutes, 105);
  assert.equal(
    buildLearningPath(
      cards,
      ['end'],
      [
        {
          skillId: 'a',
          probability: 1,
          samples: 0,
          distinctProblems: 0,
          insufficient: true,
          independentProblems: 0,
          evidenceIds: [],
          lastEvidenceAt: null,
        },
      ],
    ).nodes.find((n) => n.id === 'a')!.verified,
    false,
  );
});
test('cycles, dangling prerequisites, unknown targets and duplicate IDs produce actionable diagnostics', () => {
  const path = buildLearningPath(
    [
      { id: 'a', title: 'A', prerequisites: ['b'] },
      { id: 'b', title: 'B', prerequisites: ['a', 'missing'] },
    ],
    ['a', 'unknown'],
  );
  assert.equal(path.valid, false);
  assert.equal(path.next, null);
  assert.deepEqual(new Set(path.issues.map((i) => i.kind)), new Set(['unknown-target', 'dangling', 'cycle']));
  assert.equal(buildLearningPath([{ id: 'a', title: 'A', prerequisites: [] }], ['a']).nodes.length, 1);
  assert.equal(
    buildLearningPath(
      [
        { id: 'a', title: 'A', prerequisites: [] },
        { id: 'a', title: 'A', prerequisites: [] },
      ],
      ['a'],
    ).valid,
    false,
  );
});
