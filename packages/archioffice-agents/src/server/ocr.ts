// ── OCR des documents sans couche texte ─────────────────────────────────────
// Pourquoi ce module n'existait pas : l'extraction de contexte (context.ts)
// s'appuie sur pdf-parse, qui lit la couche texte d'un PDF. Un PDF scanné ou
// photographié n'en a pas — il ne contient qu'une image par page — et
// ressortait donc vide, sans que rien ne le dise à l'utilisateur. Or une
// bonne partie des pièces qui arrivent dans un cabinet (plans annotés, PV
// signés, arrêtés de permis, courriers papier) sont exactement dans ce cas.
//
// Faire de l'OCR sur un PDF demande deux choses distinctes :
//   1. transformer chaque page en image — c'est le rôle de pdftoppm
//      (poppler-utils), un binaire système, retenu plutôt qu'un moteur de
//      rendu Node (pdfjs + canvas) parce que celui-ci réclame des modules
//      natifs que l'image node:22-slim de ce dépôt ne porte pas, exactement
//      le problème qui avait déjà fait épingler pdf-parse à sa version 1.x ;
//   2. reconnaître le texte — c'est tesseract.js, du WebAssembly pur, donc
//      sans dépendance native.
//
// Les deux sont optionnels et le module se dégrade proprement : sans binaire
// ou sans langue disponible, on renvoie un message explicite qui sera injecté
// à la place du contenu, pour que l'agent dise « ce document est scanné et je
// n'ai pas pu le lire » au lieu de faire comme s'il était vide.
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_MAX_PAGES = 5;
const DEFAULT_LANG = 'fra+eng';
const RASTER_DPI = 150;
const RASTER_TIMEOUT_MS = 20_000;

export const OCR_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp'];

/** En dessous, un PDF est considéré comme dépourvu de couche texte utile. */
export const OCR_MIN_TEXT_CHARS = 200;

export function isOcrEnabled(): boolean {
  return process.env.AGENT_OCR_ENABLED !== 'false';
}

export function ocrMaxPages(): number {
  const parsed = parseInt(process.env.AGENT_OCR_MAX_PAGES || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 20) : DEFAULT_MAX_PAGES;
}

function ocrLang(): string {
  return process.env.AGENT_OCR_LANG || DEFAULT_LANG;
}

export function isOcrCandidate(fileName: string, extractedText: string | null): boolean {
  const lower = fileName.toLowerCase();
  if (OCR_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;
  if (lower.endsWith('.pdf')) return !extractedText || extractedText.trim().length < OCR_MIN_TEXT_CHARS;
  return false;
}

function run(command: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} a dépassé ${timeoutMs} ms`)); }, timeoutMs);
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stderr }); });
  });
}

/** Rend les premières pages d'un PDF en PNG. null si pdftoppm est absent. */
async function rasterizePdf(buffer: Buffer, maxPages: number): Promise<Buffer[] | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'archioffice-ocr-'));
  try {
    const pdfPath = path.join(dir, 'in.pdf');
    await writeFile(pdfPath, buffer);
    try {
      await run('pdftoppm', ['-png', '-r', String(RASTER_DPI), '-f', '1', '-l', String(maxPages), pdfPath, path.join(dir, 'page')], RASTER_TIMEOUT_MS);
    } catch (e: any) {
      // ENOENT = poppler-utils non installé sur cette image.
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
    const files = (await readdir(dir)).filter(f => f.startsWith('page') && f.endsWith('.png')).sort();
    const pages: Buffer[] = [];
    for (const f of files.slice(0, maxPages)) pages.push(await readFile(path.join(dir, f)));
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface OcrResult {
  text: string;
  pages: number;
  /** Renseigné quand l'OCR n'a pas pu tourner : à injecter tel quel. */
  unavailableReason?: string;
}

async function recognize(images: Buffer[]): Promise<OcrResult> {
  let createWorker: any;
  try {
    ({ createWorker } = await import('tesseract.js'));
  } catch {
    return { text: '', pages: 0, unavailableReason: "moteur OCR non installé sur ce serveur (dépendance tesseract.js absente)" };
  }

  const options: Record<string, unknown> = {};
  // Sur une instance sans accès Internet sortant, les fichiers de langue
  // doivent être fournis localement ; sinon tesseract.js les télécharge.
  if (process.env.AGENT_OCR_LANG_PATH) options.langPath = process.env.AGENT_OCR_LANG_PATH;
  if (process.env.AGENT_OCR_CACHE_PATH) options.cachePath = process.env.AGENT_OCR_CACHE_PATH;

  let worker: any;
  try {
    worker = await createWorker(ocrLang(), undefined, options);
  } catch (e: any) {
    return { text: '', pages: 0, unavailableReason: `moteur OCR indisponible (${e?.message || 'initialisation impossible'})` };
  }

  try {
    const chunks: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const { data } = await worker.recognize(images[i]);
      const pageText = String(data?.text || '').trim();
      if (pageText) chunks.push(images.length > 1 ? `--- page ${i + 1} ---\n${pageText}` : pageText);
    }
    return { text: chunks.join('\n\n'), pages: images.length };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/**
 * OCR d'un document. Retourne null si le fichier n'est pas un candidat ou si
 * l'OCR est désactivé ; sinon un résultat, éventuellement porteur d'un
 * `unavailableReason` quand la reconnaissance n'a pas pu avoir lieu.
 */
export async function ocrDocument(fileName: string, buffer: Buffer): Promise<OcrResult | null> {
  if (!isOcrEnabled()) return null;
  const lower = fileName.toLowerCase();

  if (OCR_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return recognize([buffer]);
  }

  if (!lower.endsWith('.pdf')) return null;

  const pages = await rasterizePdf(buffer, ocrMaxPages());
  if (pages === null) {
    return {
      text: '', pages: 0,
      unavailableReason: "conversion des pages impossible (utilitaire pdftoppm/poppler-utils absent de ce serveur)",
    };
  }
  if (pages.length === 0) return { text: '', pages: 0, unavailableReason: 'aucune page exploitable dans ce PDF' };
  return recognize(pages);
}
