import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTrainingAction } from '../shared/workbench.js';
import type { TrainingDay, TrainingTask } from '../shared/training.js';

const task = (key: string, extra: Partial<TrainingTask> = {}): TrainingTask => ({
  key,
  name: key,
  url: `https://example.com/${key}`,
  rating: 1200,
  tags: [],
  kind: 'due',
  phase: 'redo',
  redoAccepted: false,
  completed: false,
  attempted: false,
  nextReview: null,
  ...extra,
});
const day = (review: TrainingTask[] = [], newProblems: TrainingTask[] = []): TrainingDay => ({
  date: '2026-10-18',
  review,
  newProblems,
  catalogFetchedAt: null,
  recentCheckedAt: null,
  catalogCount: 0,
  mastery: [],
  weeklyGoal: { week: '2026-10-12', mode: 'focus', categories: ['数学'] },
});
const cf = { cf: true, atcoder: false };

test('next action prioritizes incomplete evaluation, reflection, overdue and saved order without mutation', () => {
  const input = day(
    [
      task('regular'),
      task('overdue', { nextReview: '2026-10-15T00:00:00Z' }),
      task('reflection', { phase: 'reflection' }),
      task('evaluation', { phase: 'evaluation', redoAccepted: true }),
      task('completed', { phase: 'evaluation', completed: true }),
    ],
    [task('new', { kind: 'new' })],
  );
  const snapshot = structuredClone(input);
  assert.equal(nextTrainingAction(input, cf)?.taskKey, 'evaluation');
  assert.match(nextTrainingAction(input, cf)!.href!, /focus=evaluation/);
  assert.deepEqual(input, snapshot);
  input.review[3].completed = true;
  assert.equal(nextTrainingAction(input, cf)?.taskKey, 'reflection');
  input.review[2].completed = true;
  assert.equal(nextTrainingAction(input, cf)?.taskKey, 'overdue');
  input.review[1].completed = true;
  assert.equal(nextTrainingAction(input, cf)?.taskKey, 'regular');
  input.review[0].completed = true;
  assert.equal(nextTrainingAction(input, cf)?.taskKey, 'new');
});

test('missing account, loading, weekly goal, shortages and genuine completion remain distinct', () => {
  assert.equal(nextTrainingAction(null, { cf: false, atcoder: false })?.kind, 'account');
  assert.equal(nextTrainingAction(null, cf), null);
  const input = day();
  input.weeklyGoal = null;
  assert.equal(nextTrainingAction(input, cf)?.kind, 'goal');
  assert.equal(nextTrainingAction(input, { cf: false, atcoder: true })?.kind, 'shortage');
  input.review = [task('only', { completed: true, phase: 'done' })];
  assert.equal(nextTrainingAction(input, { cf: false, atcoder: true })?.kind, 'complete');
  input.review = [task('only')];
  assert.equal(nextTrainingAction(input, cf)?.kind, 'review');
});
