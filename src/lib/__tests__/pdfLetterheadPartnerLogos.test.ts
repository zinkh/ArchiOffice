import { describe, it, expect, vi } from 'vitest';
import {
  drawAgencyHeader, loadCotraitantLogos, loadCotraitantIdentities, identityFromContact, type LogoImage,
} from '../pdfLetterhead';

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

describe('identityFromContact', () => {
  it('met la raison sociale en titre et la personne en sous-titre', () => {
    const identite = identityFromContact({
      id: 'c1', first_name: 'Anne', last_name: 'Durand', company_name: 'BET Durand', job_title: 'Gérante',
      email_work: 'a@bet.fr', email: 'perso@x.fr',
      phone_work: '0383000000', phone: '0600000000',
      address_work_street: '1 rue X', address_work_zip: '54000', address_work_city: 'Nancy',
      siret: ' 12345678900012 ',
    });
    expect(identite).toEqual({
      contactId: 'c1', titre: 'BET Durand', sousTitre: 'Anne Durand, Gérante',
      adresse: '1 rue X, 54000 Nancy', telephone: '0383000000', email: 'a@bet.fr', siret: '12345678900012',
    });
  });

  it("prend la personne pour titre quand il n'y a pas de société", () => {
    const identite = identityFromContact({ id: 'c2', first_name: 'Paul', last_name: 'Martin', email: 'p@m.fr' });
    expect(identite.titre).toBe('Paul Martin');
    expect(identite.sousTitre).toBe('');
    expect(identite.email).toBe('p@m.fr');
  });

  it('retombe sur les champs génériques et laisse vide ce qui manque', () => {
    const identite = identityFromContact({ id: 'c3', company_name: 'Acoustique SA', address: '2 av Y', zip: '75001', city: 'Paris', phone: '0100000000' });
    expect(identite.adresse).toBe('2 av Y, 75001 Paris');
    expect(identite.telephone).toBe('0100000000');
    expect(identite.siret).toBe('');
    expect(identite.email).toBe('');
  });

  it("n'imprime pas de virgule orpheline quand seule la ville est connue", () => {
    expect(identityFromContact({ id: 'c4', company_name: 'X', city: 'Metz' }).adresse).toBe('Metz');
  });
});

describe('loadCotraitantIdentities', () => {
  it('ne contacte pas le serveur sans cotraitant rattaché à une fiche', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await loadCotraitantIdentities([{}, { contact_id: undefined }])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rend une liste vide si la lecture des contacts échoue', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('réseau'));
    expect(await loadCotraitantIdentities([{ contact_id: 'c1' }])).toEqual([]);
    spy.mockRestore();
  });

  it("garde l'ordre du groupement, sans doublon, et ignore une fiche introuvable", async () => {
    const contacts = [
      { id: 'a', company_name: 'Alpha' },
      { id: 'b', company_name: 'Beta' },
    ];
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      { ok: true, json: async () => contacts } as unknown as Response,
    );
    const identites = await loadCotraitantIdentities([
      { contact_id: 'b' }, { contact_id: 'inconnu' }, { contact_id: 'a' }, { contact_id: 'b' },
    ]);
    expect(identites.map(i => i.titre)).toEqual(['Beta', 'Alpha']);
    expect(identites.every(i => i.logo === null)).toBe(true);
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

describe('en-tête des pages suivantes', () => {
  const pdfPage = (page: number) => ({
    ...fakePdf(),
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 }, getCurrentPageInfo: () => ({ pageNumber: page }) },
    getTextWidth: () => 30,
    splitTextToSize: (t: string) => [t],
  });

  it('ne dessine jamais le logo ni le bandeau des cotraitants au-delà de la première page', () => {
    const pdf = pdfPage(2);
    const y = drawAgencyHeader(pdf, { agencyName: 'AAZS' }, { title: 'DPGF', logo: logo(200, 100), partnerLogos: [logo(100, 100)] });
    expect(pdf.addImage).not.toHaveBeenCalled();
    expect(y).toBeLessThan(20);
  });

  it('tient sur une ligne : agence à gauche, document à droite', () => {
    const pdf = pdfPage(3);
    drawAgencyHeader(pdf, { agencyName: 'AAZS', address: '23 Bd de l\'Europe' }, { title: 'DPGF', subtitle: 'Villa' });
    const textes = pdf.text.mock.calls.map(c => c[0]);
    expect(textes).toEqual(['AAZS', 'DPGF  |  Villa']);
    expect(pdf.text.mock.calls[1][3]).toEqual({ align: 'right' });
    expect(pdf.text.mock.calls[0][2]).toBe(pdf.text.mock.calls[1][2]);
  });

  it('garde le logo sur la première page', () => {
    const pdf = pdfPage(1);
    drawAgencyHeader(pdf, { agencyName: 'AAZS' }, { title: 'DPGF', logo: logo(200, 100) });
    expect(pdf.addImage).toHaveBeenCalledTimes(1);
  });
});
