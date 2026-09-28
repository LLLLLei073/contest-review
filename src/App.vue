<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  BookOpen,
  LayoutDashboard,
  Library,
  Flag,
  ChartNoAxesCombined,
  Settings2,
  ArrowUpRight,
  RefreshCw,
  Check,
  X,
} from 'lucide-vue-next';
import { loadSettings, loadJob, settings, job, toast, browserMode } from './api';
import { useSpringValues } from './motion';
const route = useRoute();
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
const navigation = [
  { to: '/', label: '今日题单', icon: LayoutDashboard },
  { to: '/problems', label: '错题库', icon: Library },
  { to: '/contests', label: '比赛复盘', icon: Flag },
  { to: '/statistics', label: '训练统计', icon: ChartNoAxesCombined },
  { to: '/settings', label: '设置与数据', icon: Settings2 },
];
const initError = ref('');
let poll: ReturnType<typeof setInterval>;
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
  }
  poll = setInterval(() => loadJob().catch(() => {}), 2500);
});
const onResize = () => measureNav(true);
watch(
  () => route.path,
  async () => {
    await nextTick();
    measureNav();
  },
);
onUnmounted(() => {
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
      <div class="nav-caption">训练工作台</div>
      <nav ref="navElement">
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
        <RouterLink
          v-for="n in navigation"
          :key="n.to"
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
      </nav>
      <div class="sidebar-note">
        <span class="eyebrow">BUILD UNDERSTANDING.</span>
        <p>把每一次卡住，<br />变成下一次的思路。</p>
        <div class="note-line"></div>
        <span class="small subtle">记录 · 反思 · 再解</span>
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
                    : $route.path === '/settings'
                      ? '设置与数据'
                      : '今日题单'
          }}</b>
        </div>
        <RouterLink to="/settings" class="profile-chip"
          ><span class="avatar">{{
            settings.activeHandle
              ? settings.activeHandle[0].toUpperCase()
              : settings.activeAtcoder
                ? 'A'
                : settings.xcpcPlayer
                  ? 'X'
                  : 'CF'
          }}</span
          ><span>{{
            settings.activeHandle ||
            (settings.activeAtcoder
              ? settings.activeAtcoder + ' · AtCoder'
              : settings.xcpcPlayer
                ? settings.xcpcPlayer.name + ' · XCPC'
                : '绑定账号')
          }}</span
          ><RefreshCw v-if="job?.status === 'running'" class="spin" :size="14" /><ArrowUpRight
            v-else
            :size="14"
        /></RouterLink>
      </header>
      <main>
        <div v-if="initError" class="alert error">
          {{ browserMode ? '无法打开浏览器错题库：' : '无法连接本地服务：' }}{{ initError }}
        </div>
        <RouterView
          :key="
            ($route.path === '/contests' ? $route.path : $route.fullPath) +
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
      ><div v-if="toast" class="toast" role="status">
        <Check :size="17" />{{ toast
        }}<button class="icon-button" aria-label="关闭通知" @click="toast = ''"><X :size="15" /></button></div
    ></Transition>
  </div>
</template>
