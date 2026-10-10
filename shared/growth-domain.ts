import { z } from 'zod';
import { weeklyGoalSchema } from './weekly.js';

export const appearanceIds = [
  'signal',
  'orbit',
  'nova',
  'atlas',
  'observatory',
  'aurora',
  'voyager',
] as const;
export const paletteIds = ['cyan', 'gold', 'coral', 'ice', 'violet', 'teal', 'silver'] as const;
export const equipmentSchema = z
  .object({
    appearance: z.enum(appearanceIds),
    palette: z.enum(paletteIds),
  })
  .strict();
export type GrowthEquipment = z.infer<typeof equipmentSchema>;
// Rewards remain derived; only preferences, notification state and immutable goal snapshots are saved.
export const growthRecordSchema = z.discriminatedUnion('kind', [
  equipmentSchema.extend({ kind: z.literal('equipment') }).strict(),
  z
    .object({
      kind: z.literal('notice'),
      xp: z.number().int().nonnegative(),
      achievements: z.array(z.string().max(60)).max(256),
      initialized: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('weekly'),
      version: z.literal(1),
      week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      scope: z.string().max(300),
      activatedAt: z.string().datetime(),
      goal: weeklyGoalSchema,
    })
    .strict()
    .refine((r) => r.week === r.goal.week, '周任务目标日期不一致'),
]);
export const growthCosmetics = [
  { appearance: 'signal', palette: 'cyan', level: 1, name: '初始信号', subtitle: 'SIGNAL / 青色终端' },
  { appearance: 'orbit', palette: 'gold', level: 3, name: '星轨领航', subtitle: 'ORBIT / 金色终端' },
  { appearance: 'nova', palette: 'coral', level: 5, name: '新星探索', subtitle: 'NOVA / 珊瑚终端' },
  {
    appearance: 'atlas',
    palette: 'ice',
    level: 10,
    independent: 10,
    reflection: 10,
    days: 90,
    name: '星图研习',
    subtitle: 'ATLAS / 冰蓝终端',
  },
  {
    appearance: 'observatory',
    palette: 'violet',
    level: 15,
    independent: 30,
    reflection: 30,
    days: 150,
    name: '深空观测',
    subtitle: 'OBSERVATORY / 紫色终端',
  },
  {
    appearance: 'aurora',
    palette: 'teal',
    level: 20,
    independent: 60,
    reflection: 60,
    days: 240,
    name: '极光推演',
    subtitle: 'AURORA / 青绿终端',
  },
  {
    appearance: 'voyager',
    palette: 'silver',
    level: 30,
    independent: 120,
    reflection: 120,
    days: 365,
    name: '星海领航',
    subtitle: 'VOYAGER / 银白终端',
  },
] as const;
export type GrowthStage = {
  appearance: GrowthEquipment['appearance'];
  palette: GrowthEquipment['palette'];
  name: string;
  level: number;
  unlocked: boolean;
  conditions: { key: string; label: string; progress: number; target: number; met: boolean }[];
};
export type WeeklyGrowth = {
  week: string;
  goal: z.infer<typeof weeklyGoalSchema> | null;
  activatedAt: string | null;
  complete: boolean;
  earned: number;
  tasks: {
    id: string;
    title: string;
    target: number;
    progress: number;
    xp: number;
    complete: boolean;
    completedAt: string | null;
    evidence: GrowthEvent[];
    coverage: string[];
    coverageTarget: number;
  }[];
  unclassified: number;
};
export type GrowthEvent = {
  id: string;
  profile: string;
  problemKey: string;
  title: string;
  url: string | null;
  canReview: boolean;
  kind: 'ac' | 'independent' | 'hint' | 'reflection' | 'weekly';
  at: string;
  day: string;
  xp: number;
  condition?: string;
  evidence?: { profile: string; problemKey: string; title: string }[];
};
export type GrowthAchievement = {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unlocked: boolean;
  group: 'ac' | 'independent' | 'reflection' | 'days' | 'weeks';
};
export type GrowthNotice = { xp: number; achievements: string[]; initialized: boolean };
export type GrowthSummary = {
  scope: string;
  profiles: string[];
  xp: number;
  level: number;
  levelStart: number;
  nextLevel: number;
  equipment: GrowthEquipment;
  achievements: GrowthAchievement[];
  events: GrowthEvent[];
  counts: { ac: number; independent: number; reflection: number; days: number; weeks: number };
  stages: GrowthStage[];
  currentStage: GrowthStage;
  nextStage: GrowthStage | null;
  weekly: WeeklyGrowth;
  notice: GrowthNotice;
  revision: string;
};
