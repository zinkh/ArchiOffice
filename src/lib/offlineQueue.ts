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

/**
 * Réponses HTTP qui ne disent rien de la validité de l'écriture : session pas
 * encore renouvelée au retour du réseau (401), passerelle ou serveur qui
 * redémarre (502-504). Les traiter en erreur définitive faisait perdre la
 * saisie faite hors ligne pile au moment de la reconnexion.
 */
const TRANSIENT_HTTP_STATUSES = new Set([401, 502, 503, 504]);

/**
 * Une requête de rejeu qui ne répond jamais (jeton en attente du verrou d'authentification,
 * connexion à moitié morte sur iPad) bloquait toute la file : le drapeau `replaying` restait
 * vrai et plus aucun rejeu ne partait. Chaque requête a donc un délai, au-delà duquel elle est
 * abandonnée et retentée plus tard.
 */
const REPLAY_JSON_TIMEOUT_MS = 30_000;
const REPLAY_MULTIPART_TIMEOUT_MS = 90_000;
/** Un rejeu en cours depuis plus longtemps que cela est considéré comme planté : un autre peut démarrer. */
const REPLAY_STALE_MS = 10 * 60_000;

class ReplayTimeoutError extends Error {
  constructor() {
    super('Pas de réponse du serveur (délai dépassé)');
    this.name = 'ReplayTimeoutError';
  }
}

function isReplayTimeout(error: unknown): boolean {
  return error instanceof ReplayTimeoutError;
}

/**
 * `fetch` avec un délai ferme. Le délai court aussi pendant l'obtention du jeton (le `fetch`
 * patché par authInterceptor.ts l'attend avant d'envoyer), que l'AbortController seul n'interrompt pas.
 */
function fetchWithDeadline(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new ReplayTimeoutError());
    }, timeoutMs);
    fetch(url, { ...init, signal: controller.signal }).then(
      response => { clearTimeout(timer); resolve(response); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Erreur réseau (hors-ligne, coupure en cours de requête) ou réponse HTTP
 * transitoire : l'écriture n'a pas été jugée, on la garde pour plus tard.
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError || isReplayTimeout(error)) return true;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && TRANSIENT_HTTP_STATUSES.has(status);
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

/** Émis sur `window` quand une écriture en file atteint enfin le serveur. */
export const OFFLINE_WRITE_SYNCED_EVENT = 'archioffice:offline-write-synced';

/** Émis sur `window` quand une photo entre dans la file ou en est retirée à la main : les écrans qui superposent la file à leur liste se relisent. */
export const OFFLINE_QUEUE_CHANGED_EVENT = 'archioffice:offline-queue-changed';

/** Retire une écriture de la file avant son envoi (photo qu'on renonce à envoyer). */
export async function discardPendingWrite(id: string, entity: PendingWrite['entity']): Promise<void> {
  await db.pendingWrites.delete(id);
  window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_CHANGED_EVENT, { detail: { id, entity } }));
}

/**
 * Met une photo en file SANS tenter l'envoi dans l'appel : l'écran n'attend jamais le réseau.
 * L'envoi part tout de suite en arrière-plan (`replayNow`), un fichier à la fois, avec reprise
 * automatique : la photo vit dans IndexedDB, donc elle survit à une fermeture de l'onglet et à
 * une connexion qui tombe. C'est le chemin des photos de réserves, qu'on prend par dizaines.
 */
export async function enqueueMultipartRequest(request: MultipartWriteRequest): Promise<void> {
  await enqueue({
    id: request.id,
    entity: request.entity,
    method: request.method,
    url: request.url,
    kind: 'multipart',
    blob: request.blob,
    blobFieldName: request.blobFieldName,
    blobFilename: request.blobFilename,
    extraFields: request.extraFields,
  });
  window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_CHANGED_EVENT, { detail: { id: request.id, entity: request.entity } }));
  void replayNow();
}

let replaying = false;
let replayingSince = 0;

/**
 * Avancement du rejeu, observable par l'écran (`useSyncExternalStore`) : sans lui, « 19 en attente »
 * ne disait jamais si quelque chose partait, si c'était bloqué, ni pourquoi.
 */
export interface ReplayProgress {
  running: boolean;
  /** Entrées à traiter dans ce passage. */
  total: number;
  /** Entrées déjà traitées (envoyées ou échouées). */
  processed: number;
  sent: number;
  /** Entrées qui restent en file après ce passage (échec, délai dépassé, connexion coupée). */
  failed: number;
  currentId: string | null;
  currentEntity: PendingWrite['entity'] | null;
  currentKind: PendingWrite['kind'] | null;
  /** Octets de la photo en cours d'envoi (ne vaut que pour une entrée `multipart`). */
  bytesSent: number;
  bytesTotal: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Pourquoi le passage s'est arrêté avant la fin, le cas échéant. */
  stopReason: 'offline' | 'network' | null;
}

