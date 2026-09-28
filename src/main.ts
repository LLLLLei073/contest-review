import { createApp } from 'vue';
import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router';
import { browserMode } from './api';
import App from './App.vue';
import Dashboard from './pages/Dashboard.vue';
import './style.css';
const router = createRouter({
  history: browserMode ? createWebHashHistory(import.meta.env.BASE_URL) : createWebHistory(),
  scrollBehavior: (_to, _from, saved) => saved || { top: 0 },
  routes: [
    { path: '/', component: Dashboard },
    { path: '/problems', component: () => import('./pages/Problems.vue') },
    { path: '/problems/:key', component: () => import('./pages/ProblemDetail.vue') },
    { path: '/contests', component: () => import('./pages/Contests.vue') },
    { path: '/simulation', component: () => import('./pages/Simulation.vue') },
    { path: '/statistics', component: () => import('./pages/Statistics.vue') },
    { path: '/settings', component: () => import('./pages/Settings.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
createApp(App).use(router).mount('#app');
if (browserMode && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL })
      .catch(() => {});
  });
}
