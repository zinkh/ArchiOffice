import { describe, expect, it } from 'vitest';
import { champsDepuisPdf } from '../actEngagementImport';
import { genererActeFormulaire, lireActeFormulaire, nombreFrancais, nomChamp } from '../actEngagementForm';
import type { ContexteMarche } from '../actMarche';

const ctx: ContexteMarche = {
  operation: { nom: 'Villa Martin', code: '26014', adresse: '1 rue des Lilas, Nancy' },
  params: { moa_nom: 'M. Martin', nature_travaux: 'la construction d\'une maison' },
  agence: {},
};
const lots = [{ numero: '01', titre: 'Gros œuvre' }, { numero: '02', titre: 'Charpente' }];

describe('acte d\'engagement : formulaire', () => {
  it('lit les nombres saisis à la française', () => {
    expect(nombreFrancais('12 500,50 €')).toBe(12500.5);
    expect(nombreFrancais('abc')).toBeNull();
    expect(nombreFrancais('')).toBeNull();
  });

  it('interprète un formulaire rempli et signale les anomalies sans les corriger', () => {
    const r = lireActeFormulaire({
      [nomChamp.entreprise('entreprise')]: 'Bati SAS', [nomChamp.entreprise('siret')]: '123',
      [nomChamp.tva]: '20',
      [nomChamp.lotCandidat('01')]: true, [nomChamp.lotPrix('01')]: '48 000,00', [nomChamp.lotDelai('01')]: '3',
      [nomChamp.lotCandidat('02')]: false, [nomChamp.lotPrix('02')]: '',
      ae_lot_99_prix_ht: '1',
    }, lots);
    expect(r.lots[0]).toMatchObject({ numero: '01', candidat: true, prixHT: 48000, delaiMois: 3 });
    expect(r.lots[1]).toMatchObject({ candidat: false, prixHT: null });
    expect(r.avertissements.join('\n')).toContain('SIRET ne comporte pas 14 chiffres');
    expect(r.avertissements.join('\n')).toContain('« 99 »');
  });

  it('un lot chiffré mais non coché est retenu avec un avertissement', () => {
    const r = lireActeFormulaire({ [nomChamp.lotCandidat('01')]: false, [nomChamp.lotPrix('01')]: '100', [nomChamp.lotCandidat('02')]: false }, lots);
    expect(r.lots[0].candidat).toBe(true);
    expect(r.avertissements.join('\n')).toContain('pas coché');
  });

  it('un PDF généré, rempli puis relu redonne les mêmes valeurs', async () => {
    const data = await genererActeFormulaire(ctx, lots, 20, {}, {
      [nomChamp.entreprise('entreprise')]: 'Bati SAS',
      [nomChamp.entreprise('siret')]: '123 456 789 00012',
      [nomChamp.lotCandidat('01')]: true, [nomChamp.lotPrix('01')]: '48 000,00', [nomChamp.lotDelai('01')]: '3',
    });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const champs = await champsDepuisPdf(data, pdfjs as never);
    const r = lireActeFormulaire(champs, lots);
    expect(r.entreprise.entreprise).toBe('Bati SAS');
    expect(r.tvaPct).toBe(20);
    expect(r.lots[0]).toMatchObject({ candidat: true, prixHT: 48000, delaiMois: 3 });
    expect(r.lots[1].candidat).toBe(false);
  });

  it('refuse un PDF qui n\'est pas un acte ArchiOffice', async () => {
    const { jsPDF } = await import('jspdf');
    const autre = new jsPDF().output('arraybuffer');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    await expect(champsDepuisPdf(autre, pdfjs as never)).rejects.toThrow('pas un acte d\'engagement');
  });
});
