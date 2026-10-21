import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProblemFilters,
  serializeProblemFilters,
  problemReturnLocation,
} from '../shared/problem-filters';
test('all notebook filters and pagination round-trip through a stable URL', () => {
  const input = {
    q: '边界 2000',
    source: 'atcoder',
    tag: '动态规划',
    reason: '边界',
    status: 'reviewing',
    solved: 'no',
    ignored: 'yes',
    min: '800',
    max: '1600',
    due: 'yes',
    contestId: '2000',
    page: '3',
  };
  const parsed = parseProblemFilters(input);
  assert.deepEqual(serializeProblemFilters(parsed.filters, parsed.page), input);
  assert.deepEqual(parseProblemFilters(serializeProblemFilters(parsed.filters, parsed.page)), parsed);
});
test('invalid, repeated and unsafe values normalize without producing API validation errors', () => {
  const { filters, page } = parseProblemFilters({
    source: 'bad',
    status: ['pending'],
    due: 'no',
    page: '-2',
    min: '2000',
    max: '1000',
    contestId: 'Infinity',
    q: '  query  ',
  });
  assert.equal(filters.source, 'all');
  assert.equal(filters.status, '');
  assert.equal(filters.due, '');
  assert.equal(page, 1);
  assert.equal(filters.min, '1000');
  assert.equal(filters.max, '2000');
  assert.equal(filters.contestId, '');
  assert.equal(filters.q, 'query');
  assert.equal(parseProblemFilters({ min: 1700 }).filters.min, '1700');
  assert.equal(problemReturnLocation('//external.test'), '/problems');
  assert.equal(problemReturnLocation('/problems-evil?x=1'), '/problems');
  assert.equal(
    problemReturnLocation('/problems?page=3&source=cf&ignored=no&unsafe=yes'),
    '/problems?source=cf&page=3',
  );
});
