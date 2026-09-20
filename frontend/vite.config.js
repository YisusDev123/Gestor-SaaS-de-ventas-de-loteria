import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const devApiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET?.trim();
const devProxyOrigin = process.env.VITE_DEV_PROXY_ORIGIN?.trim() || 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    injectRegister: null,
    manifest: {
      name: 'Gestión de ventas',
      short_name: 'Ventas',
      description: 'Gestión de ventas para vendedores de tiempos',
      lang: 'es',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#f4f6f1',
      theme_color: '#176b4d',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      cleanupOutdatedCaches: true,
      clientsClaim: false,
      skipWaiting: false,
      globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      navigateFallback: '/index.html',
    },
    devOptions: { enabled: false },
  })],
  server: {
    host: true,
    port: 3000,
    proxy: devApiProxyTarget ? {
      '/api': {
        target: devApiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyRequest) => {
            proxyRequest.setHeader('origin', devProxyOrigin);
          });
        },
      },
    } : undefined,
  },
  preview: {
    host: true,
    port: 3000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.test.{js,jsx}'],
    css: true,
  },
});
