import test from 'node:test';
import assert from 'node:assert/strict';
import {
  experienceRevision,
  readExperienceDraft,
  writeExperienceDraft,
  removeExperienceDraft,
  type ExperienceDraft,
  type DraftStorage,
} from '../src/knowledge-drafts';
import type { ExperienceCard } from '../shared/learning-domain';

const card: ExperienceCard = {
  id: 'card-1',
  kind: 'card',
  createdAt: '2026-10-25T00:00:00.000Z',
  title: '原记录',
  content: '端点与循环不变量',
  knowledgeIds: ['binary-search'],
  confirmed: true,
  edited: true,
  problemKey: '100A',
  sourceHash: 'source-1',
};
const draft = (): ExperienceDraft => ({ version: 1, base: card, card: { ...card, title: '' } });
function memoryStorage() {
  const values = new Map<string, string>();
  const storage: DraftStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { values, storage: () => storage };
}

test('experience edits survive a read including an unfinished empty title, isolated by owner and card', () => {
  const { storage } = memoryStorage();
  assert.equal(writeExperienceDraft(storage, 'cf:a:bc', draft()), '');
  assert.deepEqual(readExperienceDraft(storage, 'cf:a:bc', card.id).draft, draft());
  assert.equal(readExperienceDraft(storage, 'cf:ab:c', card.id).draft, undefined);
  assert.equal(readExperienceDraft(storage, 'cf:a:bc', 'another').draft, undefined);
  assert.equal(removeExperienceDraft(storage, 'cf:a:bc', card.id), '');
  assert.equal(readExperienceDraft(storage, 'cf:a:bc', card.id).draft, undefined);
});

test('damaged or mismatched draft records are rejected without deleting recoverable data', () => {
  const { storage, values } = memoryStorage();
  writeExperienceDraft(storage, 'owner', draft());
  const key = [...values.keys()][0];
  for (const value of ['{bad', JSON.stringify({ ...draft(), card: { ...card, id: 'different' } })]) {
    values.set(key, value);
    const result = readExperienceDraft(storage, 'owner', card.id);
    assert.equal(result.draft, undefined);
    assert.ok(result.error);
    assert.equal(values.get(key), value);
  }
});

test('unavailable or full browser storage is reported instead of pretending edits were persisted', () => {
  const unavailable = (): DraftStorage => {
    throw new Error('denied');
  };
  assert.ok(readExperienceDraft(unavailable, 'owner', card.id).error);
  assert.match(writeExperienceDraft(unavailable, 'owner', draft()), /本地暂存失败/);
  assert.match(removeExperienceDraft(unavailable, 'owner', card.id), /无法清除/);
  const { storage } = memoryStorage();
  storage().setItem = () => {
    throw new Error('quota exceeded');
  };
  assert.match(writeExperienceDraft(storage, 'owner', draft()), /编辑仍保留在本页/);
});

test('revision comparison detects persisted content and source changes without mistaking derived flags for edits', () => {
  assert.equal(experienceRevision(card), experienceRevision({ ...card, edited: false }));
  assert.notEqual(experienceRevision(card), experienceRevision({ ...card, sourceHash: 'source-2' }));
  assert.notEqual(experienceRevision(card), experienceRevision({ ...card, content: '其他设备的新内容' }));
  assert.notEqual(experienceRevision(card), experienceRevision({ ...card, confirmed: false }));
  assert.equal(
    experienceRevision({ ...card, knowledgeIds: ['dp', 'binary-search'] }),
    experienceRevision({ ...card, knowledgeIds: ['binary-search', 'dp'] }),
  );
});
