<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { api, dataRevision, fullDate } from '../../api';
import {
  backupReminderDue,
  unsupportedBackup,
  type AutomaticBackupStatus,
} from '../../../shared/backup-status';
const automatic = ref<AutomaticBackupStatus>({ ...unsupportedBackup });
const lastDownload = ref<string | null>(null),
  error = ref(''),
  busy = ref(false);
const snooze = ref(localStorage.getItem('contest-review:backup-snooze'));
const due = computed(() => backupReminderDue(lastDownload.value, snooze.value));
let serial = 0;
async function load() {
  const token = ++serial;
  try {
    const [a, h] = await Promise.all([
      api<AutomaticBackupStatus>('/backup/automatic'),
      api<{ lastBackup: string | null }>('/training/health'),
    ]);
    if (token !== serial) return;
    automatic.value = a;
    lastDownload.value = h.lastBackup;
  } catch (e) {
    if (token === serial) error.value = (e as Error).message;
  }
}
async function change(run = false) {
  busy.value = true;
  error.value = '';
  try {
    automatic.value = run
      ? await api('/backup/automatic/run', {})
      : await api('/backup/automatic', { enabled: !automatic.value.enabled }, 'PUT');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function postpone() {
  snooze.value = new Date(Date.now() + 7 * 86400000).toISOString();
  localStorage.setItem('contest-review:backup-snooze', snooze.value);
}
watch(dataRevision, load, { immediate: true });
onBeforeUnmount(() => {
  serial++;
});
</script>
<template>
  <section class="panel settings-card" aria-label="备份保障">
    <h2>备份保障</h2>
    <p>
      上次发起备份下载：{{ lastDownload ? fullDate(lastDownload) : '尚无记录' }}。请自行确认下载文件已保存。
    </p>
    <div v-if="due" class="alert" role="status">
      建议保存一份完整备份到其他磁盘。<button class="small-button" @click="postpone">7 天后提醒</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="automatic.supported">
      <h3>桌面自动备份 · {{ automatic.enabled ? '已开启' : '已关闭' }}</h3>
      <p>应用运行时每天一次，保留最近 7 份；同步时延后。</p>
      <p class="backup-path">位置：{{ automatic.directory }}</p>
      <p>最近成功：{{ automatic.lastSuccess ? fullDate(automatic.lastSuccess) : '尚无记录' }}</p>
      <p v-if="automatic.error" role="alert">{{ automatic.error }}</p>
      <div class="button-row">
        <button :disabled="busy" @click="change()">
          {{ automatic.enabled ? '关闭自动备份' : '开启自动备份' }}</button
        ><button :disabled="busy" @click="change(true)">立即自动备份</button>
      </div>
    </template>
    <p v-else>此运行方式不支持自动落盘，请手动下载备份。</p>
    <p class="small subtle">
      完整备份包含 AI 配置和密钥，请妥善保管。同盘自动备份无法防止磁盘损坏，也不替代保存到其他位置的备份。
    </p>
  </section>
</template>
<style scoped>
.backup-path {
  overflow-wrap: anywhere;
}
</style>
