import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 개발 중 CORS 없이 API 호출
      '/api': 'http://localhost:3001',
    },
  },
});
