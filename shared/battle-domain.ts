import { z } from 'zod';
import { catalogSchema } from './training.js';
import { knowledgeCards } from './knowledge.js';
import type { CFSubmission } from './domain.js';

export const BATTLE_RULE_VERSION = 'battle-1';
// 自定义主题连战：AI 把任意主题映射为 CF 标签组合，skillId 仍指向最近的
// 知识卡以保持奖励归因链路（掌握度/BKT/学习转移）完全复用。
export const battleCustomSchema = z.object({
  theme: z.string().trim().min(1).max(60),
  tags: z.array(z.string().min(1).max(50)).min(1).max(6),
});
export type BattleCustom = z.infer<typeof battleCustomSchema>;
export const battleItemSchema = z.object({
  id: z.string().uuid(),
  problem: catalogSchema.shape.problems.element,
  issuedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  outcome: z.enum(['current', 'accepted', 'skipped', 'failed']),
  submissionId: z.number().int().positive().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  evaluation: z.enum(['independent', 'hint', 'failed']).nullable(),
  evaluatedAt: z.string().datetime().nullable(),
});
export const battleSessionSchema = z
  .object({
    id: z.string().uuid(),
    handle: z.string().min(1),
    skillId: z.string().refine((id) => knowledgeCards.some((c) => c.id === id)),
    ruleVersion: z.literal(BATTLE_RULE_VERSION),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    status: z.enum(['active', 'paused', 'ended']),
    exhausted: z.boolean(),
    minimum: z.number().int().min(800).max(4000),
    maximum: z.number().int().min(800).max(4000),
    preferred: z.number().int().min(800).max(4000),
    items: z.array(battleItemSchema).max(20000),
    operations: z.array(z.string().uuid()).max(20000),
    custom: battleCustomSchema.nullable().optional(),
  })
  .refine((s) => s.minimum <= s.preferred && s.preferred <= s.maximum, '难度区间无效');
export type BattleSession = z.infer<typeof battleSessionSchema>;
export type BattleItem = z.infer<typeof battleItemSchema>;
export interface BattleReward {
  itemId: string;
  problemKey: string;
  skillId: string;
  category: string;
  result: 'independent' | 'hint' | 'failed';
  at: string;
  evaluatedAt: string;
  multiplier: number;
  submissionId: number | null;
  score: number;
}
export function acceptedFor(item: BattleItem, submission: CFSubmission, handle: string) {
  return (
    submission.id === item.submissionId &&
    submission.verdict === 'OK' &&
    !submission.author.teamId &&
    submission.author.members?.length === 1 &&
    submission.author.members[0].handle.toLowerCase() === handle.toLowerCase() &&
    `${submission.problem.contestId}:${submission.problem.index}` === item.problem.key &&
    submission.creationTimeSeconds * 1000 >= Date.parse(item.issuedAt) &&
    new Date(submission.creationTimeSeconds * 1000).toISOString() === item.acceptedAt
  );
}

/** Replay in issue order. An unresolved evaluation blocks rewards until its position is settled. */
export function battleRewards(session: BattleSession, submissions: CFSubmission[], assisted: Set<string>) {
  let streak = 0,
    blocked = false;
  const rewards: BattleReward[] = [];
  const skill = knowledgeCards.find((c) => c.id === session.skillId)!;
  for (const item of session.items) {
    if (item.outcome === 'current') continue;
    if (item.outcome === 'skipped') {
      streak = 0;
      continue;
    }
    if (!item.evaluation) {
      blocked = true;
      streak = 0;
      continue;
    }
    const result = assisted.has(item.id) ? 'hint' : item.evaluation;
    const valid =
      item.outcome === 'accepted' && submissions.some((s) => acceptedFor(item, s, session.handle));
    if (result === 'independent' && !valid) {
      blocked = true;
      streak = 0;
      continue;
    }
    streak = result === 'independent' ? streak + 1 : 0;
    const multiplier = result === 'independent' && !blocked ? 1 + Math.min(streak, 5) / 10 : 1;
    // Pending predecessors do not receive provisional ordinary rewards either.
    if (blocked) continue;
    rewards.push({
      itemId: item.id,
      problemKey: item.problem.key,
      skillId: session.skillId,
      category: skill.category,
      result,
      at: item.acceptedAt ?? item.closedAt!,
      evaluatedAt: item.evaluatedAt!,
      multiplier,
      submissionId: valid ? item.submissionId : null,
      score: result === 'independent' ? 70 + 15 * multiplier : result === 'hint' ? 45 : 15,
    });
  }
  return {
    rewards,
    streak: blocked ? 0 : streak,
    pending: session.items.filter((i) => i.outcome === 'accepted' && !i.evaluation).length,
  };
}

