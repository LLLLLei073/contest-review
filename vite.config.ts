import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  // Opt in only for restricted Windows environments where realpath raises EPERM.
  resolve: { preserveSymlinks: process.env.VITE_PRESERVE_SYMLINKS === '1' },
  base: mode === 'pages' ? process.env.PAGES_BASE_PATH || '/contest-review/' : '/',
  define: {
    'import.meta.env.VITE_STORAGE_MODE': JSON.stringify(mode === 'pages' ? 'browser' : 'server'),
    // Boolean twin of VITE_STORAGE_MODE: written as a literal at branch sites so the
    // server build can dead-code-eliminate the browser-mode dynamic imports.
    'import.meta.env.VITE_BROWSER': JSON.stringify(mode === 'pages'),
  },
  build: { outDir: mode === 'pages' ? 'dist-pages' : 'dist' },
  server: { proxy: { '/api': 'http://127.0.0.1:3210' } },
}));
