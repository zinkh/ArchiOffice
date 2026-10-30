// Copie locale des photos de chantier (DET, OPR, GPA) sur l'appareil.
//
// Réglage PERSONNEL ET PAR APPAREIL (localStorage) : un iPad et un téléphone n'ont pas la même
// pellicule, et le réglage n'a de sens que là où la photo est prise.
//
// Limite de la plateforme, à connaître : une application web ne peut écrire dans la pellicule
// d'aucun système sans geste de la personne.
// - Android : un téléchargement part tout seul et la photo arrive dans « Téléchargements »
//   (visible dans Fichiers et, selon le modèle, dans la galerie).
// - iOS / iPadOS : seul le menu de partage (« Enregistrer l'image ») écrit dans Photos, et il
//   exige un appui. Les photos sont donc mises en attente et une bannière propose de toutes
//   les enregistrer d'un seul appui (`flushPendingLocalCopies`). Sans menu de partage de
//   fichiers, repli sur le téléchargement (dossier Fichiers).
// Seules les photos prises avec l'appareil sont copiées : celles choisies dans la pellicule
// y sont déjà.
import { isIos } from './push';

const STORAGE_KEY = 'photos:saveLocal';

export function isLocalCopyEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

export function setLocalCopyEnabled(value: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch { /* préférence non mémorisée */ }
}

/** Vrai quand la copie passe par une file à valider d'un appui (iOS / iPadOS). */
export function localCopyNeedsConfirmation(): boolean {
  return typeof navigator !== 'undefined' && isIos();
}

let pending: File[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

export function getPendingLocalCopies(): readonly File[] { return pending; }

export function subscribePendingLocalCopies(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function datedName(file: File, index: number): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const ext = (file.name.match(/\.[^.]+$/)?.[0] || '.jpg').toLowerCase();
  return `ArchiOffice_${stamp}_${index + 1}${ext}`;
}

function download(file: File, index = 0): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = datedName(file, index);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** À appeler avec les fichiers issus de l'appareil photo. Ne lève jamais : la photo d'origine part de toute façon. */
export function keepLocalCopy(files: readonly File[]): void {
  if (!isLocalCopyEnabled() || typeof document === 'undefined') return;
  const images = files.filter(f => f.type.startsWith('image/'));
  if (!images.length) return;
  try {
    if (localCopyNeedsConfirmation()) {
      pending = [...pending, ...images];
      notify();
    } else {
      images.forEach((f, i) => download(f, i));
    }
  } catch (error) {
    console.warn('[localPhotoCopy] copie locale impossible', error);
  }
}

/** Doit partir d'un appui (geste exigé par le menu de partage d'iOS). Rend le nombre de photos traitées. */
export async function flushPendingLocalCopies(): Promise<number> {
  const files = pending;
  if (!files.length) return 0;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  try {
    if (nav.share && nav.canShare?.({ files })) {
      await nav.share({ files });
    } else {
      files.forEach((f, i) => download(f, i));
    }
  } catch (error) {
    // Menu fermé sans choisir : les photos restent en attente pour un nouvel essai.
    if ((error as Error)?.name === 'AbortError') return 0;
    throw error;
  }
  pending = [];
  notify();
  return files.length;
}

export function discardPendingLocalCopies(): void {
  pending = [];
  notify();
}
