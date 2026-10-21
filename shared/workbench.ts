import type { TrainingDay, TrainingTask } from './training.js';

export interface TrainingAction {
  kind: 'account' | 'goal' | 'review' | 'new' | 'complete' | 'shortage';
  title: string;
  reason: string;
  label: string;
  href?: string;
  taskKey?: string;
}

/** Presentation only: choose from the saved day without generating or mutating a plan. */
export function nextTrainingAction(
  day: TrainingDay | null,
  account: { cf: boolean; atcoder: boolean },
): TrainingAction | null {
  if (!account.cf && !account.atcoder)
    return {
      kind: 'account',
      title: '从真实训练记录开始',
      reason: '连接账号后，提交、错题与复习才有可核验的依据。',
      label: '连接账号',
      href: '/settings?view=accounts',
    };
  if (!day) return null;
  const rank = (task: TrainingTask) => {
    if (task.phase === 'evaluation') return 0;
    if (task.phase === 'reflection') return 1;
    if (
      task.kind === 'due' &&
      task.nextReview &&
      Date.parse(task.nextReview) < Date.parse(`${day.date}T00:00:00`)
    )
      return 2;
    return 3;
  };
  const next = day.review
    .filter((task) => !task.completed && task.phase !== 'done')
    .map((task, index) => ({ task, index }))
    .sort((a, b) => rank(a.task) - rank(b.task) || a.index - b.index)[0]?.task;
  if (next) {
    const evaluation = next.phase === 'evaluation';
    const reflection = next.phase === 'reflection';
    return {
      kind: 'review',
      taskKey: next.key,
      title: next.name,
      label: evaluation ? '评价这次重做' : reflection ? '补全复盘' : '开始重做',
      reason: evaluation
        ? '已确认重做结果；还需要你评价是否独立完成，再安排下次复习。'
        : reflection
          ? '尝试已有记录；留下关键思路或错因，完成这一步复盘。'
          : rank(next) === 2
            ? '这道题已经逾期，优先独立重做一次，检验是否还记得关键思路。'
            : '从已保存的复习题单继续，先尝试，再记录实际结果。',
      href: `/problems/${encodeURIComponent(next.key)}?view=notes${evaluation ? '&focus=evaluation' : ''}`,
    };
  }
  if (account.cf && !day.weeklyGoal)
    return {
      kind: 'goal',
      title: '为本周选一个方向',
      reason: '复习已安排好；选择本周目标后才能生成新的训练题。',
      label: '选择本周目标',
    };
  const fresh = day.newProblems.find((task) => !task.completed);
  if (fresh)
    return {
      kind: 'new',
      title: fresh.name,
      reason: fresh.recommendationReason || '继续今天已保存的新知题，不会额外增加题目。',
      label: '打开原题',
      href: fresh.url,
      taskKey: fresh.key,
    };
  if (day.newShortage && !day.review.length && !day.newProblems.length)
    return {
      kind: 'shortage',
      title: '当前没有可安排的题目',
      reason: day.newShortage,
      label: '检查题库与同步',
      href: '/settings?view=sync',
    };
  if (!day.review.length && !day.newProblems.length)
    return {
      kind: 'shortage',
      title: '今天暂时没有训练任务',
      reason: '可以检查同步状态，或从错题库选择需要巩固的题目。',
      label: '打开错题库',
      href: '/problems',
    };
  return {
    kind: 'complete',
    title: '今天的安排已完成',
    reason: '做过与理解都留下了记录。可以回顾今天的收获，再决定明天的方向。',
    label: '回顾训练记录',
    href: '/statistics?view=activity',
  };
}
