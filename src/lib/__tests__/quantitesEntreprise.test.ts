import { describe, expect, it } from 'vitest';
import {
  construireLotQuantites, ecartsQuantites, quantiteRetenue, quantitesAcceptees, quantitesDifferent, quantitesEntreprise,
  quantitesUtiles, syntheseEcarts, totalLotQuantites,
} from '../quantitesEntreprise';
import { repartirSaisie, type EntrepriseComparee } from '../comparatifPrix';
import type { Lot, OffreDocument } from '../../types/dpgf';

const art = (id: string, numero: string, designation: string, q: number, pu: number, extra: object = {}) => ({
  id, numero, designation, unite: 'm²', quantite: q, prixUnitaire: pu, prixTotal: q * pu, type: 'ouvrage' as const, ...extra,
});
const lot = (): Lot => ({
  id: 'lot1', numero: '02', titre: 'Gros œuvre', sousTotal: 0, projectLotId: 'pl2',
  chapitres: [{
    id: 'c1', numero: '2.1', titre: 'Fondations',
    lignes: [
      art('a1', '2.1.1', 'Terrassement', 100, 20),
      art('a2', '2.1.2', 'Béton', 10, 100),
      art('a3', '2.1.3', 'Option drainage', 50, 10, { nature: 'option' }),
      art('a4', '2.1.4', 'Forfait sans quantité', 0, 500),
    ],
  }],
});
const offre = (id: string, entrepriseId: string, prix: Record<string, number | null>, extra: Partial<OffreDocument> = {}): OffreDocument => ({
  id, entrepriseId, entrepriseNom: `Ent ${entrepriseId}`, dateReception: '2026-02-01', fichierNom: 'offre.xlsx',
  importedAt: '2026-02-01T10:00:00Z', documentVersion: '1', prix, anomalies: [], statut: 'validee', ...extra,
});
const ent = (id: string): EntrepriseComparee => ({ id, nom: `Ent ${id}`, mode: 'postes', totalSaisi: 0 });

describe('comparaison à la virgule près', () => {
  it('signale la moindre différence, pas le bruit des flottants', () => {
    expect(quantitesDifferent(10, 10.01)).toBe(true);
    expect(quantitesDifferent(10, 10.0000001)).toBe(true);
    expect(quantitesDifferent(0.1 + 0.2, 0.3)).toBe(false);
    expect(quantitesDifferent(12, 12)).toBe(false);
  });

  it('ne garde que les quantités qui diffèrent du document, jamais sur un poste sans quantité', () => {
    const moe = new Map([['a1', 100], ['a2', 10], ['a4', 0]]);
    expect(quantitesUtiles({ a1: 100, a2: 12.5, a4: 3, inconnu: 5, a3: null }, moe)).toEqual({ a2: 12.5 });
    expect(quantitesUtiles({ a1: -4, a2: Number.NaN }, moe)).toEqual({});
  });
});

describe('quantités d\'une entreprise', () => {
  it('superpose les offres, la plus récente l\'emporte, une offre écartée est ignorée', () => {
    const offres = [
      offre('o1', 'e1', {}, { quantites: { a1: 90, a2: 11 }, importedAt: '2026-02-01T10:00:00Z' }),
      offre('o2', 'e1', {}, { quantites: { a1: 95 }, importedAt: '2026-02-02T10:00:00Z' }),
      offre('o3', 'e1', {}, { quantites: { a2: 99 }, statut: 'ecartee', importedAt: '2026-02-03T10:00:00Z' }),
      offre('o4', 'e2', {}, { quantites: { a1: 1 } }),
    ];
    expect(quantitesEntreprise(offres, 'e1')).toEqual({ a1: 95, a2: 11 });
  });

  it('une offre plus récente qui redonne une quantité reprend la main sur l\'acceptation précédente', () => {
    const offres = [
      offre('o1', 'e1', {}, { quantites: { a1: 90 }, quantitesAcceptees: ['a1'], importedAt: '2026-02-01T10:00:00Z' }),
      offre('o2', 'e1', {}, { quantites: { a1: 80 }, importedAt: '2026-02-02T10:00:00Z' }),
    ];
    expect([...quantitesAcceptees(offres, 'e1')]).toEqual([]);
    expect([...quantitesAcceptees(offres.slice(0, 1), 'e1')]).toEqual(['a1']);
  });
});

