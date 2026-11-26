// Test de bout en bout de la « Base de données » du cabinet (npm run test:e2e:kb), à part de la CI de base :
// le vrai écran et le vrai code serveur, sur une fausse base en mémoire, sans Supabase ni compte.
// Navigateur : celui préinstallé dans l'environnement (jamais d'installation), ou PLAYWRIGHT_CHROMIUM_PATH.
import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.KB_WEB_PORT ?? 4174);
const apiPort = Number(process.env.KB_API_PORT ?? 4311);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const launchOptions = executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };

export default defineConfig({
  testDir: './e2e-kb',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results-kb',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    launchOptions,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], launchOptions } },
  ],
  webServer: [
    {
      command: 'npx tsx e2e-kb/kbApiServer.ts',
      url: `http://127.0.0.1:${apiPort}/__health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { KB_API_PORT: String(apiPort) },
    },
    {
      command: `npx vite --config e2e-kb/vite.config.ts --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        KB_API_PORT: String(apiPort),
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'placeholder_anon_key',
      },
    },
  ],
});
