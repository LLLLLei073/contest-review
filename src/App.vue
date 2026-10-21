<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { BookOpen, ArrowUpRight, RefreshCw, Check, X, Orbit, Sparkles, Sun, Moon } from 'lucide-vue-next';
import { navigation } from './navigation';
import { appearance, toggleAppearance } from './composables/useAppearance';
import CommandPalette from './components/CommandPalette.vue';
import { growth, growthNotice, growthError, startGrowth, dismissGrowthNotice } from './growth';
import { astraSuggestion, checkAstraSuggestion, dismissAstraSuggestion } from './agent';
import { loadSettings, loadJob, settings, job, toast, browserMode, dataRevision } from './api';
import { useSpringValues } from './motion';
const route = useRoute();
const accountScope = computed(() =>
  [
    settings.value.activeHandle ? settings.value.activeHandle + ' · CF' : '',
    settings.value.activeAtcoder ? settings.value.activeAtcoder + ' · AtCoder' : '',
    settings.value.xcpcPlayer ? settings.value.xcpcPlayer.name + ' · XCPC' : '',
  ]
    .filter(Boolean)
    .join(' / '),
);
const navElement = ref<HTMLElement | null>(null);
const navVisible = ref(false);
const navSpring = useSpringValues([0, 0, 0, 0]);
let navObserver: ResizeObserver | undefined;
function measureNav(immediate = false) {
  const nav = navElement.value;
  const active = nav?.querySelector<HTMLElement>('a.active');
  if (!nav || !active) {
    navVisible.value = false;
    return;
  }
  const parent = nav.getBoundingClientRect();
  const rect = active.getBoundingClientRect();
  navSpring.setTarget(
    [rect.left - parent.left, rect.top - parent.top, rect.width, rect.height],
    immediate || !navVisible.value,
  );
  navVisible.value = true;
}
const initError = ref('');
const initialized = ref(false);
let poll: ReturnType<typeof setInterval>;
let stopGrowth: (() => void) | undefined;
onMounted(async () => {
  await nextTick();
  measureNav(true);
  if (navElement.value) {
    navObserver = new ResizeObserver(() => measureNav());
    navObserver.observe(navElement.value);
  }
  window.addEventListener('resize', onResize);
  try {
    await loadSettings();
    await loadJob();
  } catch (e) {
    initError.value = (e as Error).message;
  } finally {
    initialized.value = true;
    stopGrowth = startGrowth();
  }
  poll = setInterval(() => loadJob().catch(() => {}), 2500);
});
const onResize = () => measureNav(true);
let pendingFocusPath: string | null = null;
watch([() => route.path, initialized], async ([path, ready], [previousPath]) => {
  if (path !== previousPath) pendingFocusPath = path;
  await nextTick();
  measureNav();
  // Navigation is usable while storage opens; focus the destination once it mounts.
  if (!ready || pendingFocusPath !== route.path) return;
  const heading = document.querySelector<HTMLElement>('.workspace main h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    pendingFocusPath = null;
  }
});
let suggestionTimer: ReturnType<typeof setTimeout>;
watch(
  [() => route.path, dataRevision, () => settings.value.activeHandle, () => settings.value.activeAtcoder],
  () => {
    astraSuggestion.value = null;
    clearTimeout(suggestionTimer);
    if (route.path === '/' && (settings.value.activeHandle || settings.value.activeAtcoder))
      suggestionTimer = setTimeout(() => void checkAstraSuggestion(), 1000);
  },
  { immediate: true },
);
onUnmounted(() => {
  clearTimeout(suggestionTimer);
  stopGrowth?.();
  clearInterval(poll);
  navObserver?.disconnect();
  window.removeEventListener('resize', onResize);
});
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink to="/" class="brand"
        ><span class="brand-mark"><BookOpen :size="23" /></span
        ><span>回解<small>CONTEST REVIEW</small></span></RouterLink
      >
      <div class="nav-caption">你的算法训练工作台</div>
      <nav ref="navElement" aria-label="主导航">
        <span
          v-if="navVisible"
          class="nav-indicator"
          aria-hidden="true"
          :style="{
            transform: `translate3d(${navSpring.values.value[0]}px, ${navSpring.values.value[1]}px, 0)`,
            width: `${navSpring.values.value[2]}px`,
            height: `${navSpring.values.value[3]}px`,
          }"
        ></span>
        <template v-for="(n, index) in navigation" :key="n.to">
          <div v-if="index === 0 || navigation[index - 1]?.group !== n.group" class="nav-group-label">
            {{ n.group }}
          </div>
          <RouterLink
            :to="n.to"
            :class="{
              active:
                n.to === '/'
                  ? $route.path === '/'
                  : n.to === '/contests'
                    ? ['/contests', '/simulation'].includes($route.path)
                    : $route.path.startsWith(n.to),
            }"
            ><component :is="n.icon" :size="19" /><span>{{ n.label }}</span
            ><span v-if="n.to === '/'" class="nav-dot"></span
          ></RouterLink>
        </template>
      </nav>
      <div class="sidebar-note">
        <p>理解，来自再次验证。</p>
        <span class="small subtle">留下思路，也留下证据。</span>
        <RouterLink v-if="growth" to="/growth" class="sidebar-growth"
          ><Orbit :size="15" /><span>Lv.{{ growth.level }}</span
          ><small>{{ growth.xp }} EXP</small></RouterLink
        >
      </div>
      <div class="sidebar-bottom">
        <div class="local-status">
          <span></span>{{ browserMode ? '浏览器存储 · 定期导出备份' : '本地存储 · 数据由你掌握' }}
        </div>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div class="breadcrumb">
          我的训练空间 <span>/</span>
          <b>{{
            $route.path.startsWith('/problems')
              ? '错题复盘'
              : $route.path === '/contests'
                ? '比赛复盘'
                : $route.path === '/simulation'
                  ? 'CF 模拟赛'
                  : $route.path === '/statistics'
                    ? '训练统计'
                    : $route.path === '/knowledge'
                      ? '知识中心'
                      : $route.path === '/growth'
                        ? '成长收藏'
                        : $route.path === '/companion'
                          ? '星澪伙伴'
                          : $route.path === '/settings'
                            ? '设置与数据'
                            : '今日训练'
          }}</b>
        </div>
        <div class="topbar-actions">
          <CommandPalette />
          <button
            class="appearance-toggle icon-button"
            :aria-label="appearance === 'light' ? '切换为深色模式' : '切换为明亮模式'"
            @click="toggleAppearance"
          >
            <Moon v-if="appearance === 'light'" :size="18" /><Sun v-else :size="18" />
          </button>
          <RouterLink to="/settings?view=accounts" class="profile-chip"
            ><span class="avatar">{{
              settings.activeHandle
                ? settings.activeHandle[0].toUpperCase()
                : settings.activeAtcoder
                  ? 'A'
                  : settings.xcpcPlayer
                    ? 'X'
                    : 'CF'
            }}</span
            ><span :title="accountScope">{{ accountScope || '绑定账号' }}</span
            ><RefreshCw v-if="job?.status === 'running'" class="spin" :size="14" /><ArrowUpRight
              v-else
              :size="14"
          /></RouterLink>
        </div>
      </header>
      <main>
        <p v-if="!initialized" role="status">正在打开训练空间…</p>
        <div v-if="initError" class="alert error">
          {{ browserMode ? '无法打开浏览器错题库：' : '无法连接本地服务：' }}{{ initError }}
        </div>
        <aside
          v-if="astraSuggestion && route.path === '/'"
          class="astra-suggestion"
          aria-label="星澪的学习建议"
        >
          <Sparkles :size="17" />
          <p>{{ astraSuggestion.content }}</p>
          <RouterLink to="/companion">一起聊聊</RouterLink
          ><button class="button small" @click="dismissAstraSuggestion">关闭建议</button>
        </aside>
        <RouterView
          v-if="initialized"
          :key="
            ($route.params.key ? '/problems/' + String($route.params.key) : $route.path) +
            '|' +
            settings.activeHandle +
            '|' +
            (settings.activeAtcoder || '') +
            '|' +
            (settings.xcpcPlayer?.key || '')
          "
        />
      </main>
      <footer><span>回解 / 每一题，都值得真正理解。</span><span>LOCAL FIRST · CONTEST REVIEW</span></footer>
    </div>
    <Transition name="notice"
      ><aside v-if="growthNotice" class="growth-reward" aria-label="成长奖励" aria-live="polite">
        <div class="growth-reward__header">
          <Sparkles :size="17" /><b>{{ growthNotice.historical ? '历史成长已汇总' : '成长记录已更新' }}</b
          ><button class="icon-button" aria-label="关闭成长奖励" @click="dismissGrowthNotice">
            <X :size="16" />
          </button>
        </div>
        <strong>+{{ growthNotice.xp }} <small>EXP</small></strong>
        <details>
          <summary>查看本次成长明细</summary>
          <p>
            {{
              growthNotice.achievements.length
                ? '成就点亮：' + growthNotice.achievements.join('、')
                : '你的学习足迹，已写入成长档案。'
            }}
          </p>
        </details>
        <p v-if="growthError" class="error" role="alert">{{ growthError }}</p>
        <RouterLink to="/growth">查看成长收藏 <ArrowUpRight :size="14" /></RouterLink></aside
    ></Transition>
    <Transition name="notice"
      ><div v-if="toast" class="toast" role="status">
        <Check :size="17" />{{ toast
        }}<button class="icon-button" aria-label="关闭通知" @click="toast = ''"><X :size="15" /></button></div
    ></Transition>
  </div>
</template>
