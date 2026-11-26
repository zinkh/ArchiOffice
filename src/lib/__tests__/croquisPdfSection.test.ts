import { describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import type { CroquisExportItem } from '../croquis/exportLayout';
import { drawCroquisSection, type CroquisSectionLayout } from '../croquis/pdfSection';

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const item = (id: string, width = 1400, height = 1050): CroquisExportItem => ({
  id, title: `Croquis ${id}`, dataUrl: PNG_1X1, bytes: new Uint8Array(), width, height, mime: 'image/png',
});

function setup(overrides: Partial<CroquisSectionLayout> = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const addImage = vi.spyOn(doc, 'addImage');
  const newPage = vi.fn(() => { doc.addPage('a4'); return 18; });
  const drawHeading = vi.fn((y: number) => { doc.text('Croquis', 18, y); return y + 6; });
  const layout: CroquisSectionLayout = {
    x: 18, y: 40, contentW: 174, bottomLimit: 287, topOfNewPage: 18, newPage, drawHeading, headingHeight: 8, ...overrides,
  };
  return { doc, addImage, newPage, drawHeading, layout };
}

describe('drawCroquisSection', () => {
  it('ne dessine rien sans croquis et rend la position reçue', () => {
    const { doc, layout, drawHeading, addImage } = setup();
    expect(drawCroquisSection(doc, [], layout)).toBe(40);
    expect(drawHeading).not.toHaveBeenCalled();
    expect(addImage).not.toHaveBeenCalled();
  });

  it('dessine le titre de section une seule fois, puis chaque image dans la largeur utile', () => {
    const { doc, layout, drawHeading, addImage } = setup();
    const end = drawCroquisSection(doc, [item('a'), item('b')], layout);
    expect(drawHeading).toHaveBeenCalledTimes(1);
    expect(addImage).toHaveBeenCalledTimes(2);
    for (const call of addImage.mock.calls) {
      const [, format, x, , w, h] = call as unknown as [string, string, number, number, number, number];
      expect(format).toBe('PNG');
      expect(x).toBe(18);
      expect(w).toBeLessThanOrEqual(174);
      expect(h).toBeLessThanOrEqual(135);
    }
    expect(end).toBeGreaterThan(40);
  });

  it('change de page quand le croquis suivant ne tient plus, sans dépasser le bas de page', () => {
    const { doc, layout, newPage, addImage } = setup();
    drawCroquisSection(doc, [item('a'), item('b'), item('c'), item('d')], layout);
    expect(newPage).toHaveBeenCalled();
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    for (const call of addImage.mock.calls) {
      const [, , , y, , h] = call as unknown as [string, string, number, number, number, number];
      expect(y + h).toBeLessThanOrEqual(287 + 0.001);
    }
  });

  it('ne laisse pas le titre de section seul en bas de page', () => {
    const { doc, layout, newPage, drawHeading } = setup({ y: 280 });
    drawCroquisSection(doc, [item('a')], layout);
    expect(newPage).toHaveBeenCalledTimes(1);
    expect(drawHeading).toHaveBeenCalledWith(18);
  });

  it('borne la hauteur d\'une image à la place disponible sur une page neuve', () => {
    const { doc, layout, addImage } = setup({ topOfNewPage: 30, bottomLimit: 120, maxImageHeight: 500, y: 30 });
    drawCroquisSection(doc, [item('a', 600, 1800)], layout);
    const [, , , , , h] = addImage.mock.calls[0] as unknown as [string, string, number, number, number, number];
    expect(h).toBeLessThanOrEqual(120 - 30 - 8 - 6 - 8);
  });

  it('écrit le format JPEG pour une image JPEG', () => {
    const { doc, layout, addImage } = setup();
    drawCroquisSection(doc, [{ ...item('a'), mime: 'image/jpeg' }], layout);
    expect((addImage.mock.calls[0] as unknown as [string, string])[1]).toBe('JPEG');
  });

  it('ignore une image de dimensions nulles et ne s\'arrête pas sur une image illisible', () => {
    const { doc, layout, addImage } = setup();
    addImage.mockImplementationOnce(() => { throw new Error('illisible'); });
    expect(() => drawCroquisSection(doc, [item('a'), item('vide', 0, 0), item('b')], layout)).not.toThrow();
    expect(addImage).toHaveBeenCalledTimes(2);
  });
});
