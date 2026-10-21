<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, notify } from '../api';
import type { UpsolveItem } from '../../shared/training-extras';
const props = defineProps<{ items: UpsolveItem[]; loading: boolean }>();
const emit = defineEmits<{ refresh: [] }>();
const error = ref(''),
  busy = ref(false);
const status = ref('pending');
const groups = computed(() => {
  const groups = new Map<string, UpsolveItem[]>();
  for (const item of props.items) {
    if (
      (status.value === 'pending' && item.completed) ||
      (status.value === 'completed' && !item.completed) ||
      (status.value === 'attempted' && (!item.attempted || item.completed))
    )
      continue;
    const key = item.source + ': ' + item.contestName;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups];
});
async function removeUpsolve(item: UpsolveItem) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api(`/training/upsolve/${item.source}/${encodeURIComponent(item.key)}`, {}, 'DELETE');
    emit('refresh');
    notify('已从补题清单移除');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="upsolve-workspace">
    <div v-if="error" class="alert error" role="alert">{{ error }}</div>
    <section class="panel training-extra-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">UPSOLVE</span>
          <h2>赛后补题清单</h2>
          <p>从比赛报告添加；完成状态按对应账号同步到的 AC 判断，不占固定题单名额。</p>
        </div>
      </div>
      <div v-if="!props.items.length && !loading" class="quiet-empty">
        还没有补题。打开比赛报告，把未 AC 的题目加入这里。
      </div>
      <p>已 AC {{ items.filter((i) => i.completed).length }} / {{ items.length }} 题</p>
      <label
        >补题状态<select v-model="status">
          <option value="pending">待完成</option>
          <option value="attempted">已尝试未通过</option>
          <option value="completed">已 AC</option>
          <option value="all">全部</option>
        </select></label
      >
      <p v-if="items.length && !groups.length" class="quiet-empty">当前状态没有补题。</p>
      <section v-for="[group, tasks] in groups" :key="group" class="upsolve-group">
        <h3>{{ group }} · {{ tasks.length }} 题</h3>
        <article v-for="item in tasks" :key="item.source + item.key" class="upsolve-row">
          <div>
            <strong>{{ item.name }}</strong>
            <p class="small subtle">
              {{ item.source === 'cf' ? 'CF' : 'AtCoder' }} · {{ item.contestName }} ·
              {{ item.rating ?? '暂无难度' }} ·
              {{ item.completed ? '已 AC' : item.attempted ? '已尝试' : '未尝试' }}
            </p>
          </div>
          <div class="button-row">
            <a class="small-button" :href="item.url" target="_blank" rel="noreferrer">打开原题</a
            ><button class="small-button" :disabled="busy" @click="removeUpsolve(item)">移除</button>
          </div>
        </article>
      </section>
    </section>
  </div>
</template>
