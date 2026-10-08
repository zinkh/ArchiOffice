import { describe, expect, it } from 'vitest';
import { extraireMontants, parseMontantFr } from '../depotMontants';

describe('parseMontantFr', () => {
  it.each([
    ['12 345,50', 12345.5],
    ['12 345,50', 12345.5],
    ['12 345,50', 12345.5],
    ['12.345,50', 12345.5],
    ['12,345.50', 12345.5],
    ['12345.5', 12345.5],
    ['12345', 12345],
    ['1 234', 1234],
    ['12.345', 12345],
    ['0,99', 0.99],
    ['1 000 000', 1000000],
  ])('lit %s', (brut, attendu) => {
    expect(parseMontantFr(brut)).toBe(attendu);
  });

  it.each(['', 'abc', '0', '-5', '12a', '1e9999', '99999999999'])('refuse %s', (brut) => {
    expect(parseMontantFr(brut)).toBeNull();
  });
});

describe('extraireMontants', () => {
  const devis = [
    'DEVIS N° 2026-118 du 03/09/2026',
    'Charpente bois lamellé collé      quantité 38 m3 à 640,00 € le m3   24 320,00 €',
    'Couverture zinc                                           11 880,00 €',
    'Total HT                                                  36 200,00 €',
    'TVA 20 %                                                   7 240,00 €',
    'Total TTC                                                 43 440,00 €',
    'Acompte de 30 % à la commande : 10 860,00 €',
  ].join('\n');

  it('classe le total HT en premier', () => {
    const r = extraireMontants(devis);
    expect(r[0]).toMatchObject({ montant: 36200, nature: 'total_ht' });
    expect(r[0].contexte).toContain('Total HT');
  });

  it('range le TTC après le HT et ignore la ligne de TVA', () => {
    const r = extraireMontants(devis);
    const natures = r.map(c => c.nature);
    expect(natures.indexOf('ttc')).toBeGreaterThan(natures.indexOf('total_ht'));
    expect(r.find(c => c.montant === 7240)).toBeUndefined();
  });

  it('ne retient pas les quantités ni les dates', () => {
    const r = extraireMontants(devis);
    expect(r.find(c => c.montant === 38 || c.montant === 2026)).toBeUndefined();
  });

  it('dédoublonne une valeur répétée en gardant la mention la plus parlante', () => {
    const r = extraireMontants('Sous-total 5 000,00 €\nMontant total HT : 5 000,00 €');
    expect(r.filter(c => c.montant === 5000)).toHaveLength(1);
    expect(r[0].nature).toBe('total_ht');
  });

  it('reconnaît « prix global HT » et « offre HT »', () => {
    expect(extraireMontants('Prix global HT : 8 400 €')[0].nature).toBe('total_ht');
    expect(extraireMontants('Notre offre HT 9 100,00 euros')[0]).toMatchObject({ montant: 9100, nature: 'total_ht' });
  });

  it('rend une liste vide sans montant en euros', () => {
    expect(extraireMontants('Bonjour,\nVeuillez trouver ci-joint notre mémoire technique.')).toEqual([]);
  });

  it('borne le nombre de candidats', () => {
    const texte = Array.from({ length: 40 }, (_, i) => `Poste ${i} ${100 + i},00 €`).join('\n');
    expect(extraireMontants(texte).length).toBeLessThanOrEqual(12);
  });
});
