import { fingerprint } from './learning-domain.js';
import { categoryNames, type MasteryArea } from './training.js';
import { phaseLabels, programProgress, type TrainingProgram } from './program-domain.js';
import type { Attempt } from './domain.js';

export interface ProgramReportEvidence {
  id: string;
  text: string;
  url: string;
}
export interface ProgramReportFinding {
  title: string;
  cause: string;
  action: string;
  evidenceIds: string[];
}
export interface ProgramReportInput {
  program: TrainingProgram;
  acceptedDays: Map<string, string>;
  attempts: Attempt[];
  transfers: { result: string; problemKey: string; targetKey: string }[];
  currentMastery: MasteryArea[];
  today: string;
}
export interface ProgramReport {
  metrics: {
    planned: number;
    ac: number;
    independent: number;
    hint: number;
    completionRate: number;
    independentRate: number | null;
    doneDays: number;
    missedDays: number;
    carryShare: number;
    perPhase: { phase: string; label: string; planned: number; ac: number }[];
    challengeAc: number;
    transfers: { independent: number; hint: number; failed: number; pending: number };
    elapsedDays: number;
    finished: boolean;
  };
  focusDelta: { name: string; before: number | null; after: number }[];
  findings: ProgramReportFinding[];
  evidence: ProgramReportEvidence[];
  warnings: string[];
  fingerprint: string;
}
const percent = (value: number) => `${Math.round(value * 100)}%`;
/** 计划总结报告：纯派生，不持久化；每条 finding 都引用真实存在的证据。 */
export function buildProgramReport(input: ProgramReportInput): ProgramReport {
  const { program, acceptedDays, today } = input;
  const warnings: string[] = [];
  const evidence: ProgramReportEvidence[] = [];
  const ev = (text: string, url = ''): string => {
    const id = 'pe' + (evidence.length + 1);
    evidence.push({ id, text, url });
    return id;
  };
  const progress = programProgress(program, today, acceptedDays);
  const lastDay = program.days.at(-1)?.date ?? today;
  const keys = [...new Set(program.days.flatMap((d) => d.problems.map((p) => p.key)))];
  const acOf = (key: string, until?: string) => {
    const at = acceptedDays.get(key);
    return at !== undefined && (!until || at <= until) ? at : null;
  };
  const ac = keys.filter((k) => acOf(k, today)).length;
  const keyAttempts = input.attempts.filter((a) => keys.includes(a.problemKey));
  const latestAttempt = new Map<string, Attempt>();
  for (const a of keyAttempts)
    if (!latestAttempt.has(a.problemKey) || latestAttempt.get(a.problemKey)!.createdAt < a.createdAt)
      latestAttempt.set(a.problemKey, a);
  const independent = [...latestAttempt.values()].filter((a) => a.result === 'independent').length;
  const hint = [...latestAttempt.values()].filter((a) => a.result === 'hint').length;
  const carry = keys.filter((k) => !acceptedDays.get(k)).length;
  const carryShare = keys.length ? carry / keys.length : 0;
  const perPhase = [...new Set(program.days.map((d) => d.phase))].map((phase) => {
    const dayList = progress.days.filter((d) => d.phase === phase);
    return {
      phase,
      label: phaseLabels[phase],
      planned: dayList.reduce((sum, d) => sum + d.total, 0),
      ac: dayList.reduce((sum, d) => sum + d.ac, 0),
    };
  });
  const challengeDay = program.days.find((d) => d.phase === 'challenge');
  const challengeAc = challengeDay
    ? challengeDay.problems.filter((p) => acOf(p.key, today) !== null).length
    : 0;
  const transfers = {
    independent: input.transfers.filter((t) => t.result === 'independent').length,
    hint: input.transfers.filter((t) => t.result === 'hint').length,
    failed: input.transfers.filter((t) => t.result === 'failed').length,
    pending: input.transfers.filter((t) => t.result === 'pending').length,
  };
  const elapsedDays = progress.days.filter((d) => d.date <= today).length;
  const metrics = {
    planned: keys.length,
    ac,
    independent,
    hint,
    completionRate: keys.length ? ac / keys.length : 0,
    independentRate: ac > 0 ? independent / ac : null,
    doneDays: progress.doneDays,
    missedDays: progress.days.filter((d) => d.date <= today && d.status === 'missed').length,
    carryShare,
    perPhase,
    challengeAc,
    transfers,
    elapsedDays,
    finished: program.status === 'completed' || lastDay <= today,
  };
  const before = new Map((program.baselineMastery ?? []).map((m) => [m.name, m.score]));
  const after = new Map(input.currentMastery.map((m) => [m.name, m.score]));
  const focusDelta = [
    ...program.focus,
    ...categoryNames.filter((name) => !program.focus.includes(name)),
  ].map((name) => ({ name, before: before.get(name) ?? null, after: after.get(name) ?? 0 }));
  if (!program.baselineMastery?.length)
    warnings.push('该计划没有采纳时的掌握度快照（旧版本创建），前后对比不可用');
  if (!keyAttempts.length) warnings.push('计划期间没有评价记录，独立完成率不可信');
  // 证据：计划规模、阶段完成、挑战日、独立完成样本、掌握度变化、迁移。
  const evScale = ev(
    `计划 ${program.duration} 天 · 主攻 ${program.focus.join('、')} · 共安排 ${keys.length} 道新题`,
    '/?view=program',
  );
  const evProgress = ev(
    `完成 ${ac}/${keys.length} 题（${percent(metrics.completionRate)}）· 完成 ${metrics.doneDays} 天 · 落下 ${metrics.missedDays} 天`,
    '/?view=program',
  );
  let evChallenge: string | null = null;
  if (challengeDay) {
    const done = challengeDay.problems.filter((p) => acOf(p.key, today));
    evChallenge = ev(
      `挑战日（${challengeDay.date}）：${done.length ? `完成 ${done.map((p) => p.key).join('、')}` : '未完成挑战题'}`,
      done[0] ? '/problems/' + encodeURIComponent(done[0].key) : '/?view=program',
    );
  }
  for (const a of [...latestAttempt.values()].filter((a) => a.result === 'independent').slice(0, 3))
    ev(`独立完成：${a.problemKey}（用时 ${a.minutes} 分钟）`, '/problems/' + encodeURIComponent(a.problemKey));
  let evMastery: string | null = null;
  for (const delta of focusDelta.filter((d) => program.focus.includes(d.name))) {
    evMastery = ev(
      `${delta.name} 掌握度 ${delta.before ?? '?'} → ${delta.after}（${delta.before == null ? '无基线' : (delta.after - delta.before >= 0 ? '+' : '') + (delta.after - delta.before)}）`,
      '/insights',
    );
  }
  const findings: ProgramReportFinding[] = [];
  if (metrics.completionRate >= 0.8)
    findings.push({
      title: '计划执行力强',
      cause: `完成率 ${percent(metrics.completionRate)}（${ac}/${keys.length}），仅 ${metrics.missedDays} 天未跟上安排。`,
      action: '保持当前节奏，下一轮可在生成时直接上调每日题量。',
      evidenceIds: [evScale, evProgress],
    });
  else if (metrics.completionRate < 0.5 && elapsedDays >= 2)
    findings.push({
      title: '训练量偏大，跟上安排比题量更重要',
      cause: `完成率仅 ${percent(metrics.completionRate)}（${ac}/${keys.length}），${metrics.missedDays} 天整日落下。`,
      action: '中期校准已可下调难度与题量；下一轮生成时把每日题量降到 6，先保证完成率。',
      evidenceIds: [evScale, evProgress],
    });
  else if (keys.length)
    findings.push({
      title: '计划推进正常',
      cause: `完成率 ${percent(metrics.completionRate)}（${ac}/${keys.length}），完成 ${metrics.doneDays} 天。`,
      action: '继续执行；如某类题反复落下，用单日换题替换为更贴合薄弱标签的题。',
      evidenceIds: [evProgress],
    });
  if (metrics.independentRate != null) {
    if (metrics.independentRate >= 0.7)
      findings.push({
        title: '该难度带已可独立攻克',
        cause: `独立完成率 ${percent(metrics.independentRate)}（独立 ${independent}/AC ${ac}），说明当前难度大部分能自己解出。`,
        action: '下一轮计划可直接把难度基准上调 100，或用中期校准提前上调。',
        evidenceIds: [evProgress],
      });
    else if (metrics.independentRate < 0.4)
      findings.push({
        title: '独立解题比例偏低',
        cause: `独立完成率 ${percent(metrics.independentRate)}（独立 ${independent}/AC ${ac}），较多题目借助提示才完成。`,
        action: '维持当前难度再练一轮；做题时先强制独立思考 15 分钟再使用提示。',
        evidenceIds: [evProgress],
      });
  }
  const mainFocus = focusDelta.find((d) => d.name === program.focus[0]);
  if (mainFocus && mainFocus.before != null) {
    const delta = mainFocus.after - mainFocus.before;
    if (delta >= 8)
      findings.push({
        title: `主攻领域「${mainFocus.name}」确认突破`,
        cause: `掌握度从 ${mainFocus.before} 提升到 ${mainFocus.after}（+${delta}）。`,
        action: '该领域可以移出主攻列表，下一轮换下一个最薄弱领域。',
        evidenceIds: [evMastery ?? evProgress],
      });
    else if (delta < 3 && metrics.finished)
      findings.push({
        title: `「${mainFocus.name}」提升有限`,
        cause: `掌握度 ${mainFocus.before} → ${mainFocus.after}（${delta >= 0 ? '+' : ''}${delta}），专项练习未显著改变掌握度。`,
        action: '换一批题型（用换题功能替换低完成日的题），或检查错题复盘是否跟上了安排。',
        evidenceIds: [evMastery ?? evProgress],
      });
  }
  if (challengeAc > 0 && challengeDay && evChallenge)
    findings.push({
      title: '挑战日拿下一道硬题',
      cause: `挑战日（难度 ${challengeDay.band.minimum}–${challengeDay.band.maximum}）完成 ${challengeAc} 道，是本轮计划的难度上限验证。`,
      action: '把该题加入复盘收藏，下一轮难度基准可参考此题上探。',
      evidenceIds: [evChallenge],
    });
  if (carryShare > 0.25 && !metrics.finished)
    findings.push({
      title: '补做占比偏高',
      cause: `还有 ${carry} 道（${percent(carryShare)}）计划题未 AC，正在顺延补做。`,
      action: '优先补做而非开新题；连续两三天补做超半时用校准降档。',
      evidenceIds: [evProgress],
    });
  const transferDone = transfers.independent + transfers.hint + transfers.failed;
  if (transferDone > 0)
    findings.push({
      title: transfers.independent / transferDone >= 0.5 ? '迁移练习有效' : '迁移能力仍需巩固',
      cause: `计划相关迁移题独立 ${transfers.independent}、借助提示 ${transfers.hint}、未通过 ${transfers.failed}、待验证 ${transfers.pending}。`,
      action: transfers.independent / transferDone >= 0.5
        ? '保持错题→变式的闭环，把迁移题安排进下一轮计划的迁移日。'
        : '迁移前先重做原题并写复盘，再独立尝试变式。',
      evidenceIds: [evProgress],
    });
  const fingerprintSource = [
    program.id,
    program.duration,
    metrics,
    focusDelta.map((d) => [d.name, d.before, d.after]),
    findings.map((f) => [f.title, f.cause, f.action]),
    [...acceptedDays.entries()].sort(),
  ];
  return {
    metrics,
    focusDelta,
    findings,
    evidence,
    warnings,
    fingerprint: fingerprint(fingerprintSource),
  };
}
