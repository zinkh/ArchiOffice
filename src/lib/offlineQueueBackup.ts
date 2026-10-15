import { db, PendingWrite } from '../db';

/**
 * Solution d'urgence : sauvegarder la file d'écritures hors ligne dans un fichier, puis la
 * recharger sur n'importe quel poste connecté (même compte). Sert quand la file ne se vide plus
 * sur un appareil (iPad hors réseau, Safari qui perd des données) et que la saisie du chantier
 * ne doit pas être perdue.
 *
 * Le fichier reprend les entrées telles qu'elles sont en file, photos comprises (en base64).
 * À l'import, chaque entrée est remise « en attente » puis rejouée par `replayPendingWrites` :
 * l'id d'une entrée est sa clé d'idempotence (voir offlineQueue.ts), donc importer deux fois le
 * même fichier, ou un fichier dont une partie est déjà partie, ne crée jamais de doublon.
 */

export const BACKUP_FORMAT = 'archioffice-offline-queue';
export const BACKUP_VERSION = 1;
/** Un fichier de secours reste un fichier de téléphone : au-delà, on refuse plutôt que de planter le navigateur. */
export const MAX_BACKUP_BYTES = 150 * 1024 * 1024;

const ENTITIES: PendingWrite['entity'][] = [
  'siteReportNote', 'chantierDecoupage', 'meeting', 'meetingPhoto', 'reserve', 'reservePhoto', 'gpaReserve',
  'gpaReservePhoto', 'observation', 'observationPhoto', 'siteReportNotePhoto', 'project', 'siteReport',
  'proposal', 'tender', 'inspirationBoard', 'inspirationItem', 'inspirationBoardItem', 'meetingAttendee',
];
const METHODS: PendingWrite['method'][] = ['POST', 'PUT', 'PATCH', 'DELETE'];

interface BackupWrite extends Omit<PendingWrite, 'blob'> {
  blob?: { base64: string; type: string };
}

export interface QueueBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  writes: BackupWrite[];
}

export interface ImportSummary {
  imported: number;
  /** Entrées du fichier refusées (format inattendu), avec la raison. */
  rejected: { id: string; reason: string }[];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Construit la sauvegarde de la file actuelle. Une photo illisible est signalée plutôt que silencieusement omise. */
export async function buildQueueBackup(): Promise<{ backup: QueueBackup; unreadable: string[] }> {
  const entries = await db.pendingWrites.orderBy('createdAt').toArray();
  const unreadable: string[] = [];
  const writes: BackupWrite[] = [];
  for (const entry of entries) {
    const { blob, ...rest } = entry;
    if (entry.kind === 'multipart') {
      if (!blob || blob.size === 0) { unreadable.push(entry.id); continue; }
      writes.push({ ...rest, blob: { base64: await blobToBase64(blob), type: blob.type || 'application/octet-stream' } });
    } else {
      writes.push(rest);
    }
  }
  return {
    backup: { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), writes },
    unreadable,
  };
}

export interface PreparedBackup {
  file: File;
  count: number;
  /** Photos de la file dont le fichier est illisible sur cet appareil : absentes de la sauvegarde. */
  unreadable: number;
}

/**
 * Construit le fichier de sauvegarde (hors ligne : tout se passe sur l'appareil). La remise du
 * fichier est une seconde étape, déclenchée par un nouvel appui : sur iPad, le partage et le
 * téléchargement exigent un geste de la personne, que la lecture des photos (plusieurs secondes)
 * a déjà fait expirer. Un téléchargement lancé juste après ce travail est ignoré sans erreur.
 */
export async function prepareQueueBackup(): Promise<PreparedBackup> {
  const { backup, unreadable } = await buildQueueBackup();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = new File([JSON.stringify(backup)], `archioffice-file-attente-${stamp}.json`, { type: 'application/json' });
  return { file, count: backup.writes.length, unreadable: unreadable.length };
}

export type DeliveryResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Remet le fichier à la personne. Dans une application installée sur l'écran d'accueil de l'iPad
 * (mode standalone), un lien `<a download>` ne fait souvent rien : on passe d'abord par la feuille
 * de partage (« Enregistrer dans Fichiers », AirDrop, Mail), et on ne retombe sur le téléchargement
 * qu'ailleurs. Doit être appelée directement depuis un appui.
 */
