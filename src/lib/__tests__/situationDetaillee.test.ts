import { describe, expect, it } from 'vitest';
import type { DPGF, OffreDocument } from '../../types/dpgf';
import {
  bornerPct, figer, lignesASaisir, lignesDuMarche, lotsDuMarche, montantDepuisLignes, validerAvancementLignes,
} from '../situationDetaillee';

const ligne = (id: string, quantite: number, pu: number, extra: Record<string, unknown> = {}) => ({
  id, numero: id, designation: `Ouvrage ${id}`, unite: 'm²', quantite, prixUnitaire: pu, prixTotal: quantite * pu, type: 'ouvrage', ...extra,
});

const dpgf = {
  id: 'd', projectId: 'p', titre: 'DPGF', version: '1', dateCreation: '', statut: 'draft', totalHT: 0, TVA: 0, totalTTC: 0,
  lots: [
    { id: 'L1', numero: '01', titre: 'Terrassements', sousTotal: 0, chapitres: [{ id: 'c0', numero: '1.1', titre: 'Fouilles', lignes: [ligne('t1', 10, 50)] }] },
    {
      id: 'L2', numero: '02', titre: 'Gros œuvre', sousTotal: 0, chapitres: [
        { id: 'c1', numero: '2.1', titre: 'Fondations', lignes: [
          ligne('a', 10, 100),
          ligne('b', 0, 0, { type: 'titre' }),
          ligne('c', 1, 0, { children: [ligne('c1', 2, 500), ligne('c2', 4, 250)] }),
          ligne('x', 3, 10, { cctpOnly: true }),
        ] },
      ],
    },
  ],
} as unknown as DPGF;

describe('lignesDuMarche', () => {
  it('rapproche le lot par numéro (« 2 » = « 02 ») et ne garde que les ouvrages feuilles', () => {
    expect(lotsDuMarche(dpgf, { lot_numero: '2' }).map((l) => l.id)).toEqual(['L2']);
    expect(lotsDuMarche(dpgf, { lot_numero: '', lot_titre: 'gros oeuvre' }).map((l) => l.id)).toEqual(['L2']);
    const r = lignesDuMarche(dpgf, [], { entreprise_nom: 'Dupont', lot_numero: '02' });
    expect(r.lignes.map((l) => l.ligneId)).toEqual(['a', 'c1', 'c2']);
    expect(r.totalHt).toBe(3000);
    expect(r.source).toBe('dpgf');
  });

  it("prend les prix de l'offre de l'entreprise quand elle existe", () => {
    const offres = [
      { id: 'o1', entrepriseNom: 'Maçonnerie Dupont', prix: { a: 90, c1: null }, statut: 'validee', lotIds: ['L2'] },
      { id: 'o2', entrepriseNom: 'Autre', prix: { a: 1 }, statut: 'validee' },
    ] as unknown as OffreDocument[];
    const r = lignesDuMarche(dpgf, offres, { entreprise_nom: 'maconnerie dupont', lot_numero: '02' });
    expect(r.source).toBe('offre');
    expect(r.lignes.find((l) => l.ligneId === 'a')?.montantHt).toBe(900);
    expect(r.lignes.find((l) => l.ligneId === 'c1')?.prixUnitaire).toBe(500);
  });
});

describe('saisie de l’avancement', () => {
  const ref = lignesDuMarche(dpgf, [], { entreprise_nom: 'Dupont', lot_numero: '02' }).lignes;

  it('repart de l’avancement précédent et conserve une ligne retirée du DPGF', () => {
    const precedente = [{ ...ref[0], avancementPct: 40 }];
    const courante = [{ ...ref[1], avancementPct: 50 }, { ...ref[0], ligneId: 'ancienne', montantHt: 200, avancementPct: 100 }];
    const rows = lignesASaisir(ref, courante, precedente);
    expect(rows.find((r) => r.ligneId === 'a')).toMatchObject({ avancementPct: 40, avancementPrecedentPct: 40 });
    expect(rows.find((r) => r.ligneId === 'c1')).toMatchObject({ avancementPct: 50, avancementPrecedentPct: 0 });
    expect(rows.find((r) => r.ligneId === 'ancienne')).toMatchObject({ retiree: true });
    // 1000 × 40 % + 1000 × 50 % + 200 × 100 %
    expect(montantDepuisLignes(figer(rows))).toBe(1100);
  });

  it('borne les avancements et valide ce que reçoit le serveur', () => {
    expect(bornerPct('120')).toBe(100);
    expect(bornerPct('12,5')).toBe(12.5);
    expect(validerAvancementLignes([{ ligneId: 'a', quantite: 2, prixUnitaire: 10, montantHt: 9999, avancementPct: 50 }]).lignes?.[0].montantHt).toBe(20);
    expect(validerAvancementLignes([{ ligneId: 'a', quantite: 2, prixUnitaire: 10, avancementPct: 150 }]).error).toBeTruthy();
    expect(validerAvancementLignes('x').error).toBeTruthy();
  });
});
