import { z } from 'zod';
import { knowledgeCards } from './knowledge.js';
import { aiConfigSchema } from './ai-review.js';
import type { CoreStore } from './core-store.js';

// 自定义主题连战：把用户输入的任意主题（如"线段树"）映射为 CF 标签组合。
// 词表限定为 Codeforces 题库真实存在的标签，保证选题过滤器一定能命中。
export const BATTLE_TAG_VOCABULARY = [
  'implementation',
  'math',
  'greedy',
  'dp',
  'data structures',
  'brute force',
  'constructive algorithms',
  'graphs',
  'sortings',
  'binary search',
  'dfs and similar',
  'trees',
  'strings',
  'number theory',
  'combinatorics',
  'two pointers',
  'bitmasks',
  'dsu',
  'shortest paths',
  'divide and conquer',
  'probabilities',
  'hashing',
  'games',
  'flows',
  'interactive',
  'matrices',
  'string suffix structures',
  'segment tree',
  'ternary search',
  'geometry',
  'meet-in-the-middle',
  'string hashing',
  'sweep line',
  'expression parsing',
  'graph matchings',
  '2-sat',
] as const;
export type BattleTag = (typeof BATTLE_TAG_VOCABULARY)[number];
const vocabulary = new Set<string>(BATTLE_TAG_VOCABULARY);
const skillIds = new Set(knowledgeCards.map((c) => c.id));
export interface ThemeMapping {
  tags: BattleTag[];
  skillId: string;
}
// 中文别名词典：未配置 AI 时也能直接开常见主题的连战。
// 顺序即优先级，长词在前避免"树状数组"被"树"抢先。
const aliases: [string, ThemeMapping][] = [
  ['线段树', { tags: ['segment tree'], skillId: 'segment-tree' }],
  ['树状数组', { tags: ['data structures'], skillId: 'segment-tree' }],
  ['单调栈', { tags: ['data structures'], skillId: 'two-pointers' }],
  ['单调队列', { tags: ['data structures'], skillId: 'two-pointers' }],
  ['字符串哈希', { tags: ['string hashing'], skillId: 'string' }],
  ['后缀数组', { tags: ['string suffix structures'], skillId: 'string' }],
  ['后缀结构', { tags: ['string suffix structures'], skillId: 'string' }],
  ['动态规划', { tags: ['dp'], skillId: 'dp' }],
  ['树形dp', { tags: ['dp', 'trees'], skillId: 'dp' }],
  ['状压dp', { tags: ['dp', 'bitmasks'], skillId: 'dp' }],
  ['区间dp', { tags: ['dp'], skillId: 'dp' }],
  ['树上二分', { tags: ['trees', 'binary search'], skillId: 'binary-search' }],
  ['二分答案', { tags: ['binary search'], skillId: 'binary-search' }],
  ['二分查找', { tags: ['binary search'], skillId: 'binary-search' }],
  ['三分', { tags: ['ternary search'], skillId: 'binary-search' }],
  ['双指针', { tags: ['two pointers'], skillId: 'two-pointers' }],
  ['滑动窗口', { tags: ['two pointers'], skillId: 'two-pointers' }],
  ['最短路', { tags: ['shortest paths'], skillId: 'shortest-path' }],
  ['网络流', { tags: ['flows'], skillId: 'shortest-path' }],
  ['图论', { tags: ['graphs'], skillId: 'shortest-path' }],
  ['拓扑', { tags: ['graphs', 'dfs and similar'], skillId: 'shortest-path' }],
  ['并查集', { tags: ['dsu'], skillId: 'dsu' }],
  ['树上问题', { tags: ['trees'], skillId: 'tree' }],
  ['树链', { tags: ['trees', 'data structures'], skillId: 'tree' }],
  ['搜索', { tags: ['dfs and similar'], skillId: 'search' }],
  ['剪枝', { tags: ['brute force'], skillId: 'search' }],
  ['折半搜索', { tags: ['meet-in-the-middle'], skillId: 'search' }],
  ['meet in the middle', { tags: ['meet-in-the-middle'], skillId: 'search' }],
  ['分治', { tags: ['divide and conquer'], skillId: 'divide-conquer' }],
  ['贪心', { tags: ['greedy'], skillId: 'greedy' }],
  ['构造', { tags: ['constructive algorithms'], skillId: 'greedy' }],
  ['博弈论', { tags: ['games'], skillId: 'greedy' }],
  ['博弈', { tags: ['games'], skillId: 'greedy' }],
  ['数论', { tags: ['number theory'], skillId: 'number-theory' }],
  ['同余', { tags: ['number theory'], skillId: 'number-theory' }],
  ['组合计数', { tags: ['combinatorics'], skillId: 'combinatorics' }],
  ['组合数学', { tags: ['combinatorics'], skillId: 'combinatorics' }],
  ['计数', { tags: ['combinatorics'], skillId: 'combinatorics' }],
  ['容斥', { tags: ['combinatorics'], skillId: 'combinatorics' }],
  ['概率', { tags: ['probabilities'], skillId: 'number-theory' }],
  ['期望', { tags: ['probabilities', 'dp'], skillId: 'number-theory' }],
  ['位运算', { tags: ['bitmasks'], skillId: 'dp' }],
  ['矩阵', { tags: ['matrices'], skillId: 'number-theory' }],
  ['几何', { tags: ['geometry'], skillId: 'simulation' }],
  ['计算几何', { tags: ['geometry'], skillId: 'simulation' }],
  ['扫描线', { tags: ['sweep line'], skillId: 'segment-tree' }],
  ['排序', { tags: ['sortings'], skillId: 'simulation' }],
  ['模拟', { tags: ['implementation'], skillId: 'simulation' }],
  ['实现', { tags: ['implementation'], skillId: 'simulation' }],
  ['暴力', { tags: ['brute force'], skillId: 'simulation' }],
  ['交互', { tags: ['interactive'], skillId: 'simulation' }],
  ['哈希', { tags: ['hashing'], skillId: 'string' }],
  ['字符串', { tags: ['strings'], skillId: 'string' }],
  ['前缀和', { tags: ['data structures'], skillId: 'two-pointers' }],
  ['差分', { tags: ['data structures'], skillId: 'two-pointers' }],
  ['区间问题', { tags: ['data structures', 'sortings'], skillId: 'two-pointers' }],
];
const themeAiSchema = z.object({
  tags: z.array(z.string().trim().min(1)).min(1).max(6),
  skillId: z.string().trim().min(1),
});
/** 本地词典命中：返回 null 表示需要 AI 兜底。 */
export function themeMapping(theme: string): ThemeMapping | null {
  const key = theme.trim().toLowerCase();
  if (!key) return null;
  for (const [alias, mapping] of aliases)
    if (key.includes(alias.toLowerCase()) || alias.toLowerCase().includes(key))
      return { tags: mapping.tags.filter((t) => vocabulary.has(t)), skillId: mapping.skillId };
  // 直接输入了英文 CF 标签时按词表原样接受
  if (vocabulary.has(key)) {
    return { tags: [key as BattleTag], skillId: nearestSkill([key as BattleTag]) };
  }
  return null;
}
/** 与标签交集最大的知识卡，作为奖励归因的兜底。 */
export function nearestSkill(tags: string[]): string {
  let best = 'simulation',
    bestOverlap = -1;
  for (const card of knowledgeCards) {
    const overlap = card.tags.filter((t) => tags.includes(t)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = card.id;
    }
  }
  return best;
}
function parseJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 返回内容不是 JSON 对象');
  return JSON.parse(raw.slice(start, end + 1));
}
export const THEME_SYSTEM_PROMPT =
  '你是竞赛训练助手。把用户的训练主题映射为 Codeforces 题库标签。' +
  `只能从这个标签词表中选 1-4 个：${BATTLE_TAG_VOCABULARY.join('、')}。` +
  `同时从这些知识卡中挑出最接近的一张 id：${knowledgeCards.map((c) => c.id).join('、')}。` +
  '仅输出 JSON 对象 {"tags":["..."],"skillId":"..."}，不要输出其他内容。';
