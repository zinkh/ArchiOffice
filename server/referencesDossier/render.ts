// HTML -> PDF par Chromium headless (playwright-core). Aucun navigateur n'est
// téléchargé : on utilise celui de l'hôte (CHROMIUM_PATH, sinon le chemin que
// Playwright connaît, sinon les emplacements usuels). Le Dockerfile installe
// Chromium et définit CHROMIUM_PATH.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import type { DossierOrientation } from './types';

const COMMON_PATHS = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];

export class ChromiumUnavailableError extends Error {
  constructor() {
    super('Chromium est introuvable sur ce serveur : le dossier de références ne peut pas être généré en PDF.');
    this.name = 'ChromiumUnavailableError';
  }
}

export function resolveChromiumPath(): string | null {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const known = chromium.executablePath();
    if (known && existsSync(known)) return known;
  } catch { /* Playwright n'a pas de navigateur installé : on essaie les chemins usuels */ }
  return COMMON_PATHS.find(p => existsSync(p)) ?? null;
}

// Un seul rendu à la fois : un Chromium par requête saturerait vite la mémoire d'une petite instance.
let queue: Promise<unknown> = Promise.resolve();

export function renderPdf(html: string, orientation: DossierOrientation): Promise<Buffer> {
  const run = queue.then(() => renderNow(html, orientation));
  queue = run.catch(() => undefined);
  return run;
}

async function renderNow(html: string, orientation: DossierOrientation): Promise<Buffer> {
  const executablePath = resolveChromiumPath();
  if (!executablePath) throw new ChromiumUnavailableError();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    // Aucune requête réseau : tout (polices, images) est embarqué dans le HTML.
    await page.route('**/*', route => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => (document as any).fonts.ready);
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      width: orientation === 'portrait' ? '210mm' : '297mm',
      height: orientation === 'portrait' ? '297mm' : '210mm',
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
