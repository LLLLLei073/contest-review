<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue';
import { api, dataRevision } from '../api';
import { backupReminderDue } from '../../shared/backup-status';
const lastDownload = ref<string | null>(null),
  loaded = ref(false);
const snoozed = ref(localStorage.getItem('contest-review:backup-snooze'));
const due = computed(() => loaded.value && backupReminderDue(lastDownload.value, snoozed.value));
let serial = 0;
async function load() {
  const token = ++serial;
  try {
    const h = await api<{ lastBackup: string | null }>('/training/health');
    if (token === serial) {
      lastDownload.value = h.lastBackup;
      loaded.value = true;
      snoozed.value = localStorage.getItem('contest-review:backup-snooze');
    }
  } catch {
    /* the main data UI reports connection errors */
  }
}
function postpone() {
  snoozed.value = new Date(Date.now() + 7 * 86400000).toISOString();
  localStorage.setItem('contest-review:backup-snooze', snoozed.value);
}
watch(dataRevision, load, { immediate: true });
onBeforeUnmount(() => {
  serial++;
});
</script>
<template>
  <aside v-if="due" class="panel" aria-label="备份提醒">
    <p>学习记录保存在本机，建议定期下载备份到其他位置。</p>
    <div class="button-row">
      <RouterLink to="/settings?view=backup">备份与恢复 →</RouterLink
      ><button class="small-button" @click="postpone">7 天后提醒</button>
    </div>
  </aside>
</template>
