<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-vue-next';
import { categoryNames, type CategoryName } from '../../shared/training';

const props = defineProps<{
  mode: 'focus' | 'balanced';
  categories: CategoryName[];
  saving: boolean;
  error: string;
  existing: boolean;
}>();
const emit = defineEmits<{
  cancel: [];
  confirm: [value: { mode: 'focus' | 'balanced'; categories: CategoryName[] }];
}>();

const mode = ref(props.mode);
const selected = ref<CategoryName[]>([...props.categories]);
const scene = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const selectionValid = computed(() =>
  mode.value === 'focus' ? selected.value.length === 1 : selected.value.length >= 2,
);
const selectionHint = computed(() =>
  mode.value === 'focus'
    ? selected.value.length
      ? '已选定本周专注领域'
      : '请选择 1 个领域'
    : selected.value.length >= 2
      ? `已选择 ${selected.value.length} 个领域`
      : '请至少选择 2 个领域',
);

function chooseMode(next: 'focus' | 'balanced') {
  if (props.saving) return;
  mode.value = next;
  if (next === 'focus') selected.value = selected.value.slice(0, 1);
}
function toggle(category: CategoryName) {
  if (props.saving) return;
  if (mode.value === 'focus') {
    selected.value = [category];
    return;
  }
  selected.value = selected.value.includes(category)
    ? selected.value.filter((item) => item !== category)
    : [...selected.value, category];
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (!props.saving) emit('cancel');
    return;
  }
  if (event.key !== 'Tab' || !scene.value) return;
  const focusable = [...scene.value.querySelectorAll<HTMLElement>('button:not(:disabled)')];
  if (!focusable.length) return;
  const first = focusable[0],
    last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

let previousOverflow = '';
let previousFocus: HTMLElement | null = null;
let appShell: HTMLElement | null = null;
let previousInert = false;
onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  appShell = document.querySelector<HTMLElement>('.app-shell');
  previousInert = appShell?.inert ?? false;
  if (appShell) appShell.inert = true;
  window.addEventListener('keydown', onKeydown, true);
  await nextTick();
  cancelButton.value?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
  document.body.style.overflow = previousOverflow;
  if (appShell) appShell.inert = previousInert;
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});
</script>

<template>
  <div ref="scene" class="goal-scene" role="dialog" aria-modal="true" aria-labelledby="goal-scene-title">
    <div class="goal-scene__top">
      <div class="goal-scene__identity">
        <span class="goal-scene__mark">回解</span><span>WEEKLY FOCUS / 本周目标</span>
      </div>
      <div class="goal-scene__top-actions">
        <button ref="cancelButton" class="goal-scene__cancel" :disabled="saving" @click="emit('cancel')">
          <X :size="17" />取消
        </button>
        <button
          class="goal-scene__confirm"
          :disabled="saving || !selectionValid"
          @click="emit('confirm', { mode, categories: selected })"
        >
          {{ saving ? '正在保存…' : '确定' }}<ArrowRight :size="17" />
        </button>
      </div>
    </div>

    <div class="goal-scene__body">
      <div class="goal-scene__intro">
        <span class="eyebrow">PICK YOUR DIRECTION</span>
        <h1 id="goal-scene-title">这一周，<br /><em>想练什么？</em></h1>
        <p>从熟悉的题型里走出去，或把一个薄弱点练透。选好方向，接下来每天的新知题会优先安排相关题目。</p>
      </div>
      <div class="goal-scene__choice">
        <div class="goal-scene__modes" aria-label="目标模式">
          <button
            type="button"
            :class="{ active: mode === 'focus' }"
            :aria-pressed="mode === 'focus'"
            @click="chooseMode('focus')"
          >
            <span>01</span> 专注一个领域
          </button>
          <button
            type="button"
            :class="{ active: mode === 'balanced' }"
            :aria-pressed="mode === 'balanced'"
            @click="chooseMode('balanced')"
          >
            <span>02</span> 均衡多个领域
          </button>
        </div>
        <div class="goal-scene__grid" aria-label="算法领域">
          <button
            v-for="(category, index) in categoryNames"
            :key="category"
            type="button"
            class="goal-scene__word"
            :class="{ selected: selected.includes(category) }"
            :aria-pressed="selected.includes(category)"
            :style="{ '--word-index': index }"
            @click="toggle(category)"
          >
            <span class="goal-scene__word-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <strong>{{ category }}</strong>
            <span class="goal-scene__word-check"><Check :size="18" /></span>
          </button>
        </div>
        <div class="goal-scene__bottom">
          <span :class="{ 'goal-scene__hint--ready': selectionValid }" aria-live="polite">{{
            selectionHint
          }}</span>
          <p v-if="existing">今天已生成的题目保持不变，新目标从明天生效。</p>
          <p v-else>确定后将生成今天的新知题单；复习安排不受影响。</p>
        </div>
        <div v-if="error" class="alert error goal-scene__error" role="alert">{{ error }}</div>
      </div>
    </div>
    <div class="goal-scene__foot"><ArrowLeft :size="14" /> 选择你的方向，继续向前。</div>
  </div>
</template>
