// Rendu d'un croquis sur un <canvas> : formes Rough.js mises en cache par
// élément, crayon libre en courbes quadratiques, texte, fond et sélection.
//
// Le cache est une WeakMap indexée par l'élément : les éléments sont immuables
// (voir scene.ts), une modification crée un nouvel objet et donc une nouvelle
// entrée, l'ancienne part avec le ramasse-miettes. La graine (`seed`) de chaque
// élément fait que Rough.js redessine toujours le même tracé.
import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import type { Drawable, Options } from 'roughjs/bin/core';
import type { CroquisBackground, CroquisElement } from '../../types/croquis';
import { elementBBox, elementHandles, fontSize, sceneBBox } from './scene';
import { exportFrame, unionBBox, type ViewState } from './view';

export interface CroquisRenderer {
  rc: RoughCanvas;
  cache: WeakMap<CroquisElement, Drawable[]>;
}

export function createRenderer(canvas: HTMLCanvasElement): CroquisRenderer {
  return { rc: rough.canvas(canvas), cache: new WeakMap() };
}

/**
 * Police d'un texte : écriture manuscrite pour le trait main levée, police de
 * l'application sinon. `scale` (le zoom) sert au champ de saisie, qui est en
 * pixels d'écran alors que le dessin est en unités monde.
 */
export const fontOf = (e: CroquisElement, scale = 1): string =>
  e.rough
    ? `500 ${fontSize(e) * scale}px Caveat, "Source Sans 3", sans-serif`
    : `400 ${fontSize(e) * scale}px "Source Sans 3", system-ui, sans-serif`;

const ROUGHNESS = 1.3;

function roughOptions(e: CroquisElement): Options {
  const o: Options = {
    seed: e.seed,
    stroke: e.color,
    strokeWidth: e.sw,
    roughness: e.rough ? ROUGHNESS : 0,
    bowing: e.rough ? 1 : 0,
    disableMultiStroke: !e.rough,
    disableMultiStrokeFill: !e.rough,
  };
  if (e.fill !== 'none' && (e.type === 'rect' || e.type === 'ellipse')) {
    o.fill = e.color;
    o.fillStyle = e.fill;
    o.hachureAngle = e.angle;
    o.hachureGap = e.gap;
    o.fillWeight = Math.max(0.7, e.sw * 0.45);
  }
  return o;
}

/**
 * Formes Rough.js d'un élément, dans l'espace « écran à la création » : les
 * coordonnées sont divisées par `k`, et le tracé est dessiné avec `scale(k, k)`.
 * Trait, hachures et amplitude du tremblé gardent ainsi leur taille à l'écran.
 */
function drawablesFor(r: CroquisRenderer, e: CroquisElement): Drawable[] {
  const cached = r.cache.get(e);
  if (cached) return cached;
  const g = r.rc.generator;
  const o = roughOptions(e);
  const a = e.x1 / e.k;
  const b = e.y1 / e.k;
  const c = e.x2 / e.k;
  const d = e.y2 / e.k;
  let out: Drawable[] = [];
  if (e.type === 'rect') {
    out = [g.rectangle(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b), o)];
  } else if (e.type === 'ellipse') {
    out = [g.ellipse((a + c) / 2, (b + d) / 2, Math.abs(c - a), Math.abs(d - b), o)];
  } else if (e.type === 'line') {
    out = [g.line(a, b, c, d, o)];
  } else if (e.type === 'arrow') {
    const length = Math.hypot(c - a, d - b);
    const head = Math.min(16, length * 0.4);
    const angle = Math.atan2(d - b, c - a);
    out = [g.line(a, b, c, d, o)];
    if (length > 2) {
      for (const t of [0.45, -0.45]) {
        out.push(g.line(c, d, c - head * Math.cos(angle + t), d - head * Math.sin(angle + t), o));
      }
    }
  }
  r.cache.set(e, out);
  return out;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();

/** Largeur réelle d'un texte, en unités monde. `undefined` hors navigateur : l'appelant retombe sur l'estimation. */
export function measureTextWidth(e: CroquisElement): number | undefined {
  if (e.type !== 'text' || !e.text) return undefined;
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!measureCtx) return undefined;
  const font = fontOf(e);
  const key = `${font}|${e.text}`;
  const known = widthCache.get(key);
  if (known !== undefined) return known;
  measureCtx.font = font;
  const width = measureCtx.measureText(e.text).width;
  if (widthCache.size > 500) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

