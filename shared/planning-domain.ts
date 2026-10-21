import { z } from 'zod';
import { dailyPlanSchema } from './training.js';
import { candidateSchema } from './plan-optimizer.js';
import { bktParametersSchema } from './knowledge-tracing.js';

const id = z.string().min(1).max(200);
export const planningDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, '计划日期无效');
export const planningOptionsSchema = z.object({
  budget: z.number().int().min(15).max(240).nullable().default(null),
  targets: z.array(id).max(20).default([]),
});
export const planRequestSchema = planningOptionsSchema.extend({
  date: planningDateSchema,
  excludeKeys: z.array(id).max(10).default([]),
});
export const knowledgeStateSchema = z.object({
  skillId: id,
  probability: z.number().min(0).max(1),
  samples: z.number().int().nonnegative(),
  distinctProblems: z.number().int().nonnegative(),
  insufficient: z.boolean(),
  independentProblems: z.number().int().nonnegative(),
  evidenceIds: z.array(id),
  lastEvidenceAt: z.string().datetime().nullable(),
});
export const tracingSchema = z.object({
  version: id,
  parameters: bktParametersSchema,
  calibrated: z.literal(false),
  states: z.array(knowledgeStateSchema),
  excluded: z.array(
    z.object({
      id,
      reason: z.enum(['future', 'invalid-time', 'duplicate', 'assisted', 'unverified', 'mixed', 'unmapped']),
    }),
  ),
});
export const learningPathSchema = z.object({
  version: id,
  targets: z.array(id),
  valid: z.boolean(),
  next: id.nullable(),
  nodes: z.array(
    z.object({
      id,
      title: z.string(),
      prerequisites: z.array(id),
      successors: z.array(id),
      target: z.boolean(),
      verified: z.boolean(),
      ready: z.boolean(),
      priority: z.number().finite(),
      estimatedMinutes: z.number().min(0).max(105).default(105),
      reason: z.string(),
    }),
  ),
  issues: z.array(
    z.object({ kind: z.enum(['duplicate', 'unknown-target', 'dangling', 'cycle']), ids: z.array(id) }),
  ),
});
export const optimizerResultSchema = z.object({
  version: id,
  budget: z.number().nullable(),
  goalQuota: z.number().int().min(0).max(2),
  minimumMinutes: z.number().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  consideredCount: z.number().int().min(0).max(80),
  truncated: z.boolean(),
  feasible: z.boolean(),
  conflicts: z.array(z.string()),
  selected: z.array(candidateSchema).max(10),
  allocatedMinutes: z.number().nonnegative(),
  estimatedMinutes: z.number().nonnegative(),
  utility: z.number().finite(),
  excluded: z.array(z.object({ key: id, reason: z.string().max(500) })).max(20000),
});
const base = { id, scope: id, createdAt: z.string().datetime() };
export const planningPreferenceSchema = z.object({
  ...base,
  kind: z.literal('preferences'),
  id: z.literal('preferences'),
  options: planningOptionsSchema,
});
export const pathRecordSchema = z.object({
  ...base,
  kind: z.literal('path'),
  fingerprint: id,
  graphVersion: id,
  path: learningPathSchema,
});
export const planDecisionSchema = z.object({
  ...base,
  kind: z.literal('decision'),
  status: z.enum(['preview', 'applied', 'reverted', 'expired']),
  request: planRequestSchema,
  inputFingerprint: id,
  appliedFingerprint: id.optional(),
  algorithm: id,
  graphVersion: id,
  parameters: bktParametersSchema,
  utilityWeights: z
    .object({
      version: id,
      base: z.number(),
      gap: z.number(),
      goal: z.number(),
      path: z.number(),
      unlock: z.number(),
      coverage: z.number(),
      challenge: z.number(),
    })
    .optional(),
  before: dailyPlanSchema.nullable(),
  after: dailyPlanSchema,
  path: learningPathSchema,
  result: optimizerResultSchema,
  warnings: z.array(z.string().max(1000)).max(30),
  candidates: z.array(candidateSchema).max(80),
});
export const planningRecordSchema = z.discriminatedUnion('kind', [
  planningPreferenceSchema,
  pathRecordSchema,
  planDecisionSchema,
]);
export type PlanDecision = z.infer<typeof planDecisionSchema>;
export type PlanningRecord = z.infer<typeof planningRecordSchema>;
export const planningNamespace = (cf: string, ac: string) =>
  `planning:${cf || '-'}:${ac ? 'ac~' + ac.toLowerCase() : '-'}`;
export const planningStateSchema = z.object({
  evidence: z.array(z.object({ id, problemKey: id, at: z.string(), result: z.string() })).default([]),
  followup: z
    .object({
      overdue: z.number(),
      transferEvaluated: z.number(),
      transferIndependent: z.number(),
      transferPending: z.number(),
    })
    .optional(),
  outcomes: z
    .array(
      z.object({
        id,
        date: planningDateSchema,
        assigned: z.number(),
        evaluated: z.number(),
        independent: z.number(),
        hint: z.number(),
        independentPerHour: z.number().nullable(),
        minutes: z.number(),
        timed: z.number(),
        attempts: z.number(),
        estimatedMinutes: z.number(),
        budget: z.number().nullable(),
        elapsed: z.boolean(),
      }),
    )
    .default([]),
  scope: id,
  options: planningOptionsSchema,
  tracing: tracingSchema,
  path: learningPathSchema,
  decisions: z.array(planDecisionSchema).max(100),
  paths: z.array(pathRecordSchema).max(30),
  algorithm: id,
  graphVersion: id,
});
export type PlanningState = z.infer<typeof planningStateSchema>;
