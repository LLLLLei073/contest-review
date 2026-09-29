<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{ viewKey: string; ready?: boolean; label: string; focusSelector?: string }>(),
  { ready: true, focusSelector: 'h2, h3' },
);
const surface = ref<HTMLElement | null>(null);
const active = ref(false);
const waiting = ref(false);
let serial = 0;
let minimumTimer: ReturnType<typeof setTimeout> | undefined;
let maximumTimer: ReturnType<typeof setTimeout> | undefined;
let minimumElapsed = false;

function clearTimers() {
  clearTimeout(minimumTimer);
  clearTimeout(maximumTimer);
}
async function finish(current: number) {
  if (current !== serial || !active.value) return;
  clearTimers();
  active.value = false;
  waiting.value = false;
  await nextTick();
  if (current !== serial) return;
  const heading = [...(surface.value?.querySelectorAll<HTMLElement>(props.focusSelector) ?? [])].find(
    (candidate) => candidate.getClientRects().length,
  );
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}
function maybeFinish(current: number) {
  if (minimumElapsed && props.ready) void finish(current);
}
watch(
  () => props.viewKey,
  () => {
    clearTimers();
    const current = ++serial;
    active.value = true;
    waiting.value = false;
    minimumElapsed = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden;
    if (!minimumElapsed)
      minimumTimer = setTimeout(() => {
        if (current !== serial) return;
        minimumElapsed = true;
        waiting.value = !props.ready;
        maybeFinish(current);
      }, 600);
    maximumTimer = setTimeout(() => void finish(current), 8000);
    maybeFinish(current);
  },
  { flush: 'sync' },
);
watch(
  () => props.ready,
  () => maybeFinish(serial),
);
function onVisibility() {
  if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    minimumElapsed = true;
    waiting.value = !props.ready;
    maybeFinish(serial);
  }
}
document.addEventListener('visibilitychange', onVisibility);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion.addEventListener('change', onVisibility);
onBeforeUnmount(() => {
  ++serial;
  clearTimers();
  document.removeEventListener('visibilitychange', onVisibility);
  reducedMotion.removeEventListener('change', onVisibility);
});
</script>

<template>
  <div ref="surface" class="switch-surface" :aria-busy="active">
    <div class="switch-surface__content" :inert="active"><slot /></div>
    <div v-if="active" class="switch-surface__veil" role="status" aria-live="polite">
      <span class="switch-surface__line" aria-hidden="true"></span>
      <strong>{{ waiting ? `正在加载${label}…` : `正在切换${label}` }}</strong>
    </div>
  </div>
</template>
