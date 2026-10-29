import { createApp } from 'vue';
import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import Dashboard from './pages/Dashboard.vue';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/growth.css';
import './styles/astra.css';
import { initializeAppearance } from './composables/useAppearance';
initializeAppearance();
const router = createRouter({
  // Literal branch: only one history implementation survives per build mode.
  history: import.meta.env.VITE_BROWSER ? createWebHashHistory(import.meta.env.BASE_URL) : createWebHistory(),
  scrollBehavior: (to, from, saved) => {
    if (saved) return saved;
    // Section and tool switches update the query without leaving the page.
    if (to.path === from.path) return false;
    return { top: 0 };
  },
  routes: [
    { path: '/', component: Dashboard },
    { path: '/battle', component: () => import('./pages/Battle.vue') },
    { path: '/problems', component: () => import('./pages/Problems.vue') },
    { path: '/problems/:key', component: () => import('./pages/ProblemDetail.vue') },
    { path: '/contests', component: () => import('./pages/Contests.vue') },
    { path: '/simulation', component: () => import('./pages/Simulation.vue') },
    { path: '/insights', component: () => import('./pages/Insights.vue') },
    { path: '/statistics', component: () => import('./pages/Statistics.vue') },
    { path: '/knowledge', component: () => import('./pages/Knowledge.vue') },
    { path: '/growth', component: () => import('./pages/Growth.vue') },
    { path: '/companion', component: () => import('./pages/Companion.vue') },
    { path: '/settings', component: () => import('./pages/Settings.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
router.beforeEach((to) => {
  const legacy: Record<string, { path: string; view: string }> = {
    '/knowledge:diagnosis': { path: '/statistics', view: 'diagnosis' },
    '/knowledge:training': { path: '/', view: 'training' },
    '/knowledge:transfers': { path: '/', view: 'transfers' },
    '/statistics:upsolve': { path: '/contests', view: 'upsolve' },
    '/statistics:health': { path: '/settings', view: 'sync' },
  };
  const target = legacy[to.path + ':' + to.query.view];
  if (target) return { path: target.path, query: { ...to.query, view: target.view }, replace: true };
});
createApp(App).use(router).mount('#app');
if (import.meta.env.VITE_BROWSER && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL })
      .catch(() => {});
  });
}
