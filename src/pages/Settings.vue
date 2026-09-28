<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Download,
  Upload,
  RefreshCw,
  Link2,
  Database,
  ShieldCheck,
  ArrowRight,
  Search,
} from 'lucide-vue-next';
import { api, settings, loadSettings, loadJob, job, notify, fullDate, browserMode } from '../api';
import type { XcpcCandidate } from '../../shared/xcpc';
import type { SyncJob } from '../../shared/domain';
const savedSection = sessionStorage.getItem('contest-review:settings-section');
const savedPlatform = sessionStorage.getItem('contest-review:account-platform');
const handle = ref(''),
  settingsSection = ref<'accounts' | 'sync' | 'backup'>(
    savedSection === 'sync' || savedSection === 'backup' ? savedSection : 'accounts',
  ),
  accountPlatform = ref<'cf' | 'atcoder' | 'xcpc'>(
    savedPlatform === 'atcoder' || savedPlatform === 'xcpc' ? savedPlatform : 'cf',
  ),
  busy = ref(false),
  error = ref(''),
  restoreFile = ref<File | null>(null),
  restoreInput = ref<HTMLInputElement | null>(null),
  restoreResult = ref('');
const xcpcName = ref(''),
  candidates = ref<XcpcCandidate[]>([]),
  xcpcBusy = ref(false);
const atcoderHandle = ref(''),
  atcoderJob = ref<SyncJob | null>(null),
  atcoderVerified = ref(false),
  atcoderVerifiedBy = ref('submissions');
