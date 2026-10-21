import { z } from 'zod';
import { agentContextSchema } from './agent-domain.js';
const id = z.string().min(1).max(200);
export const reviewStages = ['orient', 'recall', 'investigate', 'verify', 'consolidate', 'transfer'] as const;
export const reviewWorkflowSchema = z.object({
  kind: z.literal('workflow'),
  id,
  scope: id,
  sessionId: id,
  context: agentContextSchema,
  xcpc: z.string().max(300),
  stage: z.enum(reviewStages),
  status: z.enum(['waiting', 'ready', 'running', 'completed', 'cancelled', 'interrupted']),
  version: z.number().int().positive(),
  fingerprint: id,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  question: z.string().max(3000),
  summary: z.string().max(5000),
  answers: z
    .array(
      z.object({
        id,
        stage: z.enum(reviewStages),
        text: z.string().min(1).max(10000),
        createdAt: z.string().datetime(),
      }),
    )
    .max(100),
  evidence: z
    .array(
      z.object({
        id,
        label: z.string().max(300),
        status: z.enum(['observed', 'hypothesis', 'user-reported']),
        summary: z.string().max(2000),
      }),
    )
    .max(100),
  proposalIds: z.array(id).max(100),
  lastRequestId: id.optional(),
  advance: z.boolean().default(false),
});
export type ReviewWorkflow = z.infer<typeof reviewWorkflowSchema>;
export const workflowNamespace = (cf: string, ac: string) =>
  `review-workflow:${cf || '-'}:${ac ? 'ac~' + ac.toLowerCase() : '-'}`;
