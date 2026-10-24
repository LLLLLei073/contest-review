<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, browserMode, dataRevision, loadSettings, notify, settings } from '../api';
import type { SyncJob } from '../../shared/domain';
import type { InsightsPayload } from '../../shared/insights';
import RadarChart from '../components/charts/RadarChart.vue';

const insights = ref<InsightsPayload | null>(null);
const error = ref('');
const loading = ref(true);
const busy = ref('');
const handle = ref('');
const atcoderHandle = ref('');
const luoguUid = ref('');
const cfJob = ref<SyncJob | null>(null);
const atcoderJob = ref<SyncJob | null>(null);
const luoguJob = ref<SyncJob | null>(null);
const luoguUser = ref<InsightsPayload['accounts'][number] | null>(null);
let alive = true;
let loadSerial = 0;
let pollTimer: ReturnType<typeof setInterval> | undefined;
// 连战结束/中断会推进 dataRevision，这里跟随刷新总览
watch(dataRevision, () => {
  if (alive) void load();
});

const platformColors: Record<string, string> = {
  cf: '#3f6ff0',
  atcoder: '#f59e0b',
  luogu: '#ef5b5b',
  all: 'var(--highlight)',
};
const platformNames: Record<string, string> = {
  cf: 'Codeforces',
  atcoder: 'AtCoder',
  luogu: '洛谷',
  all: '全部来源',
};
const accountOf = (platform: 'cf' | 'atcoder' | 'luogu') =>
  insights.value?.accounts.find((a) => a.platform === platform);
const battleStatus = (status: string) =>
  ({ active: '进行中', paused: '已中断', ended: '已结束' })[status] ?? status;

async function load() {
  const serial = ++loadSerial;
  loading.value = true;
  error.value = '';
  try {
    const [next, cfLatest, atcLatest, lgLatest] = await Promise.all([
      api<InsightsPayload>('/insights'),
      api<SyncJob | null>('/sync'),
      api<SyncJob | null>('/atcoder/sync'),
      api<SyncJob | null>('/luogu/sync'),
    ]);
    if (!alive || serial !== loadSerial) return;
    insights.value = next;
    cfJob.value = cfLatest;
    atcoderJob.value = atcLatest;
    luoguJob.value = lgLatest;
    const luogu = accountOf('luogu');
    luoguUser.value = luogu?.bound ? luogu : null;
  } catch (e) {
    if (alive && serial === loadSerial) error.value = (e as Error).message;
  } finally {
    if (alive && serial === loadSerial) loading.value = false;
  }
}

async function refresh() {
  await load();
  notify('数据总览已刷新');
}

const running = computed(() =>
  [cfJob.value, atcoderJob.value, luoguJob.value].some((j) => j?.status === 'running'),
);

