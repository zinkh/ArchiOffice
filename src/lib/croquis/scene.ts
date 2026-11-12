// Logique pure de la scène d'un croquis : création, validation, sérialisation,
// boîte englobante, test d'appartenance d'un point, déplacement. Aucune
// dépendance au DOM ni à Rough.js : tout y est testable (voir
// src/lib/__tests__/croquisScene.test.ts).
//
// Les éléments sont traités comme IMMUABLES : chaque fonction qui « modifie »
// renvoie une copie. C'est ce qui permet à l'historique (history.ts) de garder
// des références plutôt que des copies profondes.
import type {
  CroquisBBox,
  CroquisElement,
  CroquisFill,
  CroquisHandle,
  CroquisScene,
  CroquisShapeType,
  CroquisStyle,
} from '../../types/croquis';

export const SCENE_VERSION = 1 as const;
export const MAX_ELEMENTS = 5000;
export const MAX_PEN_POINTS = 5000;
export const MAX_TEXT_LENGTH = 500;
const MAX_COORD = 1_000_000;

export const COLORS = [
  { value: '#141414', key: 'black' },
  { value: '#77777a', key: 'gray' },
  { value: '#c8322b', key: 'red' },
  { value: '#c99a00', key: 'yellow' },
  { value: '#2456a6', key: 'blue' },
] as const;

export const STROKE_WIDTHS = [
  { value: 1.2, key: 'thin' },
  { value: 2.2, key: 'medium' },
  { value: 4, key: 'thick' },
] as const;

export const FILLS: readonly CroquisFill[] = ['none', 'hachure', 'cross-hatch', 'zigzag', 'dots', 'solid'];

export const DEFAULT_STYLE: CroquisStyle = {
  rough: true,
  color: '#141414',
  sw: 2.2,
  fill: 'none',
  angle: 45,
  gap: 7,
};

/** Hachures types en un clic. */
export const HATCH_PRESETS = {
  existant: { color: '#141414', fill: 'hachure', angle: 45, gap: 8 },
  demoli: { color: '#c99a00', fill: 'hachure', angle: -45, gap: 6 },
  construit: { color: '#c8322b', fill: 'hachure', angle: 45, gap: 6 },
  beton: { color: '#77777a', fill: 'cross-hatch', angle: 45, gap: 9 },
  isolant: { color: '#141414', fill: 'zigzag', angle: 0, gap: 9 },
} as const satisfies Record<string, Pick<CroquisStyle, 'color' | 'fill' | 'angle' | 'gap'>>;

export type HatchPresetKey = keyof typeof HATCH_PRESETS;

const SHAPE_TYPES: readonly CroquisShapeType[] = ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function emptyScene(): CroquisScene {
  return { version: SCENE_VERSION, elements: [] };
}

// ── Création ────────────────────────────────────────────────────────────────

/** Graine Rough.js : entier strictement positif. `random` est injectable pour les tests. */
export function newSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 2147483000) + 1;
}

export function newElementId(random: () => number = Math.random): string {
  return random().toString(36).slice(2, 10) || 'x';
}

export function createElement(
  type: CroquisShapeType,
  x: number,
  y: number,
  style: CroquisStyle,
  zoom: number,
  extra: Partial<CroquisElement> = {},
): CroquisElement {
  const filled = type === 'rect' || type === 'ellipse';
  return {
    id: newElementId(),
    type,
    x1: x,
    y1: y,
    x2: x,
    y2: y,
    k: 1 / zoom,
    seed: newSeed(),
    rough: style.rough,
    color: style.color,
    sw: style.sw,
    fill: filled ? style.fill : 'none',
    angle: style.angle,
    gap: style.gap,
    ...extra,
  };
}

// ── Validation et sérialisation ─────────────────────────────────────────────

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, fallback: number, min = -MAX_COORD, max = MAX_COORD): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function finiteCoord(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD ? v : null;
}

