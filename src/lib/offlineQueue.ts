import { db, PendingWrite } from '../db';
import { getActiveTenantId } from './activeTenant';

/**
 * File d'écritures différées (réunions, réserves OPR/GPA, observations — voir
 * CLAUDE.md « fiabiliser la synchro hors-ligne »).
 *
 * Principe : chaque appelant génère lui-même l'id de l'entité côté client
 * (`crypto.randomUUID()`) avant d'écrire, comme le fait déjà `ReserveDetail.tsx`
 * — le serveur l'accepte tel quel et l'insert y est protégé contre le
 * doublon (`ON CONFLICT (id) DO NOTHING`). Cette même id sert de clé
 * d'idempotence à la file : rejouer deux fois la même entrée ne crée jamais
 * deux fois la même ligne, et une photo peut référencer l'id de son
 * parent immédiatement, sans jamais avoir à remapper un id temporaire vers
 * un id serveur.
 *
 * `window.fetch` est déjà patché par `authInterceptor.ts` : il pose un jeton
 * frais et l'en-tête `X-Tenant-Id` du cabinet ACTUELLEMENT actif sur chaque
 * appel `/api/**`, sauf si l'appelant a déjà posé cet en-tête lui-même. Cette
 * file exploite exactement ce comportement : à l'envoi immédiat, elle laisse
 * l'intercepteur faire son travail ; au rejeu, elle impose explicitement le
 * cabinet capturé au moment de la mise en file (`entry.tenantId`), qui peut
 * différer du cabinet actif si la personne a basculé entre-temps.
 */

interface JsonWriteRequest {
  entity: PendingWrite['entity'];
  id: string;
  method: PendingWrite['method'];
  url: string;
  body?: any;
}

interface MultipartWriteRequest {
  entity: PendingWrite['entity'];
  id: string;
  method: PendingWrite['method'];
  url: string;
  blob: Blob;
  blobFieldName: string;
  blobFilename?: string;
  extraFields?: Record<string, string>;
}

export interface QueuedResult<T = any> {
  /** false = envoyée tout de suite ; true = mise en file, à rejouer plus tard. */
  queued: boolean;
  data?: T;
}

/** Erreur réseau (hors-ligne, coupure en cours de requête) — jamais une réponse HTTP d'erreur. */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

async function parseJsonResponse(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) return response.json();
  return null;
}

async function throwForHttpError(response: Response): Promise<never> {
  let message = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json();
    if (body?.error) message = body.error;
    else if (body?.message) message = body.message;
  } catch {
    // Corps non JSON — on garde le message générique.
  }
  const err: any = new Error(message);
  err.status = response.status;
  throw err;
}

function buildFormData(entry: Pick<PendingWrite, 'blob' | 'blobFieldName' | 'blobFilename' | 'extraFields'>): FormData {
  const formData = new FormData();
  if (entry.blob && entry.blobFieldName) {
    formData.append(entry.blobFieldName, entry.blob, entry.blobFilename || 'photo.jpg');
  }
  for (const [key, value] of Object.entries(entry.extraFields || {})) {
    formData.append(key, value);
  }
  return formData;
}

async function enqueue(entry: Omit<PendingWrite, 'status' | 'attempts' | 'createdAt' | 'tenantId'>): Promise<void> {
  const pendingWrite: PendingWrite = {
    ...entry,
    tenantId: getActiveTenantId(),
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
  };
  await db.pendingWrites.put(pendingWrite);
}

/**
 * Écrit un enregistrement JSON (création/modification/suppression d'une
 * réunion, réserve ou observation). Hors-ligne ou en cas de coupure réseau,
 * la requête est mise en file au lieu d'échouer — l'appelant reçoit
 * `{ queued: true }` et doit construire lui-même l'état optimiste affiché à
 * l'écran (il connaît déjà l'id qu'il a généré).
 */
export async function queuedJsonRequest<T = any>(request: JsonWriteRequest): Promise<QueuedResult<T>> {
  if (!navigator.onLine) {
    await enqueue({
      id: request.id,
      entity: request.entity,
      method: request.method,
      url: request.url,
      kind: 'json',
      jsonBody: request.body,
    });
    return { queued: true };
  }

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
    });
    if (!response.ok) await throwForHttpError(response);
    return { queued: false, data: await parseJsonResponse(response) };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    await enqueue({
      id: request.id,
      entity: request.entity,
      method: request.method,
      url: request.url,
      kind: 'json',
      jsonBody: request.body,
    });
    return { queued: true };
  }
}

