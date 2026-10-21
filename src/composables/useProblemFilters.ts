import { onScopeDispose, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  defaultProblemFilters,
  parseProblemFilters,
  serializeProblemFilters,
  type ProblemFilters,
} from '../../shared/problem-filters';
export function useProblemFilters() {
  const route = useRoute(),
    router = useRouter();
  const initial = parseProblemFilters(route.query),
    filters = ref(initial.filters),
    page = ref(initial.page);
  let applying = false,
    alive = true,
    timer: ReturnType<typeof setTimeout> | undefined;
  function write(replace = false) {
    clearTimeout(timer);
    if (!alive || route.path !== '/problems') return;
    const query = serializeProblemFilters(filters.value, page.value);
    if (JSON.stringify(query) === JSON.stringify(route.query)) return;
    void router[replace ? 'replace' : 'push']({ path: '/problems', query });
  }
  watch(
    filters,
    () => {
      if (applying) return;
      applying = true;
      page.value = 1;
      applying = false;
      clearTimeout(timer);
      timer = setTimeout(() => write(), 200);
    },
    { deep: true, flush: 'sync' },
  );
  watch(
    page,
    () => {
      if (!applying) write();
    },
    { flush: 'sync' },
  );
  watch(
    () => route.query,
    (query) => {
      if (route.path !== '/problems') return;
      clearTimeout(timer);
      applying = true;
      const next = parseProblemFilters(query);
      filters.value = next.filters;
      page.value = next.page;
      applying = false;
      write(true);
    },
    { immediate: true, flush: 'sync' },
  );
  onScopeDispose(() => {
    alive = false;
    clearTimeout(timer);
  });
  function reset(preset: Partial<ProblemFilters> = {}) {
    filters.value = { ...defaultProblemFilters, ...preset };
  }
  return { filters, page, reset };
}
