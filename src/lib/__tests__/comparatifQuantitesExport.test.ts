import { describe, expect, it } from 'vitest';
import { versComparatif } from '../bpuToAct';
import { comparatifDepuisOffres, type EntrepriseComparee } from '../comparatifPrix';
import { lignesEcartsQuantites } from '../actAnalysisExport';
import type { Lot, OffreDocument } from '../../types/dpgf';

const art = (id: string, numero: string, designation: string, q: number, pu: number) => ({
  id, numero, designation, unite: 'm²', quantite: q, prixUnitaire: pu, prixTotal: q * pu, type: 'ouvrage' as const,
});
const lot = (): Lot => ({
  id: 'lot1', numero: '02', titre: 'Gros œuvre', sousTotal: 0, projectLotId: 'pl2',
  chapitres: [{ id: 'c1', numero: '2.1', titre: 'Fondations', lignes: [art('a1', '2.1.1', 'Terrassement', 100, 20), art('a2', '2.1.2', 'Béton', 10, 100)] }],
});
const offre = (id: string, entrepriseId: string, prix: Record<string, number | null>, extra: Partial<OffreDocument> = {}): OffreDocument => ({
  id, entrepriseId, entrepriseNom: `Ent ${entrepriseId}`, dateReception: '2026-02-01', fichierNom: 'offre.xlsx',
  importedAt: '2026-02-01T10:00:00Z', documentVersion: '1', prix, anomalies: [], statut: 'validee', ...extra,
});
const offres = [
  offre('o1', 'e1', { a1: 20, a2: 100 }),
  offre('o2', 'e2', { a1: 19, a2: 100 }, { quantites: { a1: 80, a2: 12 }, quantitesAcceptees: ['a2'] }),
];
const montant = (base: 'moe' | 'entreprise', article: string, e: string) => {
  const { comparatif } = versComparatif([lot()], offres, base);
  return comparatif[0].articles.find(a => a.id === article)!.prix[e];
};

describe('versement vers le comparatif selon la base de quantités', () => {
  it('base MOE (défaut) : quantités du document, sauf quantité acceptée', () => {
    expect(montant('moe', 'a1', 'e2')).toBe(19 * 100);      // 80 non acceptée : le document compte
    expect(montant('moe', 'a2', 'e2')).toBe(100 * 12);      // 12 acceptée
    expect(montant('moe', 'a1', 'e1')).toBe(20 * 100);
    expect(versComparatif([lot()], offres).comparatif[0].articles.find(a => a.id === 'a1')!.prix.e2).toBe(19 * 100);
  });

  it('base entreprises : les quantités de chaque entreprise', () => {
    expect(montant('entreprise', 'a1', 'e2')).toBe(19 * 80);
    expect(montant('entreprise', 'a2', 'e2')).toBe(100 * 12);
    expect(montant('entreprise', 'a1', 'e1')).toBe(20 * 100); // e1 reprend les quantités du document
  });

  it('le sous-total du lot suit la base', () => {
    const sous = (base: 'moe' | 'entreprise') => versComparatif([lot()], offres, base).comparatif[0].articles.find(a => a.is_subtotal)!.prix;
    expect(sous('moe')).toEqual({ e1: 3000, e2: 1900 + 1200 });
    expect(sous('entreprise')).toEqual({ e1: 3000, e2: 1520 + 1200 });
  });

  it('rapporte les écarts de quantité avec le prix unitaire, acceptée ou non, quelle que soit la base', () => {
    const articles = versComparatif([lot()], offres, 'moe').comparatif[0].articles;
    expect(articles.find(a => a.id === 'a1')!.ecartsQuantites).toEqual({ e2: { quantite: 80, acceptee: false, prixUnitaire: 19 } });
    expect(articles.find(a => a.id === 'a2')!.ecartsQuantites).toEqual({ e2: { quantite: 12, acceptee: true, prixUnitaire: 100 } });
    expect(articles.find(a => a.is_subtotal)).not.toHaveProperty('ecartsQuantites');
  });

  it('une entreprise qui reprend les quantités du document n\'a aucun écart', () => {
    const sans = versComparatif([lot()], [offres[0]]).comparatif[0].articles;
    expect(sans.every(a => !('ecartsQuantites' in a))).toBe(true);
  });

  it('comparatifDepuisOffres transmet la base', () => {
    const entreprises: EntrepriseComparee[] = [
      { id: 'e1', nom: 'Ent e1', mode: 'postes', totalSaisi: 0 }, { id: 'e2', nom: 'Ent e2', mode: 'postes', totalSaisi: 0 },
    ];
    const ent = () => entreprises;
    const moe = comparatifDepuisOffres([lot()], offres, ent);
    const eto = comparatifDepuisOffres([lot()], offres, ent, [], 'entreprise');
    expect(moe[0].articles.find(a => a.is_subtotal)!.prix.e2).toBe(3100);
    expect(eto[0].articles.find(a => a.is_subtotal)!.prix.e2).toBe(2720);
  });
});

describe('table des quantités modifiées de l\'export Excel', () => {
  const lotsProjet = [{ id: 'pl2', lot_number: '02', lot_title: 'Gros œuvre' }, { id: 'pl3', lot_number: '03', lot_title: 'Couverture' }];
  const entreprises = [{ id: 'e1', nom: 'Dupont' }, { id: 'e2', nom: 'Martin' }];
  const comparatif = versComparatif([lot()], offres, 'moe').comparatif;

  it('liste chaque quantité changée, du plus lourd au plus léger en euros', () => {
    const lignes = lignesEcartsQuantites(lotsProjet, comparatif, entreprises);
    expect(lignes.map(l => [l.entreprise, l.code, l.quantiteDocument, l.quantiteEntreprise, l.ecart, l.effet, l.acceptee])).toEqual([
      ['Martin', '2.1.1', 100, 80, -20, -380, false],  // (80 - 100) x 19
      ['Martin', '2.1.2', 10, 12, 2, 200, true],        // (12 - 10) x 100
    ].sort((a, b) => Math.abs(b[5] as number) - Math.abs(a[5] as number)));
    expect(lignes[0]).toMatchObject({ lot: 'Lot 02 - Gros œuvre', unite: 'm²', prixUnitaire: 19 });
  });

  it('ne liste rien sans écart, ni pour un lot absent du comparatif', () => {
    expect(lignesEcartsQuantites(lotsProjet, versComparatif([lot()], [offres[0]]).comparatif, entreprises)).toEqual([]);
    expect(lignesEcartsQuantites([lotsProjet[1]], comparatif, entreprises)).toEqual([]);
  });

  it('un poste sans prix garde son écart mais sans effet, en dernier', () => {
    const sansPrix = [offre('o3', 'e2', { a1: null, a2: 100 }, { quantites: { a1: 80, a2: 12 } })];
    const lignes = lignesEcartsQuantites(lotsProjet, versComparatif([lot()], sansPrix).comparatif, entreprises);
    expect(lignes.map(l => [l.code, l.effet])).toEqual([['2.1.2', 200], ['2.1.1', null]]);
  });
});
