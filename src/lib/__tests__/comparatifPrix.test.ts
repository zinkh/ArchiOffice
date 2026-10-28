import { describe, it, expect } from 'vitest';
import {
  construireLot, comparatifDepuisOffres, ecartPct, niveauEcart, mediane, modeEffectif,
  prixEntreprise, totalLotPostes, ligneEnEcart, aDesPrix, type EntrepriseComparee,
} from '../comparatifPrix';
import type { Lot, OffreDocument } from '../../types/dpgf';

const art = (id: string, numero: string, designation: string, q: number, pu: number, extra: object = {}) => ({
  id, numero, designation, unite: 'm²', quantite: q, prixUnitaire: pu,
  prixTotal: q * pu, type: 'ouvrage' as const, ...extra,
});

const lot = (): Lot => ({
  id: 'lot1', numero: '02', titre: 'Gros œuvre', sousTotal: 0, projectLotId: 'pl2',
  chapitres: [{
    id: 'c1', numero: '2.1', titre: 'Fondations',
    lignes: [
      art('a1', '2.1.1', 'Terrassement', 100, 20),
      art('a2', '2.1.2', 'Béton', 10, 100),
      art('a3', '2.1.3', 'Option drainage', 50, 10, { nature: 'option' }),
    ],
  }],
});

const offre = (
  id: string, entrepriseId: string, prix: Record<string, number | null>,
  extra: Partial<OffreDocument> = {},
): OffreDocument => ({
  id, entrepriseId, entrepriseNom: `Ent ${entrepriseId}`, dateReception: '2026-02-01',
  fichierNom: 'offre.xlsx', importedAt: '2026-02-01T10:00:00Z', documentVersion: '1', prix,
  anomalies: [], statut: 'validee', ...extra,
});

const ent = (id: string, mode: 'total' | 'postes' = 'postes', totalSaisi = 0): EntrepriseComparee =>
  ({ id, nom: `Ent ${id}`, mode, totalSaisi });

describe('écarts et médiane', () => {
  it('calcule l’écart à l’estimation en pourcentage', () => {
    expect(ecartPct(22, 20)).toBeCloseTo(10);
    expect(ecartPct(15, 20)).toBeCloseTo(-25);
    expect(ecartPct(10, 0)).toBeNull();
  });
  it('signale seulement au-delà du seuil', () => {
    expect(niveauEcart(15)).toBe('normal');
    expect(niveauEcart(15.1)).toBe('haut');
    expect(niveauEcart(-16)).toBe('bas');
    expect(niveauEcart(null)).toBe('normal');
  });
  it('rend la médiane de valeurs paires et impaires', () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([1, 2, 3, 4])).toBe(2.5);
    expect(mediane([])).toBeNull();
  });
});

describe('construireLot', () => {
  it('compare les prix unitaires, avec meilleur prix et médiane', () => {
    const offres = [offre('o1', 'e1', { a1: 18, a2: 110 }), offre('o2', 'e2', { a1: 22, a2: 90 })];
    const r = construireLot(lot(), offres, [ent('e1'), ent('e2')]);
    const [a1, a2] = r.chapitres[0].lignes;
    expect(a1.meilleur).toBe(18);
    expect(a2.meilleur).toBe(90);
    expect(a1.mediane).toBe(20);
    expect(a1.estimation).toBe(20);
  });

  it('ne marque pas de meilleur prix avec une seule entreprise chiffrée', () => {
    const r = construireLot(lot(), [offre('o1', 'e1', { a1: 18 })], [ent('e1'), ent('e2')]);
    expect(r.chapitres[0].lignes[0].meilleur).toBeNull();
  });

  it('déduit le total du lot des prix, hors options', () => {
    const r = construireLot(lot(), [offre('o1', 'e1', { a1: 18, a2: 110, a3: 12 })], [ent('e1')]);
    // 100 x 18 + 10 x 110, l'option n'entre pas dans le total de base.
    expect(r.totaux.e1).toBe(2900);
    expect(r.estimationTotale).toBe(3000);
    expect(r.chapitres[0].lignes[2].horsBase).toBe(true);
  });

  it('ne compte pas un poste pour mémoire à zéro et le dénombre', () => {
    const r = construireLot(lot(), [offre('o1', 'e1', { a1: 18, a2: null })], [ent('e1')]);
    expect(r.totaux.e1).toBe(1800);
    expect(r.pourMemoire.e1).toBe(1);
  });

  it('laisse un lot sans prix sans total', () => {
    const r = construireLot(lot(), [], [ent('e1')]);
    expect(r.totaux.e1).toBeNull();
    expect(r.rangs.e1).toBeNull();
  });

  it('reprend le total saisi d’une entreprise en mode total et la classe', () => {
    const offres = [offre('o1', 'e1', { a1: 18, a2: 110 })];
    const r = construireLot(lot(), offres, [ent('e1'), ent('e2', 'total', 2500)]);
    expect(r.totaux.e2).toBe(2500);
    expect(r.rangs.e2).toBe(1);
    expect(r.rangs.e1).toBe(2);
    // Une entreprise au total seul ne figure pas dans les prix par ligne.
    expect(r.chapitres[0].lignes[0].prix.e2).toBeUndefined();
  });

  it('ajoute les postes ajoutés au total de leur entreprise', () => {
    const poste = { id: 'p1', numero: 'A.1', designation: 'Cuvelage', unite: 'ft', quantite: 1, prixUnitaire: 3200, lotId: 'lot1' };
    const r = construireLot(lot(), [offre('o1', 'e1', { a1: 18 }, { postesAjoutes: [poste] })], [ent('e1')]);
    expect(r.ajouts).toHaveLength(1);
    expect(r.totaux.e1).toBe(1800 + 3200);
  });

  it('ignore une offre écartée', () => {
    const r = construireLot(lot(), [offre('o1', 'e1', { a1: 18 }, { statut: 'ecartee' })], [ent('e1')]);
    expect(r.totaux.e1).toBeNull();
  });
});

