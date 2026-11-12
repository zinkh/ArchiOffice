// Logique pure du croquis hors ligne : identifiants d'écritures en file, superposition de la file à la
// liste lue, brouillon local, état retenu à la réouverture, numérotation des titres. Aucune dépendance
// au DOM, à Dexie ni au réseau : tout est testé (src/lib/__tests__/croquisOffline.test.ts). Les
// écritures réelles sont dans src/lib/croquisSync.ts.
//
// Principe, le même que les notes de réunion et les appels téléphoniques :
//   - l'identifiant du croquis est généré par l'appareil, le serveur le reconnaît à un rejeu ;
//   - chaque sorte d'écriture a SON identifiant de file (`croquis-scene:<id>`, `croquis-title:<id>`...) :
//     les enregistrements successifs d'une même sorte se remplacent, deux sortes ne s'écrasent jamais ;
//   - la liste affichée = cache ou serveur + écritures en file rejouées par-dessus.
import type { PendingWrite } from '../db';
import type { Croquis } from '../types';
import type { CroquisScene } from '../types/croquis';
import { emptyScene, sanitizeScene, serializeScene } from './croquis/scene';

export type CroquisParent =
  | { kind: 'meeting'; id: string; projectId?: string | null }
  | { kind: 'siteReport'; id: string; projectId?: string | null };

/** Ce que la superposition lit d'une entrée de file : un sous-ensemble de `PendingWrite`. */
export type PendingLike = Pick<PendingWrite, 'id' | 'entity' | 'method' | 'kind'> & Partial<Pick<PendingWrite, 'jsonBody' | 'createdAt'>>;

const PREFIX = {
  create: 'croquis-create:',
  scene: 'croquis-scene:',
  title: 'croquis-title:',
  remove: 'croquis-delete:',
  background: 'croquis-bg:',
  backgroundClear: 'croquis-bgclear:',
  preview: 'croquis-preview:',
} as const;

export type CroquisWriteKind = keyof typeof PREFIX;

export const CROQUIS_WRITE_KINDS = Object.keys(PREFIX) as CroquisWriteKind[];

/** Les images partent en multipart (entité `croquisFile`), tout le reste en JSON (entité `croquis`). */
export const croquisWriteEntity = (kind: CroquisWriteKind): 'croquis' | 'croquisFile' =>
  kind === 'background' || kind === 'preview' ? 'croquisFile' : 'croquis';

export const croquisWriteId = (kind: CroquisWriteKind, croquisId: string): string => `${PREFIX[kind]}${croquisId}`;

export function parseCroquisWriteId(id: string): { kind: CroquisWriteKind; croquisId: string } | null {
  for (const kind of CROQUIS_WRITE_KINDS) {
    if (id.startsWith(PREFIX[kind]) && id.length > PREFIX[kind].length) {
      return { kind, croquisId: id.slice(PREFIX[kind].length) };
    }
  }
  return null;
}

/** Les écritures en attente d'UN croquis, rangées par sorte. */
export type CroquisPending = Partial<Record<CroquisWriteKind, PendingLike>>;

export const DEFAULT_BG_OPACITY = 0.35;
const MIN_BG_OPACITY = 0.05;

export function indexPendingCroquis(pending: readonly PendingLike[]): Map<string, CroquisPending> {
  const index = new Map<string, CroquisPending>();
  for (const write of pending) {
    if (write.entity !== 'croquis' && write.entity !== 'croquisFile') continue;
    const parsed = parseCroquisWriteId(write.id);
    if (!parsed) continue;
    const entry = index.get(parsed.croquisId) ?? {};
    entry[parsed.kind] = write;
    index.set(parsed.croquisId, entry);
  }
  return index;
}

const matchesParent = (body: any, parent: CroquisParent): boolean =>
  parent.kind === 'meeting' ? body?.meeting_id === parent.id : body?.site_report_id === parent.id;

const clampOpacity = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(MIN_BG_OPACITY, v)) : DEFAULT_BG_OPACITY;

function rowFromCreate(write: PendingLike, parent: CroquisParent): Croquis {
  const body = (write.jsonBody ?? {}) as any;
  const at = new Date(write.createdAt ?? Date.now()).toISOString();
  return {
    id: body.id,
    project_id: parent.projectId ?? null,
    meeting_id: parent.kind === 'meeting' ? parent.id : null,
    site_report_id: parent.kind === 'siteReport' ? parent.id : null,
    title: typeof body.title === 'string' && body.title ? body.title : 'Croquis',
    scene: sanitizeScene(body.scene) ?? emptyScene(),
    bg_path: null,
    bg_opacity: clampOpacity(body.bg_opacity),
    created_at: at,
    updated_at: at,
  };
}

