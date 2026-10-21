<script setup lang="ts">
import { job, settings, fullDate } from '../../api';
import type { SyncJob } from '../../../shared/domain';
defineProps<{ atcoder: SyncJob | null }>();
</script>
<template>
  <section class="panel settings-card">
    <h2>同步总览</h2>
    <div
      v-for="item in [
        { name: 'Codeforces', handle: settings.activeHandle, job: job },
        { name: 'AtCoder', handle: settings.activeAtcoder, job: atcoder },
      ]"
      :key="item.name"
    >
      <h3>{{ item.name }} · {{ item.handle || '未连接' }}</h3>
      <p>
        {{ item.job?.message || '尚无同步任务'
        }}<span v-if="item.job">
          · 已处理 {{ item.job.processed }} 条 · {{ fullDate(item.job.startedAt) }}</span
        >
      </p>
      <progress v-if="item.job?.status === 'running'" :aria-label="item.name + '同步中'"></progress>
    </div>
    <p class="small subtle">两站按各自账号保存。失败时保留已有缓存，可使用下方入口继续同步。</p>
  </section>
</template>
