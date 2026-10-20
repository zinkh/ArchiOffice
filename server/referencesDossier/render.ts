// HTML -> PDF par Chromium headless (playwright-core). Aucun navigateur n'est
// téléchargé : on utilise celui de l'hôte (CHROMIUM_PATH, sinon le chemin que
// Playwright connaît, sinon les emplacements usuels). Le Dockerfile installe
// Chromium et définit CHROMIUM_PATH.
import { existsSync } from 'node:fs';
import type { DossierOrientation } from './types';

const COMMON_PATHS = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];

export class ChromiumUnavailableError extends Error {
  constructor() {
    super('Chromium est introuvable sur ce serveur : le dossier de références ne peut pas être généré en PDF.');
    this.name = 'ChromiumUnavailableError';
  }
}

// Chargé à l'usage : playwright-core est externe au bundle serveur (build:server) et absent du client de bureau.
const loadPlaywright = async () => (await import('playwright-core')).chromium;

export async function resolveChromiumPath(): Promise<string | null> {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const known = (await loadPlaywright()).executablePath();
    if (known && existsSync(known)) return known;
  } catch { /* Playwright n'a pas de navigateur installé : on essaie les chemins usuels */ }
  return COMMON_PATHS.find(p => existsSync(p)) ?? null;
}

// Un seul rendu à la fois : un Chromium par requête saturerait vite la mémoire d'une petite instance.
let queue: Promise<unknown> = Promise.resolve();

export interface PdfPageSize {
  width: string;
  height: string;
}

export interface PdfRenderResult {
  pdf: Buffer;
  /** Vrai si le contenu de `.body` dépasse la zone prévue (rien n'est rogné en silence : l'appelant avertit). */
  overflow: boolean;
}

/** Rendu générique (file partagée avec les panneaux) : page de taille libre, détection de débordement. */
export function renderHtmlToPdf(html: string, size: PdfPageSize): Promise<PdfRenderResult> {
  const run = queue.then(() => renderNow(html, size));
  queue = run.catch(() => undefined);
  return run;
}

export async function renderPdf(html: string, orientation: DossierOrientation): Promise<Buffer> {
  const { pdf } = await renderHtmlToPdf(html, {
    width: orientation === 'portrait' ? '210mm' : '297mm',
    height: orientation === 'portrait' ? '297mm' : '210mm',
  });
  return pdf;
}

async function renderNow(html: string, size: PdfPageSize): Promise<PdfRenderResult> {
  const executablePath = await resolveChromiumPath();
  if (!executablePath) throw new ChromiumUnavailableError();
  const browser = await (await loadPlaywright()).launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    // Aucune requête réseau : tout (polices, images) est embarqué dans le HTML.
    await page.route('**/*', route => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => (document as any).fonts.ready);
    const overflow = await page.evaluate(() => {
      const body = document.querySelector('.body') as HTMLElement | null;
      return !!body && (body.scrollHeight > body.clientHeight + 2 || body.scrollWidth > body.clientWidth + 2);
    });
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      width: size.width,
      height: size.height,
    });
    return { pdf: Buffer.from(pdf), overflow };
  } finally {
    await browser.close();
  }
}
