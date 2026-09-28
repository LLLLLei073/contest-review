import { z } from 'zod';
import type { CFSubmission, Review } from './domain.js';

export const upsolveSchema = z.object({
  key: z.string().min(1).max(200),
  source: z.enum(['cf', 'atcoder']),
  contestKey: z.string().min(1).max(200),
  contestName: z.string().max(1000),
  name: z.string().max(1000),
  url: z.url().refine((url) => /^https:\/\/(codeforces\.com|atcoder\.jp)\//.test(url)),
  rating: z.number().nullable(),
  addedAt: z.string().datetime(),
});
export type UpsolveItem = z.infer<typeof upsolveSchema> & { completed: boolean; attempted: boolean };

export const reasonSnapshotSchema = z.object({
  id: z.string().uuid(),
  problemKey: z.string().min(1).max(200),
  savedAt: z.string().datetime(),
  reasons: z.array(z.string().max(80)).max(30),
});
export type ReasonSnapshot = z.infer<typeof reasonSnapshotSchema>;
export function reviewQualityHints(review: Review): string[] {
  const hints: string[] = [];
  if (!review.rootCause.trim()) hints.push('补一句根本原因，方便下次识别同类错误。');
  if (!review.counterexample.trim()) hints.push('补一个最小反例或边界条件，重做前更容易回忆。');
  if (!review.solution.trim()) hints.push('写下下次可执行的解题步骤或改进方法。');
  return hints;
}

export const simulationSchema = z.object({
  id: z.string().uuid(),
  contestId: z.number().int().positive(),
  contestName: z.string().max(1000),
  startedAt: z.string().datetime(),
  durationSeconds: z.number().int().positive(),
  finishedAt: z.string().datetime().nullable(),
  manual: z.array(
    z.object({
      problemKey: z.string().min(1).max(200),
      verdict: z.enum(['OK', 'FAILED']),
      at: z.string().datetime(),
    }),
  ),
});
export type Simulation = z.infer<typeof simulationSchema>;
export interface SimulationEvent {
  problemKey: string;
  verdict: string;
  at: string;
  minute: number;
  source: 'cf' | 'manual';
  submissionUrl?: string;
}
export function simulationEvents(session: Simulation, submissions: CFSubmission[]): SimulationEvent[] {
  const end = Math.min(
    Date.parse(session.finishedAt ?? new Date().toISOString()),
    Date.parse(session.startedAt) + session.durationSeconds * 1000,
  );
  const events: SimulationEvent[] = submissions
    .filter(
      (s) =>
        s.contestId === session.contestId &&
        !s.author.teamId &&
        s.creationTimeSeconds * 1000 >= Date.parse(session.startedAt) &&
        s.creationTimeSeconds * 1000 <= end,
    )
    .map((s) => ({
      problemKey: `${s.problem.contestId ?? s.contestId}:${s.problem.index}`,
      verdict: s.verdict ?? '待判',
      at: new Date(s.creationTimeSeconds * 1000).toISOString(),
      minute: Math.floor((s.creationTimeSeconds * 1000 - Date.parse(session.startedAt)) / 60000),
      source: 'cf' as const,
      submissionUrl: `https://codeforces.com/contest/${session.contestId}/submission/${s.id}`,
    }));
  for (const item of session.manual)
    if (Date.parse(item.at) <= end)
      events.push({
        problemKey: item.problemKey,
        verdict: item.verdict,
        at: item.at,
        minute: Math.floor((Date.parse(item.at) - Date.parse(session.startedAt)) / 60000),
        source: 'manual',
      });
  return events.sort((a, b) => a.at.localeCompare(b.at));
}
