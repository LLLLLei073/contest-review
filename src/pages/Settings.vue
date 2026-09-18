<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Download, Upload, RefreshCw, Link2, Database, ShieldCheck, ArrowRight } from 'lucide-vue-next';
import { api, settings, loadSettings, loadJob, job, notify, fullDate, browserMode } from '../api';
const handle = ref(''),
  busy = ref(false),
  error = ref(''),
  restoreFile = ref<File | null>(null),
  restoreInput = ref<HTMLInputElement | null>(null),
  restoreResult = ref('');
onMounted(() => {
  handle.value = settings.value.activeHandle;
});
async function bind(value = handle.value) {
  busy.value = true;
  error.value = '';
  try {
    await api('/settings/handle', { handle: value });
    await loadSettings();
    await loadJob();
    handle.value = settings.value.activeHandle;
    notify('用户名已绑定，点击同步开始导入');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function sync(mode = 'incremental', resume = false) {
  error.value = '';
  busy.value = true;
  try {
    await api('/sync', { mode, resume });
    await loadJob();
    notify('同步已开始，可继续浏览其他页面');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
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
    notify('备份已导出');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function selectFile(e: Event) {
  restoreFile.value = (e.target as HTMLInputElement).files?.[0] || null;
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
  <div class="page-head">
    <div>
      <div class="eyebrow">YOUR DATA, YOUR SPACE</div>
      <h1>设置与数据</h1>
      <p>连接你的训练记录，妥善保存每一次思考。</p>
    </div>
    <span class="date-chip"><ShieldCheck :size="16" />本地优先</span>
  </div>
  <div v-if="error" class="alert error" role="alert">{{ error }}</div>
  <div v-if="browserMode" class="alert">
    在线版的数据保存在当前浏览器中，不会上传到
    GitHub。清除网站数据或更换浏览器前，请导出备份；导入历史时请保持页面打开。
  </div>
  <div class="settings-layout">
    <div>
      <section class="panel settings-card">
        <div class="section-head">
          <div class="section-title">
            <span class="section-icon"><Link2 :size="20" /></span>
            <div>
              <h2>Codeforces 账号</h2>
              <p>只需要公开用户名，无需密码或 API 密钥。</p>
            </div>
          </div>
          <span v-if="settings.activeHandle" class="badge mastered">已绑定</span>
        </div>
        <form class="handle-form" @submit.prevent="bind()">
          <label
            >Codeforces Handle<input
              v-model="handle"
              required
              pattern="[a-zA-Z0-9_.\-]+"
              maxlength="64"
              placeholder="例如 tourist"
              :disabled="busy || job?.status === 'running'" /></label
          ><button class="primary" :disabled="busy || job?.status === 'running'">
            {{ busy ? '处理中…' : '绑定用户名' }}<ArrowRight :size="16" />
          </button>
        </form>
        <div v-if="settings.handles.length > 1" class="profile-switch">
          <span class="small subtle">本机账号分区</span
          ><button
            v-for="h in settings.handles"
            :key="h"
            :disabled="busy || job?.status === 'running' || h === settings.activeHandle"
            @click="bind(h)"
          >
            {{ h }}
          </button>
        </div>
        <p class="small subtle">切换用户名会使用独立的数据分区；已有笔记和复习进度仍然保留。</p>
      </section>
      <section class="panel settings-card">
        <div class="section-head">
          <div class="section-title">
            <span class="section-icon"><RefreshCw :size="20" /></span>
            <div>
              <h2>同步提交历史</h2>
              <p>首次读取全部公开历史，之后可增量更新。</p>
            </div>
          </div>
        </div>
        <div v-if="job" :class="['sync-status', job.status]">
          <div>
            <span :class="['status-dot', job.status]"></span
            ><strong>{{
              { running: '正在同步', completed: '同步完成', failed: '同步未完成', interrupted: '同步已中断' }[
                job.status
              ]
            }}</strong
            ><span class="mono">{{ job.processed.toLocaleString() }} 条</span>
          </div>
          <p>{{ job.message }}</p>
          <small
            >开始于 {{ fullDate(job.startedAt)
            }}{{ job.finishedAt ? ' · 结束于 ' + fullDate(job.finishedAt) : '' }}</small
          >
          <div v-if="job.status === 'running'" class="progress-indeterminate"></div>
        </div>
        <div v-else class="quiet-empty align-left">尚未同步。绑定用户名后，开始建立你的错题档案。</div>
        <div class="button-row">
          <button
            class="primary"
            :disabled="busy || !settings.activeHandle || job?.status === 'running'"
            @click="sync()"
          >
            <RefreshCw :size="15" />{{ job ? '增量同步' : '开始首次同步' }}</button
          ><button
            :disabled="busy || !settings.activeHandle || job?.status === 'running'"
            @click="sync('full')"
          >
            全量重新核对</button
          ><button
            v-if="job && ['failed', 'interrupted'].includes(job.status)"
            :disabled="busy"
            @click="sync(job.mode, true)"
          >
            继续上次同步
          </button>
        </div>
        <p class="small subtle">
          公开 API
          按至少两秒的间隔请求。历史较多时需要等待；已读取数据会分页保存。全量核对用于更新较早的判题变化。
        </p>
      </section>
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
            <button :disabled="busy || job?.status === 'running'" @click="download()">
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
                :disabled="busy || job?.status === 'running'"
                @change="selectFile"
            /></label>
            <div v-if="restoreFile" class="restore-confirm">
              <span>{{ restoreFile.name }}</span
              ><button :disabled="busy || job?.status === 'running'" @click="restore">恢复此备份</button>
            </div>
          </div>
        </div>
        <p v-if="restoreResult" class="alert success">恢复成功。原数据备份：{{ restoreResult }}</p>
        <button
          v-if="browserMode"
          class="text-link"
          :disabled="busy || job?.status === 'running'"
          @click="download(true)"
        >
          下载最近一次恢复前的备份
        </button>
      </section>
    </div>
    <aside class="settings-note">
      <ShieldCheck :size="30" />
      <h2>让记录留在自己手里。</h2>
      <p>
        {{
          browserMode
            ? '数据保存在当前浏览器的 IndexedDB 中，不会跨设备自动同步。页面缓存完成后，离线也能查看笔记、整理错因和复习。'
            : '数据保存在本机的 SQLite 数据库中。即使没有网络，也能查看笔记、整理错因和完成复习。'
        }}
      </p>
      <hr />
      <h3>同步会带来什么？</h3>
      <ul>
        <li>题目名称、难度与算法标签</li>
        <li>每次提交的时间、语言与判题结果</li>
        <li>关联比赛与公开评级变化</li>
      </ul>
      <h3>需要你留下什么？</h3>
      <p>当时的思路、真正的错因、解法与代码。通过评测之后，仍值得再独立做一次。</p>
    </aside>
  </div>
</template>
