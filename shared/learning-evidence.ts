import { verdictLabel, type Attempt, type CFSubmission, type Review } from './domain.js';
import type { LearningRecord } from './learning-domain.js';
export interface LearningEvidence {
  id: string;
  kind: 'submission' | 'attempt' | 'reflection' | 'assistance' | 'experience' | 'verification' | 'transfer';
  at: string | null;
  title: string;
  summary: string;
  href: string;
  status: 'observed' | 'user-reported' | 'draft';
}
export function learningEvidence(input: {
  problemKey: string;
  submissions: CFSubmission[];
  attempts: Attempt[];
  review: Review;
  records: LearningRecord[];
  battle?: import('./battle-domain.js').BattleReward[];
}) {
  const events: LearningEvidence[] = [];
  for (const r of input.battle ?? []) events.push({
    id: r.itemId, kind: 'attempt', at: r.evaluatedAt, title: `连战评价 · ${{ independent: '独立完成', hint: '借助提示', failed: '未完成' }[r.result]}`,
    summary: `目标知识点 ${r.skillId} · ${r.result === 'independent' ? r.multiplier.toFixed(1) + '× 掌握度加成' : '无独立完成加成'}${r.submissionId ? ' · 提交 #' + r.submissionId : ''}`,
    href: '/battle', status: 'user-reported',
  });
  const link = (query: string) => '/problems/' + encodeURIComponent(input.problemKey) + '?' + query;
  const time = (value: string | number | undefined | null) => {
    if (value === null || value === undefined) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };
  for (const s of input.submissions)
    events.push({
      id: 'submission:' + s.id,
      kind: 'submission',
      at: time(s.creationTimeSeconds * 1000),
      title: `提交 #${s.id} · ${verdictLabel[s.verdict ?? ''] ?? s.verdict ?? '待判'}`,
      summary: `${s.programmingLanguage}。通过评测不等同于独立掌握。`,
      href: link('view=submissions'),
      status: 'observed',
    });
  for (const a of input.attempts)
    events.push({
      id: 'attempt:' + a.id,
      kind: 'attempt',
      at: time(a.createdAt),
      title: `重做评价 · ${{ independent: '独立完成', hint: '借助提示', failed: '仍未做出' }[a.result]}`,
      summary: `用户记录 ${a.minutes} 分钟${a.note ? ' · ' + a.note : ''}`,
      href: link('view=attempts'),
      status: 'user-reported',
    });
  if (input.review.firstReflectionAt)
    events.push({
      id: 'reflection:' + input.problemKey,
      kind: 'reflection',
      at: time(input.review.firstReflectionAt),
      title: '首次有效复盘已保存',
      summary: '以已保存分析字段为依据，不从 AI 草稿推断完成。',
      href: link('view=notes'),
      status: 'observed',
    });
  for (const r of input.records) {
    if (!('problemKey' in r) || r.problemKey !== input.problemKey) continue;
    if (r.kind === 'hint')
      events.push({
        id: 'hint:' + r.id,
        kind: 'assistance',
        at: time(r.createdAt),
        title: `已使用第 ${r.level} 级提示`,
        summary: '此会话需要新的独立验证；提示文本不作为掌握证据。',
        href: link('view=assistant&tool=hints'),
        status: 'observed',
      });
    if (r.kind === 'card')
      events.push({
        id: 'card:' + r.id,
        kind: 'experience',
        at: time(r.createdAt),
        title: '经验卡已创建',
        summary: `${r.title} · 当前${r.confirmed ? '已确认' : '待核对'}；此时间是创建时间。`,
        href: '/knowledge?experience=' + encodeURIComponent(r.id),
        status: r.confirmed ? 'user-reported' : 'draft',
      });
    if (r.kind === 'bundle') {
      events.push({
        id: 'bundle:' + r.id,
        kind: 'verification',
        at: time(r.createdAt),
        title: '对拍材料已生成',
        summary: '生成材料不表示运行通过。',
        href: link('view=assistant&tool=stress'),
        status: 'draft',
      });
      r.reports.forEach((report, index) =>
        events.push({
          id: `report:${r.id}:${index}`,
          kind: 'verification',
          at: null,
          title: `用户导入运行报告 · ${report.status}`,
          summary: `${report.rounds} 轮 · seed ${report.seed}。旧报告未记录导入时间，单独展示。`,
          href: link('view=assistant&tool=stress'),
          status: 'user-reported',
        }),
      );
    }
    if (r.kind === 'transfer') {
      events.push({
        id: 'transfer:' + r.id,
        kind: 'transfer',
        at: time(r.createdAt),
        title: `已安排迁移练习 ${r.targetKey}`,
        summary: `计划日期 ${r.date} · ${r.reason}`,
        href: '/?view=transfers',
        status: 'observed',
      });
      if (r.result !== 'pending')
        events.push({
          id: 'transfer-result:' + r.id,
          kind: 'transfer',
          at: time(r.evaluatedAt),
          title: '迁移练习已评价',
          summary: `${r.result} · ${r.minutes} 分钟`,
          href: '/?view=transfers',
          status: 'user-reported',
        });
    }
  }
  return events.sort((a, b) =>
    a.at === null
      ? b.at === null
        ? a.id.localeCompare(b.id)
        : 1
      : b.at === null
        ? -1
        : Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );
}
