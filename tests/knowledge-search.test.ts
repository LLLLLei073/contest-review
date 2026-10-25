import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { LearningService } from '../shared/learning-service.js';
import { fingerprint } from '../shared/learning-domain.js';
import {
  matchesKnowledgeQuery,
  normalizeKnowledgeQuery,
  searchDocuments,
  type SearchDocument,
} from '../shared/knowledge.js';

const document = (id: string, title: string, content: string, aliases: string[] = []): SearchDocument => ({
  id,
  title,
  content,
  aliases,
  url: '/knowledge?card=' + id,
  excerpt: '',
  fingerprint: fingerprint(content),
});

test('knowledge filters normalize both query and documents and require every space-separated word', () => {
  assert.equal(normalizeKnowledgeQuery('  Ｂｉｎａｒｙ\tＳＥＡＲＣＨ\n  '), 'binary search');
  assert.ok(matchesKnowledgeQuery('二分答案：检查边界', ' 二分　 边界 '));
  assert.ok(matchesKnowledgeQuery('区间维护', ' BINARY\n SEARCH ', ['Ｂｉｎａｒｙ Ｓｅａｒｃｈ']));
  assert.ok(matchesKnowledgeQuery('区间维护', '维护 DATA', ['data structures']));
  assert.ok(matchesKnowledgeQuery('动态规划', '   '));
  assert.equal(matchesKnowledgeQuery('二分答案', '二分 边界'), false);
  assert.equal(matchesKnowledgeQuery('动态规划', 'binary search'), false);
});

test('retrieval normalizes document fields, keeps original citations and prioritizes query coverage', () => {
  const partial = document('partial', 'ＢＩＮＡＲＹ SEARCH', '只涉及基础概念', ['binary search', '二分']),
    complete = document('complete', 'Ｂｉｎａｒｙ', '检查\tＢＯＵＮＤＡＲＹ');
  const results = searchDocuments([partial, complete], '  binary\n boundary ');
  assert.equal(results[0].id, 'complete');
  assert.equal(results[0].fingerprint, fingerprint(complete.content));
  assert.equal(results[0].excerpt, complete.content);
  assert.ok(results.some((result) => result.id === 'partial'));
  assert.equal(searchDocuments([complete], 'ＢＩＮＡＲＹ　ＢＯＵＮＤＡＲＹ')[0].id, 'complete');
  assert.deepEqual(searchDocuments([complete], '   '), []);
});

test('retrieval retains knowledge alias expansion and Chinese query token fallback', () => {
  const translated = document('translated', '单调谓词', '单调性证明'),
    boundary = document('boundary', '检查记录', '边界遗漏');
  assert.ok(
    searchDocuments([translated], 'ＢＩＮＡＲＹ ＳＥＡＲＣＨ').some((result) => result.id === 'translated'),
  );
  assert.ok(searchDocuments([boundary], '二分边界').some((result) => result.id === 'boundary'));
});

test('confirmed experience inherits knowledge aliases and domains while drafts and stale sources stay excluded', async () => {
  const store = new Store(':memory:');
  try {
    store.activate('knowledge_search');
    const key = store.manualProblem('knowledge_search', {
      contestId: 4200,
      index: 'A',
      name: '一份个人记录',
      tags: ['binary search'],
      rating: 1000,
    });
    store.saveReview('knowledge_search', key, {
      ...store.review('knowledge_search', key),
      solution: '认真检查端点并写出循环不变量',
    });
    const service = new LearningService(store);
    const draft = await service.draft({ problemKey: key });
    const id = 'experience:' + draft.id;
    assert.equal(
      service.documents().some((doc) => doc.id === id),
      false,
    );
    await service.editCard({ ...draft, confirmed: true });
    const experience = service.documents().find((doc) => doc.id === id)!;
    assert.ok(experience);
    assert.equal(experience.content.includes('二分'), false);
    assert.ok(service.search('二分').some((result) => result.id === id));
    assert.ok(service.search('BINARY SEARCH').some((result) => result.id === id));
    assert.ok(service.search('数据结构').some((result) => result.id === id));
    assert.ok(
      service
        .documents()
        .find((doc) => doc.id === 'knowledge:binary-search')
        ?.aliases.includes('数据结构'),
    );
    store.saveReview('knowledge_search', key, {
      ...store.review('knowledge_search', key),
      solution: '原始来源已修改',
    });
    assert.equal(
      service.documents().some((doc) => doc.id === id),
      false,
    );
    assert.equal(
      service.search('二分').some((result) => result.id === id),
      false,
    );
  } finally {
    store.close();
  }
});
