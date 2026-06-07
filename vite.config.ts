import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  // loadEnv with empty prefix reads ALL env vars (OS env + .env file)
  const env = loadEnv(mode, process.cwd(), '');
  return {
    build: {
      outDir: 'dist',
    },
    define: {
      // Use process.env directly — guaranteed to read DigitalOcean OS env vars at build time
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || ''),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png'],
        manifest: {
          name: 'ArchiOffice - Architectural Office Management',
          short_name: 'ArchiOffice',
          description: 'Gestion de cabinet d\'architecture : projets, propositions, factures et équipe.',
          theme_color: '#2563eb',
          background_color: '#ffffff',
          display: 'standalone',
          scope: '/',
          start_url: '/',
          orientation: 'portrait-primary',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          // Cache app shell and static assets
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // Network-first for API calls (never cache)
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/archimanager\.fr\/api\//,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'google-fonts-stylesheets' },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@zinkh/archioffice-agents/client': path.resolve(__dirname, 'packages/archioffice-agents/src/client/index.ts'),
        '@zinkh/archioffice-agents': path.resolve(__dirname, 'packages/archioffice-agents/src/types.ts'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
