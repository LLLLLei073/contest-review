import { z } from 'zod';
import { aiConfigSchema } from './ai-review.js';
import type { CoreStore } from './core-store.js';
import { battleTheme, type BattleSession } from './battle-domain.js';
import { sessionRewards } from './battle-service.js';

export const battleSummarySchema = z.object({
  text: z.string().min(1).max(4000),
  highlights: z.array(z.string().min(1).max(200)).max(6),
  advice: z.array(z.string().min(1).max(200)).max(6),
});
export type BattleSummary = z.infer<typeof battleSummarySchema>;
export const battleSummaryNamespace = (handle: string) => 'battle-summary:' + handle;
const SUMMARY_SYSTEM_PROMPT =
  '你是竞赛训练教练星澪。基于给定的连战事实写一份简短战报总结。' +
  '不要虚构事实中不存在的数据或题目；语言简洁具体。' +
  '仅输出 JSON 对象 {"text":"3-5 句总结","highlights":["亮点，最多4条"],"advice":["下一步建议，最多3条"]}。';
/** 连战战报的派生事实：主题、耗时、题量、评价与连击。 */
export function battleFacts(store: CoreStore, session: BattleSession) {
  const closed = session.items.filter((i) => i.closedAt).at(-1)?.closedAt ?? session.updatedAt;
  // 已结束的场次以结束时刻为准；进行中/已暂停以最后一次收题时刻为准
  const playedUntil =
    session.status === 'ended'
      ? session.updatedAt
      : session.items.some((i) => i.closedAt)
        ? closed
        : session.updatedAt;
  const { rewards, pending } = sessionRewards(store, session);
  return {
    theme: battleTheme(session),
    status: session.status,
    startedAt: session.createdAt,
    endedAt: session.status === 'ended' ? session.updatedAt : null,
    durationMinutes: Math.max(0, Math.round((Date.parse(playedUntil) - Date.parse(session.createdAt)) / 60000)),
    difficulty: `${session.minimum}-${session.maximum}`,
    problemCount: session.items.length,
    accepted: session.items.filter((i) => i.outcome === 'accepted').length,
    skipped: session.items.filter((i) => i.outcome === 'skipped').length,
    failed: session.items.filter((i) => i.outcome === 'failed').length,
    evaluations: {
      independent: session.items.filter((i) => i.evaluation === 'independent').length,
      hint: session.items.filter((i) => i.evaluation === 'hint').length,
    },
    pending,
    bestStreak: rewards.reduce((n, r) => Math.max(n, Math.round((r.multiplier - 1) * 10)), 0),
    maxMultiplier: rewards.length ? Math.max(...rewards.map((r) => r.multiplier)) : null,
    problems: session.items.map((i) => ({
      name: i.problem.name,
      rating: i.problem.rating,
      outcome: i.outcome,
      evaluation: i.evaluation,
    })),
  };
}
export function savedSummary(store: CoreStore, handle: string, sessionId: string): BattleSummary | null {
  return store.externalGet<BattleSummary>(battleSummaryNamespace(handle), sessionId) ?? null;
}
/** 生成一场连战的 AI 总结（不持久化，由 BattleService 统一写入）。 */
export async function generateBattleSummary(
  store: CoreStore,
  ai: { complete(config: { baseUrl: string; apiKey: string; model: string }, system: string, user: string, maxTokens?: number): Promise<string> },
  session: BattleSession,
): Promise<BattleSummary> {
  const config = aiConfigSchema.safeParse(store.externalGet('ai', 'config'));
  if (!config.success) throw new Error('尚未配置 AI 服务，无法生成连战总结；可在设置 → AI 助手中配置');
  const facts = battleFacts(store, session);
  const raw = await ai.complete(config.data, SUMMARY_SYSTEM_PROMPT, JSON.stringify(facts), 2000);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 返回内容不是 JSON 对象');
  return battleSummarySchema.parse(JSON.parse(raw.slice(start, end + 1)));
}
