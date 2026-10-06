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

describe('groupement actif', () => {
  const colonnes = [{ header: 'A', width: 20 }, { header: 'B', width: 20 }];
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it("l'en-tête PDF reprend les logos du groupement actif, et une liste explicite vide les retire", async () => {
    const { setActiveGroupementLogos } = await import('../pdfLetterhead');
    setActiveGroupementLogos([logo(100, 100)]);
    const pdf = fakePdf();
    drawAgencyHeader(pdf, {}, { title: 'Doc' });
    expect(pdf.addImage).toHaveBeenCalledTimes(1);
    const pdf2 = fakePdf();
    drawAgencyHeader(pdf2, {}, { title: 'Doc', partnerLogos: [] });
    expect(pdf2.addImage).not.toHaveBeenCalled();
    setActiveGroupementLogos([]);
  });

  it('la feuille Excel réserve des lignes et pose les logos du groupement', async () => {
    const { ajouterFeuille, nouveauClasseur } = await import('../xlsxLetterhead');
    const wb = await nouveauClasseur();
    const sans = ajouterFeuille(wb, { nom: 'S', settings: {}, title: 'T', colonnes });
    const avec = ajouterFeuille(wb, {
      nom: 'A', settings: {}, title: 'T', colonnes,
      partnerLogos: [{ dataUrl: png, format: 'PNG', width: 1, height: 1 }],
    });
    expect(avec.ws.getImages()).toHaveLength(1);
    expect(sans.ws.getImages()).toHaveLength(0);
    expect(avec.ws.pageSetup.printTitlesRow).not.toBe(sans.ws.pageSetup.printTitlesRow);
    expect(avec.ws.getCell('A5').value).toBe('En groupement avec');
  });
});
