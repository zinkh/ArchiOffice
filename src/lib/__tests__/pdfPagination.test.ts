import { describe, it, expect } from 'vitest';
import {
  pageShiftMm, pageCountForHeight,
  PAGE_HEIGHT_MM, CONTENT_TOP_MM, CONTENT_BOTTOM_MM, HEADING_KEEP_MM,
} from '../pdfPagination';

const WINDOW_BOTTOM = PAGE_HEIGHT_MM - CONTENT_BOTTOM_MM; // 277
const NEXT_WINDOW_TOP = PAGE_HEIGHT_MM + CONTENT_TOP_MM; // 323

describe('pageShiftMm', () => {
  it('laisse en place un bloc qui tient dans la fenêtre', () => {
    expect(pageShiftMm(40, 20)).toBe(0);
    expect(pageShiftMm(CONTENT_TOP_MM, WINDOW_BOTTOM - CONTENT_TOP_MM)).toBe(0);
  });

  it('repousse en haut de la page suivante un bloc qui dépasse le bas de la fenêtre', () => {
    const top = 260;
    expect(pageShiftMm(top, 30)).toBeCloseTo(NEXT_WINDOW_TOP - top);
  });

  it('repousse un bloc qui commence dans la bande du pied de page', () => {
    expect(pageShiftMm(280, 5)).toBeCloseTo(NEXT_WINDOW_TOP - 280);
  });

  it("descend un bloc qui commence dans la bande de l'en-tête", () => {
    const top = PAGE_HEIGHT_MM + 5;
    expect(pageShiftMm(top, 10)).toBeCloseTo(CONTENT_TOP_MM + PAGE_HEIGHT_MM - top);
  });

  it('applique la même règle sur les pages suivantes', () => {
    const page3Top = 2 * PAGE_HEIGHT_MM + 250;
    expect(pageShiftMm(page3Top, 40)).toBeCloseTo(3 * PAGE_HEIGHT_MM + CONTENT_TOP_MM - page3Top);
  });

  it("ne déplace pas un bloc plus haut qu'une fenêtre entière qui commence dans la fenêtre", () => {
    expect(pageShiftMm(60, 400)).toBe(0);
  });

  it("garde la place d'un titre avec ce qui le suit", () => {
    const top = WINDOW_BOTTOM - 10; // le titre seul (6 mm) tiendrait, pas avec la suite
    expect(pageShiftMm(top, 6)).toBe(0);
    expect(pageShiftMm(top, 6, { keepExtent: HEADING_KEEP_MM })).toBeCloseTo(NEXT_WINDOW_TOP - top);
  });

  describe('début de section (newPage)', () => {
    it('ne bouge pas un bloc déjà en haut de la fenêtre', () => {
      expect(pageShiftMm(CONTENT_TOP_MM, 10, { newPage: true })).toBe(0);
      expect(pageShiftMm(PAGE_HEIGHT_MM + CONTENT_TOP_MM, 10, { newPage: true })).toBe(0);
    });

    it('pose un bloc en milieu de page en haut de la page suivante', () => {
      expect(pageShiftMm(100, 10, { newPage: true })).toBeCloseTo(NEXT_WINDOW_TOP - 100);
    });

    it("descend un bloc placé dans la bande d'en-tête au haut de cette même page", () => {
      const top = PAGE_HEIGHT_MM + 3;
      expect(pageShiftMm(top, 10, { newPage: true })).toBeCloseTo(PAGE_HEIGHT_MM + CONTENT_TOP_MM - top);
    });
  });
});

describe('pageCountForHeight', () => {
  it('compte une page pour un document qui tient dans une page', () => {
    expect(pageCountForHeight(10)).toBe(1);
    expect(pageCountForHeight(PAGE_HEIGHT_MM)).toBe(1);
  });

  it('ouvre une page dès que le contenu la dépasse vraiment', () => {
    expect(pageCountForHeight(PAGE_HEIGHT_MM + 5)).toBe(2);
    expect(pageCountForHeight(3 * PAGE_HEIGHT_MM)).toBe(3);
  });

  it("ne crée pas de page blanche pour un arrondi de mesure", () => {
    expect(pageCountForHeight(2 * PAGE_HEIGHT_MM + 0.1)).toBe(2);
  });
});
