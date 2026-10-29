import test from 'node:test';
import assert from 'node:assert/strict';
import { filterKnowledgeGraph, type KnowledgeGraphFilters } from '../shared/knowledge-graph.js';

const graph = {
  nodes: [
    { id: 'knowledge:simulation', label: '实现与模拟', kind: 'knowledge', category: '基础算法' },
    { id: 'knowledge:binary-search', label: '二分答案', kind: 'knowledge', category: '数据结构' },
    { id: 'knowledge:dp', label: '动态规划', kind: 'knowledge', category: '动态规划' },
    { id: 'problem:123A', label: '边界检查', kind: 'problem', category: '数据结构' },
    { id: 'experience:one', label: '边界笔记', kind: 'experience', category: '' },
  ],
  edges: [
    { from: 'knowledge:simulation', to: 'knowledge:binary-search', relation: '前置知识' },
    { from: 'knowledge:simulation', to: 'knowledge:dp', relation: '前置知识' },
    { from: 'problem:123A', to: 'knowledge:binary-search', relation: '涉及算法' },
    { from: 'experience:one', to: 'problem:123A', relation: '对应经验' },
    { from: 'experience:one', to: 'problem:deleted', relation: '已失效来源' },
  ],
};
const filters: KnowledgeGraphFilters = { focus: '', query: '', category: 'all', kind: 'all' };
const select = (changes: Partial<KnowledgeGraphFilters>) =>
  filterKnowledgeGraph(graph, { ...filters, ...changes });

test('graph searches knowledge aliases, tags and categories with the library normalization rules', () => {
  assert.deepEqual(
    select({ query: '  ＢＩＮＡＲＹ　ＳＥＡＲＣＨ ' }).nodes.map((node) => node.id),
    ['knowledge:binary-search'],
  );
  assert.deepEqual(
    select({ query: '二分 数据结构' }).nodes.map((node) => node.id),
    ['knowledge:binary-search'],
  );
  assert.deepEqual(select({ query: '二分 dp' }).nodes, []);
  assert.deepEqual(
    select({ query: '１２３ａ 边界' }).nodes.map((node) => node.id),
    ['problem:123A'],
  );
  assert.equal(select({ query: ' 　\n' }).nodes.length, graph.nodes.length);
});

test('neighborhood search stays scoped and leaving it preserves the same query and filters', () => {
  const scoped = { focus: 'knowledge:binary-search', query: 'dp', kind: 'knowledge' };
  assert.deepEqual(select(scoped).nodes, []);
  assert.deepEqual(
    select({ ...scoped, focus: '' }).nodes.map((node) => node.id),
    ['knowledge:dp'],
  );
  assert.deepEqual(
    select({ focus: 'knowledge:binary-search' }).nodes.map((node) => node.id),
    ['knowledge:binary-search', 'knowledge:simulation', 'problem:123A'],
  );
});

test('the relation list only contains edges between matching visible nodes', () => {
  const structural = select({ category: '数据结构' });
  assert.deepEqual(
    structural.nodes.map((node) => node.id),
    ['knowledge:binary-search', 'problem:123A'],
  );
  assert.deepEqual(structural.edges, [graph.edges[2]]);
  assert.equal(select({ kind: 'knowledge' }).edges.length, 2);
  assert.deepEqual(select({ query: '不存在' }).edges, []);
  assert.equal(select({}).edges.length, 4, 'exclude edges whose source or target no longer exists');
});
