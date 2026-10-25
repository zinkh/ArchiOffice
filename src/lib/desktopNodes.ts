// Identifiants et noms des nœuds de l'arborescence desktop (docs/desktop-sync-contract.md,
// sections 4 et 10). Logique pure, testée, partagée par le serveur.
//
// Un identifiant de nœud est stable : un renommage ou un déplacement ne le change jamais.
// Une phase n'existe pas en base : c'est la valeur de `documents.phase` d'une affaire, donc
// son identifiant est composé (`phase:<affaire>:<code>`).
import { fileExtension } from './cadFiles';

export type ParsedNodeId =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'inbox'; tenantId: string }
  | { kind: 'prj'; projectId: string }
  | { kind: 'phase'; projectId: string; code: string }
  | { kind: 'doc'; documentId: string };

/** Phase d'un document sans phase : le même libellé que le dossier « Général » de l'écran Documents. */
export const DEFAULT_PHASE_CODE = 'Général';

/** Phases de la mission, dans l'ordre où un cabinet les lit. Une phase inconnue passe après. */
export const PHASE_ORDER: readonly string[] = [
  'ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR', DEFAULT_PHASE_CODE,
];

export const tenantNodeId = (tenantId: string) => `tenant:${tenantId}`;
export const inboxNodeId = (tenantId: string) => `inbox:${tenantId}`;
export const projectNodeId = (projectId: string) => `prj:${projectId}`;
export const phaseNodeId = (projectId: string, code: string) => `phase:${projectId}:${code}`;
export const documentNodeId = (documentId: string) => `doc:${documentId}`;

/** Code de phase d'un document : sa valeur, ou « Général » quand elle est vide. */
export function phaseCode(phase: string | null | undefined): string {
  return String(phase ?? '').trim() || DEFAULT_PHASE_CODE;
}

export function parseNodeId(raw: string | null | undefined): ParsedNodeId | null {
  const id = String(raw ?? '');
  const colon = id.indexOf(':');
  if (colon <= 0) return null;
  const kind = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  if (!rest) return null;
  if (kind === 'tenant') return { kind: 'tenant', tenantId: rest };
  if (kind === 'inbox') return { kind: 'inbox', tenantId: rest };
  if (kind === 'prj') return { kind: 'prj', projectId: rest };
  if (kind === 'doc') return { kind: 'doc', documentId: rest };
  if (kind === 'phase') {
    // Un identifiant d'affaire ne contient jamais « : » ; le code de phase peut en contenir.
    const sep = rest.indexOf(':');
    if (sep <= 0 || sep === rest.length - 1) return null;
    return { kind: 'phase', projectId: rest.slice(0, sep), code: rest.slice(sep + 1) };
  }
  return null;
}

/** Rang d'une phase pour le tri ; les phases inconnues se rangent après, par ordre alphabétique. */
export function comparePhaseCodes(a: string, b: string): number {
  const ia = PHASE_ORDER.indexOf(a);
  const ib = PHASE_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return a.localeCompare(b, 'fr');
}

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_LENGTH = 255;

/**
 * Nom de fichier valide sous Windows ET macOS : caractères réservés remplacés, pas de point
 * ni d'espace final, pas de nom réservé (CON, NUL...), 255 caractères au plus en gardant
 * l'extension. Le nom d'origine reste dans `documents.name`.
 */
export function safeNodeName(name: string | null | undefined, fallback = 'Sans nom'): string {
  let value = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim();
  value = value.replace(/[. ]+$/, '');
  if (!value) value = fallback;
  const dot = value.lastIndexOf('.');
  const stem = dot > 0 ? value.slice(0, dot) : value;
  if (RESERVED_WINDOWS_NAMES.test(stem)) value = `_${value}`;
  if (value.length > MAX_NAME_LENGTH) {
    const ext = dot > 0 ? value.slice(value.lastIndexOf('.')) : '';
    if (ext && ext.length < 32) {
      value = `${value.slice(0, MAX_NAME_LENGTH - ext.length)}${ext}`;
    } else {
      value = value.slice(0, MAX_NAME_LENGTH);
    }
  }
  return value;
}

/** « Plan.pdf » → « Plan (2).pdf ». */
function withSuffix(name: string, n: number): string {
  const ext = fileExtension(name);
  if (!ext) return `${name} (${n})`;
  // L'extension d'origine est reprise telle quelle : fileExtension() la met en minuscules.
  const stem = name.slice(0, name.length - ext.length - 1);
  const originalExt = name.slice(name.length - ext.length);
  return `${stem} (${n}).${originalExt}`;
}

/**
 * Noms uniques dans un dossier, sans tenir compte de la casse (Windows et macOS sont
 * insensibles à la casse). Déterministe : à nom égal, l'identifiant le plus petit garde
 * le nom, les autres reçoivent « (2) », « (3) »... dans l'ordre des identifiants.
 */
export function uniqueSiblingNames(items: ReadonlyArray<{ id: string; name: string }>): Map<string, string> {
  const sorted = [...items]
    .map(item => ({ id: item.id, base: safeNodeName(item.name) }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const taken = new Set<string>();
  const result = new Map<string, string>();
  for (const { id, base } of sorted) {
    let candidate = base;
    let n = 1;
    while (taken.has(candidate.toLowerCase())) {
      n += 1;
      candidate = withSuffix(base, n);
    }
    taken.add(candidate.toLowerCase());
    result.set(id, candidate);
  }
  return result;
}
