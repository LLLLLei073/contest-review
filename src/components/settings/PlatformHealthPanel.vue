<script setup lang="ts">
import { usePlatformHealth, platformStatusLabel } from '../../composables/usePlatformHealth';
import { fullDate } from '../../api';
const { platforms, error, load } = usePlatformHealth();
</script>
<template>
  <section class="panel settings-card" aria-label="平台同步状态">
    <h3>平台同步状态</h3>
    <p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
    <div class="health-grid">
      <div v-for="item in platforms" :key="item.id">
        <h4>{{ item.name }} · {{ item.account || '未连接' }}</h4>
        <p>最近成功：{{ item.lastSuccess ? fullDate(item.lastSuccess) : '暂无记录' }}</p>
        <p>
          最近尝试：{{ platformStatusLabel[item.status]
          }}<template v-if="item.lastAttempt"> · {{ fullDate(item.lastAttempt) }}</template>
        </p>
        <p v-if="item.error" role="status">{{ item.error }}</p>
        <p class="small subtle">{{ item.capabilities.join(' · ') }}</p>
        <RouterLink :to="item.href"
          >{{ !item.bound ? '连接账号' : item.id === 'xcpc' ? '更新比赛资料' : '查看同步操作' }} →</RouterLink
        >
      </div>
    </div>
    <p class="small subtle">状态来自本地记录；离线时仍可查看。读取状态不会触发同步。</p>
  </section>
</template>
