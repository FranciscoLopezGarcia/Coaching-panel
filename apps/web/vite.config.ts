import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': process.env.WEB_API_TARGET ?? 'http://127.0.0.1:3001' },
  },
  test: { environment: 'node' },
});
