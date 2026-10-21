<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Search, ArrowUpRight, X } from 'lucide-vue-next';
import { navigation, quickActions } from '../navigation';

const router = useRouter();
const dialog = ref<HTMLDialogElement>();
const search = ref<HTMLInputElement>();
const query = ref('');
const selected = ref(0);
let returnFocus: HTMLElement | null = null;
const commands = [...navigation, ...quickActions];
const matches = computed(() =>
  commands
    .filter((item) =>
      `${item.label} ${item.caption}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
    )
    .sort(
      (a, b) => Number(b.label.includes(query.value.trim())) - Number(a.label.includes(query.value.trim())),
    ),
);

async function open() {
  if (dialog.value?.open) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  query.value = '';
  selected.value = 0;
  dialog.value?.showModal();
  await nextTick();
  search.value?.focus();
}
function close() {
  dialog.value?.close();
}
function restoreFocus() {
  returnFocus?.isConnected && returnFocus.focus();
}
async function choose(index: number) {
  const item = matches.value[index];
  if (!item) return;
  close();
  await router.push(item.to);
}
function navigate(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    void choose(selected.value);
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const length = matches.value.length;
  if (!length) return;
  selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + length) % length;
  void nextTick(() =>
    dialog.value?.querySelector(`#command-${selected.value}`)?.scrollIntoView({ block: 'nearest' }),
  );
}
function shortcut(event: KeyboardEvent) {
  if (
    event.isComposing ||
    event.altKey ||
    event.shiftKey ||
    (!event.metaKey && !event.ctrlKey) ||
    event.key.toLowerCase() !== 'k'
  )
    return;
  // Never layer a new modal over another confirmation or goal dialog.
  if (document.querySelector('dialog[open], [aria-modal="true"]') && !dialog.value?.open) return;
  event.preventDefault();
  if (dialog.value?.open) close();
  else void open();
}
onMounted(() => window.addEventListener('keydown', shortcut));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', shortcut);
  close();
});
</script>

<template>
  <button
    class="command-trigger"
    aria-label="打开快捷操作"
    aria-keyshortcuts="Control+k Meta+k"
    @click="open"
  >
    <Search :size="16" /><span>快捷操作</span><kbd>⌘ / Ctrl K</kbd>
  </button>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="command-palette"
      aria-labelledby="command-title"
      @close="restoreFocus"
      @click="
        (event) => {
          if (event.target === dialog) close();
        }
      "
    >
      <header>
        <h2 id="command-title">想从哪里继续？</h2>
        <button class="icon-button" aria-label="关闭快捷操作" @click="close"><X :size="18" /></button>
      </header>
      <div class="command-search">
        <Search :size="19" /><input
          ref="search"
          v-model="query"
          aria-label="搜索页面与操作"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="command-results"
          :aria-activedescendant="matches.length ? `command-${selected}` : undefined"
          placeholder="搜索题目入口、计划、备份…"
          @input="selected = 0"
          @keydown="navigate"
        />
      </div>
      <div id="command-results" class="command-results" role="listbox" aria-label="快捷操作结果">
        <button
          v-for="(item, index) in matches"
          :id="`command-${index}`"
          :key="item.to"
          role="option"
          :aria-selected="index === selected"
          tabindex="-1"
          @mousemove="selected = index"
          @click="choose(index)"
        >
          <span
            ><strong>{{ item.label }}</strong
            ><small>{{ item.caption }}</small></span
          ><ArrowUpRight :size="17" />
        </button>
        <p v-if="!matches.length" class="quiet-empty" role="status">没有匹配的操作，试试“复习”或“备份”。</p>
      </div>
      <footer><span>↑ ↓ 选择 · Enter 打开</span><span>Esc 关闭</span></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.command-trigger {
  gap: 9px;
  color: var(--muted);
  padding: 8px 11px;
  background: var(--canvas);
}
kbd {
  font:
    10px 'Consolas',
    monospace;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 3px 5px;
}
.command-palette {
  width: min(560px, calc(100vw - 32px));
  max-height: min(600px, 80dvh);
  margin: 12dvh auto auto;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 16px;
  color: var(--ink);
  background: var(--paper);
  box-shadow: 0 28px 90px var(--shadow-color);
}
.command-palette::backdrop {
  background: #09142180;
  backdrop-filter: blur(4px);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 10px;
}
header h2 {
  font-size: 17px;
}
.command-search {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 10px 24px 14px;
  color: var(--highlight);
}
.command-search input {
  flex: 1;
  min-width: 0;
  background: var(--canvas);
}
.command-results {
  max-height: 42dvh;
  overflow: auto;
  padding: 0 12px 12px;
}
.command-results button {
  display: flex;
  width: 100%;
  justify-content: space-between;
  text-align: left;
  padding: 12px;
  border-color: transparent;
}
.command-results button[aria-selected='true'] {
  background: var(--accent-soft);
  border-color: var(--line);
  color: var(--highlight);
}
.command-results button span {
  display: grid;
  gap: 4px;
}
.command-results small {
  color: var(--muted);
  font-weight: 400;
}
footer {
  padding: 12px 24px;
  border-top: 1px solid var(--line);
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
}
@media (max-width: 650px) {
  .command-trigger span,
  kbd {
    display: none;
  }
  .command-trigger {
    padding: 8px;
  }
}
</style>
