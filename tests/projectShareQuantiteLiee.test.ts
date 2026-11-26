// Quantités liées et propositions d'un confrère : la quantité d'un article qui suit un autre poste ne se
// propose pas (on propose sur le poste suivi), et approuver une quantité sur la source recalcule les suiveurs,
// y compris dans un autre lot. Document synthétique, quantités fictives.
import { describe, expect, it } from 'vitest';
import { applyFieldToNode, blockedEdit, recomputeAfterNumericChange } from '../server/projectShares/documentView';

type Rec = Record<string, any>;

function document(): Rec {
  return {
    totalHT: 4800, TVA: 20, totalTTC: 5760,
    lots: [
      {
        id: 'lot-a', numero: '01', titre: 'Menuiseries', projectLotId: 'pl-a', sousTotal: 4000,
        chapitres: [{ id: 'c-a', numero: '1', titre: 'Fenêtres', lignes: [
          { id: 'fenetres', numero: '1.1', designation: 'Fenêtres PVC', unite: 'u', quantite: 10, prixUnitaire: 400, prixTotal: 4000, type: 'ouvrage' },
        ] }],
      },
      {
        id: 'lot-b', numero: '02', titre: 'Occultations', projectLotId: 'pl-b', sousTotal: 800,
        chapitres: [{ id: 'c-b', numero: '1', titre: 'Volets', lignes: [
          { id: 'volets', numero: '1.1', designation: 'Volets roulants', unite: 'u', quantite: 8, prixUnitaire: 100, prixTotal: 800, type: 'ouvrage', quantiteLiee: { sourceId: 'fenetres', coefficient: 0.8 } },
        ] }],
      },
    ],
  };
}

const ligne = (doc: Rec, id: string): Rec =>
  doc.lots.flatMap((l: Rec) => l.chapitres.flatMap((c: Rec) => c.lignes)).find((l: Rec) => l.id === id);

describe('proposition sur un article lié', () => {
  it('refuse la quantité et le métré d\'un article qui suit un autre poste', () => {
    const volets = ligne(document(), 'volets');
    expect(blockedEdit(volets, 'quantite')).toMatch(/liée à un autre poste/);
    expect(blockedEdit(volets, 'metre')).toMatch(/liée à un autre poste/);
  });

  it('laisse proposer son prix et son unité : ils ne dépendent pas de la quantité', () => {
    const volets = ligne(document(), 'volets');
    expect(blockedEdit(volets, 'prixUnitaire')).toBeNull();
    expect(blockedEdit(volets, 'unite')).toBeNull();
  });

  it('laisse proposer la quantité du poste suivi', () => {
    expect(blockedEdit(ligne(document(), 'fenetres'), 'quantite')).toBeNull();
  });
});

describe('approbation d\'une quantité sur le poste suivi', () => {
  it('recalcule le suiveur situé dans un autre lot, ses sous-totaux et les totaux', () => {
    const doc = document();
    applyFieldToNode(ligne(doc, 'fenetres'), 'quantite', '20');
    recomputeAfterNumericChange(doc, 'pl-a');

    const volets = ligne(doc, 'volets');
    expect(volets.quantite).toBe(16);
    expect(volets.prixTotal).toBe(1600);
    expect(doc.lots[0].sousTotal).toBe(8000);
    expect(doc.lots[1].sousTotal).toBe(1600);
    expect(doc.totalHT).toBe(9600);
    expect(doc.totalTTC).toBe(9600 * 1.2);
  });

  it('un document sans lien est recalculé comme avant', () => {
    const doc = document();
    delete ligne(doc, 'volets').quantiteLiee;
    applyFieldToNode(ligne(doc, 'fenetres'), 'quantite', '20');
    recomputeAfterNumericChange(doc, 'pl-a');
    expect(ligne(doc, 'volets').quantite).toBe(8);
    expect(doc.totalHT).toBe(8000 + 800);
  });
});
