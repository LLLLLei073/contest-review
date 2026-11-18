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
// 顺序即优先级：八大领域名放最前（精确命中优先于子串反向匹配，
// 避免「数学」被旧词条「组合数学」反向抢走），其后长词在前避免"树状数组"被"树"抢先。
const aliases: [string, ThemeMapping][] = [
  // 八大领域名（长期计划「按焦点开连战」直接传领域名或 X+Y 组合）。
  // skillId 固定取本领域的知识卡，保证连战奖励计入同领域的掌握度。
  ['实现与模拟', { tags: ['implementation'], skillId: 'simulation' }],
  ['贪心与构造', { tags: ['greedy', 'constructive algorithms'], skillId: 'greedy' }],
  ['数据结构', { tags: ['data structures', 'binary search'], skillId: 'segment-tree' }],
  ['图与树', { tags: ['graphs', 'trees'], skillId: 'dsu' }],
  ['动态规划', { tags: ['dp'], skillId: 'dp' }],
  ['字符串', { tags: ['strings'], skillId: 'string' }],
  ['搜索与技巧', { tags: ['dfs and similar', 'brute force'], skillId: 'search' }],
  ['数学', { tags: ['math', 'number theory'], skillId: 'number-theory' }],
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
// 领域名用于组合串「X+Y」的逐组件解析；skillId 取第一个可解析组件的领域卡。
const domainAliases = [
  '实现与模拟',
  '贪心与构造',
  '数据结构',
  '图与树',
  '动态规划',
  '字符串',
  '搜索与技巧',
  '数学',
] as const;
const domainMap = new Map(
  aliases
    .filter(([alias]) => (domainAliases as readonly string[]).includes(alias))
    .map(([alias, mapping]) => [alias, mapping]),
);
const clampTags = (tags: string[]): ThemeMapping['tags'] =>
  [...new Set(tags)].filter((t) => vocabulary.has(t)).slice(0, 6) as ThemeMapping['tags'];
const themeAiSchema = z.object({
  tags: z.array(z.string().trim().min(1)).min(1).max(6),
  skillId: z.string().trim().min(1),
});
/** 本地词典命中：返回 null 表示需要 AI 兜底。支持「X+Y」组合（按任一组件解析，tags 并集截 6）。 */
export function themeMapping(theme: string): ThemeMapping | null {
  const key = theme.trim().toLowerCase();
  if (!key) return null;
  // 领域名只做精确命中（key 即领域名，或组件级拆分），避免反向子串把
  // 「组合数学」这类普通长词抢到领域卡上。
  const exactDomain = domainAliases.find((alias) => key === alias.toLowerCase());
  if (exactDomain) {
    const mapping = domainMap.get(exactDomain)!;
    return { tags: mapping.tags.filter((t) => vocabulary.has(t)), skillId: mapping.skillId };
  }
  if (key.includes('+')) {
    const parts = key
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean);
    // 逐组件先查领域词典再退普通词典；skillId 取第一个可解析组件（奖励归因只承载一张卡）。
    const hits: { tags: string[]; skillId?: string }[] = [];
    for (const part of parts) {
      const domain = domainAliases.find((alias) => part === alias.toLowerCase());
      const mapping = domain ? domainMap.get(domain) : undefined;
      if (mapping) hits.push({ tags: mapping.tags, skillId: mapping.skillId });
      else {
        for (const [alias, single] of aliases) {
          if (part.includes(alias.toLowerCase()) || alias.toLowerCase().includes(part)) {
            hits.push({ tags: single.tags, skillId: single.skillId });
            break;
          }
        }
      }
    }
    if (hits.length) {
      const tags = clampTags(hits.flatMap((hit) => hit.tags));
      if (tags.length) {
        const skillId = hits.find((hit) => hit.skillId)?.skillId ?? nearestSkill(tags);
        return { tags, skillId };
      }
    }
  }
  // 普通词条子串匹配（领域名已由上方精确分支处理，此处跳过防反向抢匹配）。
  const domainSet = new Set<string>(domainAliases);
  for (const [alias, mapping] of aliases)
    if (!domainSet.has(alias) && (key.includes(alias.toLowerCase()) || alias.toLowerCase().includes(key)))
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
