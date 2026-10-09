import { z } from 'zod';
import { reasonOptions, type ProblemRow, type CFSubmission } from './domain.js';

export const aiConfigSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^https?:\/\//, '接口地址需以 http(s):// 开头'),
  apiKey: z.string().trim().max(300).default(''),
  model: z.string().trim().min(1).max(120),
});
export type AiConfig = z.infer<typeof aiConfigSchema>;

export const aiReviewInputSchema = z.object({
  code: z.string().min(1, '请先粘贴需要分析的代码').max(100000),
  language: z.string().trim().min(1).max(40),
  verdict: z.string().trim().max(60).default(''),
  focus: z.string().trim().max(2000).default(''),
  statement: z.string().trim().max(20000).default(''),
});
export type AiReviewInput = z.infer<typeof aiReviewInputSchema>;

export const aiReviewResultSchema = z.object({
  errorAnalysis: z.string().min(1).max(50000),
  approachEvaluation: z.string().min(1).max(50000),
  counterexamples: z.array(z.string().min(1).max(10000)).max(10),
  knowledgePoints: z.array(z.string().min(1).max(200)).min(1).max(20),
  suggestedReasons: z.array(z.string().min(1).max(80)).max(10).default([]),
  suggestedCode: z.string().max(50000).default(''),
});
export type AiReviewResult = z.infer<typeof aiReviewResultSchema>;

export const aiReviewRecordSchema = aiReviewResultSchema.extend({
  id: z.string().min(1).max(80),
  problemKey: z.string().min(1).max(200),
  language: z.string().max(40),
  verdict: z.string().max(60).default(''),
  model: z.string().max(120),
  createdAt: z.string().datetime(),
  code: z.string().max(100000),
});
export type AiReviewRecord = z.infer<typeof aiReviewRecordSchema>;

export const AI_CONFIG_NAMESPACE = 'ai';
export const AI_CONFIG_KEY = 'config';
export const aiReviewNamespace = (profile: string) => `ai-review:${profile}`;

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return key.slice(0, 2) + '…';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export interface AiReviewContext {
  problem: ProblemRow;
  submissions: CFSubmission[];
}

export function buildPrompt(context: AiReviewContext, input: AiReviewInput) {
  const p = context.problem;
  const failed = context.submissions
    .filter((s) => s.verdict && s.verdict !== 'OK')
    .slice(0, 5)
    .map((s) => s.verdict)
    .join('、');
  const notes = [
    p.review.wrongIdea && `当时思路：${p.review.wrongIdea}`,
    p.review.rootCause && `自析错因：${p.review.rootCause}`,
  ]
    .filter(Boolean)
    .join('\n');
  const system = [
    '你是一名经验丰富的算法竞赛教练（熟悉 Codeforces / AtCoder），正在帮助选手复盘一段未通过评测的代码。',
    '请用简体中文回答，语气直接、具体、可操作，避免空泛的鼓励。',
    '你必须只输出一个 JSON 对象，不要输出任何其他文字、不要用 Markdown 围栏包裹。字段如下：',
    '{',
    '  "errorAnalysis": "错误原因分析（Markdown 字符串）：结合代码指出具体出错位置与机制，必要时引用代码行",',
    '  "approachEvaluation": "思路评价（Markdown 字符串）：评价整体算法思路是否正确、复杂度是否达标，若方向错误给出正确方向",',
    '  "counterexamples": ["反例（字符串数组）：每条给出一组能让代码出错的最小输入、正确输出与代码实际行为说明，输入用代码块格式"] ,',
    '  "knowledgePoints": ["推荐知识点（字符串数组）：为补上这类题需要学习的具体算法/技巧，如「二分答案」「线段树懒标记」"],',
    '  "suggestedReasons": ["建议的错因归类（字符串数组），尽量从以下选项中选取：' +
      reasonOptions.join('、') +
      '"],',
    '  "suggestedCode": "根据正确思路给出的修正代码（纯代码字符串，不要 Markdown 围栏）：若选手思路正确只是实现有 bug，保持其语言与代码风格修复并给出完整代码；若思路错误，用同一语言给出正确思路的完整参考实现。确实无法给出时填空字符串"',
    '}',
    '所有 Markdown 字符串内可以使用代码块（```）与 LaTeX（$…$）。counterexamples 至少给出 1 条，确实无法构造时说明原因。',
  ].join('\n');
  const user = [
    `题目：${p.name}（${p.source === 'atcoder' ? 'AtCoder' : 'Codeforces'} ${p.contestId ?? ''}${p.index}）`,
    p.tags.length ? `标签：${p.tags.join('、')}` : '',
    p.rating !== null ? `难度：${p.rating}` : '',
    failed ? `近期失败提交评测结果：${failed}` : '',
    input.verdict ? `本次代码评测结果：${input.verdict}` : '',
    notes ? `\n选手自己的复盘笔记：\n${notes}` : '',
    input.statement ? `\n题目描述（选手提供）：\n${input.statement}` : '',
    input.focus ? `\n选手希望重点关注：${input.focus}` : '',
    `\n待分析代码（${input.language}）：\n\`\`\`${input.language}\n${input.code}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user };
}

export function parseAiReviewText(text: string): AiReviewResult {
  const trimmed = text.trim();
  const candidates: string[] = [];
  const firstFence = trimmed.indexOf('```');
  const lastFence = trimmed.lastIndexOf('```');
  if (firstFence !== -1 && lastFence > firstFence) {
    const newline = trimmed.indexOf('\n', firstFence);
    candidates.push(
      trimmed.slice(newline !== -1 && newline < lastFence ? newline + 1 : firstFence + 3, lastFence).trim(),
    );
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  candidates.push(trimmed);
  let parsed: unknown;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // 尝试下一种提取方式
    }
  }
  if (parsed === undefined) throw new Error('AI 返回格式异常，无法解析为 JSON，请重试');
  const result = aiReviewResultSchema.safeParse(parsed);
  if (!result.success) throw new Error('AI 返回内容缺少必要字段，请重试');
  return result.data;
}

