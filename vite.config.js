import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/3Deyes/' : '/',
  server: { port: 5173, host: true },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: { input: { main: 'index.html', calibrate: 'calibrate.html', editor: 'editor.html', visor: 'visor.html' } },
  },
});