function sanitizeElement(raw: unknown): CroquisElement | null {
  if (!isRecord(raw)) return null;
  const type = raw.type;
  if (typeof type !== 'string' || !SHAPE_TYPES.includes(type as CroquisShapeType)) return null;
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;

  const x1 = finiteCoord(raw.x1);
  const y1 = finiteCoord(raw.y1);
  const x2 = finiteCoord(raw.x2 ?? raw.x1);
  const y2 = finiteCoord(raw.y2 ?? raw.y1);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

  const el: CroquisElement = {
    id,
    type: type as CroquisShapeType,
    x1,
    y1,
    x2,
    y2,
    k: num(raw.k, 1, 0.01, 100),
    seed: typeof raw.seed === 'number' && Number.isInteger(raw.seed) && raw.seed > 0 ? raw.seed : 1,
    rough: raw.rough !== false,
    color: typeof raw.color === 'string' && HEX_COLOR.test(raw.color) ? raw.color : DEFAULT_STYLE.color,
    sw: num(raw.sw, DEFAULT_STYLE.sw, 0.5, 20),
    fill: FILLS.includes(raw.fill as CroquisFill) ? (raw.fill as CroquisFill) : 'none',
    angle: num(raw.angle, DEFAULT_STYLE.angle, -180, 180),
    gap: num(raw.gap, DEFAULT_STYLE.gap, 2, 40),
  };

  if (el.type === 'pen') {
    if (!Array.isArray(raw.pts)) return null;
    const pts: [number, number][] = [];
    for (const p of raw.pts.slice(0, MAX_PEN_POINTS)) {
      if (!Array.isArray(p)) continue;
      const px = finiteCoord(p[0]);
      const py = finiteCoord(p[1]);
      if (px !== null && py !== null) pts.push([px, py]);
    }
    if (pts.length === 0) return null;
    el.pts = pts;
    el.fill = 'none';
  } else if (el.type === 'text') {
    const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_TEXT_LENGTH) : '';
    if (!text) return null;
    el.text = text;
    el.fill = 'none';
  } else if (el.type !== 'rect' && el.type !== 'ellipse') {
    el.fill = 'none';
  }
  return el;
}

/**
 * Valide une scène lue en base : ignore les éléments invalides (au lieu de
 * faire échouer tout le croquis), plafonne leur nombre et refuse les identifiants
 * en double. Renvoie `null` si la valeur n'a pas la forme d'une scène.
 */
export function sanitizeScene(raw: unknown): CroquisScene | null {
  if (!isRecord(raw) || raw.version !== SCENE_VERSION || !Array.isArray(raw.elements)) return null;
  const seen = new Set<string>();
  const elements: CroquisElement[] = [];
  for (const item of raw.elements) {
    if (elements.length >= MAX_ELEMENTS) break;
    const el = sanitizeElement(item);
    if (!el || seen.has(el.id)) continue;
    seen.add(el.id);
    elements.push(el);
  }
  return { version: SCENE_VERSION, elements };
}

/** JSON compact : nombres arrondis à 2 décimales (le tracé n'a pas besoin de plus). */
export function serializeScene(scene: CroquisScene): string {
  return JSON.stringify(scene, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v));
}

/** Relit une scène sérialisée. `null` si le JSON est illisible : l'appelant ne doit alors rien écraser. */
export function parseScene(json: string): CroquisScene | null {
  try {
    return sanitizeScene(JSON.parse(json));
  } catch {
    return null;
  }
}

// ── Géométrie ───────────────────────────────────────────────────────────────

/** Taille de police en unités monde : constante à l'écran grâce au facteur `k`. */
export const fontSize = (e: Pick<CroquisElement, 'rough' | 'k'>): number => (e.rough ? 24 : 17) * e.k;

/** Largeur approchée d'un texte, quand le rendu n'a pas encore pu la mesurer. */
const estimatedTextWidth = (e: CroquisElement): number => (e.text?.length ?? 4) * fontSize(e) * 0.55;

