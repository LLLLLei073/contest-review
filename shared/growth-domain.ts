import { z } from 'zod';

export const appearanceIds = ['signal', 'orbit', 'nova'] as const;
export const paletteIds = ['cyan', 'gold', 'coral'] as const;
export const equipmentSchema = z
  .object({
    appearance: z.enum(appearanceIds),
    palette: z.enum(paletteIds),
  })
  .strict();
export type GrowthEquipment = z.infer<typeof equipmentSchema>;
// Only presentation preferences and the last acknowledged summary are persisted.
export const growthRecordSchema = z.discriminatedUnion('kind', [
  equipmentSchema.extend({ kind: z.literal('equipment') }).strict(),
  z
    .object({
      kind: z.literal('notice'),
      xp: z.number().int().nonnegative(),
      achievements: z.array(z.string().max(60)).max(20),
      initialized: z.boolean(),
    })
    .strict(),
]);
export const growthCosmetics = [
  { appearance: 'signal', palette: 'cyan', level: 1, name: '初始信号', subtitle: 'SIGNAL / 青色终端' },
  { appearance: 'orbit', palette: 'gold', level: 3, name: '星轨领航', subtitle: 'ORBIT / 金色终端' },
  { appearance: 'nova', palette: 'coral', level: 5, name: '新星探索', subtitle: 'NOVA / 珊瑚终端' },
] as const;
export type GrowthEvent = {
  id: string;
  profile: string;
  problemKey: string;
  title: string;
  url: string | null;
  canReview: boolean;
  kind: 'ac' | 'independent' | 'hint' | 'reflection';
  at: string;
  day: string;
  xp: number;
};
export type GrowthAchievement = {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unlocked: boolean;
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
  counts: { ac: number; independent: number; reflection: number; days: number };
  notice: GrowthNotice;
  revision: string;
};
