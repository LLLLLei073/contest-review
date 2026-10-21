import type { KnowledgeCard } from './knowledge.js';
import type { KnowledgeState } from './knowledge-tracing.js';

export const PATH_VERSION = 'prerequisite-dag-2';
export interface PathNode {
  id: string;
  title: string;
  prerequisites: string[];
  successors: string[];
  target: boolean;
  verified: boolean;
  ready: boolean;
  priority: number;
  estimatedMinutes: number;
  reason: string;
}
export interface PathIssue {
  kind: 'duplicate' | 'unknown-target' | 'dangling' | 'cycle';
  ids: string[];
}

/** Full AND dependency closure; a recommendation never prevents manually opening a card. */
export function buildLearningPath(
  cards: Pick<KnowledgeCard, 'id' | 'title' | 'prerequisites'>[],
  targets: string[],
  states: KnowledgeState[] = [],
) {
  const graph = new Map(cards.map((c) => [c.id, c]));
  const issues: PathIssue[] = [];
  const duplicates = cards.filter((c, i) => cards.findIndex((x) => x.id === c.id) !== i).map((c) => c.id);
  if (duplicates.length) issues.push({ kind: 'duplicate', ids: [...new Set(duplicates)].sort() });
  const closure = new Set<string>();
  const pending = [...new Set(targets)].sort();
  for (const id of pending) if (!graph.has(id)) issues.push({ kind: 'unknown-target', ids: [id] });
  while (pending.length) {
    const id = pending.pop()!;
    if (closure.has(id) || !graph.has(id)) continue;
    closure.add(id);
    for (const prerequisite of new Set(graph.get(id)!.prerequisites)) {
      if (!graph.has(prerequisite)) issues.push({ kind: 'dangling', ids: [id, prerequisite] });
      else pending.push(prerequisite);
    }
  }
  const successors = new Map([...closure].map((id) => [id, [] as string[]]));
  const degrees = new Map<string, number>();
  for (const id of closure) {
    const deps = [...new Set(graph.get(id)!.prerequisites)].filter((p) => closure.has(p));
    degrees.set(id, deps.length);
    for (const dep of deps) successors.get(dep)!.push(id);
  }
  const knowledge = new Map(states.map((s) => [s.skillId, s]));
  const verified = (id: string) => (knowledge.get(id)?.independentProblems ?? 0) >= 3;
  // Cold-start reference: remaining distinct validations at 35 minutes each, not a promise.
  const burden = (id: string) => Math.max(0, 3 - (knowledge.get(id)?.independentProblems ?? 0)) * 35;
  const priority = (id: string) => {
    const state = knowledge.get(id);
    const gap = state && !state.insufficient ? 1 - state.probability : 0.5;
    return (
      (targets.includes(id) ? 4 : 0) +
      (verified(id) ? 0 : 2) +
      successors.get(id)!.length +
      gap -
      burden(id) / 105
    );
  };
  const ready = [...closure].filter((id) => degrees.get(id) === 0);
  const nodes: PathNode[] = [];
  while (ready.length) {
    ready.sort((a, b) => priority(b) - priority(a) || a.localeCompare(b));
    const id = ready.shift()!,
      card = graph.get(id)!;
    const deps = [...new Set(card.prerequisites)].sort();
    const confirmed = verified(id);
    nodes.push({
      id,
      title: card.title,
      prerequisites: deps,
      successors: successors.get(id)!.sort(),
      target: targets.includes(id),
      verified: confirmed,
      ready: deps.every(verified),
      priority: priority(id),
      estimatedMinutes: burden(id),
      reason: confirmed
        ? '已有至少三道不同题目的独立验证，可展开复查'
        : deps.some((p) => !verified(p))
          ? '先补足列出的全部基础，再推进此节点'
          : knowledge.get(id)?.insufficient !== false
            ? '证据不足，先安排基础验证'
            : '依据目标关联、知识缺口与后续解锁顺序推荐',
    });
    for (const next of successors.get(id)!) {
      degrees.set(next, degrees.get(next)! - 1);
      if (degrees.get(next) === 0) ready.push(next);
    }
  }
  const blocked = [...closure].filter((id) => !nodes.some((n) => n.id === id)).sort();
  if (blocked.length) issues.push({ kind: 'cycle', ids: blocked });
  return {
    version: PATH_VERSION,
    targets: [...new Set(targets)].sort(),
    nodes,
    issues,
    valid: issues.length === 0,
    next: issues.length ? null : (nodes.find((n) => !n.verified && n.ready)?.id ?? null),
  };
}