export function elementBBox(e: CroquisElement, measuredTextWidth?: number): CroquisBBox {
  if (e.type === 'pen' && e.pts && e.pts.length) {
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const [px, py] of e.pts) {
      if (px < x1) x1 = px;
      if (py < y1) y1 = py;
      if (px > x2) x2 = px;
      if (py > y2) y2 = py;
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  if (e.type === 'text') {
    const s = fontSize(e);
    return { x: e.x1, y: e.y1, w: measuredTextWidth ?? estimatedTextWidth(e), h: s * 1.2 };
  }
  return { x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2), w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
}

/** Boîte englobante de plusieurs éléments, `null` si la liste est vide. */
export function sceneBBox(elements: readonly CroquisElement[]): CroquisBBox | null {
  if (!elements.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const e of elements) {
    const b = elementBBox(e);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Le point (x, y), en coordonnées monde, tombe-t-il sur l'élément ? La tolérance reste de ~9 px à l'écran. */
export function hitElement(e: CroquisElement, x: number, y: number, zoom: number, measuredTextWidth?: number): boolean {
  const t = 9 / zoom + (e.sw * e.k) / 2;
  if (e.type === 'pen') {
    const p = e.pts ?? [];
    if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) < t;
    for (let i = 1; i < p.length; i++) {
      if (distanceToSegment(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) < t) return true;
    }
    return false;
  }
  if (e.type === 'line' || e.type === 'arrow') return distanceToSegment(x, y, e.x1, e.y1, e.x2, e.y2) < t;
  const b = elementBBox(e, measuredTextWidth);
  const inside = x >= b.x - t && x <= b.x + b.w + t && y >= b.y - t && y <= b.y + b.h + t;
  if (e.type === 'text') return inside;
  if (e.type === 'rect') {
    if (!inside) return false;
    if (e.fill !== 'none') return true;
    return x < b.x + t || x > b.x + b.w - t || y < b.y + t || y > b.y + b.h - t;
  }
  if (e.type === 'ellipse') {
    const rx = Math.max(b.w / 2, 0.001);
    const ry = Math.max(b.h / 2, 0.001);
    const v = Math.sqrt(((x - b.x - rx) / rx) ** 2 + ((y - b.y - ry) / ry) ** 2);
    if (e.fill !== 'none') return v <= 1 + t / Math.min(rx, ry);
    return Math.abs(v - 1) * Math.min(rx, ry) < t;
  }
  return false;
}

/** Élément le plus haut (dessiné en dernier) sous le point, ou `null`. */
export function topElementAt(elements: readonly CroquisElement[], x: number, y: number, zoom: number): CroquisElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitElement(elements[i], x, y, zoom)) return elements[i];
  }
  return null;
}

/** Gomme : retire les éléments sous le point. Renvoie la MÊME liste s'il n'y a rien à retirer. */
export function eraseAtPoint(
  elements: readonly CroquisElement[],
  x: number,
  y: number,
  zoom: number,
): { elements: CroquisElement[]; removed: number } {
  const kept = elements.filter((e) => !hitElement(e, x, y, zoom));
  return { elements: kept.length === elements.length ? (elements as CroquisElement[]) : kept, removed: elements.length - kept.length };
}

// ── Modification (immuable) ─────────────────────────────────────────────────

export function translateElement(e: CroquisElement, dx: number, dy: number): CroquisElement {
  const moved: CroquisElement = { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
  if (e.pts) moved.pts = e.pts.map(([px, py]) => [px + dx, py + dy] as [number, number]);
  return moved;
}

/** Poignées de redimensionnement : deux extrémités pour un segment, quatre coins pour une forme. */
export function elementHandles(e: CroquisElement): CroquisHandle[] {
  if (e.type === 'line' || e.type === 'arrow') return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
  if (e.type === 'rect' || e.type === 'ellipse') {
    return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y1 }, { x: e.x2, y: e.y2 }, { x: e.x1, y: e.y2 }];
  }
  return [];
}

/** Déplace la poignée `index` en (x, y). Renvoie l'élément inchangé si l'index n'existe pas. */
export function moveHandle(e: CroquisElement, index: number, x: number, y: number): CroquisElement {
  if (e.type === 'line' || e.type === 'arrow') {
    if (index === 0) return { ...e, x1: x, y1: y };
    if (index === 1) return { ...e, x2: x, y2: y };
    return e;
  }
  if (e.type === 'rect' || e.type === 'ellipse') {
    if (index === 0) return { ...e, x1: x, y1: y };
    if (index === 1) return { ...e, x2: x, y1: y };
    if (index === 2) return { ...e, x2: x, y2: y };
    if (index === 3) return { ...e, x1: x, y2: y };
  }
  return e;
}

/**
 * Applique un changement de style à un élément. Crayon et texte restent sans
 * remplissage ; une forme conserve son remplissage si le patch n'en parle pas.
 */
export function applyStyleToElement(e: CroquisElement, patch: Partial<CroquisStyle>): CroquisElement {
  const next: CroquisElement = { ...e, ...patch };
  if (e.type !== 'rect' && e.type !== 'ellipse') next.fill = 'none';
  return next;
}

/** Un tracé trop petit (simple clic) n'est pas gardé, sauf le crayon (un point est un point). */
export function isWorthKeeping(e: CroquisElement, zoom: number): boolean {
  if (e.type === 'pen') return true;
  const b = elementBBox(e);
  return Math.max(b.w, b.h) > 3 / zoom;
}