/** Une ligne avec ses écritures en attente rejouées par-dessus ; `null` si sa suppression est en attente. */
function overlayRow(row: Croquis, pending: CroquisPending): Croquis | null {
  if (pending.remove) return null;
  let next = row;
  const sceneBody = pending.scene?.jsonBody as any;
  if (sceneBody) {
    const scene = sanitizeScene(sceneBody.scene);
    if (scene) next = { ...next, scene };
    if (sceneBody.bg_opacity !== undefined) next = { ...next, bg_opacity: clampOpacity(sceneBody.bg_opacity) };
  }
  const title = (pending.title?.jsonBody as any)?.title;
  if (typeof title === 'string' && title) next = { ...next, title };
  if (pending.backgroundClear) next = { ...next, bg_path: null, bg_width: null, bg_height: null };
  const waiting = Boolean(pending.create || pending.scene || pending.title || pending.background || pending.backgroundClear || pending.preview);
  return waiting ? { ...next, pendingSync: true } : next;
}

/**
 * La liste d'un parent (réunion ou compte-rendu) avec la file rejouée par-dessus : un croquis créé hors ligne
 * apparaît tout de suite (marqué « en attente »), une modification en attente est visible, une suppression en
 * attente le retire. Sans cela, relire la liste faisait disparaître ce qu'on venait de dessiner.
 */
export function applyPendingCroquisWrites(rows: readonly Croquis[], pending: readonly PendingLike[], parent: CroquisParent): Croquis[] {
  const index = indexPendingCroquis(pending);
  const seen = new Set<string>();
  const result: Croquis[] = [];
  for (const row of rows) {
    seen.add(row.id);
    const next = overlayRow(row, index.get(row.id) ?? {});
    if (next) result.push(next);
  }
  for (const [id, entry] of index) {
    if (seen.has(id) || !entry.create || entry.remove) continue;
    if (!matchesParent(entry.create.jsonBody, parent)) continue;
    const created = overlayRow(rowFromCreate(entry.create, parent), entry);
    if (created) result.push(created);
  }
  return result.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// ── Brouillon local ─────────────────────────────────────────────────────────
// Écrit à chaque modification, de façon SYNCHRONE (localStorage) : la file d'écritures vit dans IndexedDB,
// asynchrone, et une fermeture d'onglet ou un plantage entre le dernier trait et son enregistrement la
// perdrait. Le brouillon ne couvre que ce délai : il est retiré dès que l'écriture est partie ou en file.

export interface CroquisDraft {
  scene: CroquisScene;
  bgOpacity: number;
  savedAt: number;
}

export function serializeDraft(scene: CroquisScene, bgOpacity: number, now: number = Date.now()): string {
  return JSON.stringify({ v: 1, t: now, o: bgOpacity, s: JSON.parse(serializeScene(scene)) });
}

/** Relit un brouillon ; `null` s'il est absent ou illisible (jamais d'exception : un brouillon abîmé ne bloque rien). */
export function parseDraft(raw: string | null | undefined): CroquisDraft | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return null;
    const scene = sanitizeScene(data.s);
    if (!scene) return null;
    return { scene, bgOpacity: clampOpacity(data.o), savedAt: typeof data.t === 'number' ? data.t : 0 };
  } catch {
    return null;
  }
}

export const sceneEquals = (a: CroquisScene, b: CroquisScene): boolean => serializeScene(a) === serializeScene(b);

export interface ResolvedCroquisState {
  scene: CroquisScene;
  bgOpacity: number;
  /** D'où vient l'état : un brouillon non parti, une écriture en file, ou le serveur. */
  source: 'draft' | 'queue' | 'server';
}

/**
 * L'état que l'éditeur ouvre : brouillon non parti > écriture en file > valeur du serveur. Chaque niveau est
 * plus récent que le suivant, par construction (voir plus haut).
 */
export function resolveCroquisState(row: Croquis, pending: CroquisPending | undefined, draft: CroquisDraft | null): ResolvedCroquisState {
  if (draft) return { scene: draft.scene, bgOpacity: draft.bgOpacity, source: 'draft' };
  const body = pending?.scene?.jsonBody as any;
  const queued = body ? sanitizeScene(body.scene) : null;
  if (queued) return { scene: queued, bgOpacity: clampOpacity(body.bg_opacity ?? row.bg_opacity), source: 'queue' };
  return { scene: sanitizeScene(row.scene) ?? emptyScene(), bgOpacity: clampOpacity(row.bg_opacity), source: 'server' };
}

/** « Croquis 3 » : le premier numéro libre après ceux déjà pris par des titres de la forme « <base> N ». */
export function nextCroquisTitle(titles: readonly string[], base: string): string {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped} (\\d+)$`);
  let max = 0;
  for (const title of titles) {
    const match = pattern.exec(title.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${base} ${Math.max(max, titles.length) + 1}`;
}