const IDLE_PROGRESS: ReplayProgress = {
  running: false, total: 0, processed: 0, sent: 0, failed: 0,
  currentId: null, currentEntity: null, currentKind: null, bytesSent: 0, bytesTotal: 0,
  startedAt: null, finishedAt: null, stopReason: null,
};

let progress: ReplayProgress = IDLE_PROGRESS;
const progressListeners = new Set<() => void>();

function setProgress(patch: Partial<ReplayProgress>): void {
  progress = { ...progress, ...patch };
  progressListeners.forEach(listener => listener());
}

export function getReplayProgress(): ReplayProgress {
  return progress;
}

export function subscribeReplayProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => { progressListeners.delete(listener); };
}

/** Quatre échecs réseau d'affilée : la connexion est morte, inutile d'essayer les suivantes à ce tour. */
const MAX_CONSECUTIVE_FAILURES = 4;

/** Délai d'obtention du jeton : le `fetch` patché l'attend sans limite, `XMLHttpRequest` doit le faire à sa place. */
const TOKEN_TIMEOUT_MS = 15_000;

/** Raison lisible d'un échec qui laisse l'entrée en file (jamais un silence). */
function transientFailureMessage(error: unknown): string {
  if (isReplayTimeout(error)) return (error as Error).message;
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401) return 'Session expirée (HTTP 401) : reconnectez-vous';
  if (typeof status === 'number') return `Serveur indisponible (HTTP ${status})`;
  const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
  return `Connexion interrompue pendant l'envoi${detail}`;
}

/**
 * Envoi d'une photo par `XMLHttpRequest`, seul moyen de connaître l'avancement de l'envoi (`fetch` n'en
 * donne pas). Mêmes en-têtes que le `fetch` patché : jeton et cabinet capturé à la mise en file.
 */
async function xhrMultipart(entry: PendingWrite, timeoutMs: number, onProgress: (sent: number, total: number) => void): Promise<Response> {
  const { getAccessToken } = await import('./authToken');
  const token = await Promise.race([
    getAccessToken(),
    new Promise<null>((_, reject) => setTimeout(() => reject(new ReplayTimeoutError()), TOKEN_TIMEOUT_MS)),
  ]);
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(entry.method, entry.url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (entry.tenantId) xhr.setRequestHeader('X-Tenant-Id', entry.tenantId);
    xhr.timeout = timeoutMs;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded, event.total); };
    xhr.onload = () => {
      const body = xhr.responseText || null;
      resolve(new Response(xhr.status === 204 || xhr.status === 205 ? null : body, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: { 'content-type': xhr.getResponseHeader('content-type') || '' },
      }));
    };
    xhr.onerror = () => reject(new TypeError('réseau injoignable'));
    xhr.onabort = () => reject(new TypeError('envoi annulé'));
    xhr.ontimeout = () => reject(new ReplayTimeoutError());
    xhr.send(buildFormData(entry));
  });
}

/**
 * Ordre du passage. Les saisies (JSON) partent d'abord, dans l'ordre de création : une photo ne se
 * rattache qu'à une entité déjà créée, jamais l'inverse. Les photos viennent ensuite, la moins
 * essayée d'abord : une photo qui échoue à chaque tour ne doit pas bloquer celles qui la suivent.
 */
function replayOrder(entries: PendingWrite[]): PendingWrite[] {
  const json = entries.filter(e => e.kind === 'json').sort((a, b) => a.createdAt - b.createdAt);
  const photos = entries.filter(e => e.kind !== 'json').sort((a, b) => a.attempts - b.attempts || a.createdAt - b.createdAt);
  return [...json, ...photos];
}

/**
 * Rejoue les écritures en attente et rend l'état final du passage. Une erreur réseau ou serveur
 * transitoire (connexion coupée, délai dépassé, 401/502/503/504) laisse l'entrée en file AVEC sa
 * raison et passe à la suivante : avant, elle arrêtait tout le rejeu sans rien enregistrer, et une
 * seule photo en tête de file bloquait les autres indéfiniment, sans « Échec » affiché. Une erreur
 * applicative (validation refusée) marque l'entrée `error`, visible, sans bloquer le reste.
 */
