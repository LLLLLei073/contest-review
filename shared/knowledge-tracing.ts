import { z } from 'zod';

export const BKT_VERSION = 'bkt-2-battle-uncalibrated';
export const bktParametersSchema = z.object({
  initial: z.number().min(0).max(1),
  learn: z.number().min(0).max(1),
  guess: z.number().min(0).max(1),
  slip: z.number().min(0).max(1),
});
export type BktParameters = z.infer<typeof bktParametersSchema>;
export const DEFAULT_BKT: Readonly<BktParameters> = Object.freeze({
  initial: 0.2,
  learn: 0.05,
  guess: 0.2,
  slip: 0.1,
});

/** Engineering defaults, not calibrated estimates of ability. BKT does not model forgetting. */
export function updateKnowledge(prior: number, correct: boolean, parameters: BktParameters = DEFAULT_BKT) {
  const p = bktParametersSchema.parse(parameters);
  if (!Number.isFinite(prior) || prior < 0 || prior > 1) throw new Error('掌握概率必须介于 0 和 1');
  const known = prior * (correct ? 1 - p.slip : p.slip);
  const unknown = (1 - prior) * (correct ? p.guess : 1 - p.guess);
  // An impossible observation under extreme parameters supplies no information.
  const posterior = known + unknown === 0 ? prior : known / (known + unknown);
  return Math.min(1, Math.max(0, posterior + (1 - posterior) * p.learn));
}

export interface KnowledgeObservation {
  id: string;
  problemKey: string;
  session: string;
  at: string;
  skillIds: string[];
  /** Explicit attribution only; never inferred by the language model. */
  attributedSkillId?: string;
  result: 'independent' | 'failed' | 'hint' | 'accepted';
  accepted: boolean;
  assisted: boolean;
  learningMultiplier?: number;
  acceptedSubmissionId?: number;
}
export interface KnowledgeState {
  skillId: string;
  probability: number;
  samples: number;
  distinctProblems: number;
  insufficient: boolean;
  independentProblems: number;
  evidenceIds: string[];
  lastEvidenceAt: string | null;
}
export type EvidenceExclusion =
  'future' | 'invalid-time' | 'duplicate' | 'assisted' | 'unverified' | 'mixed' | 'unmapped';

export function traceKnowledge(
  skillIds: string[],
  observations: KnowledgeObservation[],
  asOf: string,
  parameters: BktParameters = DEFAULT_BKT,
) {
  const params = bktParametersSchema.parse(parameters);
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error('知识追踪时间无效');
  const states = new Map<string, KnowledgeState>(
    [...new Set(skillIds)].sort().map((skillId) => [
      skillId,
      {
        skillId,
        probability: params.initial,
        samples: 0,
        distinctProblems: 0,
        insufficient: true,
        independentProblems: 0,
        evidenceIds: [],
        lastEvidenceAt: null,
      },
    ]),
  );
  const excluded: { id: string; reason: EvidenceExclusion }[] = [];
  const groups = new Map<string, KnowledgeObservation[]>();
  for (const o of observations) {
    const at = Date.parse(o.at);
    if (!Number.isFinite(at) || at > cutoff) {
      excluded.push({ id: o.id, reason: !Number.isFinite(at) ? 'invalid-time' : 'future' });
      continue;
    }
    const key = JSON.stringify([o.problemKey, o.session]);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  // Last explicit evaluation wins within a session; assistance contaminates the whole session.
  const selected: KnowledgeObservation[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
    const latest = group.at(-1)!;
    for (const older of group.slice(0, -1)) excluded.push({ id: older.id, reason: 'duplicate' });
    if (group.some((o) => o.assisted || o.result === 'hint'))
      excluded.push({ id: latest.id, reason: 'assisted' });
    else selected.push(latest);
  }
  selected.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const problems = new Map<string, Set<string>>();
  const successes = new Map<string, Set<string>>();
  const seenIds = new Set<string>();
  for (const o of selected) {
    let reason: EvidenceExclusion | undefined;
    const skills = [...new Set(o.skillIds)];
    const skill = o.attributedSkillId ?? (skills.length === 1 ? skills[0] : undefined);
    if (seenIds.has(o.id)) reason = 'duplicate';
    else if (o.result !== 'failed' && !(o.result === 'independent' && o.accepted)) reason = 'unverified';
    else if (!skills.length || (skill && (!skills.includes(skill) || !states.has(skill))))
      reason = 'unmapped';
    else if (!skill) reason = 'mixed';
    if (reason) {
      excluded.push({ id: o.id, reason });
      continue;
    }
    seenIds.add(o.id);
    const state = states.get(skill!)!;
    const multiplier = o.result === 'independent' ? Math.max(1, Math.min(1.5, o.learningMultiplier ?? 1)) : 1;
    state.probability = updateKnowledge(state.probability, o.result === 'independent', { ...params, learn: Math.min(1, params.learn * multiplier) });
    state.samples++;
    state.evidenceIds.push(o.id);
    state.lastEvidenceAt = o.at;
    const distinct = problems.get(skill!) ?? new Set<string>();
    distinct.add(o.problemKey);
    problems.set(skill!, distinct);
    state.distinctProblems = distinct.size;
    state.insufficient = distinct.size < 3;
    const independent = successes.get(skill!) ?? new Set<string>();
    if (o.result === 'independent') independent.add(o.problemKey);
    else independent.delete(o.problemKey);
    successes.set(skill!, independent);
    state.independentProblems = independent.size;
  }
  return {
    version: BKT_VERSION,
    parameters: params,
    calibrated: false as const,
    states: [...states.values()],
    excluded: excluded.sort((a, b) => a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason)),
  };
}
