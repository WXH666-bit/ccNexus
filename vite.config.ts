import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  server: {
    port: 5000,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:3456', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3456', ws: true },
    },
  },
  preview: {
    port: 5000,
    host: '0.0.0.0',
  },
});