describe('prixEntreprise', () => {
  it('superpose les fichiers dans l’ordre d’import, le plus récent gagne', () => {
    const anciennes = offre('o1', 'e1', { a1: 18, a2: 100 }, { importedAt: '2026-01-01T00:00:00Z' });
    const recente = offre('o2', 'e1', { a1: 17 }, { importedAt: '2026-02-01T00:00:00Z' });
    expect(prixEntreprise([recente, anciennes], 'e1')).toEqual({ a1: 17, a2: 100 });
  });
});

describe('modeEffectif', () => {
  it('respecte le mode enregistré', () => {
    expect(modeEffectif('total', 0, true)).toBe('total');
    expect(modeEffectif('postes', 5000, false)).toBe('postes');
  });
  it('déduit le mode d’une consultation antérieure', () => {
    expect(modeEffectif(undefined, 5000, true)).toBe('total');
    expect(modeEffectif(undefined, 0, true)).toBe('postes');
    expect(modeEffectif(undefined, 0, false)).toBe('total');
  });
});

describe('totalLotPostes et aDesPrix', () => {
  it('rend null quand rien n’est chiffré', () => {
    expect(totalLotPostes(lot(), {})).toBeNull();
    expect(aDesPrix(lot(), {})).toBe(false);
    expect(aDesPrix(lot(), { a1: 10 })).toBe(true);
  });
});

describe('ligneEnEcart', () => {
  it('retient un écart de plus de 10 % ou un poste pour mémoire', () => {
    const offres = [offre('o1', 'e1', { a1: 20, a2: 100 }), offre('o2', 'e2', { a1: 23, a2: null })];
    const es = [ent('e1'), ent('e2')];
    const [a1, a2] = construireLot(lot(), offres, es).chapitres[0].lignes;
    expect(ligneEnEcart(a1, es)).toBe(true);
    expect(ligneEnEcart(a2, es)).toBe(true);
    expect(ligneEnEcart(a1, [ent('e1')])).toBe(false);
  });
});

describe('comparatifDepuisOffres', () => {
  it('dérive le comparatif du lot rattaché et garde la saisie manuelle des autres', () => {
    const manuel = { lot_id: 'plX', articles: [{ id: 'm', code: '', titre: 'Manuel', prix: {} }] };
    const offres = [offre('o1', 'e1', { a1: 18, a2: 110 })];
    const sortie = comparatifDepuisOffres([lot()], offres, () => [ent('e1'), ent('e2', 'total', 4000)], [manuel]);
    expect(sortie.map(c => c.lot_id)).toEqual(['pl2', 'plX']);
    const sousTotal = sortie[0].articles.find(a => a.is_subtotal)!;
    expect(sousTotal.prix.e2).toBe(4000);
    expect(sousTotal.prix.e1).toBeGreaterThan(0);
  });

  it('n’écrit pas les prix d’une entreprise saisie au total', () => {
    const offres = [offre('o1', 'e2', { a1: 18 })];
    const sortie = comparatifDepuisOffres([lot()], offres, () => [ent('e2', 'total', 4000)]);
    const a1 = sortie[0].articles.find(a => a.id === 'a1')!;
    expect(a1.prix.e2).toBeUndefined();
  });
});