export async function deliverBackupFile(file: File): Promise<DeliveryResult> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    // iOS n'accepte pas tous les types de fichier : le texte brut passe là où le JSON est refusé.
    for (const type of [file.type, 'text/plain']) {
      const candidate = type === file.type ? file : new File([file], file.name, { type });
      if (!nav.canShare({ files: [candidate] })) continue;
      try {
        await nav.share({ files: [candidate], title: file.name });
        return 'shared';
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return 'cancelled';
        break; // partage refusé : on tente le téléchargement
      }
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari lit le lien après le clic : on ne libère l'URL qu'un peu plus tard.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

/** Lit un fichier choisi par la personne, le recharge dans la file puis lance le rejeu s'il y a du réseau. */
export async function importQueueBackupFile(file: File): Promise<ImportSummary> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Ce fichier est trop volumineux pour une sauvegarde de la file.');
  const summary = await importQueueBackup(await file.text());
  const { replayPendingWrites } = await import('./offlineQueue');
  void replayPendingWrites();
  return summary;
}

/** Vérifie une entrée du fichier : un fichier de secours vient de l'extérieur, il ne peut viser que l'API de l'application. */
function validateWrite(raw: any): { ok: true; write: PendingWrite } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'entrée invalide' };
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 100) return { ok: false, reason: 'identifiant manquant' };
  if (!ENTITIES.includes(raw.entity)) return { ok: false, reason: 'type d\'écriture inconnu' };
  if (!METHODS.includes(raw.method)) return { ok: false, reason: 'méthode inconnue' };
  if (typeof raw.url !== 'string' || !raw.url.startsWith('/api/') || raw.url.includes('..') || raw.url.includes('//')) {
    return { ok: false, reason: 'adresse hors de l\'API' };
  }
  if (raw.kind !== 'json' && raw.kind !== 'multipart') return { ok: false, reason: 'type de requête inconnu' };
  const createdAt = Number(raw.createdAt);
  const write: PendingWrite = {
    id: raw.id,
    entity: raw.entity,
    method: raw.method,
    url: raw.url,
    kind: raw.kind,
    tenantId: typeof raw.tenantId === 'string' ? raw.tenantId : undefined,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    status: 'pending',
    attempts: 0,
  } as PendingWrite;
  if (raw.kind === 'json') {
    write.jsonBody = raw.jsonBody;
  } else {
    if (!raw.blob || typeof raw.blob.base64 !== 'string') return { ok: false, reason: 'photo absente du fichier' };
    try {
      write.blob = base64ToBlob(raw.blob.base64, typeof raw.blob.type === 'string' ? raw.blob.type : 'application/octet-stream');
    } catch {
      return { ok: false, reason: 'photo corrompue' };
    }
    write.blobFieldName = typeof raw.blobFieldName === 'string' ? raw.blobFieldName : undefined;
    write.blobFilename = typeof raw.blobFilename === 'string' ? raw.blobFilename : undefined;
    write.extraFields = raw.extraFields && typeof raw.extraFields === 'object' ? raw.extraFields : undefined;
  }
  return { ok: true, write };
}

/** Recharge un fichier de secours dans la file ; le rejeu part ensuite comme pour toute écriture en attente. */
export async function importQueueBackup(text: string): Promise<ImportSummary> {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Ce fichier n\'est pas une sauvegarde ArchiOffice (JSON illisible).');
  }
  if (!parsed || parsed.format !== BACKUP_FORMAT || !Array.isArray(parsed.writes)) {
    throw new Error('Ce fichier n\'est pas une sauvegarde de la file hors ligne ArchiOffice.');
  }
  if (typeof parsed.version === 'number' && parsed.version > BACKUP_VERSION) {
    throw new Error('Cette sauvegarde vient d\'une version plus récente de l\'application : mettez l\'application à jour.');
  }
  const rejected: ImportSummary['rejected'] = [];
  const valid: PendingWrite[] = [];
  for (const raw of parsed.writes) {
    const result = validateWrite(raw);
    if (result.ok) valid.push(result.write);
    else rejected.push({ id: String(raw?.id ?? '?'), reason: result.reason });
  }
  for (const write of valid) await db.pendingWrites.put(write);
  return { imported: valid.length, rejected };
}
