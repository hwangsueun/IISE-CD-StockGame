import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// dev 5173 / API 3001 프록시.
// index.html = React SPA(서버 연동 본편), design.html = 디자인 게임(정적 멀티페이지) 런처.
// public/game/*.html 정적 화면은 빌드 시 dist/game 으로 그대로 복사된다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        design: resolve(__dirname, 'design.html'),
      },
    },
  },
});
