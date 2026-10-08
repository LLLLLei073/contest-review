import { categoryNames, type CategoryName } from './training.js';
import { fingerprint, type Citation } from './learning-domain.js';

export interface KnowledgeCard {
  id: string;
  title: string;
  category: CategoryName;
  aliases: string[];
  tags: string[];
  prerequisites: string[];
  content: string;
}
const entries: [string, string, number, string[], string[], string[], string][] = [
  [
    'simulation',
    '实现与模拟',
    0,
    ['implementation', '模拟', '边界', '溢出'],
    ['implementation', 'brute force'],
    [],
    '按题意维护状态，明确循环不变量与下标范围。复杂度取决于操作次数；避免每轮全量扫描。检查空集合、单元素、最大值、整型溢出与多测状态清理。',
  ],
  [
    'two-pointers',
    '双指针',
    0,
    ['two pointers', '滑动窗口'],
    ['two pointers'],
    ['simulation'],
    '适用于区间端点移动具有单调性的场景。两端点各移动至多 n 次时 O(n)，维护状态占 O(1) 或 O(n) 空间。先证明窗口合法性随端点移动的变化，负数可能破坏和的单调性。',
  ],
  [
    'greedy',
    '贪心与构造',
    1,
    ['greedy', 'constructive algorithms', '交换论证'],
    ['greedy', 'constructive algorithms'],
    [],
    '证明局部决策可交换成最优解，或证明构造满足所有约束。排序常见 O(n log n)，线性决策 O(n)。不能仅凭样例确认贪心；用小规模穷举寻找反例，检查相等元素与排序次序。',
  ],
  [
    'number-theory',
    '数论',
    2,
    ['math', 'number theory', 'gcd', '模运算'],
    ['math', 'number theory'],
    [],
    '整除、最大公约数与同余约束可转化数学问题。欧几里得算法 O(log min(a,b))；筛法 O(n log log n)。注意 0、负数取模、乘法溢出及模逆元存在条件。',
  ],
  [
    'combinatorics',
    '组合计数',
    2,
    ['combinatorics', '组合数', '容斥'],
    ['combinatorics'],
    ['number-theory'],
    '先明确计数对象及是否有序，避免重复或遗漏。阶乘预处理 O(n)，组合数查询 O(1)（满足模逆条件时）。容斥常需 O(2^k)。注意边界 C(n,0)、非法下标与非质数模数。',
  ],
  [
    'binary-search',
    '二分答案',
    3,
    ['binary search', '二分', '单调谓词'],
    ['binary search'],
    ['simulation'],
    '将最优化转为单调可行性判断。复杂度 O(check × log 范围)，空间取决于 check。先证明单调性，明确左右端点含义；检查全可行、全不可行与中点溢出。',
  ],
  [
    'segment-tree',
    '线段树',
    3,
    ['segment tree', '懒标记', '区间查询'],
    ['data structures', 'segment tree'],
    ['simulation'],
    '维护可合并的区间信息，单点更新与区间查询常为 O(log n)，空间 O(n)。懒标记必须定义组合顺序和对区间值的作用，注意区间长度、空区间及初始化单位元。',
  ],
  [
    'dsu',
    '并查集',
    4,
    ['dsu', '连通性', 'union find'],
    ['dsu'],
    [],
    '用于动态合并集合与连通性判断。路径压缩与按秩合并摊还 O(α(n))，空间 O(n)。不能直接处理删除边；带权关系与可回滚并查集需单独维护不变量。',
  ],
  [
    'shortest-path',
    '最短路',
    4,
    ['graphs', 'shortest paths', 'Dijkstra', 'BFS'],
    ['graphs', 'shortest paths'],
    ['simulation'],
    '无权图 BFS O(V+E)，非负权图堆优化 Dijkstra O((V+E) log V)，空间 O(V+E)。检查不可达、重边和距离溢出；负权边不能直接使用 Dijkstra。',
  ],
  [
    'tree',
    '树与遍历',
    4,
    ['trees', 'DFS', '树形结构'],
    ['trees'],
    ['simulation'],
    '树遍历通常 O(n)，空间 O(n)。明确父子方向、根节点和子树边界，深链递归可能栈溢出。树形 DP 需定义状态以及子树合并顺序。',
  ],
  [
    'dp',
    '动态规划',
    5,
    ['dp', '状态转移', '背包'],
    ['dp'],
    ['simulation'],
    '定义状态含义、初值、转移与计算顺序。复杂度等于状态数乘转移开销，空间取决于保存状态。检查不可达状态、重复使用元素和滚动数组更新方向；优化前先验证朴素转移。',
  ],
  [
    'string',
    '字符串匹配',
    6,
    ['strings', 'KMP', '前缀函数', '哈希'],
    ['strings', 'string hashing'],
    ['simulation'],
    'KMP 匹配 O(n+m)，前缀函数空间 O(m)。哈希查询常 O(1)，但存在碰撞。注意重叠匹配、空模式、字符编码和多测数组清理；不可将哈希相等视为严格证明。',
  ],
  [
    'search',
    '搜索与剪枝',
    7,
    ['dfs and similar', '回溯', '搜索', 'brute force'],
    ['dfs and similar', 'brute force'],
    ['simulation'],
    '枚举解空间并通过可证明的条件剪枝。最坏复杂度通常指数级，深度和状态数决定空间。必须恢复回溯状态；剪枝不得排除正确解。小规模暴力可作对拍参考。',
  ],
  [
    'divide-conquer',
    '分治',
    7,
    ['divide and conquer', 'meet-in-the-middle', '折半搜索'],
    ['divide and conquer', 'meet-in-the-middle'],
    ['search'],
    '将问题分解为独立子问题并合并，复杂度由递推式决定。折半搜索常 O(2^(n/2)) 空间与时间。检查区间端点、合并代价和重复计数。',
  ],
];
export const knowledgeCards: KnowledgeCard[] = entries.map(
  ([id, title, category, aliases, tags, prerequisites, content]) => ({
    id,
    title,
    category: categoryNames[category],
    aliases,
    tags,
    prerequisites,
    content,
  }),
);
export function knowledgeFor(tags: string[]): string[] {
  return knowledgeCards.filter((k) => k.tags.some((t) => tags.includes(t))).map((k) => k.id);
}
export interface SearchDocument extends Citation {
  content: string;
  aliases: string[];
}
export function tokens(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const words = normalized.match(/[a-z0-9_+]+|[\u3400-\u9fff]+/g) ?? [];
  return [
    ...new Set(
      words.flatMap((w) =>
        /[\u3400-\u9fff]/.test(w) && w.length > 2
          ? [w, ...Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))]
          : [w],
      ),
    ),
  ];
}
export function searchDocuments(docs: SearchDocument[], query: string, limit = 8): Citation[] {
  const terms = tokens(query);
  if (!terms.length) return [];
  const expanded = new Set(terms);
  for (const k of knowledgeCards)
    if ([k.title, ...k.aliases].some((a) => query.toLowerCase().includes(a.toLowerCase())))
      for (const t of tokens([k.title, ...k.aliases].join(' '))) expanded.add(t);
  return docs
    .map((doc) => {
      const title = doc.title.toLowerCase(),
        content = doc.content.toLowerCase(),
        aliases = doc.aliases.join(' ').toLowerCase();
      const score = [...expanded].reduce(
        (n, t) =>
          n + (title.includes(t) ? 5 : 0) + (aliases.includes(t) ? 4 : 0) + (content.includes(t) ? 1 : 0),
        0,
      );
      return { doc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
    .slice(0, limit)
    .map(({ doc }) => {
      const pos = [...expanded].map((t) => doc.content.toLowerCase().indexOf(t)).find((p) => p >= 0) ?? 0;
      return {
        id: doc.id,
        title: doc.title,
        url: doc.url,
        fingerprint: fingerprint(doc.content),
        excerpt: doc.content.slice(Math.max(0, pos - 100), Math.max(0, pos - 100) + 900),
      };
    });
}
