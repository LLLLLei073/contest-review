import { ref, watch } from 'vue';
import { api, settings, dataRevision } from './api';
import type { GrowthSummary, GrowthEquipment, GrowthEvent } from '../shared/growth';

export const growth = ref<GrowthSummary | null>(null);
export const growthError = ref('');
export const growthLoading = ref(false);
export const growthNotice = ref<{ historical: boolean; xp: number; achievements: string[] } | null>(null);
let read = 0;
const scopeKey = () => `${settings.value.activeHandle}|${settings.value.activeAtcoder || ''}`;
export async function refreshGrowth() {
  const request = ++read,
    scope = scopeKey();
  growthLoading.value = true;
  try {
    const value = await api<GrowthSummary>('/growth/summary');
    if (request !== read || scope !== scopeKey()) return;
    growth.value = value;
    growthError.value = '';
    document.documentElement.dataset.palette = value.equipment.palette;
    const earned = value.achievements
      .filter((a) => a.unlocked && !value.notice.achievements.includes(a.id))
      .map((a) => a.title);
    growthNotice.value =
      value.profiles.length && (value.xp > value.notice.xp || earned.length)
        ? {
            historical: !value.notice.initialized,
            xp: Math.max(0, value.xp - value.notice.xp),
            achievements: earned,
          }
        : null;
  } catch (error) {
    if (request === read && scope === scopeKey()) growthError.value = (error as Error).message;
  } finally {
    if (request === read) growthLoading.value = false;
  }
}
export function startGrowth() {
  const stop = watch(
    [scopeKey, dataRevision],
    ([scope], old) => {
      if (scope !== old?.[0]) {
        growth.value = null;
        growthNotice.value = null;
        growthError.value = '';
        document.documentElement.dataset.palette = 'cyan';
      }
      void refreshGrowth();
    },
    { immediate: true },
  );
  return () => {
    stop();
    read++;
  };
}
export async function equipGrowth(equipment: GrowthEquipment) {
  const scope = scopeKey();
  await api<GrowthSummary>('/growth/equipment', { ...equipment, scope: growth.value?.scope }, 'PUT');
  if (scope === scopeKey()) await refreshGrowth();
}
export async function dismissGrowthNotice() {
  const value = growth.value;
  if (!value) return;
  try {
    await api('/growth/notice', { revision: value.revision }, 'PUT');
    await refreshGrowth();
  } catch (error) {
    growthError.value = (error as Error).message;
  }
}
export type GrowthHistory = { items: GrowthEvent[]; total: number; page: number; pageSize: number };
export const growthKindLabel = {
  ac: '首次 AC',
  independent: '独立重做',
  hint: '借助提示',
  reflection: '有效复盘',
};
