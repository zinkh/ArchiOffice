import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_SIDE, dataUrlToBytes, exportMime, fitInBox, scaledSize } from '../croquis/exportLayout';

describe('fitInBox', () => {
  it('cadre une image large par la largeur', () => {
    expect(fitInBox(1000, 500, 180, 135)).toEqual({ w: 180, h: 90 });
  });

  it('cadre une image haute par la hauteur', () => {
    expect(fitInBox(500, 1000, 180, 135)).toEqual({ w: 67.5, h: 135 });
  });

  it('conserve le rapport largeur sur hauteur', () => {
    const { w, h } = fitInBox(1400, 1050, 170, 135);
    expect(w / h).toBeCloseTo(1400 / 1050, 10);
    expect(w).toBeLessThanOrEqual(170);
    expect(h).toBeLessThanOrEqual(135);
  });

  it('agrandit une petite image (les unités sont des mm, pas des pixels)', () => {
    const { w } = fitInBox(100, 50, 180, 135);
    expect(w).toBe(180);
  });

  it('rend une boîte nulle pour une dimension nulle ou invalide', () => {
    expect(fitInBox(0, 100, 180, 135)).toEqual({ w: 0, h: 0 });
    expect(fitInBox(100, Number.NaN, 180, 135)).toEqual({ w: 0, h: 0 });
    expect(fitInBox(100, 100, 0, 135)).toEqual({ w: 0, h: 0 });
  });
});

describe('scaledSize', () => {
  it('réduit le grand côté à 1400 px', () => {
    expect(scaledSize(2800, 1400)).toEqual({ width: EXPORT_MAX_SIDE, height: 700 });
    expect(scaledSize(1000, 4000)).toEqual({ width: 350, height: EXPORT_MAX_SIDE });
  });

  it('n\'agrandit jamais une petite image et ne rend jamais zéro', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe('exportMime', () => {
  it('garde le PNG pour un dessin seul et passe en JPEG sous un plan ou une photo', () => {
    expect(exportMime(false)).toBe('image/png');
    expect(exportMime(true)).toBe('image/jpeg');
  });
});

describe('dataUrlToBytes', () => {
  it('décode une image en base64', () => {
    const bytes = dataUrlToBytes('data:image/png;base64,iVBORw0KGgo=');
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('refuse ce qui n\'est pas une image en base64', () => {
    expect(() => dataUrlToBytes('https://exemple.test/x.png')).toThrow();
    expect(() => dataUrlToBytes('data:image/png,abc')).toThrow();
  });
});
