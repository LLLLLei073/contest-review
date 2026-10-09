import { z } from 'zod';
import { citationSchema } from './learning-domain.js';
const id = z.string().min(1).max(100);
const text = z.string().max(50000);
export const agentContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('general') }),
  z.object({ kind: z.literal('problem'), problemKey: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal('contest'),
    source: z.enum(['cf', 'atcoder', 'xcpc']),
    contestId: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal('monthly'),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    source: z.enum(['all', 'cf', 'atcoder']).default('all'),
  }),
]);
export type AgentContext = z.infer<typeof agentContextSchema>;
export const changeActions = ['review', 'card', 'delete', 'weekly', 'transfer', 'agent'] as const;
export const agentRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session'),
    id,
    title: z.string().max(150),
    context: agentContextSchema,
    xcpc: z.string().max(300),
    createdAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('message'),
    id,
    sessionId: id,
    role: z.enum(['user', 'assistant']),
    content: text,
    citations: z.array(citationSchema).max(8).default([]),
    createdAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('run'),
    id,
    requestId: id,
    sessionId: id,
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    events: z
      .array(
        z.object({
          type: z.enum(['text', 'tool-start', 'tool-end', 'proposal', 'complete', 'error']),
          text: text.optional(),
          name: z.string().max(150).optional(),
          id: id.optional(),
        }),
      )
      .max(2000),
    createdAt: z.string().datetime(),
    error: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal('proposal'),
    id,
    runId: id,
    sessionId: id,
    action: z.enum(changeActions),
    input: z.record(z.string(), z.unknown()),
    preview: text,
    fingerprint: id,
    xcpc: z.string().max(300),
    status: z.enum(['pending', 'applied', 'rejected', 'expired']),
    result: text.optional(),
    createdAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('memory'),
    id,
    content: z.string().trim().min(1).max(2000),
    sourceId: id,
    createdAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('settings'),
    id: z.literal('settings'),
    memory: z.boolean().default(true),
    proactive: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('suggestion'),
    id,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fingerprint: id,
    content: text,
    dismissed: z.boolean(),
    createdAt: z.string().datetime(),
  }),
]);
export type AgentRecord = z.infer<typeof agentRecordSchema>;
export type AgentEvent = Extract<AgentRecord, { kind: 'run' }>['events'][number];
export const agentNamespace = (cf: string, ac: string) =>
  `agent:${cf || '-'}:${ac ? 'ac~' + ac.toLowerCase() : '-'}`;
export const agentRunInputSchema = z.object({
  sessionId: id,
  requestId: id,
  message: z.string().trim().min(1).max(10000),
});
