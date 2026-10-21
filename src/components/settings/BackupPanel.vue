<script setup lang="ts">
import { ref } from 'vue';
import { Database, Download, Upload } from 'lucide-vue-next';
import { api, notify, loadSettings, loadJob, job, recentChecks, browserMode } from '../../api';
import { backupSummary } from '../../../shared/backup-summary';
const preview = ref<ReturnType<typeof backupSummary>>(),
  previewError = ref(''),
  previewLoading = ref(false);
let fileSerial = 0;
const busy = ref(false),
  error = ref(''),
  restoreFile = ref<File | null>(null),
  restoreInput = ref<HTMLInputElement | null>(null),
  restoreResult = ref('');
async function download(previous = false) {
  busy.value = true;
  error.value = '';
  try {
    const data = await api(previous ? '/backup/previous' : '/backup');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `contest-review-${previous ? 'before-restore-' : ''}${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (!previous) await api('/training/backup-exported', {});
    notify('备份已导出');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function selectFile(e: Event) {
  restoreFile.value = (e.target as HTMLInputElement).files?.[0] || null;
  const file = restoreFile.value,
    serial = ++fileSerial;
  preview.value = undefined;
  previewError.value = '';
  if (!file) return;
  previewLoading.value = true;
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error('备份文件超过 100 MB 限制');
    const summary = backupSummary(JSON.parse(await file.text()));
    if (serial === fileSerial) preview.value = summary;
  } catch {
    if (serial === fileSerial)
      previewError.value = '无法识别此文件概要；恢复接口仍会执行完整格式与引用校验。';
  } finally {
    if (serial === fileSerial) previewLoading.value = false;
  }
}
async function restore() {
  if (!restoreFile.value) return;
  if (!confirm('恢复将替换全部本地账号的数据。当前数据会先自动备份。确认恢复所选文件？')) return;
  busy.value = true;
  error.value = '';
  try {
    if (restoreFile.value.size > 100 * 1024 * 1024) throw new Error('备份文件超过 100 MB 限制');
    const data = JSON.parse(await restoreFile.value.text());
    const result = await api<{ backupPath: string }>('/backup/restore', data);
    restoreResult.value = result.backupPath;
    await loadSettings();
    await loadJob();
    restoreFile.value = null;
    preview.value = undefined;
    if (restoreInput.value) restoreInput.value.value = '';
    notify('备份恢复完成');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div v-if="error" role="alert" class="alert error">{{ error }}</div>
  <section class="panel settings-card">
    <div class="section-head">
      <div class="section-title">
        <span class="section-icon"><Database :size="20" /></span>
        <div>
          <h2>备份与恢复</h2>
          <p>备份包含全部账号分区、笔记、代码和复习记录。</p>
        </div>
      </div>
    </div>
    <div class="backup-actions">
      <div>
        <h3>导出完整备份</h3>
        <p>建议定期备份到其他磁盘。文件格式为 JSON。</p>
        <button :disabled="recentChecks > 0 || busy || job?.status === 'running'" @click="download()">
          <Download :size="16" />导出备份
        </button>
      </div>
      <div>
        <h3>从备份恢复</h3>
        <p>校验通过后替换现有数据，并自动保存恢复前备份。</p>
        <label class="file-picker"
          ><Upload :size="16" />选择备份文件<input
            ref="restoreInput"
            type="file"
            accept=".json,application/json"
            aria-label="选择备份文件"
            :disabled="recentChecks > 0 || busy || job?.status === 'running'"
            @change="selectFile"
        /></label>
        <div v-if="restoreFile" class="restore-confirm">
          <span>{{ restoreFile.name }}</span
          ><button :disabled="recentChecks > 0 || busy || job?.status === 'running'" @click="restore">
            恢复此备份
          </button>
        </div>
        <p v-if="previewLoading" role="status">正在只读解析备份概要…</p>
        <p v-if="previewError" class="subtle">{{ previewError }}</p>
        <div v-if="preview" class="backup-preview">
          <h3>待恢复文件概要 · v{{ preview.version }}</h3>
          <p>账号分区：{{ preview.profiles.join('、') || '无' }}。恢复将替换本机全部账号数据。</p>
          <p>规划记录 {{ preview.planning }} · 引导复盘 {{ preview.workflows }}</p>
          <details>
            <summary>记录数量</summary>
            <ul>
              <li v-for="row in preview.counts" :key="row.name">{{ row.name }}：{{ row.count }}</li>
            </ul>
          </details>
          <p class="small subtle">
            概要不是完整校验结果。执行中的引导会中断，未执行提案与旧预览失效，恢复后需要重新查证。
          </p>
        </div>
      </div>
    </div>
    <p v-if="restoreResult" class="alert success">恢复成功。原数据备份：{{ restoreResult }}</p>
    <p class="small subtle">
      导出格式 v11，支持恢复 v1–v11。包含算法偏好、路径、计划决策与引导进度；旧版应用可能无法读取新版备份。
    </p>
    <button
      v-if="browserMode"
      class="text-link"
      :disabled="recentChecks > 0 || busy || job?.status === 'running'"
      @click="download(true)"
    >
      下载最近一次恢复前的备份
    </button>
  </section>
</template>
