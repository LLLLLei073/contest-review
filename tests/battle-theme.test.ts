import test from 'node:test';
import assert from 'node:assert/strict';
import { themeMapping, nearestSkill } from '../shared/battle-theme.js';
import { knowledgeCards } from '../shared/knowledge.js';

const categoryOf = (skillId: string) => knowledgeCards.find((c) => c.id === skillId)?.category;

test('eight domain names resolve offline with in-category attribution', () => {
  const cases: [string, string, string[]][] = [
    ['实现与模拟', '实现与模拟', ['implementation']],
    ['贪心与构造', '贪心与构造', ['greedy', 'constructive algorithms']],
    ['数据结构', '数据结构', ['data structures']],
    ['图与树', '图与树', ['graphs', 'trees']],
    ['动态规划', '动态规划', ['dp']],
    ['字符串', '字符串', ['strings']],
    ['搜索与技巧', '搜索与技巧', ['dfs and similar', 'brute force']],
    ['数学', '数学', ['math', 'number theory']],
  ];
  for (const [theme, expectedCategory, expectedTags] of cases) {
    const mapping = themeMapping(theme);
    assert.ok(mapping, `${theme} must resolve without AI`);
    assert.equal(categoryOf(mapping.skillId), expectedCategory, `${theme} skill attribution`);
    for (const tag of expectedTags) assert.ok(mapping.tags.includes(tag as never), `${theme} should carry ${tag}`);
  }
});

test('domain names survive the previously conflicting aliases', () => {
  // 「数学」此前被「组合数学」反向匹配抢走；领域条目置前后必须精确命中数学卡。
  const math = themeMapping('数学');
  assert.equal(math?.skillId, 'number-theory');
  // 「字符串」精确命中 string 卡，而非「字符串哈希」链路。
  const string = themeMapping('字符串');
  assert.equal(string?.skillId, 'string');
  assert.deepEqual(string?.tags, ['strings']);
});

test('combined X+Y themes resolve per component with tags clamped to six', () => {
  const combo = themeMapping('数据结构+图与树');
  assert.ok(combo);
  assert.equal(categoryOf(combo.skillId), '数据结构', 'skillId follows the first component');
  assert.deepEqual([...combo.tags].sort(), ['binary search', 'data structures', 'graphs', 'trees']);
  assert.ok(combo.tags.length <= 6, 'tags must respect the battle session limit');
  const mixed = themeMapping('数学+动态规划');
  assert.ok(mixed);
  assert.equal(categoryOf(mixed.skillId), '数学');
  assert.ok(mixed.tags.includes('dp' as never) && mixed.tags.includes('math' as never));
  // 普通主题 + 领域名混合组件也走通。
  const cross = themeMapping('线段树+贪心与构造');
  assert.ok(cross);
  assert.ok(cross.tags.includes('segment tree' as never));
  assert.ok(cross.tags.includes('greedy' as never));
  assert.ok(cross.tags.length <= 6);
});

test('unknown themes still fall through to AI and vocabulary pass-through works', () => {
  assert.equal(themeMapping('量子纠缠算法'), null);
  assert.equal(themeMapping(''), null);
  const raw = themeMapping('segment tree');
  assert.ok(raw);
  assert.deepEqual(raw.tags, ['segment tree']);
  assert.equal(nearestSkill(['segment tree']), 'segment-tree');
});

test('plain aliases keep their original behavior after reordering', () => {
  assert.equal(themeMapping('线段树')?.skillId, 'segment-tree');
  assert.equal(themeMapping('组合数学')?.skillId, 'combinatorics');
  assert.equal(themeMapping('树形dp')?.skillId, 'dp');
  assert.equal(themeMapping('并查集')?.skillId, 'dsu');
});
