import { defineConfig, mergeConfig } from 'vite';
import appConfig from '../vite.config';

// Scan fixtures before the first browser navigation. Otherwise a late dependency
// discovery can invalidate an in-flight module URL with "Outdated Optimize Dep".
export default defineConfig(async env => mergeConfig(await appConfig(env), {
  cacheDir: 'node_modules/.vite-e2e',
  optimizeDeps: { entries: ['index.html', 'e2e/fixtures/*.html'], include: ['jspdf'] },
}));