describe('bases de comparaison', () => {
  const acceptees = new Set(['a2']);
  it('MOE : quantité du maître d\'œuvre, sauf quantité acceptée', () => {
    expect(quantiteRetenue('moe', 100, 'a1', { a1: 90 }, acceptees)).toBe(100);
    expect(quantiteRetenue('moe', 10, 'a2', { a2: 12 }, acceptees)).toBe(12);
    expect(quantiteRetenue('moe', 10, 'a2', {}, acceptees)).toBe(10);
  });
  it('entreprise : toutes les quantités de l\'entreprise', () => {
    expect(quantiteRetenue('entreprise', 100, 'a1', { a1: 90 }, new Set())).toBe(90);
    expect(quantiteRetenue('entreprise', 100, 'a1', {}, new Set())).toBe(100);
  });

  it('le total suit la base ; une option reste hors total', () => {
    const prix = { a1: 20, a2: 100, a3: 10 };
    const q = { a1: 90, a2: 12, a3: 99 };
    expect(totalLotQuantites(lot(), prix, [], 'moe', q, new Set())).toBe(100 * 20 + 10 * 100);
    expect(totalLotQuantites(lot(), prix, [], 'moe', q, new Set(['a2']))).toBe(100 * 20 + 12 * 100);
    expect(totalLotQuantites(lot(), prix, [], 'entreprise', q, new Set())).toBe(90 * 20 + 12 * 100);
    expect(totalLotQuantites(lot(), {}, [], 'moe', q, new Set())).toBeNull();
  });
});

describe('écarts de quantité', () => {
  it('classe du plus lourd en euros au plus léger, et ignore un poste sans quantité', () => {
    const prix = { a1: 20, a2: 100, a4: 500 };
    const q = { a1: 90, a2: 12, a4: 3 };
    const ecarts = ecartsQuantites(lot(), prix, q, new Set(['a2']));
    // a1 : -200 €, a2 : +200 € (même poids : départagés par numéro), a4 sans quantité au document : ignoré.
    expect(ecarts.map(e => e.ligneId)).toEqual(['a1', 'a2']);
    expect(ecarts[0]).toMatchObject({ ecart: -10, impact: -200, acceptee: false });
    expect(ecarts[1]).toMatchObject({ quantiteMoe: 10, quantiteEntreprise: 12, ecart: 2, impact: 200, acceptee: true });
  });

  it('un poste sans prix chiffré garde son écart mais sans impact, en dernier', () => {
    const ecarts = ecartsQuantites(lot(), { a2: 100 }, { a1: 90, a2: 12 }, new Set());
    expect(ecarts.map(e => [e.ligneId, e.impact])).toEqual([['a2', 200], ['a1', null]]);
    expect(syntheseEcarts(ecarts)).toEqual({ nombre: 2, acceptees: 0, impactTotal: 200, sansPrix: 1 });
  });

  it('un écart sur une option est signalé mais n\'a pas d\'impact sur le total', () => {
    const [e] = ecartsQuantites(lot(), { a3: 10 }, { a3: 60 }, new Set());
    expect(e).toMatchObject({ ligneId: 'a3', horsBase: true, impact: null });
  });

  it('aucun écart quand l\'entreprise reprend les quantités du document', () => {
    expect(ecartsQuantites(lot(), { a1: 20 }, { a1: 100 }, new Set())).toEqual([]);
  });
});

