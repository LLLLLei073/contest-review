import { onScopeDispose, ref, watch } from 'vue';
import { api, dataRevision } from './api';
import type { LearningService } from '../shared/learning-service';
import type { LearningRecord } from '../shared/learning-domain';

export function useLearningState() {
  const state = ref<ReturnType<LearningService['state']>>();
  const loading = ref(false),
    busy = ref(false),
    error = ref(''),
    message = ref('');
  let serial = 0,
    alive = true;
  onScopeDispose(() => {
    alive = false;
    serial++;
  });
  watch(dataRevision, () => {
    if (state.value && !busy.value) void load();
  });
  async function load() {
    const request = ++serial;
    loading.value = true;
    error.value = '';
    try {
      const next = await api<NonNullable<typeof state.value>>('/learning/state');
      if (alive && request === serial) state.value = next;
    } catch (e) {
      if (alive && request === serial) error.value = (e as Error).message;
    } finally {
      if (alive && request === serial) loading.value = false;
    }
  }
  async function run(action: string, input: unknown) {
    if (busy.value || !alive) return;
    busy.value = true;
    error.value = '';
    message.value = '';
    try {
      const result = await api<LearningRecord & { message?: string }>('/learning/' + action, input);
      if (!alive) return;
      message.value = result.message || '已完成';
      await load();
      return result;
    } catch (e) {
      if (alive) error.value = (e as Error).message;
    } finally {
      if (alive) busy.value = false;
    }
  }
  return { state, loading, busy, error, message, load, run };
}
