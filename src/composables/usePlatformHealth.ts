import { ref, watch, onBeforeUnmount } from 'vue';
import { api, settings, dataRevision, job } from '../api';
import type { PlatformHealth } from '../../shared/platform-health';
export function usePlatformHealth() {
  const platforms = ref<PlatformHealth[]>([]),
    error = ref('');
  let serial = 0;
  async function load() {
    const token = ++serial;
    try {
      const health = await api<{ platforms: PlatformHealth[] }>('/training/health');
      if (token === serial) {
        platforms.value = health.platforms;
        error.value = '';
      }
    } catch (e) {
      if (token === serial) error.value = (e as Error).message;
    }
  }
  watch(
    () => [
      settings.value.activeHandle,
      settings.value.activeAtcoder,
      settings.value.activeLuogu,
      settings.value.xcpcPlayer?.key,
    ],
    () => {
      platforms.value = [];
      void load();
    },
    { immediate: true },
  );
  watch([dataRevision, job], load);
  const timer = setInterval(load, 10000);
  onBeforeUnmount(() => {
    serial++;
    clearInterval(timer);
  });
  return { platforms, error, load };
}
export const platformStatusLabel = {
  unbound: '未连接',
  never: '暂无同步记录',
  running: '进行中',
  completed: '成功',
  failed: '失败',
  interrupted: '已中断',
};