export function parseThemeAi(raw: string): ThemeMapping {
  const data = themeAiSchema.parse(parseJson(raw));
  const tags = [...new Set(data.tags.map((t) => t.toLowerCase()))].filter((t) => vocabulary.has(t));
  if (!tags.length) throw new Error('AI 未返回词表内的有效标签');
  const skillId = skillIds.has(data.skillId) ? data.skillId : nearestSkill(tags);
  return { tags: tags as BattleTag[], skillId };
}
export interface ThemeCompleter {
  complete(config: { baseUrl: string; apiKey: string; model: string }, system: string, user: string, maxTokens?: number): Promise<string>;
}
/**
 * 主题映射总入口：先查本地词典（无 AI 也能用），未命中再用 AI 兜底。
 * 两者都失败时抛出可读错误。
 */
export async function mapTheme(
  store: CoreStore,
  ai: ThemeCompleter | null,
  theme: string,
): Promise<ThemeMapping> {
  const local = themeMapping(theme);
  if (local) return local;
  const config = aiConfigSchema.safeParse(store.externalGet('ai', 'config'));
  if (!config.success || !ai) throw new Error('无法识别该主题：请换个说法（如"线段树"），或先在设置中配置 AI 服务');
  try {
    return parseThemeAi(await ai.complete(config.data, THEME_SYSTEM_PROMPT, theme, 500));
  } catch (e) {
    throw new Error(`无法识别该主题：${(e as Error).message}`);
  }
}
