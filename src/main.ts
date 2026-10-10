import { createApp } from 'vue';
import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router';
import { browserMode } from './api';
import App from './App.vue';
import Dashboard from './pages/Dashboard.vue';
import './style.css';
import './terminal.css';
import './astra.css';
const router = createRouter({
  history: browserMode ? createWebHashHistory(import.meta.env.BASE_URL) : createWebHistory(),
  scrollBehavior: (to, from, saved) => {
    if (saved) return saved;
    // Section and tool switches update the query without leaving the page.
    if (to.path === from.path) return false;
    return { top: 0 };
  },
  routes: [
    { path: '/', component: Dashboard },
    { path: '/problems', component: () => import('./pages/Problems.vue') },
    { path: '/problems/:key', component: () => import('./pages/ProblemDetail.vue') },
    { path: '/contests', component: () => import('./pages/Contests.vue') },
    { path: '/simulation', component: () => import('./pages/Simulation.vue') },
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
if (browserMode && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL })
      .catch(() => {});
  });
}
