import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
    watch: {
      // /mnt/c (Windows drive under WSL2) doesn't emit file events,
      // so hot reload only works with polling.
      usePolling: true,
      interval: 300,
    },
  },
});