let atcoderTimer: ReturnType<typeof setInterval> | undefined;
watch(settingsSection, (value) => sessionStorage.setItem('contest-review:settings-section', value));
watch(accountPlatform, (value) => sessionStorage.setItem('contest-review:account-platform', value));
async function loadAtcoder() {
  const data = await api<{ job: SyncJob | null; verified: boolean; verifiedBy: string }>('/atcoder/binding');
  atcoderJob.value = data.job;
  atcoderVerified.value = data.verified;
  atcoderVerifiedBy.value = data.verifiedBy;
}
async function bindAtcoder(value = atcoderHandle.value) {
  busy.value = true;
  error.value = '';
  try {
    await api('/atcoder/binding', { handle: value });
    await loadSettings();
    atcoderHandle.value = settings.value.activeAtcoder ?? '';
    await loadAtcoder();
    notify('AtCoder 用户名已绑定，请同步公开提交');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function syncAtcoder(mode: 'full' | 'incremental' = 'incremental', resume = false) {
  busy.value = true;
  error.value = '';
  try {
    await api('/atcoder/sync', { mode, resume });
    await loadAtcoder();
    notify('AtCoder 同步已开始');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  handle.value = settings.value.activeHandle;
  atcoderHandle.value = settings.value.activeAtcoder ?? '';
  void loadAtcoder();
  atcoderTimer = setInterval(() => {
    if (atcoderJob.value?.status === 'running') void loadAtcoder();
  }, 2000);
});
onUnmounted(() => clearInterval(atcoderTimer));
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
async function searchXcpc() {
  xcpcBusy.value = true;
  error.value = '';
  try {
    candidates.value = await api<XcpcCandidate[]>(
      '/xcpc/search?name=' + encodeURIComponent(xcpcName.value.trim()),
    );
    if (!candidates.value.length) error.value = '未找到选手，请输入公开榜单中的中文姓名。';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    xcpcBusy.value = false;
  }
}
async function bindXcpc(key: string) {
  xcpcBusy.value = true;
  error.value = '';
  try {
    await api('/xcpc/binding', { key });
    await loadSettings();
    candidates.value = [];
    notify('XCPC 选手已绑定，比赛已加入复盘列表');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    xcpcBusy.value = false;
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
    if (!previous) await api('/training/backup-exported', {});
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
  <nav class="content-switcher" aria-label="设置分类">
    <button :class="{ active: settingsSection === 'accounts' }" @click="settingsSection = 'accounts'">
      账号连接
    </button>
    <button :class="{ active: settingsSection === 'sync' }" @click="settingsSection = 'sync'">
      同步状态
    </button>
    <button :class="{ active: settingsSection === 'backup' }" @click="settingsSection = 'backup'">
      备份与恢复
    </button>
  </nav>
  <nav v-show="settingsSection === 'accounts'" class="content-switcher sub-switcher" aria-label="账号平台">
    <button :class="{ active: accountPlatform === 'cf' }" @click="accountPlatform = 'cf'">Codeforces</button>
    <button :class="{ active: accountPlatform === 'atcoder' }" @click="accountPlatform = 'atcoder'">
      AtCoder
    </button>
    <button :class="{ active: accountPlatform === 'xcpc' }" @click="accountPlatform = 'xcpc'">XCPC</button>
  </nav>
  <div class="settings-layout">
    <div>
      <section
        v-show="settingsSection === 'accounts' && accountPlatform === 'atcoder'"
        class="panel settings-card"
      >
        <div class="section-head">
          <div class="section-title">
            <span class="section-icon"><Link2 :size="20" /></span>
            <div>
              <h2>AtCoder 账号</h2>
              <p>使用公开用户名独立绑定；提交数据来自 AtCoder Problems 非官方接口。</p>
            </div>
          </div>
          <span v-if="settings.activeAtcoder" class="badge mastered">已绑定</span>
        </div>
        <form class="handle-form" @submit.prevent="bindAtcoder()">
          <label
            >AtCoder 用户名<input
              v-model="atcoderHandle"
              required
              pattern="[A-Za-z0-9_]+"
              maxlength="64"
              placeholder="例如 kenkoooo"
              :disabled="busy || atcoderJob?.status === 'running'" /></label
          ><button class="primary" :disabled="busy || atcoderJob?.status === 'running'">
            绑定 AtCoder <ArrowRight :size="16" />
          </button>
        </form>
        <div v-if="settings.atcoderHandles?.length" class="profile-switch">
          <span class="small subtle">AtCoder 账号分区</span
          ><button
            v-for="h in settings.atcoderHandles"
            :key="h"
            :disabled="
              busy ||
              h.toLowerCase() === settings.activeAtcoder?.toLowerCase() ||
              atcoderJob?.status === 'running'
            "
            @click="bindAtcoder(h)"
          >
            {{ h }}
          </button>
        </div>
        <p v-if="settings.activeAtcoder" class="small subtle">
          {{
            atcoderVerified
              ? atcoderVerifiedBy === 'history'
                ? '已从官方比赛历史验证该用户名'
                : '已从公开提交验证该用户名'
              : '尚无法验证：无公开提交或尚未同步'
          }}<template v-if="atcoderJob">
            ·
            {{
              { running: '正在同步', completed: '同步完成', failed: '同步未完成', interrupted: '同步已中断' }[
                atcoderJob.status
              ]
            }}
            · 已读取 {{ atcoderJob.processed }} 条 · {{ atcoderJob.message
            }}<template v-if="atcoderJob.finishedAt">
              · {{ fullDate(atcoderJob.finishedAt) }}</template
            ></template
          >
        </p>
        <div class="button-row">
          <button
            class="primary"
            :disabled="busy || !settings.activeAtcoder || atcoderJob?.status === 'running'"
            @click="syncAtcoder()"
          >
            <RefreshCw :size="15" />{{ atcoderJob ? '增量同步' : '首次同步' }}</button
          ><button
            :disabled="busy || !settings.activeAtcoder || atcoderJob?.status === 'running'"
            @click="syncAtcoder('full')"
          >
            全量核对</button
          ><button
            v-if="atcoderJob && ['failed', 'interrupted'].includes(atcoderJob.status)"
            :disabled="busy"
            @click="syncAtcoder(atcoderJob.mode, true)"
          >
            继续同步
          </button>
        </div>
        <p class="small subtle">请求间隔至少一秒。来源可能延迟或中断；失败时保留已导入数据，离线仍可复盘。</p>
      </section>
      <section
        v-show="settingsSection === 'accounts' && accountPlatform === 'cf'"
        class="panel settings-card"
      >
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
      <section
        v-show="settingsSection === 'accounts' && accountPlatform === 'xcpc'"
        class="panel settings-card"
      >
        <div class="section-head">
          <div class="section-title">
            <span class="section-icon"><Link2 :size="20" /></span>
            <div>
              <h2>XCPC Rating 选手</h2>
              <p>按姓名搜索公开选手，同名时请核对学校或组织。</p>
            </div>
          </div>
          <span v-if="settings.xcpcPlayer" class="badge mastered">已绑定</span>
        </div>
        <p v-if="settings.xcpcPlayer" class="alert success">
          当前选手：{{ settings.xcpcPlayer.name }} · {{ settings.xcpcPlayer.org }} ·
          {{ settings.xcpcPlayer.contests }} 场比赛
        </p>
        <form class="handle-form" @submit.prevent="searchXcpc">
          <label
            >选手姓名<input
              v-model="xcpcName"
              required
              maxlength="80"
              placeholder="输入选手姓名"
              :disabled="xcpcBusy || busy"
          /></label>
          <button class="primary" :disabled="xcpcBusy || busy">
            <Search :size="16" />{{ xcpcBusy ? '搜索中…' : '搜索选手' }}
          </button>
        </form>
        <div v-if="candidates.length" class="profile-switch" aria-label="XCPC 候选选手">
          <button
            v-for="candidate in candidates"
            :key="candidate.key"
            :disabled="xcpcBusy || busy"
            @click="bindXcpc(candidate.key)"
          >
            {{ candidate.name }} · {{ candidate.org }} · {{ candidate.contests }} 场
          </button>
        </div>
        <p class="small subtle">
          只绑定选中的唯一档案。切换后旧选手的比赛报告和补充笔记仍保留在本机；XCPC 与 Codeforces 可单独使用。
        </p>
        <a
          class="text-link"
          href="https://hei-maom.github.io/xcpcrating/#/"
          target="_blank"
          rel="noopener noreferrer"
          >打开 XCPC Rating 原站</a
        >
      </section>
      <section v-show="settingsSection === 'sync'" class="panel settings-card">
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
      <section v-show="settingsSection === 'backup'" class="panel settings-card">
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
