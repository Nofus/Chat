import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [react(),  basicSsl()],
  server: {
    allowedHosts: [
      '.trycloudflare.com',
      '.loca.lt',       
      '.ngrok-free.app', 
      '.pinggy.io',      
      '.localhost.cc',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
    host: true,
  },
});