async function bindHandle() {
  busy.value = 'cf';
  error.value = '';
  try {
    await api('/settings/handle', { handle: handle.value });
    await loadSettings();
    handle.value = settings.value.activeHandle;
    await load();
    notify('Codeforces 用户名已绑定，点击同步开始导入');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function bindAtcoder() {
  busy.value = 'atcoder';
  error.value = '';
  try {
    await api('/atcoder/binding', { handle: atcoderHandle.value });
    await loadSettings();
    atcoderHandle.value = settings.value.activeAtcoder ?? '';
    await load();
    notify('AtCoder 用户名已绑定，点击同步导入提交');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function bindLuogu() {
  busy.value = 'luogu';
  error.value = '';
  try {
    const data = await api<{ user: NonNullable<typeof luoguUser.value> }>('/luogu/binding', {
      uid: luoguUid.value,
    });
    luoguUser.value = data.user;
    await loadSettings();
    await load();
    notify(`洛谷用户 ${data.user?.name ?? ''} 已绑定，点击同步导入提交`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function sync(platform: 'cf' | 'atcoder' | 'luogu') {
  busy.value = platform;
  error.value = '';
  try {
    if (platform === 'cf') await api('/sync', { mode: 'incremental' });
    else if (platform === 'atcoder') await api('/atcoder/sync', { mode: 'incremental' });
    else await api('/luogu/sync', { mode: 'incremental' });
    // 任务可能在第一次轮询前就完成，启动时即登记待刷新
    refreshArmed = true;
    await poll();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function poll() {
  const [cfLatest, atcLatest, lgLatest] = await Promise.all([
    api<SyncJob | null>('/sync'),
    api<SyncJob | null>('/atcoder/sync'),
    api<SyncJob | null>('/luogu/sync'),
  ]);
  if (!alive) return;
  cfJob.value = cfLatest;
  atcoderJob.value = atcLatest;
  luoguJob.value = lgLatest;
}

let refreshArmed = false;
function watchCompletion() {
  const anyRunning = [cfJob.value, atcoderJob.value, luoguJob.value].some((j) => j?.status === 'running');
  if (anyRunning) {
    refreshArmed = true;
    return;
  }
  if (refreshArmed) {
    refreshArmed = false;
    void load();
  }
}

const radarSeries = computed(() => {
  const data = insights.value;
  if (!data) return [];
  const names = data.accounts.filter((a) => a.bound).map((a) => a.platform);
  const options: ('all' | 'cf' | 'atcoder' | 'luogu')[] = ['all', 'cf', 'atcoder', 'luogu'].filter(
    (p) => p === 'all' || names.includes(p as 'cf' | 'atcoder' | 'luogu'),
  ) as ('all' | 'cf' | 'atcoder' | 'luogu')[];
  return options.map((platform) => ({
    platform,
    name: platformNames[platform],
    color: platformColors[platform],
    values: data.mastery[platform].map((area) => area.score),
    tooltip: data.mastery[platform].map((area) => `${area.name} ${area.score} 分 · ${area.samples} 题`),
  }));
});
const enabledPlatforms = ref<('all' | 'cf' | 'atcoder' | 'luogu')[]>(['all']);
const radarKey = computed(() =>
  radarSeries.value
    .filter((s) => enabledPlatforms.value.includes(s.platform))
    .map((s) => s.name)
    .join('|'),
);
const radarProps = computed(() =>
  radarSeries.value
    .filter((s) => enabledPlatforms.value.includes(s.platform))
    .map((s) => ({ name: s.name, color: s.color, values: s.values, samples: s.tooltip })),
);
const radarAxes = computed(() => insights.value?.mastery.all.map((area) => area.name) ?? []);

const ratingChart = computed(() => {
  const data = insights.value;
  if (!data) return null;
  const cf = data.ratings.cf;
  const atcoder = data.ratings.atcoder;
  const all = [...cf, ...atcoder];
  if (!all.length) return null;
  const width = 720,
    height = 230,
    padX = 42,
    padY = 22;
  const tMin = Math.min(...all.map((p) => p.t)),
    tMax = Math.max(...all.map((p) => p.t)),
    rMin = Math.min(...all.map((p) => p.rating)),
    rMax = Math.max(...all.map((p) => p.rating));
  const x = (t: number) =>
    tMax === tMin ? width / 2 : padX + ((t - tMin) / (tMax - tMin)) * (width - 2 * padX);
  const y = (r: number) =>
    rMax === rMin ? height / 2 : height - padY - ((r - rMin) / (rMax - rMin)) * (height - 2 * padY);
  const line = (points: { t: number; rating: number }[]) =>
    points.map((p) => `${x(p.t).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ');
  const grid = [rMax, Math.round((rMax + rMin) / 2), rMin];
  return {
    width,
    height,
    grid: grid.map((r) => ({ r, y: y(r) })),
    series: [
      { name: 'Codeforces', color: platformColors.cf, points: line(cf), data: cf },
      { name: 'AtCoder', color: platformColors.atcoder, points: line(atcoder), data: atcoder },
    ]
      .filter((s) => s.data.length)
      .map((s) => ({
        ...s,
        dots: s.data.map((p) => ({
          x: x(p.t).toFixed(1),
          y: y(p.rating).toFixed(1),
          label: `${s.name} ${p.rating} · ${new Date(p.t * 1000).toLocaleDateString('zh-CN')}`,
        })),
      })),
  };
});

const difficultyChart = computed(() => {
  const data = insights.value;
  if (!data) return [];
  const max = Math.max(1, ...data.difficulty.map((d) => d.cf + d.atcoder + d.luogu));
  return data.difficulty.map((d) => ({
    label: d.label,
    total: d.cf + d.atcoder + d.luogu,
    segments: [
      { color: platformColors.cf, label: 'Codeforces', value: d.cf },
      { color: platformColors.atcoder, label: 'AtCoder', value: d.atcoder },
      { color: platformColors.luogu, label: '洛谷', value: d.luogu },
    ],
    height: ((d.cf + d.atcoder + d.luogu) / max) * 140,
  }));
});

const activityChart = computed(() => {
  const data = insights.value;
  if (!data) return [];
  const max = Math.max(1, ...data.activity.map((m) => m.cf + m.atcoder + m.luogu));
  return data.activity.map((m) => ({
    label: m.month.slice(2).replace('-', '/'),
    month: m.month,
    total: m.cf + m.atcoder + m.luogu,
    segments: [
      { color: platformColors.cf, label: 'Codeforces', value: m.cf },
      { color: platformColors.atcoder, label: 'AtCoder', value: m.atcoder },
      { color: platformColors.luogu, label: '洛谷', value: m.luogu },
    ],
    height: ((m.cf + m.atcoder + m.luogu) / max) * 140,
  }));
});

const anyBound = computed(() => !!insights.value?.accounts.some((a) => a.bound));
function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '尚未同步';
}

onMounted(() => {
  handle.value = settings.value.activeHandle;
  atcoderHandle.value = settings.value.activeAtcoder ?? '';
  luoguUid.value = settings.value.activeLuogu ?? '';
  void loadSettings().then(() => {
    if (!alive) return;
    handle.value = settings.value.activeHandle;
    atcoderHandle.value = settings.value.activeAtcoder ?? '';
    luoguUid.value = settings.value.activeLuogu ?? '';
  });
  void load();
  pollTimer = setInterval(() => {
    // armed 状态下即使任务尚未观测到 running 也持续轮询，直到其结束
    if (!running.value && !refreshArmed) return;
    void poll().then(watchCompletion);
  }, 2500);
});
onBeforeUnmount(() => {
  alive = false;
  if (pollTimer) clearInterval(pollTimer);
});
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">ALL PLATFORMS, ONE VIEW</div>
      <h1>数据总览</h1>
      <p>绑定各平台账号，把 Codeforces、AtCoder 与洛谷的训练数据放在同一页。</p>
    </div>
    <div class="button-row">
      <button :disabled="loading || running" @click="refresh">{{ loading ? '加载中…' : '刷新数据' }}</button>
    </div>
  </div>
  <div v-if="error" class="alert error" role="alert">{{ error }}</div>
  <div v-if="!loading && insights && !anyBound" class="alert">
    还没有绑定任何平台账号：在下方卡片输入用户名即可绑定，或在
    <RouterLink to="/settings?view=accounts">设置与数据</RouterLink>
    中完成连接。
  </div>

  <section class="insight-accounts" aria-label="平台账号">
    <div v-for="platform in ['cf', 'atcoder', 'luogu'] as const" :key="platform" class="panel account-card">
      <div class="account-head">
        <strong>{{ platformNames[platform] }}</strong>
        <span v-if="accountOf(platform)?.bound" class="account-badge bound">已连接</span>
        <span v-else class="account-badge">未绑定</span>
      </div>
      <template v-if="accountOf(platform)?.bound">
        <p class="account-name">
          {{ accountOf(platform)!.name || accountOf(platform)!.handle }}
          <small v-if="platform === 'luogu' && accountOf(platform)!.handle">UID {{ accountOf(platform)!.handle }}</small>
        </p>
        <dl class="account-facts">
          <div>
            <dt>当前 Rating</dt>
            <dd>{{ accountOf(platform)!.rating ?? '—' }}</dd>
          </div>
          <div>
            <dt>本地已同步通过</dt>
            <dd>{{ accountOf(platform)!.solved }} 题</dd>
          </div>
          <div>
            <dt>提交记录</dt>
            <dd>{{ accountOf(platform)!.submissions }} 条</dd>
          </div>
          <div v-if="platform === 'luogu' && accountOf(platform)!.officialSolved !== null">
            <dt>洛谷官方通过</dt>
            <dd>{{ accountOf(platform)!.officialSolved }} 题</dd>
          </div>
          <div>
            <dt>最近同步</dt>
            <dd>{{ formatDateTime(accountOf(platform)!.lastSync) }}</dd>
          </div>
        </dl>
        <button
          class="primary"
          :disabled="busy === platform || running"
          @click="sync(platform)"
        >
          {{
            platform === 'cf'
              ? (cfJob?.status === 'running' ? `同步中 · ${cfJob.message}` : '同步数据')
              : platform === 'atcoder'
                ? (atcoderJob?.status === 'running' ? `同步中 · ${atcoderJob.message}` : '同步数据')
                : (luoguJob?.status === 'running' ? `同步中 · ${luoguJob.message}` : '同步数据')
          }}
        </button>
        <p
          v-if="platform !== 'cf' && (platform === 'atcoder' ? atcoderJob : luoguJob)?.status === 'failed'"
          class="account-error"
        >
          {{ (platform === 'atcoder' ? atcoderJob : luoguJob)?.message }}
        </p>
      </template>
      <template v-else>
        <p class="account-hint">
          <template v-if="platform === 'cf'">输入 Codeforces 用户名完成绑定</template>
          <template v-else-if="platform === 'atcoder'">输入 AtCoder 用户名完成绑定</template>
          <template v-else>输入洛谷 UID（个人主页地址 luogu.com.cn/user/ 后的数字）</template>
        </p>
        <form v-if="platform === 'cf'" class="account-form" @submit.prevent="bindHandle">
          <input
            v-model="handle"
            placeholder="用户名"
            :disabled="busy === platform"
            aria-label="Codeforces 用户名"
          />
          <button type="submit" class="primary" :disabled="busy === platform">
            {{ busy === platform ? '绑定中…' : '绑定' }}
          </button>
        </form>
        <form v-else-if="platform === 'atcoder'" class="account-form" @submit.prevent="bindAtcoder">
          <input
            v-model="atcoderHandle"
            placeholder="用户名"
            :disabled="busy === platform"
            aria-label="AtCoder 用户名"
          />
          <button type="submit" class="primary" :disabled="busy === platform">
            {{ busy === platform ? '绑定中…' : '绑定' }}
          </button>
        </form>
        <form v-else class="account-form" @submit.prevent="bindLuogu">
          <input
            v-model="luoguUid"
            inputmode="numeric"
            placeholder="例如 109757"
            :disabled="busy === platform || browserMode"
            aria-label="洛谷 UID"
          />
          <button type="submit" class="primary" :disabled="busy === platform || browserMode">
            {{ busy === platform ? '绑定中…' : '绑定' }}
          </button>
        </form>
        <p v-if="platform === 'luogu' && browserMode" class="account-error">
          在线版受浏览器跨域限制，洛谷同步仅本地模式可用。
        </p>
        <p v-if="platform === 'luogu'" class="account-note">洛谷仅提供较近一段的提交记录，历史深度有限。</p>
      </template>
    </div>
  </section>

  <template v-if="insights && anyBound">
    <section class="panel insight-panel" aria-label="关键指标">
      <div class="section-head"><h2>关键指标</h2></div>
      <div class="metrics insight-metrics">
        <div class="metric">
          <small>总通过题数</small>
          <strong>{{ insights.totals.solved }}</strong>
        </div>
        <div class="metric">
          <small>总提交记录</small>
          <strong>{{ insights.totals.submissions }}</strong>
        </div>
        <div class="metric">
          <small>活跃天数</small>
          <strong>{{ insights.totals.activeDays }}</strong>
        </div>
        <div class="metric">
          <small>Codeforces</small>
          <strong>{{ accountOf('cf')?.rating ?? '—' }}</strong>
        </div>
        <div class="metric">
          <small>AtCoder</small>
          <strong>{{ accountOf('atcoder')?.rating ?? '—' }}</strong>
        </div>
        <div class="metric">
          <small>洛谷通过</small>
          <strong>{{ accountOf('luogu')?.officialSolved ?? accountOf('luogu')?.solved ?? '—' }}</strong>
        </div>
      </div>
    </section>

    <section v-if="insights.battles.total" class="panel insight-panel" aria-label="连战记录">
      <div class="section-head">
        <h2>连战记录</h2>
        <RouterLink to="/battle" class="text-link">进入连战 →</RouterLink>
      </div>
      <div class="metrics insight-metrics battle-metrics">
        <div class="metric">
          <small>连战场次</small>
          <strong>{{ insights.battles.total }}</strong>
        </div>
        <div class="metric">
          <small>连战题目</small>
          <strong>{{ insights.battles.totalProblems }}</strong>
        </div>
        <div class="metric">
          <small>连战 AC</small>
          <strong>{{ insights.battles.solvedProblems }}</strong>
        </div>
        <div class="metric">
          <small>累计耗时</small>
          <strong>{{ insights.battles.totalMinutes }} 分</strong>
        </div>
      </div>
      <ol class="battle-briefs">
        <li v-for="b in insights.battles.recent" :key="b.id">
          <div class="battle-brief-head">
            <strong>{{ b.theme }}</strong>
            <span class="badge">{{ battleStatus(b.status) }}</span>
          </div>
          <p class="small subtle">
            {{ new Date(b.startedAt).toLocaleDateString() }} · {{ b.durationMinutes }} 分钟 ·
            {{ b.problemCount }} 题 / AC {{ b.solvedCount }}
          </p>
          <p v-if="b.summaryText" class="battle-brief-summary">{{ b.summaryText }}</p>
        </li>
      </ol>
    </section>

    <section class="panel insight-panel" aria-label="Rating 走势">
      <div class="section-head"><h2>Rating 走势</h2></div>
      <svg
        v-if="ratingChart"
        class="rating-chart"
        :viewBox="`0 0 ${ratingChart.width} ${ratingChart.height}`"
        role="img"
        aria-label="Codeforces 与 AtCoder 的 Rating 历史折线图"
      >
        <line
          v-for="(g, i) in ratingChart.grid"
          :key="i"
          :x1="42"
          :x2="ratingChart.width - 12"
          :y1="g.y"
          :y2="g.y"
          class="chart-grid"
        />
        <text v-for="(g, i) in ratingChart.grid" :key="'l' + i" :x="6" :y="g.y + 4" class="chart-tick">
          {{ g.r }}
        </text>
        <polyline
          v-for="s in ratingChart.series"
          :key="s.name"
          :points="s.points"
          fill="none"
          :stroke="s.color"
          stroke-width="2.5"
        />
        <template v-for="s in ratingChart.series" :key="'dots' + s.name">
          <circle v-for="(dot, i) in s.dots" :key="i" :cx="dot.x" :cy="dot.y" r="3" :fill="s.color">
            <title>{{ dot.label }}</title>
          </circle>
        </template>
      </svg>
      <p v-else class="quiet-empty">暂无比赛 Rating 记录：绑定账号并完成同步后，Codeforces 与 AtCoder 的 Rated 比赛历史会显示在这里。</p>
      <div v-if="ratingChart" class="chart-legend">
        <span v-for="s in ratingChart.series" :key="s.name"><i :style="{ background: s.color }"></i>{{ s.name }}</span>
      </div>
    </section>

    <section class="panel insight-panel" aria-label="能力雷达">
      <div class="section-head">
        <h2>能力雷达</h2>
        <div class="radar-toggle" role="group" aria-label="雷达图系列">
          <button
            v-for="s in radarSeries"
            :key="s.platform"
            :aria-pressed="enabledPlatforms.includes(s.platform)"
            :class="{ active: enabledPlatforms.includes(s.platform) }"
            @click="
              enabledPlatforms = enabledPlatforms.includes(s.platform)
                ? enabledPlatforms.filter((p) => p !== s.platform)
                : [...enabledPlatforms, s.platform]
            "
          >
            {{ s.name }}
          </button>
        </div>
      </div>
      <RadarChart
        :key="radarKey"
        :axes="radarAxes"
        :series="radarProps"
        labels
        aria-label="各平台算法领域掌握度雷达图"
        :tooltip="(axis) => radarProps.map((s) => `${s.name}：${radarAxes[axis]} ${s.values[axis]} 分`).join('；')"
      />
      <details class="chart-caption">
        <summary>口径说明</summary>
        <p>
          与训练统计页一致：已掌握 100、独立做对 85、借助提示 45、仍未做出 15，未重做时 AC
          70、失败 20，样本不足向 50 收敛。AtCoder 与洛谷的题目只有在复盘里标注过领域才会计入对应维度。
        </p>
      </details>
    </section>

    <div class="insight-columns">
      <section class="panel insight-panel" aria-label="难度分布">
        <div class="section-head"><h2>难度分布（已通过）</h2></div>
        <div v-if="difficultyChart.some((c) => c.total)" class="stacked-chart">
          <div v-for="col in difficultyChart" :key="col.label" class="stacked-col">
            <div class="stacked-bars" :style="{ height: Math.max(col.height, col.total ? 4 : 1) + 'px' }">
              <span
                v-for="seg in col.segments"
                v-show="seg.value"
                :key="seg.label"
                :style="{ height: col.total ? (seg.value / col.total) * 100 + '%' : '0', background: seg.color }"
                :title="`${seg.label}：${seg.value} 题`"
              ></span>
            </div>
            <small>{{ col.label }}</small>
          </div>
        </div>
        <p v-else class="quiet-empty">暂无带难度标签的通过记录。</p>
        <p class="chart-caption">难度为各平台原始分：CF/AtCoder 取估算难度，洛谷按入门→NOI+ 档位折算。</p>
      </section>

      <section class="panel insight-panel" aria-label="活跃趋势">
        <div class="section-head"><h2>近 12 个月提交</h2></div>
        <div v-if="activityChart.some((c) => c.total)" class="stacked-chart">
          <div v-for="col in activityChart" :key="col.month" class="stacked-col">
            <div class="stacked-bars" :style="{ height: Math.max(col.height, col.total ? 4 : 1) + 'px' }">
              <span
                v-for="seg in col.segments"
                v-show="seg.value"
                :key="seg.label"
                :style="{ height: col.total ? (seg.value / col.total) * 100 + '%' : '0', background: seg.color }"
                :title="`${col.month} ${seg.label}：${seg.value} 次提交`"
              ></span>
            </div>
            <small>{{ col.label }}</small>
          </div>
        </div>
        <p v-else class="quiet-empty">近 12 个月暂无提交记录。</p>
      </section>
    </div>
  </template>
  <p v-else-if="loading" class="quiet-empty">正在汇总各平台数据…</p>
</template>
<style scoped>
.insight-accounts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}
.account-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}
.account-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.account-badge {
  font-size: 12px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 10px;
}
.account-badge.bound {
  color: var(--on-highlight, #fff);
  background: var(--highlight);
  border-color: var(--highlight);
}
.account-name {
  font-weight: 600;
}
.account-name small {
  color: var(--muted);
  font-weight: 400;
  margin-left: 6px;
}
.account-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin: 0;
}
.account-facts dt {
  font-size: 12px;
  color: var(--muted);
}
.account-facts dd {
  margin: 0;
  font-weight: 600;
}
.account-hint {
  color: var(--muted);
  font-size: 13px;
}
.account-form {
  display: flex;
  gap: 8px;
}
.account-form input {
  flex: 1;
  min-width: 0;
}
.account-error {
  color: var(--danger);
  font-size: 12px;
}
.account-note {
  color: var(--muted);
  font-size: 12px;
}
.insight-panel {
  padding: 16px;
  margin-bottom: 16px;
}
.insight-metrics {
  grid-template-columns: repeat(6, 1fr);
}
.battle-metrics {
  grid-template-columns: repeat(4, 1fr);
}
.battle-briefs {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
}
.battle-briefs li {
  padding: 10px 0;
  border-top: 1px solid var(--line);
}
.battle-brief-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.battle-brief-summary {
  margin: 6px 0 0;
  line-height: 1.7;
  color: var(--ink);
}
.insight-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.insight-columns .insight-panel {
  margin-bottom: 0;
}
.rating-chart {
  width: 100%;
  height: auto;
}
.chart-grid {
  stroke: var(--line);
  stroke-width: 1;
}
.chart-tick {
  font-size: 11px;
  fill: var(--muted);
}
.chart-legend {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--muted);
}
.chart-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.chart-legend i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.radar-toggle {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.radar-toggle button {
  font-size: 12px;
  border: 1px solid var(--line);
  background: var(--paper);
  border-radius: 999px;
  padding: 3px 12px;
  color: var(--muted);
  cursor: pointer;
}
.radar-toggle button.active {
  background: var(--accent-soft);
  border-color: var(--highlight);
  color: var(--highlight);
}
.stacked-chart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.stacked-col {
  flex: 1;
  min-width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.stacked-bars {
  width: 100%;
  max-width: 46px;
  display: flex;
  flex-direction: column-reverse;
  border-radius: 4px 4px 0 0;
  overflow: hidden;
}
.stacked-bars span {
  display: block;
  width: 100%;
}
.stacked-col small {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
@media (max-width: 900px) {
  .insight-accounts {
    grid-template-columns: 1fr;
  }
  .insight-metrics {
    grid-template-columns: repeat(3, 1fr);
  }
  .insight-columns {
    grid-template-columns: 1fr;
  }
}
</style>
