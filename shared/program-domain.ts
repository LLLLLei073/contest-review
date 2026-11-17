import { z } from 'zod';
import { categoryNames } from './training.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const programPhases = [
  'foundation',
  'reinforce',
  'checkpoint',
  'transfer',
  'challenge',
  'summary',
] as const;
export type ProgramPhase = (typeof programPhases)[number];
export const phaseLabels: Record<ProgramPhase, string> = {
  foundation: '基础巩固',
  reinforce: '专项强化',
  checkpoint: '复盘节点',
  transfer: '综合迁移',
  challenge: '挑战日',
  summary: '总复盘',
};
export const roleLabels = { warmup: '热身', core: '核心', stretch: '拉伸' } as const;
export const programProblemSchema = z.object({
  key: z.string().min(1).max(200),
  role: z.enum(['warmup', 'core', 'stretch']),
});
export const programDaySchema = z.object({
  date: dateSchema,
  phase: z.enum(programPhases),
  theme: z.string().min(1).max(200),
  focus: z.array(z.enum(categoryNames)).min(1).max(2),
  band: z.object({
    minimum: z.number().int(),
    maximum: z.number().int(),
    preferred: z.number().int(),
  }),
  problems: z.array(programProblemSchema).max(10),
  reasons: z.record(z.string(), z.string().max(500)),
  shortage: z.string().max(500).nullable(),
  estimateMinutes: z.number().int().nonnegative(),
});
export const trainingProgramSchema = z
  .object({
    id: z.string().min(1).max(200),
    createdAt: z.string().datetime(),
    duration: z.union([z.literal(7), z.literal(14)]),
    dailyCount: z.number().int().min(6).max(10),
    focus: z.array(z.enum(categoryNames)).min(1).max(2),
    basis: z.string().max(1000),
    days: z.array(programDaySchema),
    status: z.enum(['draft', 'active', 'completed', 'abandoned']),
    confirmedAt: z.string().datetime().nullable().optional(),
    finishedAt: z.string().datetime().nullable().optional(),
    /** 采纳时的 8 领域掌握度快照，报告雷达用它对比计划前后。 */
    baselineMastery: z
      .array(z.object({ name: z.string(), score: z.number(), samples: z.number() }))
      .max(8)
      .optional(),
    recalibrations: z
      .array(
        z.object({
          at: z.string().datetime(),
          acRate: z.number().min(0).max(1),
          shift: z.number().int(),
          note: z.string().max(300),
        }),
      )
      .max(4)
      .optional(),
  })
  .refine((value) => value.days.length === value.duration, '计划天数与模板不符');
export type ProgramProblem = z.infer<typeof programProblemSchema>;
export type ProgramDay = z.infer<typeof programDaySchema>;
export type TrainingProgram = z.infer<typeof trainingProgramSchema>;
export const programNamespace = (cf: string, ac: string) =>
  `program:${cf || '-'}:${ac.toLowerCase() || '-'}`;
export type ProgramDayStatus = 'done' | 'partial' | 'todo' | 'missed';
export interface ProgramProgressDay {
  index: number;
  date: string;
  phase: ProgramPhase;
  theme: string;
  status: ProgramDayStatus;
  ac: number;
  total: number;
  carry: string[];
}
export interface ProgramProgress {
  currentIndex: number | null;
  percent: number;
  doneDays: number;
  days: ProgramProgressDay[];
}
export interface ProgramAssignment {
  keys: string[];
  reasons: Record<string, string>;
  shortage: string | null;
  dayIndex: number | null;
  carryCount: number;
}
/**
 * 纯函数：把计划落到某一天。当天的题在前，此前漏掉的未 AC 题按天序顺延补做（总 clamp 10）。
 * reservedKeys：当日已预约的迁移题等显式安排，置于计划题之前。
 * acceptedDays: key → 首次 AC 的本地日期。
 */
export function programAssignment(
  program: TrainingProgram,
  today: string,
  acceptedDays: Map<string, string>,
  reservedKeys: { key: string; reason: string }[] = [],
): ProgramAssignment {
  const index = program.days.findIndex((d) => d.date === today);
  if (index < 0)
    return { keys: [], reasons: {}, shortage: null, dayIndex: null, carryCount: 0 };
  const day = program.days[index];
  const keys: string[] = [];
  const reasons: Record<string, string> = {};
  for (const reserved of reservedKeys) {
    if (keys.includes(reserved.key)) continue;
    if (keys.length >= 10) break;
    keys.push(reserved.key);
    reasons[reserved.key] = reserved.reason;
  }
  for (const p of day.problems) {
    if (keys.includes(p.key)) continue;
    if (keys.length >= 10) break;
    keys.push(p.key);
    reasons[p.key] = day.reasons[p.key] ?? `${phaseLabels[day.phase]}：${day.theme}`;
  }
  const carry: string[] = [];
  for (let i = 0; i < index && carry.length + keys.length < 10; i++) {
    const earlier = program.days[i];
    for (const p of earlier.problems) {
      if (keys.includes(p.key) || carry.includes(p.key)) continue;
      if (acceptedDays.get(p.key)) continue;
      carry.push(p.key);
      reasons[p.key] = `补做·第${i + 1}天：${(earlier.reasons[p.key] ?? earlier.theme).slice(0, 120)}`;
      if (carry.length + keys.length >= 10) break;
    }
  }
  return {
    keys: [...keys, ...carry],
    reasons,
    shortage: day.shortage,
    dayIndex: index,
    carryCount: carry.length,
  };
}
export function programProgress(
  program: TrainingProgram,
  today: string,
  acceptedDays: Map<string, string>,
): ProgramProgress {
  const days = program.days.map((day, index) => {
    const total = day.problems.length;
    const ac = day.problems.filter((p) => {
      const at = acceptedDays.get(p.key);
      return at !== undefined && at <= day.date;
    }).length;
    const status: ProgramDayStatus =
      day.date > today
        ? 'todo'
        : total > 0 && ac >= total
          ? 'done'
          : ac > 0
            ? day.date === today
              ? 'partial'
              : 'missed'
            : day.date === today
              ? 'todo'
              : 'missed';
    return {
      index,
      date: day.date,
      phase: day.phase,
      theme: day.theme,
      status,
      ac,
      total,
      carry: day.problems.filter((p) => !acceptedDays.get(p.key)).map((p) => p.key),
    };
  });
  const currentIndex = program.days.findIndex((d) => d.date === today);
  const totalAll = days.reduce((sum, d) => sum + d.total, 0);
  const acAll = days.reduce((sum, d) => sum + d.ac, 0);
  return {
    currentIndex: currentIndex < 0 ? null : currentIndex,
    percent: totalAll ? Math.round((100 * acAll) / totalAll) : 0,
    doneDays: days.filter((d) => d.status === 'done').length,
    days,
  };
}
