import { describe, it, expect, vi } from 'vitest';
import { drawAgencyHeader, loadCotraitantLogos, type LogoImage } from '../pdfLetterhead';

function fakePdf() {
  return {
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    setFont: vi.fn(), setFontSize: vi.fn(), setTextColor: vi.fn(),
    setDrawColor: vi.fn(), setLineWidth: vi.fn(),
    text: vi.fn(), line: vi.fn(), addImage: vi.fn(),
  };
}

const logo = (width: number, height: number): LogoImage =>
  ({ dataUrl: 'data:image/png;base64,AAAA', format: 'PNG', width, height });

describe('drawAgencyHeader : logos des cotraitants', () => {
  it('ne dessine aucun bandeau sans logo de cotraitant', () => {
    const pdf = fakePdf();
    const sans = drawAgencyHeader(pdf, {}, { title: 'Doc' });
    expect(pdf.addImage).not.toHaveBeenCalled();
    const pdf2 = fakePdf();
    const avec = drawAgencyHeader(pdf2, {}, { title: 'Doc', partnerLogos: [logo(200, 100)] });
    expect(pdf2.addImage).toHaveBeenCalledTimes(1);
    expect(avec).toBeGreaterThan(sans);
  });

  it('conserve le rapport des logos et les place côte à côte', () => {
    const pdf = fakePdf();
    drawAgencyHeader(pdf, {}, { title: 'Doc', partnerLogos: [logo(200, 100), logo(100, 100)] });
    const [, , x1, , w1, h1] = pdf.addImage.mock.calls[0];
    const [, , x2] = pdf.addImage.mock.calls[1];
    expect(w1 / h1).toBeCloseTo(2);
    expect(x2).toBeGreaterThan(x1 + w1);
  });

  it('réduit un logo trop large sans le déformer', () => {
    const pdf = fakePdf();
    drawAgencyHeader(pdf, {}, { title: 'Doc', partnerLogos: [logo(1000, 100)] });
    const [, , , , w, h] = pdf.addImage.mock.calls[0];
    expect(w).toBeLessThanOrEqual(34);
    expect(w / h).toBeCloseTo(10);
  });
});

describe('loadCotraitantLogos', () => {
  it('ne contacte pas le serveur sans cotraitant rattaché à une fiche', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await loadCotraitantLogos([{}, { contact_id: undefined }])).toEqual([]);
    expect(await loadCotraitantLogos(undefined)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rend une liste vide si la lecture des contacts échoue', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('réseau'));
    expect(await loadCotraitantLogos([{ contact_id: 'c1' }])).toEqual([]);
    spy.mockRestore();
  });
});