describe('comparatif d\'un lot selon la base', () => {
  const offres = [
    offre('o1', 'e1', { a1: 20, a2: 100 }),                                  // reprend les quantités du MOE : 3 000
    offre('o2', 'e2', { a1: 19, a2: 100 }, { quantites: { a1: 80 } }),        // moins cher, mais sur 80 m² : 2 520 (entreprise) / 2 900 (MOE)
  ];
  it('base MOE : classement sur les quantités du maître d\'œuvre', () => {
    const d = construireLotQuantites(lot(), offres, [ent('e1'), ent('e2')], 'moe');
    expect(d.totaux).toEqual({ e1: 3000, e2: 2900 });
    expect(d.rangs).toEqual({ e1: 2, e2: 1 });
    expect(d.base).toBe('moe');
  });

  it('base entreprises : classement sur les quantités remises, et les deux totaux restent lisibles', () => {
    const d = construireLotQuantites(lot(), offres, [ent('e1'), ent('e2')], 'entreprise');
    expect(d.totaux).toEqual({ e1: 3000, e2: 2520 });
    expect(d.totauxMoe).toEqual({ e1: 3000, e2: 2900 });
    expect(d.totauxEntreprise).toEqual({ e1: 3000, e2: 2520 });
    expect(d.quantitesParLigne).toEqual({ a1: { e2: 80 } });
    expect(d.ecarts.e1).toEqual([]);
    expect(d.ecarts.e2).toHaveLength(1);
  });

  it('une quantité acceptée entre dans le total de la base MOE', () => {
    const acceptees = [offre('o1', 'e1', { a1: 20, a2: 100 }), offre('o2', 'e2', { a1: 19, a2: 100 }, { quantites: { a1: 80 }, quantitesAcceptees: ['a1'] })];
    const d = construireLotQuantites(lot(), acceptees, [ent('e1'), ent('e2')], 'moe');
    expect(d.totaux.e2).toBe(2520);
    expect(d.ecarts.e2[0].acceptee).toBe(true);
  });

  it('une entreprise saisie au total n\'a ni écart ni total recalculé', () => {
    const d = construireLotQuantites(lot(), offres, [{ id: 'e3', nom: 'Ent e3', mode: 'total', totalSaisi: 5000 }], 'entreprise');
    expect(d.totaux.e3).toBe(5000);
    expect(d.ecarts.e3).toBeUndefined();
  });
});

describe('enregistrement des quantités dans les offres', () => {
  const idsLot = ['a1', 'a2', 'a3', 'a4'];
  it('pose la quantité dans l\'offre qui porte le prix, sans toucher aux autres', () => {
    const offres = [offre('o1', 'e1', { a1: 20 }), offre('o2', 'e1', { a2: 100 }, { importedAt: '2026-02-02T10:00:00Z' })];
    const maj = repartirSaisie(offres, 'e1', 'lot1', idsLot, { a1: 20, a2: 100 }, [], { a2: 12 }, new Set(['a2']));
    expect(maj).toHaveLength(1);
    expect(maj[0]).toMatchObject({ id: 'o2', quantites: { a2: 12 }, quantitesAcceptees: ['a2'] });
  });

  it('retire la quantité (et son acceptation) quand l\'entreprise reprend celle du document', () => {
    const offres = [offre('o1', 'e1', { a1: 20 }, { quantites: { a1: 80 }, quantitesAcceptees: ['a1'] })];
    const maj = repartirSaisie(offres, 'e1', 'lot1', idsLot, { a1: 20 }, [], {}, new Set());
    expect(maj[0]).toMatchObject({ id: 'o1', quantites: {}, quantitesAcceptees: [] });
  });

  it('bascule seulement l\'acceptation, sans rien changer d\'autre', () => {
    const offres = [offre('o1', 'e1', { a1: 20 }, { quantites: { a1: 80 } })];
    const maj = repartirSaisie(offres, 'e1', 'lot1', idsLot, { a1: 20 }, [], { a1: 80 }, new Set(['a1']));
    expect(maj).toHaveLength(1);
    expect(maj[0].quantitesAcceptees).toEqual(['a1']);
    expect(repartirSaisie(offres, 'e1', 'lot1', idsLot, { a1: 20 }, [], { a1: 80 }, new Set())).toEqual([]);
  });

  it('sans quantités fournies, les quantités enregistrées ne sont pas touchées', () => {
    const offres = [offre('o1', 'e1', { a1: 20 }, { quantites: { a1: 80 } })];
    expect(repartirSaisie(offres, 'e1', 'lot1', idsLot, { a1: 20 }, [])).toEqual([]);
    const maj = repartirSaisie(offres, 'e1', 'lot1', idsLot, { a1: 21 }, []);
    expect(maj[0]).not.toHaveProperty('quantites');
  });

  it('une quantité sur un prix nouveau va dans « Saisie manuelle »', () => {
    const maj = repartirSaisie([], 'e1', 'lot1', idsLot, { a2: 100 }, [], { a2: 12 }, new Set());
    expect(maj).toEqual([{ id: null, prix: { a2: 100 }, postesAjoutes: [], quantites: { a2: 12 }, quantitesAcceptees: [] }]);
  });
});