export type FetchLike = (
  url: string,
  init?: unknown,
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class AiReviewer {
  constructor(private fetchImpl?: FetchLike) {}

  async complete(config: AiConfig, system: string, user: string, maxTokens = 4000): Promise<string> {
    try {
      const { astraComplete } = await import('./astra-model.js');
      return await astraComplete(config, system, user, maxTokens, this.fetchImpl);
    } catch (error) {
      const e = error as Error & { status?: number };
      if (e.status === 401 || e.status === 403) throw new Error('API 密钥无效或已过期');
      if (e.status === 429) throw new Error('AI 服务请求过于频繁，请稍后重试');
      if (/abort|timeout/i.test(e.message)) throw new Error('AI 请求超时，请稍后重试');
      throw new Error(e.message || '无法连接 AI 服务');
    }
  }
  async capabilities(config: AiConfig): Promise<{ toolCalling: boolean; message: string }> {
    const { astraModel } = await import('./astra-model.js');
    const { tool } = await import('langchain');
    const probe = tool(() => 'ok', {
      name: 'astra_probe',
      description: '连接能力测试',
      schema: z.object({}),
    });
    try {
      const result = await astraModel(config, this.fetchImpl, 80)
        .bindTools([probe], { tool_choice: 'astra_probe' })
        .invoke('请调用 astra_probe', { signal: AbortSignal.timeout(30000) });
      const supported = result.tool_calls?.some((t) => t.name === 'astra_probe') ?? false;
      return {
        toolCalling: supported,
        message: supported ? '工具调用可用' : '当前模型未返回工具调用，结构化任务仍可用',
      };
    } catch {
      return { toolCalling: false, message: '当前模型不支持工具调用或测试未成功，结构化任务仍可用' };
    }
  }

  async review(config: AiConfig, context: AiReviewContext, input: AiReviewInput): Promise<AiReviewResult> {
    const { system, user } = buildPrompt(context, input);
    return parseAiReviewText(await this.complete(config, system, user));
  }

  async test(config: AiConfig): Promise<string> {
    await this.complete(config, '你是一个助手。', '请只回复「连接成功」四个字。', 20);
    return '连接成功';
  }
}

export type PageFetchLike = (
  url: string,
  init?: unknown,
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export function submissionUrl(s: {
  source?: 'cf' | 'atcoder';
  contestId?: number;
  contestKey?: string;
  id: number;
}): string {
  if (s.source === 'atcoder') {
    if (!s.contestKey) throw new Error('该提交缺少比赛标识，无法定位源码页面');
    return `https://atcoder.jp/contests/${s.contestKey}/submissions/${s.id}`;
  }
  const contestId = s.contestId ?? 0;
  if (!contestId) throw new Error('该提交缺少比赛标识，无法定位源码页面');
  return `https://codeforces.com/${contestId >= 100000 ? 'gym' : 'contest'}/${contestId}/submission/${s.id}`;
}

const htmlEscapes: [RegExp, string][] = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
];

export function unescapeHtml(text: string): string {
  for (const [pattern, value] of htmlEscapes) text = text.replace(pattern, value);
  return text;
}

export function extractSubmissionCode(html: string): string {
  const match =
    html.match(/<pre id="submission-code"[^>]*>([\s\S]*?)<\/pre>/) ??
    html.match(/<pre id="program-source-text"[^>]*>([\s\S]*?)<\/pre>/);
  if (!match) throw new Error('页面中未找到源码，可能已被平台拦截');
  const code = unescapeHtml(match[1])
    .replace(/^\r?\n/, '')
    .replace(/[\s\r\n]+$/, '');
  if (!code.trim()) throw new Error('页面中的源码为空');
  return code;
}

export function mapProgrammingLanguage(raw: string): string {
  const value = raw.toLowerCase();
  if (value.includes('c++') || value.includes('gnu c') || value.includes('clang')) return 'cpp';
  if (value.includes('python') || value.includes('pypy')) return 'python';
  if (value.includes('java')) return 'java';
  if (value.includes('javascript') || value.includes('node')) return 'javascript';
  if (value.includes('rust')) return 'rust';
  if (/\bgo\b/.test(value)) return 'go';
  return '';
}

const pageHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

export async function fetchSubmissionCode(
  pageFetch: PageFetchLike,
  submission: Parameters<typeof submissionUrl>[0],
): Promise<string> {
  const url = submissionUrl(submission);
  let response: Awaited<ReturnType<PageFetchLike>>;
  try {
    response = await pageFetch(url, { headers: pageHeaders, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error('无法连接平台，请检查网络后重试');
  }
  if (response.status === 403 || response.status === 429)
    throw new Error(`平台拦截了自动获取，请打开提交页面手动复制代码：${url}`);
  if (response.status === 404) throw new Error('提交页面不存在，可能已被平台移除');
  if (!response.ok) throw new Error(`平台返回错误（HTTP ${response.status}），请手动复制代码：${url}`);
  return extractSubmissionCode(await response.text());
}