export function battleTheme(session: BattleSession) {
  return session.custom?.theme ?? knowledgeCards.find((c) => c.id === session.skillId)?.title ?? session.skillId;
}
/** 选题允许的标签集合：自定义主题用 AI 映射的标签，知识卡连战用卡内标签。 */
export function battleTags(session: BattleSession) {
  const skill = knowledgeCards.find((c) => c.id === session.skillId)!;
  return session.custom ? session.custom.tags : skill.tags;
}
export function validateBattle(session: BattleSession, submissions: CFSubmission[]) {
  const ids = new Set<string>(),
    keys = new Set<string>();
  let last = Date.parse(session.createdAt);
  const allowed = new Set(battleTags(session));
  for (const [index, item] of session.items.entries()) {
    if (ids.has(item.id) || keys.has(item.problem.key)) throw new Error('连战题目重复');
    ids.add(item.id);
    keys.add(item.problem.key);
    if (
      !item.problem.tags.some((t) => allowed.has(t)) ||
      item.problem.key !== `${item.problem.contestId}:${item.problem.index}` ||
      item.problem.url !==
        `https://codeforces.com/contest/${item.problem.contestId}/problem/${item.problem.index}`
    )
      throw new Error('连战题目归属不一致');
    if (Date.parse(item.issuedAt) < last || Date.parse(item.issuedAt) > Date.parse(session.updatedAt))
      throw new Error('连战时间顺序无效');
    if (item.outcome === 'current') {
      if (
        index !== session.items.length - 1 ||
        item.closedAt ||
        item.submissionId ||
        item.acceptedAt ||
        item.evaluation ||
        item.evaluatedAt
      )
        throw new Error('连战当前题状态无效');
    } else {
      if (
        !item.closedAt ||
        Date.parse(item.closedAt) < Date.parse(item.issuedAt) ||
        Date.parse(item.closedAt) > Date.parse(session.updatedAt)
      )
        throw new Error('连战结束时间无效');
      if (item.outcome === 'accepted') {
        if (
          !submissions.some((s) => acceptedFor(item, s, session.handle)) ||
          Date.parse(item.acceptedAt!) > Date.parse(item.closedAt)
        )
          throw new Error('连战缺少有效个人 AC 证据');
      } else if (item.submissionId || item.acceptedAt) throw new Error('连战非 AC 题包含通过证据');
      if (
        (item.evaluation === null) !== (item.evaluatedAt === null) ||
        (item.evaluatedAt &&
          (Date.parse(item.evaluatedAt) < Date.parse(item.closedAt) ||
            Date.parse(item.evaluatedAt) > Date.parse(session.updatedAt))) ||
        (item.outcome === 'failed' && item.evaluation !== 'failed') ||
        (item.outcome === 'skipped' && item.evaluation !== null)
      )
        throw new Error('连战评价无效');
      last = Date.parse(item.closedAt);
    }
  }
  if (new Set(session.operations).size !== session.operations.length) throw new Error('连战操作重复');
  if (
    session.exhausted &&
    (session.status !== 'paused' || session.items.some((i) => i.outcome === 'current'))
  )
    throw new Error('连战题源状态无效');
}
