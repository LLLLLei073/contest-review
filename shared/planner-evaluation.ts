import { DEFAULT_BKT, traceKnowledge, type KnowledgeObservation } from './knowledge-tracing.js';

/** Predict each next observation using only observations strictly earlier than its timestamp. */
export function evaluateKnowledgePredictions(
  observations: KnowledgeObservation[],
  skillIds: string[],
  asOf: string,
) {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error('回放截止时间无效');
  const included = observations
    .filter((o) => Number.isFinite(Date.parse(o.at)) && Date.parse(o.at) <= cutoff)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const rows: {
    id: string;
    at: string;
    skillId: string;
    probability: number;
    correct: boolean;
    priorSamples: number;
    brier: number;
  }[] = [];
  for (const observation of included) {
    const current = traceKnowledge(
      skillIds,
      included.filter((o) => Date.parse(o.at) <= Date.parse(observation.at)),
      observation.at,
    );
    if (current.excluded.some((e) => e.id === observation.id)) continue;
    const skill = current.states.find((s) => s.evidenceIds.includes(observation.id));
    if (!skill) continue;
    const prior = traceKnowledge(
      skillIds,
      included.filter((o) => Date.parse(o.at) < Date.parse(observation.at)),
      observation.at,
    ).states.find((s) => s.skillId === skill.skillId)!;
    const probability =
      prior.probability * (1 - DEFAULT_BKT.slip) + (1 - prior.probability) * DEFAULT_BKT.guess;
    const correct = observation.result === 'independent';
    rows.push({
      id: observation.id,
      at: observation.at,
      skillId: skill.skillId,
      probability,
      correct,
      priorSamples: prior.samples,
      brier: (Number(correct) - probability) ** 2,
    });
  }
  return {
    asOf,
    samples: rows.length,
    brier: rows.length ? rows.reduce((n, r) => n + r.brier, 0) / rows.length : null,
    insufficient: rows.length < 30,
    rows,
    conclusion: '描述性回放，不证明学习效率的因果提升；参数尚未校准',
  };
}
