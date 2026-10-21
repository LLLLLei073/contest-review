import type { Attempt } from './domain.js';
import type { PlanDecision } from './planning-domain.js';
import type { KnowledgeObservation } from './knowledge-tracing.js';
const day = (value: string) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10);
/** Descriptive follow-up only: future events and unverified self-reported independence are excluded. */
export function plannerOutcomes(
  decisions: PlanDecision[],
  attempts: Attempt[],
  observations: KnowledgeObservation[],
  asOf: string,
) {
  const latest = new Map<string, PlanDecision>();
  for (const d of decisions
    .filter((d) => d.status === 'applied')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    latest.set(d.request.date, d);
  const valid = attempts.filter(
    (a) => Number.isFinite(Date.parse(a.createdAt)) && Date.parse(a.createdAt) <= Date.parse(asOf),
  );
  return [...latest.values()]
    .sort((a, b) => b.request.date.localeCompare(a.request.date))
    .map((d) => {
      const keys = new Set([...d.after.review.map((r) => r.key), ...d.after.newKeys]);
      const selected = valid.filter((a) => keys.has(a.problemKey) && day(a.createdAt) === d.request.date);
      const latestAttempt = new Map<string, Attempt>();
      for (const a of selected.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
        latestAttempt.set(a.problemKey, a);
      const independent = [...latestAttempt.values()].filter((a) =>
        observations.some(
          (o) =>
            o.id === a.id &&
            o.problemKey === a.problemKey &&
            o.result === 'independent' &&
            o.accepted &&
            !o.assisted,
        ),
      );
      const timed = selected.filter((a) => a.minutes > 0 && a.minutes <= 240),
        minutes = timed.reduce((sum, a) => sum + a.minutes, 0);
      return {
        id: d.id,
        date: d.request.date,
        assigned: keys.size,
        evaluated: latestAttempt.size,
        independent: independent.length,
        hint: [...latestAttempt.values()].filter(
          (a) =>
            a.result === 'hint' ||
            observations.some((o) => o.id === a.id && o.problemKey === a.problemKey && o.assisted),
        ).length,
        independentPerHour:
          minutes > 0 && timed.length === selected.length ? (independent.length * 60) / minutes : null,
        minutes,
        timed: timed.length,
        attempts: selected.length,
        estimatedMinutes: d.result.estimatedMinutes,
        budget: d.request.budget,
        elapsed: d.request.date <= day(asOf),
      };
    });
}
