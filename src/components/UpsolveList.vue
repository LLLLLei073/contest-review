<script setup lang="ts">
import { ref } from 'vue';
import { api, notify } from '../api';
import type { UpsolveItem } from '../../shared/training-extras';
const props = defineProps<{ items: UpsolveItem[]; loading: boolean }>();
const emit = defineEmits<{ refresh: [] }>();
const error = ref(''),
  busy = ref(false);
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
    <article v-for="item in props.items" :key="item.source + item.key" class="upsolve-row">
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
</template>
