<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount, watch } from 'vue';
import { api, dataRevision, fullDate } from '../api';
const health = ref<{
  cf: { handle: string; sync: string | null; catalog: string | null; problems: number; rated: number };
  atcoder: { handle: string; sync: string | null; catalog: string | null; problems: number; rated: number };
  pendingVerdicts: number;
  lastBackup: string | null;
} | null>(null);
const error = ref(''),
  loading = ref(false);
let serial = 0;
onBeforeUnmount(() => {
  serial++;
});
async function load() {
  const request = ++serial;
  loading.value = true;
  error.value = '';
  try {
    const next = await api<NonNullable<typeof health.value>>('/training/health');
    if (request === serial) health.value = next;
  } catch (e) {
    if (request === serial) error.value = (e as Error).message;
  } finally {
    if (request === serial) loading.value = false;
  }
}
onMounted(load);
watch(dataRevision, load);
</script>
<template>
  <div v-if="loading" role="status">正在检查数据健康…</div>
  <div v-if="error" class="alert error" role="alert">{{ error }} <button @click="load">重试</button></div>
  <section v-if="health" class="panel training-extra-panel">
    <div class="section-head">
      <div>
        <span class="eyebrow">DATA HEALTH</span>
        <h2>数据健康</h2>
      </div>
    </div>
    <div class="health-grid">
      <p>
        CF 提交：{{ health.cf.sync ? fullDate(health.cf.sync) : '尚未同步' }}<br />题目目录
        {{ health.cf.problems }} 题，含难度 {{ health.cf.rated }} 题<br />目录更新：{{
          health.cf.catalog ? fullDate(health.cf.catalog) : '暂无数据'
        }}
      </p>
      <p>
        AtCoder 提交：{{ health.atcoder.sync ? fullDate(health.atcoder.sync) : '尚未同步' }}<br />题目目录
        {{ health.atcoder.problems }} 题，含估计难度 {{ health.atcoder.rated }} 题<br />目录更新：{{
          health.atcoder.catalog ? fullDate(health.atcoder.catalog) : '暂无数据'
        }}
      </p>
      <p>
        待判提交：{{ health.pendingVerdicts }} 条<br />上次备份导出：{{
          health.lastBackup ? fullDate(health.lastBackup) : '尚无记录'
        }}
      </p>
    </div>
    <RouterLink to="/settings?view=backup" class="small-button">导出备份</RouterLink>
  </section>
  <button class="small-button" @click="load">刷新健康状态</button>
</template>