export function drawElement(ctx: CanvasRenderingContext2D, r: CroquisRenderer, e: CroquisElement): void {
  if (e.type === 'pen') {
    const p = e.pts;
    if (!p || !p.length) return;
    ctx.save();
    ctx.strokeStyle = e.color;
    ctx.fillStyle = e.color;
    ctx.lineWidth = e.sw * e.k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (p.length < 3) {
      ctx.arc(p[0][0], p[0][1], (e.sw * e.k) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++) {
        ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      }
      ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (e.type === 'text') {
    if (!e.text) return;
    ctx.save();
    ctx.font = fontOf(e);
    ctx.fillStyle = e.color;
    ctx.textBaseline = 'top';
    ctx.fillText(e.text, e.x1, e.y1);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.scale(e.k, e.k);
  for (const d of drawablesFor(r, e)) r.rc.draw(d);
  ctx.restore();
}

export interface FrameOptions {
  dpr: number;
  view: ViewState;
  elements: readonly CroquisElement[];
  /** Élément en cours de tracé, dessiné par-dessus les autres. */
  extra?: CroquisElement | null;
  background: CroquisBackground | null;
  bgOpacity: number;
  selectedId?: string | null;
}

/** Dessine une image complète de l'éditeur : fond blanc, fond importé, éléments, sélection. */
export function drawFrame(r: CroquisRenderer, canvas: HTMLCanvasElement, o: FrameOptions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(o.dpr * o.view.zoom, 0, 0, o.dpr * o.view.zoom, o.dpr * o.view.panX, o.dpr * o.view.panY);
  if (o.background) {
    ctx.globalAlpha = o.bgOpacity;
    ctx.drawImage(o.background.image, 0, 0, o.background.width, o.background.height);
    ctx.globalAlpha = 1;
  }
  for (const e of o.elements) drawElement(ctx, r, e);
  if (o.extra) drawElement(ctx, r, o.extra);
  const selected = o.selectedId ? o.elements.find((e) => e.id === o.selectedId) : undefined;
  if (selected) drawSelection(ctx, selected, o.view.zoom);
}

function drawSelection(ctx: CanvasRenderingContext2D, e: CroquisElement, zoom: number): void {
  const b = elementBBox(e, measureTextWidth(e));
  const u = 1 / zoom;
  const m = 5 * u;
  ctx.save();
  ctx.strokeStyle = '#77777a';
  ctx.lineWidth = u;
  ctx.setLineDash([4 * u, 3 * u]);
  ctx.strokeRect(b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 1.3 * u;
  for (const h of elementHandles(e)) {
    ctx.beginPath();
    ctx.rect(h.x - 4.5 * u, h.y - 4.5 * u, 9 * u, 9 * u);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export interface StaticRenderOptions {
  elements: readonly CroquisElement[];
  background: CroquisBackground | null;
  bgOpacity: number;
  /** Plus grand côté de l'image produite, en pixels. */
  maxSide?: number;
  pad?: number;
}

/**
 * Image fixe du croquis entier, sans poignées de sélection : export PNG de la
 * vue et aperçu inséré dans les comptes-rendus. `null` si rien n'est à dessiner.
 */
export function renderSceneToCanvas(o: StaticRenderOptions): HTMLCanvasElement | null {
  const bgBounds = o.background ? { x: 0, y: 0, w: o.background.width, h: o.background.height } : null;
  const bounds = unionBBox(bgBounds, sceneBBox(o.elements));
  if (!bounds) return null;
  const frame = exportFrame(bounds, o.maxSide, o.pad);
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const r = createRenderer(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(...frame.transform);
  if (o.background) {
    ctx.globalAlpha = o.bgOpacity;
    ctx.drawImage(o.background.image, 0, 0, o.background.width, o.background.height);
    ctx.globalAlpha = 1;
  }
  for (const e of o.elements) drawElement(ctx, r, e);
  return canvas;
}
