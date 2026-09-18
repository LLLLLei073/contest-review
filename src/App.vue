<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
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
const navigation = [
  { to: '/', label: '今日复习', icon: LayoutDashboard },
  { to: '/problems', label: '错题库', icon: Library },
  { to: '/contests', label: '比赛复盘', icon: Flag },
  { to: '/statistics', label: '训练统计', icon: ChartNoAxesCombined },
];
const initError = ref('');
let poll: ReturnType<typeof setInterval>;
onMounted(async () => {
  try {
    await loadSettings();
    await loadJob();
  } catch (e) {
    initError.value = (e as Error).message;
  }
  poll = setInterval(() => loadJob().catch(() => {}), 2500);
});
onUnmounted(() => clearInterval(poll));
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink to="/" class="brand"
        ><span class="brand-mark"><BookOpen :size="23" /></span
        ><span>回解<small>CONTEST REVIEW</small></span></RouterLink
      >
      <div class="nav-caption">训练工作台</div>
      <nav>
        <RouterLink
          v-for="n in navigation"
          :key="n.to"
          :to="n.to"
          :class="{ active: n.to === '/' ? $route.path === '/' : $route.path.startsWith(n.to) }"
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
        <RouterLink to="/settings" :class="{ active: $route.path === '/settings' }"
          ><Settings2 :size="18" /> 设置与数据</RouterLink
        >
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
                : $route.path === '/statistics'
                  ? '训练统计'
                  : $route.path === '/settings'
                    ? '设置与数据'
                    : '今日复习'
          }}</b>
        </div>
        <RouterLink to="/settings" class="profile-chip"
          ><span class="avatar">{{
            settings.activeHandle ? settings.activeHandle[0].toUpperCase() : 'CF'
          }}</span
          ><span>{{ settings.activeHandle || '绑定 Codeforces' }}</span
          ><RefreshCw v-if="job?.status === 'running'" class="spin" :size="14" /><ArrowUpRight
            v-else
            :size="14"
        /></RouterLink>
      </header>
      <main>
        <div v-if="initError" class="alert error">
          {{ browserMode ? '无法打开浏览器错题库：' : '无法连接本地服务：' }}{{ initError }}
        </div>
        <RouterView :key="$route.fullPath + '|' + settings.activeHandle" />
      </main>
      <footer><span>回解 / 每一题，都值得真正理解。</span><span>LOCAL FIRST · CF CONNECTED</span></footer>
    </div>
    <div v-if="toast" class="toast" role="status">
      <Check :size="17" />{{ toast
      }}<button class="icon-button" aria-label="关闭通知" @click="toast = ''"><X :size="15" /></button>
    </div>
  </div>
</template>