export async function replayPendingWrites(): Promise<ReplayProgress> {
  if (!navigator.onLine) return progress;
  if (replaying && Date.now() - replayingSince < REPLAY_STALE_MS) return progress;
  replaying = true;
  replayingSince = Date.now();
  let consecutiveFailures = 0;
  try {
    const entries = replayOrder(await db.pendingWrites.toArray());
    setProgress({ ...IDLE_PROGRESS, running: true, total: entries.length, startedAt: Date.now() });

    for (const entry of entries) {
      if (!navigator.onLine) { setProgress({ stopReason: 'offline' }); break; }
      setProgress({
        currentId: entry.id, currentEntity: entry.entity, currentKind: entry.kind,
        bytesSent: 0, bytesTotal: entry.kind === 'multipart' ? entry.blob?.size ?? 0 : 0,
      });

      // Sur iPad, un Blob rangé dans IndexedDB peut redevenir illisible : l'envoyer vide ne ferait
      // que bloquer ou créer une photo vide. L'entrée reste visible en échec, avec la raison.
      if (entry.kind === 'multipart' && !(entry.blob && entry.blob.size > 0)) {
        await db.pendingWrites.update(entry.id, {
          status: 'error',
          attempts: entry.attempts + 1,
          lastError: 'Fichier illisible sur cet appareil : reprenez la photo.',
        });
        setProgress({ processed: progress.processed + 1, failed: progress.failed + 1 });
        continue;
      }

      try {
        let response: Response;
        if (entry.kind === 'multipart' && typeof XMLHttpRequest !== 'undefined') {
          response = await xhrMultipart(entry, REPLAY_MULTIPART_TIMEOUT_MS, (sent, total) => setProgress({ bytesSent: sent, bytesTotal: total }));
        } else {
          const headers = new Headers();
          // Impose le cabinet capturé à la mise en file, pas le cabinet actuellement affiché :
          // authInterceptor.ts ne pose X-Tenant-Id que si absent, donc le poser ici prime.
          if (entry.tenantId) headers.set('X-Tenant-Id', entry.tenantId);
          let init: RequestInit;
          if (entry.kind === 'json') {
            headers.set('Content-Type', 'application/json');
            init = { method: entry.method, headers, body: entry.jsonBody !== undefined ? JSON.stringify(entry.jsonBody) : undefined };
          } else {
            init = { method: entry.method, headers, body: buildFormData(entry) };
          }
          response = await fetchWithDeadline(entry.url, init, entry.kind === 'multipart' ? REPLAY_MULTIPART_TIMEOUT_MS : REPLAY_JSON_TIMEOUT_MS);
        }
        if (!response.ok) await throwForHttpError(response);

        consecutiveFailures = 0;
        // La réponse du serveur (la photo créée, avec son `file_url`) voyage avec l'événement : l'écran
        // remplace son aperçu local sans relire toute la liste. Illisible = pas de données, jamais une erreur.
        const data = await parseJsonResponse(response).catch(() => null);
        await db.pendingWrites.delete(entry.id);
        setProgress({ processed: progress.processed + 1, sent: progress.sent + 1 });
        // Permet à l'écran qui a mis l'écriture en file (toujours ouvert ou rouvert depuis) de lever
        // son badge « en attente » — voir Reunions.tsx. Chaque écran filtre par entity/id ce qui le concerne.
        window.dispatchEvent(new CustomEvent(OFFLINE_WRITE_SYNCED_EVENT, { detail: { id: entry.id, entity: entry.entity, data } }));
      } catch (error) {
        if (isNetworkError(error)) {
          // Entrée gardée en attente, raison enregistrée (visible dans la liste), on passe à la suivante.
          await db.pendingWrites.update(entry.id, { attempts: entry.attempts + 1, lastError: transientFailureMessage(error) });
          setProgress({ processed: progress.processed + 1, failed: progress.failed + 1 });
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) { setProgress({ stopReason: 'network' }); break; }
          continue;
        }
        await db.pendingWrites.update(entry.id, {
          status: 'error',
          attempts: entry.attempts + 1,
          lastError: error instanceof Error ? error.message : String(error),
        });
        setProgress({ processed: progress.processed + 1, failed: progress.failed + 1 });
      }
    }
  } finally {
    replaying = false;
    setProgress({ running: false, currentId: null, currentEntity: null, currentKind: null, bytesSent: 0, bytesTotal: 0, finishedAt: Date.now() });
  }
  return progress;
}

/**
 * Lance un rejeu en attendant qu'un éventuel passage déjà en cours se termine : un import ou un
 * « Réessayer » ne doit pas être avalé parce que le sondage de 30 s vient de démarrer.
 */
export async function replayNow(): Promise<ReplayProgress> {
  if (progress.running) {
    await new Promise<void>(resolve => {
      const unsubscribe = subscribeReplayProgress(() => {
        if (!progress.running) { unsubscribe(); resolve(); }
      });
    });
  }
  return replayPendingWrites();
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

/** Écritures en file pour une entité donnée, dans l'ordre de création (relecture au rechargement d'un écran). */
export async function listPendingWrites(entity: PendingWrite['entity']): Promise<PendingWrite[]> {
  try {
    const all = await db.pendingWrites.orderBy('createdAt').toArray();
    return all.filter(w => w.entity === entity);
  } catch {
    return [];
  }
}
