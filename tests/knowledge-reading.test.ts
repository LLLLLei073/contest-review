import test from 'node:test';
import assert from 'node:assert/strict';
import {
  knowledgeReadingKey,
  normalizeKnowledgeReading,
  readKnowledgeReading,
  rememberKnowledgeReading,
  toggleKnowledgeFavorite,
  writeKnowledgeReading,
  type ReadingStorage,
} from '../src/knowledge-reading.js';

const validIds = ['binary', 'dp', 'graph', 'string', 'greedy', 'math', 'tree', 'window'];
function memoryStorage(): ReadingStorage {
  const records = new Map<string, string>();
  return {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => void records.set(key, value),
  };
}

test('knowledge reading rejects invalid IDs, removes duplicates and bounds recent entries', () => {
  assert.deepEqual(normalizeKnowledgeReading(null, validIds), { favorites: [], recent: [] });
  assert.deepEqual(
    normalizeKnowledgeReading(
      { favorites: ['binary', 'deleted', 'binary', 3, null, 'dp'], recent: [...validIds, 'binary'] },
      validIds,
    ),
    { favorites: ['binary', 'dp'], recent: validIds.slice(0, 6) },
  );
  assert.deepEqual(normalizeKnowledgeReading({ favorites: {}, recent: 'binary' }, validIds), {
    favorites: [],
    recent: [],
  });
});

test('reading visits move to the front without duplicates and favorite updates are immutable', () => {
  const initial = { favorites: ['binary'], recent: validIds.slice(0, 6) };
  const visited = rememberKnowledgeReading(initial, 'tree');
  assert.deepEqual(visited.recent, ['tree', ...validIds.slice(0, 5)]);
  assert.deepEqual(rememberKnowledgeReading(visited, 'binary').recent, [
    'binary',
    'tree',
    'dp',
    'graph',
    'string',
    'greedy',
  ]);
  assert.deepEqual(toggleKnowledgeFavorite(initial, 'binary').favorites, []);
  assert.deepEqual(toggleKnowledgeFavorite(initial, 'dp').favorites, ['binary', 'dp']);
  assert.deepEqual(initial, { favorites: ['binary'], recent: validIds.slice(0, 6) });
});

test('reading data survives reload with exact account isolation and validated IDs', () => {
  const storage = memoryStorage();
  const a = 'cf:Alice:at:one';
  const b = 'cf:Alice:at:two';
  assert.notEqual(knowledgeReadingKey(a), knowledgeReadingKey(b));
  assert.notEqual(knowledgeReadingKey('a:b'), knowledgeReadingKey('a%3Ab'));
  assert.equal(
    writeKnowledgeReading(a, { favorites: ['binary', 'deleted'], recent: ['dp'] }, validIds, storage),
    '',
  );
  assert.deepEqual(readKnowledgeReading(a, validIds, storage), {
    value: { favorites: ['binary'], recent: ['dp'] },
    warning: '',
  });
  assert.deepEqual(readKnowledgeReading(b, validIds, storage), {
    value: { favorites: [], recent: [] },
    warning: '',
  });
  assert.deepEqual(readKnowledgeReading(a, ['dp'], storage).value, {
    favorites: [],
    recent: ['dp'],
  });
});

test('corrupt or unsupported reading data falls back safely with an explanation', () => {
  const storage = memoryStorage();
  for (const raw of ['{', JSON.stringify({ version: 2, favorites: [], recent: [] }), 'x'.repeat(64001)]) {
    storage.setItem(knowledgeReadingKey('owner'), raw);
    const result = readKnowledgeReading('owner', validIds, storage);
    assert.deepEqual(result.value, { favorites: [], recent: [] });
    assert.match(result.warning, /无法识别/);
  }
});

test('unavailable or full browser storage reports failure without throwing or changing local reading state', () => {
  const value = { favorites: ['binary'], recent: ['dp'] };
  const storage: ReadingStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.match(readKnowledgeReading('owner', validIds, storage).warning, /当前页面保留/);
  assert.match(readKnowledgeReading('owner', validIds).warning, /当前页面保留/);
  assert.match(writeKnowledgeReading('owner', value, validIds, storage), /当前页面保留/);
  assert.match(writeKnowledgeReading('owner', value, validIds), /当前页面保留/);
  assert.deepEqual(value, { favorites: ['binary'], recent: ['dp'] });
});
