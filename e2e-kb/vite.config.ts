import { defineConfig, mergeConfig } from 'vite';
import appConfig from '../vite.config';

// Même principe que e2e/vite.config.ts (les fixtures sont explorées avant la première navigation), avec en
// plus le renvoi de /api vers le serveur de test de la « Base de données » (e2e-kb/kbApiServer.ts).
const apiPort = Number(process.env.KB_API_PORT ?? 4311);

export default defineConfig(async env => mergeConfig(await appConfig(env), {
  cacheDir: 'node_modules/.vite-e2e-kb',
  optimizeDeps: { entries: ['index.html', 'e2e-kb/fixtures/*.html'], include: ['jspdf'] },
  server: { proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } } },
}));
