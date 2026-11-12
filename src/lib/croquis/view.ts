// Mathématiques de la vue d'un croquis : zoom, déplacement, cadrage et cadre
// d'export. Fonctions pures (aucun DOM), testées dans
// src/lib/__tests__/croquisView.test.ts.
//
// Repères : « monde » = coordonnées du croquis ; « écran » = pixels CSS du canvas.
//   écran = monde × zoom + pan
import type { CroquisBBox } from '../../types/croquis';

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 8;
/** Au cadrage, on ne grossit pas au-delà de 150 % (un petit croquis ne doit pas être agrandi à l'excès). */
export const MAX_FIT_ZOOM = 1.5;

export const DEFAULT_VIEW: ViewState = { zoom: 1, panX: 0, panY: 0 };

export const toWorld = (v: ViewState, sx: number, sy: number): Point => ({
  x: (sx - v.panX) / v.zoom,
  y: (sy - v.panY) / v.zoom,
});

export const toScreen = (v: ViewState, x: number, y: number): Point => ({
  x: x * v.zoom + v.panX,
  y: y * v.zoom + v.panY,
});

const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zoome d'un facteur autour du point d'écran (sx, sy), qui reste fixe sous le doigt ou le curseur. */
export function zoomAt(v: ViewState, sx: number, sy: number, factor: number): ViewState {
  const zoom = clampZoom(v.zoom * factor);
  const ratio = zoom / v.zoom;
  return { zoom, panX: sx - (sx - v.panX) * ratio, panY: sy - (sy - v.panY) * ratio };
}

export const panBy = (v: ViewState, dx: number, dy: number): ViewState => ({
  ...v,
  panX: v.panX + dx,
  panY: v.panY + dy,
});

/** État d'un geste à deux doigts : distance entre les doigts et leur milieu, en pixels d'écran. */
export interface PinchMetrics {
  d: number;
  mx: number;
  my: number;
}

export function pinchMetrics(a: { sx: number; sy: number }, b: { sx: number; sy: number }): PinchMetrics {
  return { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
}

/** Applique un pas de geste à deux doigts : le milieu déplace la vue, l'écart des doigts la zoome. */
export function pinchView(v: ViewState, prev: PinchMetrics, next: PinchMetrics): ViewState {
  const moved = panBy(v, next.mx - prev.mx, next.my - prev.my);
  return prev.d > 0 && next.d > 0 ? zoomAt(moved, next.mx, next.my, next.d / prev.d) : moved;
}

export interface FitInsets {
  top: number;
  bottom: number;
  /** Largeur occupée à gauche (panneau ouvert sur grand écran). */
  left: number;
  /** Marge de chaque côté. */
  pad: number;
}

/** Cadre `bounds` dans la zone visible, centré. Sans contenu : vue par défaut. */
export function fitView(bounds: CroquisBBox | null, viewport: { w: number; h: number }, insets: FitInsets): ViewState {
  if (!bounds) return DEFAULT_VIEW;
  const availW = Math.max(1, viewport.w - insets.left - insets.pad * 2);
  const availH = Math.max(1, viewport.h - insets.top - insets.bottom);
  const zoom = clampZoom(Math.min(MAX_FIT_ZOOM, availW / bounds.w, availH / bounds.h));
  return {
    zoom,
    panX: insets.left + (viewport.w - insets.left - bounds.w * zoom) / 2 - bounds.x * zoom,
    panY: insets.top + (availH - bounds.h * zoom) / 2 - bounds.y * zoom,
  };
}

export const formatZoom = (zoom: number): string => `${Math.round(zoom * 100)} %`;

export function unionBBox(a: CroquisBBox | null, b: CroquisBBox | null): CroquisBBox | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export interface ExportFrame {
  width: number;
  height: number;
  /** Transformation canvas [a, b, c, d, e, f] qui place le monde dans l'image. */
  transform: [number, number, number, number, number, number];
}

/**
 * Cadre d'une image exportée : `bounds` plus une marge, ramené à `maxSide`
 * pixels sur le grand côté (jamais agrandi au-delà de 2×).
 */
export function exportFrame(bounds: CroquisBBox, maxSide = 1600, pad = 24): ExportFrame {
  const worldW = bounds.w + pad * 2;
  const worldH = bounds.h + pad * 2;
  const scale = Math.min(2, maxSide / Math.max(worldW, worldH));
  return {
    width: Math.max(1, Math.round(worldW * scale)),
    height: Math.max(1, Math.round(worldH * scale)),
    transform: [scale, 0, 0, scale, (pad - bounds.x) * scale, (pad - bounds.y) * scale],
  };
}
