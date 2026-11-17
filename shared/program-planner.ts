import {
  categories,
  selectProblems,
  type Catalog,
  type CategoryName,
  type DifficultyBand,
  type MasteryArea,
  type ProblemRole,
} from './training.js';
import {
  phaseLabels,
  roleLabels,
  programDaySchema,
  trainingProgramSchema,
  type ProgramDay,
  type ProgramPhase,
  type TrainingProgram,
} from './program-domain.js';

export interface ProgramPlannerInput {
  today: string;
  duration: 7 | 14;
  dailyCount: number;
  focus: CategoryName[];
  catalog: Catalog['problems'];
  blocked: Set<string>;
  mastery: MasteryArea[];
  weak: Map<string, number>;
  band: DifficultyBand;
  minutesPerProblem: number;
  minutesBasis: string;
}
interface DayTemplate {
  phase: ProgramPhase;
  minimum: number;
  maximum: number;
  preferred: number;
  block?: string;
}
export function buildArc(band: DifficultyBand, duration: 7 | 14): DayTemplate[] {
  const P = band.preferred;
  const floor = (n: number) => Math.max(800, n);
  const cap = (n: number) => Math.min(3500, n);
  if (duration === 7)
    return [
      { phase: 'foundation', minimum: floor(P - 100), maximum: P, preferred: P - 50 },
      { phase: 'reinforce', minimum: P, maximum: P + 100, preferred: P + 50, block: 'I' },
      { phase: 'reinforce', minimum: P, maximum: P + 100, preferred: P + 50, block: 'I' },
      { phase: 'checkpoint', minimum: P, maximum: P + 100, preferred: P + 50 },
      { phase: 'reinforce', minimum: P + 100, maximum: P + 200, preferred: P + 150, block: 'II' },
      { phase: 'reinforce', minimum: P + 100, maximum: P + 200, preferred: P + 150, block: 'II' },
      { phase: 'challenge', minimum: P + 200, maximum: cap(P + 350), preferred: P + 250 },
    ];
  return [
    { phase: 'foundation', minimum: floor(P - 100), maximum: P, preferred: P - 50 },
    { phase: 'foundation', minimum: floor(P - 100), maximum: P, preferred: P - 50 },
    { phase: 'reinforce', minimum: P, maximum: P + 100, preferred: P + 50, block: 'I' },
    { phase: 'reinforce', minimum: P, maximum: P + 100, preferred: P + 50, block: 'I' },
    { phase: 'reinforce', minimum: P, maximum: P + 100, preferred: P + 50, block: 'I' },
    { phase: 'checkpoint', minimum: P, maximum: P + 100, preferred: P + 50 },
    { phase: 'reinforce', minimum: P + 100, maximum: P + 200, preferred: P + 150, block: 'II' },
    { phase: 'reinforce', minimum: P + 100, maximum: P + 200, preferred: P + 150, block: 'II' },
    { phase: 'reinforce', minimum: P + 100, maximum: P + 200, preferred: P + 150, block: 'II' },
    { phase: 'checkpoint', minimum: P + 100, maximum: P + 200, preferred: P + 150 },
    { phase: 'transfer', minimum: P + 100, maximum: P + 200, preferred: P + 150 },
    { phase: 'transfer', minimum: P + 100, maximum: P + 200, preferred: P + 150 },
    { phase: 'challenge', minimum: P + 200, maximum: cap(P + 350), preferred: P + 250 },
    { phase: 'summary', minimum: P, maximum: P + 100, preferred: P + 50 },
  ];
}
export function phaseCount(phase: ProgramPhase, dailyCount: number): number {
  switch (phase) {
    case 'foundation':
    case 'reinforce':
    case 'transfer':
      return dailyCount;
    case 'checkpoint':
      return Math.max(2, Math.round(dailyCount / 3));
    case 'challenge':
      return dailyCount >= 9 ? 3 : 2;
    case 'summary':
      return 2;
  }
}
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00+08:00');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function themeOf(template: DayTemplate, focus: CategoryName[]): string {
  const name = focus.join('+');
  switch (template.phase) {
    case 'foundation':
      return `基础巩固·${name}`;
    case 'reinforce':
      return `专项强化${template.block ?? ''}·${name}`;
    case 'checkpoint':
      return '复盘节点·消化错题与到期复习';
    case 'transfer':
      return `综合迁移·${name}交叉演练`;
    case 'challenge':
      return '挑战日·冲击更高难度';
    case 'summary':
      return '总复盘·收束与总结';
  }
}
export interface DayBuildInput {
  date: string;
  index: number;
  phase: ProgramPhase;
  block?: string;
  count: number;
  band: { minimum: number; maximum: number; preferred: number };
  focus: CategoryName[];
  catalog: Catalog['problems'];
  blocked: Set<string>;
  mastery: MasteryArea[];
  weak: Map<string, number>;
  minutesPerProblem: number;
  /** 校准重建时给推荐理由加前缀。 */
  reasonPrefix?: string;
}
/** 单题估时按难度分档：高于当日目标难度的题按比例放大，反之缩小。 */
export function estimateForRating(base: number, rating: number | null, preferred: number): number {
  const factor =
    rating == null ? 1 : Math.max(0.8, Math.min(1.4, 1 + (rating - preferred) / 600));
  return Math.max(5, Math.round(base * factor));
}
/** 构建单日安排：transfer 日先做双焦点交叉预筛，再走统一评分引擎补足，最后生成理由与估时。 */
export function buildDay(input: DayBuildInput): ProgramDay {
  const byKey = new Map(input.catalog.map((p) => [p.key, p]));
  const picks: { key: string; role: ProblemRole }[] = [];
  // 综合迁移日：先从同时命中全部焦点领域的题里取两道，强化交叉套路。
  if (input.phase === 'transfer' && input.focus.length === 2) {
    const both = input.catalog.filter((p) => {
      const names = categories(p.tags);
      return input.focus.every((f) => names.includes(f));
    });
    if (both.length >= 2) {
      const cross = selectProblems(both, input.blocked, input.mastery, {
        date: input.date,
        count: 2,
        band: input.band,
        focus: input.focus,
        weak: input.weak,
        relax: true,
      });
      for (const pick of cross.picks) {
        picks.push(pick);
        input.blocked.add(pick.key);
      }
    }
  }
  const selection = selectProblems(input.catalog, input.blocked, input.mastery, {
    date: input.date,
    count: input.count - picks.length,
    band: input.band,
    focus: input.focus,
    weak: input.weak,
    relax: true,
  });
  picks.push(...selection.picks);
  for (const pick of selection.picks) input.blocked.add(pick.key);
  const reasons: Record<string, string> = {};
  let estimateMinutes = 0;
  for (const pick of picks) {
    const problem = byKey.get(pick.key);
    estimateMinutes += estimateForRating(input.minutesPerProblem, problem?.rating ?? null, input.band.preferred);
    const weakHit = problem?.tags.filter((t) => (input.weak.get(t) ?? 0) >= 0.25).slice(0, 2);
    reasons[pick.key] = [
      `${input.reasonPrefix ? input.reasonPrefix + '·' : ''}第${input.index + 1}天·${phaseLabels[input.phase]}${input.block ?? ''}`,
      input.focus.length ? `主攻 ${input.focus.join('、')}` : '',
      `${roleLabels[pick.role]}题（难度 ${problem?.rating ?? '?'}）`,
      weakHit?.length ? `命中薄弱标签：${weakHit.join('、')}` : '',
      input.weak.size === 0 && pick.role === 'core' ? '暂无失败记录，按薄弱领域与质量先验选取' : '',
    ]
      .filter(Boolean)
      .join('；');
  }
  return programDaySchema.parse({
    date: input.date,
    phase: input.phase,
    theme: themeOf({ phase: input.phase, minimum: input.band.minimum, maximum: input.band.maximum, preferred: input.band.preferred, block: input.block }, input.focus),
    focus: input.focus,
    band: input.band,
    problems: picks,
    reasons,
    shortage: selection.shortage,
    estimateMinutes,
  });
}
/** 渐进式训练计划生成：跨天难度爬坡 + 单日热身→核心→拉伸阶梯，选题走统一评分引擎。 */
export function buildProgram(input: ProgramPlannerInput): {
  program: TrainingProgram;
  warnings: string[];
} {
  const warnings: string[] = [];
  const focus = input.focus.slice(0, 2);
  const blocked = new Set(input.blocked);
  const arc = buildArc(input.band, input.duration);
  const days = arc.map((template, index) =>
    buildDay({
      date: addDays(input.today, index),
      index,
      phase: template.phase,
      block: template.block,
      count: phaseCount(template.phase, input.dailyCount),
      band: {
        minimum: template.minimum,
        maximum: template.maximum,
        preferred: template.preferred,
      },
      focus,
      catalog: input.catalog,
      blocked,
      mastery: input.mastery,
      weak: input.weak,
      minutesPerProblem: input.minutesPerProblem,
    }),
  );
  const shortages = days.filter((d) => d.shortage).length;
  if (shortages) warnings.push(`${shortages} 天的候选题不足，已按可选数量安排，可在对应日换题`);
  const weakest = [...input.mastery]
    .sort((a, b) => a.score - b.score || b.samples - a.samples)
    .filter((a) => a.name === focus[0])[0];
  const basis = [
    `主攻领域：${focus.join('、')}${weakest ? `（掌握度 ${weakest.score}/100，样本 ${weakest.samples}）` : ''}`,
    `难度基准：${input.band.basis}，推荐区间 ${input.band.minimum}–${input.band.maximum}`,
    `选题质量：优先全网通过数较多的经典题，同日同比赛/同标签限两题`,
    `估时：${input.minutesBasis}，每题约 ${Math.round(input.minutesPerProblem)} 分钟`,
  ].join('；');
  const program = trainingProgramSchema.parse({
    id: 'draft',
    createdAt: new Date().toISOString(),
    duration: input.duration,
    dailyCount: input.dailyCount,
    focus,
    basis,
    days,
    status: 'draft',
  });
  return { program, warnings };
}
