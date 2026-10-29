import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { api } from '../api';

type TaskPayload = { task: { status: string; message?: string } };

// Shared load/refresh loop for contest analysis reports (CF / XCPC): the backend
// runs the analysis as a task, so the first read polls while status is running
// and emits `updated` once it settles.
export function useAnalysisPolling<T extends TaskPayload>(options: {
  readPath: string;
  refreshPath: string;
  onUpdated?: () => void;
  shouldAutoRefresh?: (data: T) => boolean;
  isBusyConflict?: (message: string) => boolean;
}) {
  const state = ref<T | null>(null) as Ref<T | null>;
  const error = ref('');
  const busy = ref(false);
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function read(auto = false) {
    try {
      const next = await api<T>(options.readPath);
      if (!alive) return;
      const wasRunning = state.value?.task.status === 'running';
      state.value = next;
      if (next.task.status === 'running') timer = setTimeout(() => void read(), 1200);
      else if (wasRunning) options.onUpdated?.();
      if (auto && next.task.status === 'idle' && navigator.onLine && options.shouldAutoRefresh?.(next))
        await refresh();
    } catch (e) {
      if (alive) error.value = (e as Error).message;
    }
  }
  async function refresh() {
    busy.value = true;
    error.value = '';
    clearTimeout(timer);
    try {
      const next = await api<T>(options.refreshPath, {});
      if (!alive) return;
      state.value = next;
      timer = setTimeout(() => void read(), 1000);
    } catch (e) {
      if (!alive) return;
      error.value = (e as Error).message;
      if (options.isBusyConflict?.(error.value)) timer = setTimeout(() => void read(true), 1500);
    } finally {
      if (alive) busy.value = false;
    }
  }
  onMounted(() => void read(true));
  onBeforeUnmount(() => {
    alive = false;
    clearTimeout(timer);
  });
  return { state, error, busy, read, refresh };
}
