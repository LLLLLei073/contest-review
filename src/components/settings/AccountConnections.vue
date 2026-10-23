<script setup lang="ts">
import { settings } from '../../api';
defineProps<{ platform: string }>();
const emit = defineEmits<{ select: [platform: 'cf' | 'atcoder' | 'luogu' | 'xcpc'] }>();
</script>
<template>
  <div class="connection-cards">
    <button
      v-for="item in [
        { id: 'cf', title: 'Codeforces', name: settings.activeHandle },
        { id: 'atcoder', title: 'AtCoder', name: settings.activeAtcoder },
        { id: 'luogu', title: '洛谷', name: settings.activeLuogu },
        { id: 'xcpc', title: 'XCPC', name: settings.xcpcPlayer?.name },
      ] as const"
      :key="item.id"
      :aria-pressed="platform === item.id"
      @click="emit('select', item.id)"
    >
      <strong>{{ item.title }}</strong
      ><span>{{ item.name || '尚未连接' }}</span
      ><small>{{ item.name ? '当前档案' : '绑定公开账号' }}</small>
    </button>
  </div>
</template>
<style scoped>
.connection-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.connection-cards button {
  display: flex;
  flex-direction: column;
  align-items: start;
  padding: 12px;
  gap: 4px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.connection-cards button[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--wash);
}
.connection-cards small {
  color: var(--muted);
}
@media (max-width: 600px) {
  .connection-cards {
    gap: 6px;
  }
  .connection-cards button {
    padding: 10px 8px;
    font-size: 11px;
  }
  .connection-cards span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
