import type { CoreStore } from './core-store.js';
import { BattleService } from './battle-service.js';
import { ReviewWorkflowService, stageLabels } from './review-workflow.js';
export interface TrainingContinuation {
  kind: 'workflow' | 'battle';
  id: string;
  title: string;
  stage: string;
  updatedAt: string;
  href: string;
}
/** Reads existing evidence only; never starts a session or advances a task. */
export function trainingContinuations(store: CoreStore): TrainingContinuation[] {
  const result: TrainingContinuation[] = [];
  const workflow = new ReviewWorkflowService(store);
  for (const row of workflow.records()) {
    if (['completed', 'cancelled'].includes(row.status)) continue;
    try {
      workflow.read(row.id);
      workflow.contextEvidence(row);
      const context = row.context;
      const title =
        context.kind === 'problem'
          ? (store.detail(store.profileForKey(context.problemKey), context.problemKey)?.problem.name ??
            context.problemKey)
          : context.kind === 'contest'
            ? `${context.source.toUpperCase()} · ${context.contestId}`
            : '引导复盘';
      result.push({
        kind: 'workflow',
        id: row.id,
        title,
        stage: stageLabels[row.stage],
        updatedAt: row.updatedAt,
        href:
          '/companion?sessionId=' +
          encodeURIComponent(row.sessionId) +
          '&workflowId=' +
          encodeURIComponent(row.id),
      });
    } catch {
      /* Invalid or foreign contexts must never become continuation links. */
    }
  }
  for (const row of new BattleService(store).records()) {
    if (row.status === 'ended') continue;
    result.push({
      kind: 'battle',
      id: row.id,
      title: row.theme,
      stage: row.pendingCount ? '待补评' : row.status === 'paused' ? '已暂停' : '当前题目',
      updatedAt: row.updatedAt,
      href: '/battle?sessionId=' + encodeURIComponent(row.id) + '&continue=1',
    });
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
