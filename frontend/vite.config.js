import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 섹션 2/5 기준: dev 서버 5173, 백엔드 API는 3001.
// VITE_USE_MOCK=false 로 실제 백엔드(/api)를 프록시한다.
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
      // index.html = 디자인 게임 런처, app.html = API 연동용 React SPA.
      // public/game/*.html 정적 화면은 그대로 dist/game 으로 복사된다.
      input: {
        index: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
});
