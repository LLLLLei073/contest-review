import { computed, onScopeDispose, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

let locationWrite = Promise.resolve();

/** Query-driven sections preserve the page instance and its unsaved inputs. */
export function useSection<T extends string>(
  values: readonly T[],
  fallback: T,
  key = 'view',
  remembered?: T,
) {
  const route = useRoute();
  const router = useRouter();
  const path = route.path;
  let alive = true;
  onScopeDispose(() => {
    alive = false;
  });
  const section = computed<T>({
    get: () =>
      route.query[key] === undefined
        ? (remembered ?? fallback)
        : values.includes(route.query[key] as T)
          ? (route.query[key] as T)
          : fallback,
    set: (value) => {
      locationWrite = locationWrite
        .then(async () => {
          if (alive && route.path === path)
            await router.push({ path, query: { ...route.query, [key]: value } });
        })
        .catch(() => {});
    },
  });
  watch(
    () => route.query[key],
    (value) => {
      if (route.path === path && value !== undefined && !values.includes(value as T))
        locationWrite = locationWrite
          .then(async () => {
            if (
              alive &&
              route.path === path &&
              route.query[key] !== undefined &&
              !values.includes(route.query[key] as T)
            )
              await router.replace({ path, query: { ...route.query, [key]: fallback } });
          })
          .catch(() => {});
    },
    { immediate: true },
  );
  return section;
}