/**
 * Même principe que `queuedJsonRequest`, pour l'envoi d'une photo (réunion,
 * réserve, observation) — un fichier par appel, comme le fait déjà l'écran
 * (une photo prise = un envoi).
 */
export async function queuedMultipartRequest<T = any>(request: MultipartWriteRequest): Promise<QueuedResult<T>> {
  const commonFields = {
    id: request.id,
    entity: request.entity,
    method: request.method,
    url: request.url,
  };

  if (!navigator.onLine) {
    await enqueue({
      ...commonFields,
      kind: 'multipart',
      blob: request.blob,
      blobFieldName: request.blobFieldName,
      blobFilename: request.blobFilename,
      extraFields: request.extraFields,
    });
    return { queued: true };
  }

  try {
    const response = await fetch(request.url, {
      method: request.method,
      body: buildFormData(request),
    });
    if (!response.ok) await throwForHttpError(response);
    return { queued: false, data: await parseJsonResponse(response) };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    await enqueue({
      ...commonFields,
      kind: 'multipart',
      blob: request.blob,
      blobFieldName: request.blobFieldName,
      blobFilename: request.blobFilename,
      extraFields: request.extraFields,
    });
    return { queued: true };
  }
}

let replaying = false;

/**
 * Rejoue les écritures en attente, dans l'ordre de création. S'arrête dès la
 * première erreur réseau (la connexion est probablement retombée en cours de
 * route) — les entrées suivantes seront retentées au prochain déclenchement.
 * Une erreur HTTP applicative (validation refusée par le serveur), elle,
 * n'interrompt pas le rejeu des autres entrées : elle marque juste la sienne
 * `error` pour qu'elle reste visible plutôt que de bloquer tout le reste de
 * la file indéfiniment.
 */
export async function replayPendingWrites(): Promise<void> {
  if (replaying || !navigator.onLine) return;
  replaying = true;
  try {
    const entries = await db.pendingWrites.orderBy('createdAt').toArray();
    for (const entry of entries) {
      const headers = new Headers();
      // Impose le cabinet capturé à la mise en file, pas le cabinet
      // actuellement affiché : authInterceptor.ts ne pose X-Tenant-Id que si
      // absent, donc le poser ici prime toujours sur le cabinet actif.
      if (entry.tenantId) headers.set('X-Tenant-Id', entry.tenantId);

      let init: RequestInit;
      if (entry.kind === 'json') {
        headers.set('Content-Type', 'application/json');
        init = { method: entry.method, headers, body: entry.jsonBody !== undefined ? JSON.stringify(entry.jsonBody) : undefined };
      } else {
        init = { method: entry.method, headers, body: buildFormData(entry) };
      }

      try {
        const response = await fetch(entry.url, init);
        if (!response.ok) {
          await throwForHttpError(response);
        }
        await db.pendingWrites.delete(entry.id);
      } catch (error) {
        if (isNetworkError(error)) {
          // Connexion retombée pendant le rejeu : on arrête là, on retentera
          // tout — celle-ci comprise — au prochain déclenchement.
          return;
        }
        await db.pendingWrites.update(entry.id, {
          status: 'error',
          attempts: entry.attempts + 1,
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    replaying = false;
  }
}

let initialized = false;

/** À appeler une fois au démarrage de l'application (voir src/main.tsx). */
export function initOfflineQueue(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener('online', () => void replayPendingWrites());
  // WebKit/iOS n'implémente pas la Background Sync API : un sondage
  // périodique est le seul filet fiable sur ce moteur, pas un pis-aller en
  // attendant mieux.
  setInterval(() => void replayPendingWrites(), 30_000);
  void replayPendingWrites();
}

/** Nombre d'écritures en attente ou en erreur — pour un badge dans l'en-tête. */
export async function countPendingWrites(): Promise<number> {
  return db.pendingWrites.count();
}
