import { describe, expect, it } from 'vitest';
import { BACKGROUND_MAX_SIDE, fitSize } from '../croquis/background';
import {
  DEFAULT_VIEW,
  MAX_FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  exportFrame,
  fitView,
  formatZoom,
  panBy,
  pinchMetrics,
  pinchView,
  toScreen,
  toWorld,
  unionBBox,
  zoomAt,
} from '../croquis/view';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('conversion écran et monde', () => {
  it('se retrouve en faisant l\'aller-retour', () => {
    const v = { zoom: 2.5, panX: -40, panY: 18 };
    const w = toWorld(v, 300, 120);
    const s = toScreen(v, w.x, w.y);
    close(s.x, 300);
    close(s.y, 120);
  });
});

describe('zoomAt', () => {
  it('garde fixe le point du monde sous le curseur', () => {
    const v = { zoom: 1, panX: 30, panY: 10 };
    const before = toWorld(v, 200, 150);
    const after = zoomAt(v, 200, 150, 3);
    const same = toWorld(after, 200, 150);
    close(same.x, before.x);
    close(same.y, before.y);
    close(after.zoom, 3);
  });

  it('borne le zoom', () => {
    expect(zoomAt(DEFAULT_VIEW, 0, 0, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(DEFAULT_VIEW, 0, 0, 0.00001).zoom).toBe(MIN_ZOOM);
  });

  it('ne déplace pas la vue quand le zoom est déjà au maximum', () => {
    const v = { zoom: MAX_ZOOM, panX: 12, panY: 34 };
    expect(zoomAt(v, 100, 100, 2)).toEqual(v);
  });
});

describe('déplacement à deux doigts', () => {
  it('translate la vue avec le milieu des doigts', () => {
    const prev = pinchMetrics({ sx: 100, sy: 100 }, { sx: 200, sy: 100 });
    const next = pinchMetrics({ sx: 110, sy: 130 }, { sx: 210, sy: 130 });
    const v = pinchView(DEFAULT_VIEW, prev, next);
    close(v.panX, 10);
    close(v.panY, 30);
    close(v.zoom, 1);
  });

  it('zoome selon l\'écart des doigts', () => {
    const prev = pinchMetrics({ sx: 100, sy: 100 }, { sx: 200, sy: 100 });
    const next = pinchMetrics({ sx: 50, sy: 100 }, { sx: 250, sy: 100 });
    expect(pinchView(DEFAULT_VIEW, prev, next).zoom).toBeCloseTo(2, 6);
  });

  it('ne zoome pas quand les doigts sont superposés', () => {
    const prev = pinchMetrics({ sx: 100, sy: 100 }, { sx: 100, sy: 100 });
    const next = pinchMetrics({ sx: 100, sy: 100 }, { sx: 200, sy: 100 });
    expect(pinchView(DEFAULT_VIEW, prev, next).zoom).toBe(1);
  });

  it('panBy ne modifie pas la vue reçue', () => {
    const v = { zoom: 1, panX: 0, panY: 0 };
    panBy(v, 5, 5);
    expect(v).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });
});

describe('fitView', () => {
  const insets = { top: 64, bottom: 74, left: 0, pad: 16 };

  it('renvoie la vue par défaut sans contenu', () => {
    expect(fitView(null, { w: 800, h: 600 }, insets)).toEqual(DEFAULT_VIEW);
  });

  it('centre le contenu dans la zone visible', () => {
    const v = fitView({ x: 0, y: 0, w: 400, h: 200 }, { w: 800, h: 600 }, insets);
    const a = toScreen(v, 0, 0);
    const b = toScreen(v, 400, 200);
    close((a.x + b.x) / 2, 400);
    close((a.y + b.y) / 2, 64 + (600 - 64 - 74) / 2);
  });

  it('ne grossit pas un petit croquis au-delà du plafond', () => {
    expect(fitView({ x: 0, y: 0, w: 10, h: 10 }, { w: 800, h: 600 }, insets).zoom).toBe(MAX_FIT_ZOOM);
  });

  it('réduit un grand plan pour qu\'il tienne', () => {
    const v = fitView({ x: 0, y: 0, w: 2600, h: 1800 }, { w: 800, h: 600 }, insets);
    expect(v.zoom).toBeLessThan(0.4);
    const b = toScreen(v, 2600, 1800);
    expect(b.x).toBeLessThanOrEqual(800);
    expect(b.y).toBeLessThanOrEqual(600 - 74 + 0.001);
  });

  it('laisse la place d\'un panneau ouvert à gauche', () => {
    const v = fitView({ x: 0, y: 0, w: 200, h: 200 }, { w: 1000, h: 600 }, { ...insets, left: 312 });
    expect(toScreen(v, 0, 0).x).toBeGreaterThanOrEqual(312);
  });
});

describe('formatZoom, unionBBox, exportFrame', () => {
  it('affiche le zoom en pourcentage', () => {
    expect(formatZoom(1)).toBe('100 %');
    expect(formatZoom(0.456)).toBe('46 %');
  });

  it('réunit deux boîtes, et en tolère une absente', () => {
    expect(unionBBox(null, null)).toBeNull();
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(unionBBox(a, null)).toBe(a);
    expect(unionBBox(a, { x: 20, y: -5, w: 10, h: 10 })).toEqual({ x: 0, y: -5, w: 30, h: 15 });
  });

  it('cadre l\'export avec une marge et borne le grand côté', () => {
    const f = exportFrame({ x: 100, y: 50, w: 4000, h: 2000 }, 1600, 24);
    expect(Math.max(f.width, f.height)).toBe(1600);
    const [scale, , , , e, ff] = [f.transform[0], f.transform[1], f.transform[2], f.transform[3], f.transform[4], f.transform[5]];
    close(e, (24 - 100) * scale);
    close(ff, (24 - 50) * scale);
  });

  it('n\'agrandit pas un petit croquis au-delà de deux fois', () => {
    const f = exportFrame({ x: 0, y: 0, w: 100, h: 50 }, 1600, 0);
    expect(f.transform[0]).toBe(2);
    expect(f.width).toBe(200);
  });
});

describe('fitSize du fond', () => {
  it('réduit une grande image à 2600 px sur le grand côté', () => {
    expect(fitSize(5200, 2600)).toEqual({ width: BACKGROUND_MAX_SIDE, height: 1300 });
    expect(fitSize(1000, 4000)).toEqual({ width: 650, height: BACKGROUND_MAX_SIDE });
  });

  it('ne agrandit jamais une petite image', () => {
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('ne renvoie jamais une dimension nulle', () => {
    expect(fitSize(10000, 1).height).toBe(1);
    expect(fitSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});
