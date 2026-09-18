import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  base: mode === 'pages' ? process.env.PAGES_BASE_PATH || '/contest-review/' : '/',
  define: { 'import.meta.env.VITE_STORAGE_MODE': JSON.stringify(mode === 'pages' ? 'browser' : 'server') },
  build: { outDir: mode === 'pages' ? 'dist-pages' : 'dist' },
  server: { proxy: { '/api': 'http://127.0.0.1:3210' } },
}));
