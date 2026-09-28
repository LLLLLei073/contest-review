<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { BookOpen } from 'lucide-vue-next';

const emit = defineEmits<{ finish: [] }>();
const skipButton = ref<HTMLButtonElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let media: MediaQueryList | undefined;
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  if (timer) clearTimeout(timer);
  emit('finish');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    finish();
  } else if (event.key === 'Tab') {
    event.preventDefault();
    skipButton.value?.focus();
  }
}

function onVisibility() {
  if (document.hidden) finish();
}

function onMotionChange() {
  if (media?.matches) finish();
}

onMounted(async () => {
  await nextTick();
  skipButton.value?.focus({ preventScroll: true });
  media = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (media.matches || document.hidden) {
    finish();
    return;
  }
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('visibilitychange', onVisibility);
  media.addEventListener('change', onMotionChange);
  timer = setTimeout(finish, 1200);
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('visibilitychange', onVisibility);
  media?.removeEventListener('change', onMotionChange);
});
</script>

<template>
  <div
    class="opening-intro"
    role="dialog"
    aria-modal="true"
    aria-label="回解开屏动画"
    @wheel.prevent
    @touchmove.prevent
  >
    <div class="opening-intro__content">
      <div class="opening-intro__brand" aria-hidden="true">
        <span class="opening-intro__mark"><BookOpen :size="37" :stroke-width="1.8" /></span>
        <span class="opening-intro__name">回解</span>
        <span class="opening-intro__english">CONTEST REVIEW</span>
      </div>
      <div class="opening-intro__journey" aria-hidden="true">
        <span>卡住</span>
        <span class="opening-intro__line"><i></i></span>
        <span>再解</span>
      </div>
      <p class="opening-intro__caption">每一题，都值得真正理解。</p>
    </div>
    <button ref="skipButton" class="opening-intro__skip" type="button" @click="finish">跳过动画</button>
  </div>
</template>
