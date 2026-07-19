import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  // loadEnv with empty prefix reads ALL env vars (OS env + .env file)
  const env = loadEnv(mode, process.cwd(), '');
  return {
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          // Pin the heaviest third-party libraries to their own stable chunk
          // names. Rollup's automatic splitting already keeps them out of
          // page bundles that don't use them, but without this they can
          // still be re-bundled together with whichever app code imports
          // them — so a change to one page's own code can invalidate the
          // cached copy of a multi-hundred-KB library for every returning
          // visitor. Isolating them means those chunks only change (and
          // need re-downloading) when the library itself is upgraded.
          manualChunks(id) {
            if (id.includes('/node_modules/maplibre-gl/')) return 'vendor-maplibre';
            if (id.includes('/node_modules/recharts/')) return 'vendor-recharts';
            if (id.includes('/node_modules/jspdf/') || id.includes('/node_modules/jspdf-autotable/')) return 'vendor-jspdf';
            if (id.includes('/node_modules/xlsx/')) return 'vendor-xlsx';
            if (id.includes('/node_modules/docx/')) return 'vendor-docx';
            if (id.includes('/node_modules/html2canvas/')) return 'vendor-html2canvas';
          },
        },
      },
    },
    define: {
      // Use process.env directly — guaranteed to read DigitalOcean OS env vars at build time
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || ''),
      // Set only in the offline desktop build's .env — switches auth to the local
      // account flow instead of Supabase Auth (see src/lib/authToken.ts).
      'import.meta.env.VITE_OFFLINE_MODE': JSON.stringify(process.env.VITE_OFFLINE_MODE || ''),
      'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(process.env.VITE_SENTRY_DSN || ''),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
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
          // Cache app shell and static assets only
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // Exclude all API routes from service worker interception entirely.
          // Using NetworkOnly would still intercept the request and emit a
          // "no-response" SW error when the network fails; no registered route
          // means the browser handles /api/ natively with its own error path.
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
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
      alias: (() => {
        const localPkg = path.resolve(__dirname, 'packages/archioffice-agents/src');
        const hasLocal = fs.existsSync(localPkg);
        return {
          '@': path.resolve(__dirname, '.'),
          ...(hasLocal ? {
            '@zinkh/archioffice-agents/client': path.resolve(localPkg, 'client/index.ts'),
            '@zinkh/archioffice-agents': path.resolve(localPkg, 'types.ts'),
          } : {}),
        };
      })(),
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
