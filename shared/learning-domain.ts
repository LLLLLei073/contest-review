import { z } from 'zod';

const text = z.string().max(50000);
const id = z.string().min(1).max(200);
const base = { id, createdAt: z.string().datetime() };
export const cardSchema = z.object({
  ...base,
  kind: z.literal('card'),
  title: z.string().min(1).max(300),
  content: text,
  knowledgeIds: z.array(id).max(30),
  confirmed: z.boolean().default(false),
  edited: z.boolean().default(false),
  problemKey: id,
  sourceId: id.optional(),
  sourceHash: id,
});
export type ExperienceCard = z.infer<typeof cardSchema>;
export const citationSchema = z.object({
  id,
  title: z.string().max(300),
  excerpt: text,
  url: z.string().max(1000),
  fingerprint: id,
});
export type Citation = z.infer<typeof citationSchema>;
export const answerSchema = z.object({
  ...base,
  kind: z.literal('answer'),
  question: text,
  answer: text,
  general: text,
  citations: z.array(citationSchema).max(8),
});
export const findingSchema = z.object({
  evidenceIds: z.array(id).max(30),
  cause: text,
  action: text,
  knowledgeIds: z.array(id).max(30),
});
export const diagnosisSchema = z.object({
  ...base,
  kind: z.literal('diagnosis'),
  period: z.enum(['30', 'all']),
  findings: z.array(findingSchema).max(10),
  warnings: z.array(text).max(20),
  evidence: z
    .array(z.object({ id, text, knowledgeIds: z.array(id).max(30) }))
    .max(100)
    .default([]),
});
export const hintSchema = z.object({
  ...base,
  kind: z.literal('hint'),
  problemKey: id,
  session: id,
  level: z.number().int().min(1).max(4),
  content: text,
});
export const preferenceSchema = z.object({
  ...base,
  kind: z.literal('preferences'),
  auto: z.boolean().default(false),
});
const plan = z.object({
  date: z.string(),
  review: z.array(z.unknown()).max(5),
  newKeys: z.array(id).max(5),
  newReasons: z.record(z.string(), z.string()).optional(),
  newShortage: z.string().nullable().optional(),
  catalogReady: z.boolean(),
  createdAt: z.string(),
});
export const revisionSchema = z.object({
  ...base,
  kind: z.literal('revision'),
  date: z.string(),
  fingerprint: id,
  reason: text,
  before: plan,
  after: plan,
  reverted: z.boolean().default(false),
  inputSummary: text,
});
export const agentRunSchema = z.object({
  ...base,
  kind: z.literal('agent-run'),
  fingerprint: id,
  status: z.enum(['completed', 'failed', 'reverted']),
  message: text,
});
export const transferSchema = z.object({
  ...base,
  kind: z.literal('transfer'),
  problemKey: id,
  targetKey: id,
  knowledgeIds: z.array(id).max(30),
  date: z.string(),
  reason: text,
  result: z.enum(['pending', 'independent', 'hint', 'failed']).default('pending'),
  minutes: z.number().min(0).max(100000).default(0),
  evaluatedAt: z.string().datetime().optional(),
});
export const coachSchema = z.object({
  ...base,
  kind: z.literal('coach'),
  contestKey: id,
  findings: z.array(findingSchema).max(10),
  evidence: z.array(z.object({ id, text })).max(100),
  warnings: z.array(text).max(20),
});
export const stressReportSchema = z.object({
  format: z.literal('contest-review-stress'),
  version: z.literal(1),
  bundleId: id,
  codeHash: id,
  seed: z.number().int().nonnegative(),
  rounds: z.number().int().min(1).max(100000),
  status: z.enum(['passed', 'mismatch', 'crash', 'timeout', 'error']),
  round: z.number().int().min(0),
  input: text.default(''),
  expected: text.default(''),
  actual: text.default(''),
  message: text.default(''),
});
export const bundleSchema = z.object({
  ...base,
  kind: z.literal('bundle'),
  problemKey: id,
  language: z.enum(['cpp', 'python']),
  code: z.string().max(100000),
  codeHash: id,
  oracle: z.string().min(1).max(100000),
  generator: z.string().min(1).max(100000),
  status: z.enum(['suggested', 'user-verified', 'verification-failed']).default('suggested'),
  reports: z.array(stressReportSchema).max(100).default([]),
});
export const learningRecordSchema = z.discriminatedUnion('kind', [
  cardSchema,
  answerSchema,
  diagnosisSchema,
  hintSchema,
  preferenceSchema,
  revisionSchema,
  agentRunSchema,
  transferSchema,
  coachSchema,
  bundleSchema,
]);
export type LearningRecord = z.infer<typeof learningRecordSchema>;
export type Transfer = z.infer<typeof transferSchema>;
export type Bundle = z.infer<typeof bundleSchema>;
export function fingerprint(value: unknown): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? 'undefined');
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}-${text.length}`;
}
export const learningNamespace = (cf: string, ac: string) =>
  `learning:${cf || '-'}:${ac ? 'ac~' + ac.toLowerCase() : '-'}`;
