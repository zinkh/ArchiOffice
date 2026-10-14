import { describe, expect, it } from 'vitest';
import type { DPGF, OffreDocument } from '../../types/dpgf';
import type { Contact, ProjectLot } from '../../types';
import {
  aConstituer, dpgfDuMarche, lignesMarches, marcheACreer, nomPiece, snapshotOffre,
  trouverLotDocument, trouverOffre, valeursActe, type MarcheActLu,
} from '../marcheAct';
import { nomChamp } from '../actEngagementForm';

const lotProjet = (id: string, n: string, titre = 'Gros oeuvre'): ProjectLot => ({ id, project_id: 'p1', lot_number: n, lot_title: titre });
const lots = [lotProjet('L2', '02'), lotProjet('L1', '01', 'VRD')];
const entreprises = [{ id: 'E1', nom: 'Dupont SARL', contact_id: 'C1' }, { id: 'E2', nom: 'Martin' }];

const ligne = (id: string, q: number, pu: number) => ({ id, numero: id, designation: id, unite: 'u', quantite: q, prixUnitaire: pu, prixTotal: q * pu });
const dpgf = (): DPGF => ({
  id: 'd', projectId: 'p1', titre: 'DPGF', version: '1', dateCreation: '', statut: 'draft', totalHT: 0, TVA: 20, totalTTC: 0,
  lots: [
    { id: 'dl1', numero: '01', titre: 'VRD', sousTotal: 0, chapitres: [{ id: 'c1', numero: '1', titre: 'Terrassement', lignes: [ligne('a1', 10, 5)] }] },
    {
      id: 'dl2', numero: '02', titre: 'Gros oeuvre', projectLotId: 'L2', sousTotal: 0,
      chapitres: [
        { id: 'c2', numero: '1', titre: 'Fondations', lignes: [ligne('b1', 2, 100), ligne('b2', 3, 50)] },
        { id: 'c3', numero: '2', titre: 'Elevation', lignes: [{ ...ligne('b3', 1, 0), children: [ligne('b3a', 4, 10)] }] },
      ],
    },
  ],
} as unknown as DPGF);

const offre = (extra: Partial<OffreDocument> = {}): OffreDocument => ({
  id: 'o1', entrepriseId: 'E1', entrepriseNom: 'Dupont SARL', dateReception: '', fichierNom: '', importedAt: '', documentVersion: '1',
  prix: { b1: 90, b2: null, b3a: 12, a1: 999 }, anomalies: [], statut: 'validee', ...extra,
});

describe('lignesMarches', () => {
  it('classe par numéro de lot, ignore un lot ou une entreprise inconnus', () => {
    const r = lignesMarches(
      [{ lot_id: 'L2', entreprise_id: 'E1', montant: 1000 }, { lot_id: 'L1', entreprise_id: 'E2', montant: 500 }, { lot_id: 'X', entreprise_id: 'E1', montant: 1 }],
      entreprises, lots, [],
    );
    expect(r.map(l => l.lot.lot_number)).toEqual(['01', '02']);
    expect(r.every(l => l.statut === 'a_constituer' && aConstituer(l))).toBe(true);
  });

  it('signale l’écart d’attribution sans proposer de réécrire un marché signé', () => {
    const marche = (s: 'a_signer' | 'signe'): MarcheActLu => ({ id: 'm', act_lot_id: 'L2', act_entreprise_id: 'E1', entreprise_nom: 'Dupont SARL', montant_ht: 900, tva_rate: 20, statut_signature: s });
    const a = [{ lot_id: 'L2', entreprise_id: 'E1', montant: 1000 }];
    const nonSigne = lignesMarches(a, entreprises, lots, [marche('a_signer')])[0];
    expect(nonSigne.ecart).toBe(100);
    expect(aConstituer(nonSigne)).toBe(true);
    const signe = lignesMarches(a, entreprises, lots, [marche('signe')])[0];
    expect(signe.ecart).toBe(100);
    expect(aConstituer(signe)).toBe(false);
  });

  it('ne refait rien quand le marché correspond à l’attribution', () => {
    const m: MarcheActLu = { id: 'm', act_lot_id: 'L2', act_entreprise_id: 'E1', entreprise_nom: 'Dupont SARL', montant_ht: 1000, tva_rate: 20, statut_signature: 'a_signer' };
    const l = lignesMarches([{ lot_id: 'L2', entreprise_id: 'E1', montant: 1000 }], entreprises, lots, [m])[0];
    expect(l.ecart).toBeNull();
    expect(aConstituer(l)).toBe(false);
  });

  it('une autre entreprise attribuée sur un marché non signé le fait reconstituer', () => {
    const m: MarcheActLu = { id: 'm', act_lot_id: 'L2', act_entreprise_id: 'E2', entreprise_nom: 'Martin', montant_ht: 1000, tva_rate: 20, statut_signature: 'a_signer' };
    const l = lignesMarches([{ lot_id: 'L2', entreprise_id: 'E1', montant: 1000 }], entreprises, lots, [m])[0];
    expect(aConstituer(l)).toBe(true);
  });
});

describe('offre figée', () => {
  it('retrouve l’offre par identifiant puis par nom, et écarte une offre écartée', () => {
    expect(trouverOffre([offre()], entreprises[0])?.id).toBe('o1');
    expect(trouverOffre([offre({ entrepriseId: undefined, entrepriseNom: ' dupont sarl ' })], entreprises[0])?.id).toBe('o1');
    expect(trouverOffre([offre({ statut: 'ecartee' })], entreprises[0])).toBeUndefined();
  });

  it('ne garde que les prix des articles du lot', () => {
    const lotDoc = trouverLotDocument(dpgf(), lots[0])!;
    expect(lotDoc.numero).toBe('02');
    const s = snapshotOffre(offre(), lotDoc, entreprises[0], 1234.567)!;
    expect(Object.keys(s.prix).sort()).toEqual(['b1', 'b2', 'b3a']);
    expect(s.total_ht).toBe(1234.57);
    expect(snapshotOffre(undefined, lotDoc, entreprises[0], 1)).toBeNull();
  });
});

describe('dpgfDuMarche', () => {
  it('applique les prix de l’offre, compte les articles absents et recalcule les totaux', () => {
    const lotDoc = trouverLotDocument(dpgf(), lots[0])!;
    const snap = snapshotOffre(offre({ prix: { b1: 90, b3a: 12 } }), lotDoc, entreprises[0], 0)!;
    const r = dpgfDuMarche(dpgf(), '02', snap);
    expect(r.source).toBe('offre');
    expect(r.manquants).toBe(1); // b2 absent de l'offre
    expect(r.dpgf.lots).toHaveLength(1);
    // b1 : 2 x 90 = 180 ; b2 : 0 ; b3a : 4 x 12 = 48
    expect(r.dpgf.lots[0].sousTotal).toBe(228);
    expect(r.dpgf.totalHT).toBe(228);
    expect(r.dpgf.totalTTC).toBe(273.6);
  });

  it('une valeur null (non chiffré) vaut zéro sans être comptée comme manquante', () => {
    const lotDoc = trouverLotDocument(dpgf(), lots[0])!;
    const snap = snapshotOffre(offre({ prix: { b1: 90, b2: null, b3a: 12 } }), lotDoc, entreprises[0], 0)!;
    expect(dpgfDuMarche(dpgf(), '02', snap).manquants).toBe(0);
  });

  it('range les postes ajoutés sous un chapitre dédié, comptés dans le sous-total', () => {
    const lotDoc = trouverLotDocument(dpgf(), lots[0])!;
    const snap = snapshotOffre(offre({ prix: { b1: 90, b2: 10, b3a: 12 }, postesAjoutes: [{ id: 'pa1', numero: '02.9', designation: 'Reprise', unite: 'ens', quantite: null, prixUnitaire: 300, lotId: 'dl2' }] }), lotDoc, entreprises[0], 0)!;
    const r = dpgfDuMarche(dpgf(), '02', snap);
    const dernier = r.dpgf.lots[0].chapitres.at(-1)!;
    expect(dernier.titre).toMatch(/Postes ajoutés/);
    expect(r.dpgf.lots[0].sousTotal).toBe(180 + 30 + 48 + 300);
  });

  it('sans offre figée : prix à zéro, source « absent », jamais l’estimation', () => {
    const r = dpgfDuMarche(dpgf(), '02', null);
    expect(r.source).toBe('absent');
    expect(r.dpgf.totalHT).toBe(0);
  });

  it('ne modifie pas le DPGF source', () => {
    const source = dpgf();
    const avant = JSON.stringify(source);
    dpgfDuMarche(source, '02', null);
    expect(JSON.stringify(source)).toBe(avant);
  });
});

describe('valeursActe', () => {
  const contact = { first_name: 'Jean', last_name: 'Dupont', company_name: 'Dupont SARL', job_title: 'Gérant', address: '1 rue X', zip: '54000', city: 'Nancy', siret: '12345678901234', email: 'j@d.fr', phone: '0383' } as Contact;

  it('préremplit l’entreprise, le lot, le prix et la TVA, avec la virgule française', () => {
    const v = valeursActe(contact, entreprises[0], { numero: '02' }, 1234.5, 20, 3);
    expect(v[nomChamp.entreprise('entreprise')]).toBe('Dupont SARL');
    expect(v[nomChamp.entreprise('representant')]).toBe('Jean Dupont');
    expect(v[nomChamp.entreprise('siege')]).toBe('1 rue X, 54000 Nancy');
    expect(v[nomChamp.lotCandidat('02')]).toBe(true);
    expect(v[nomChamp.lotPrix('02')]).toBe('1234,5');
    expect(v[nomChamp.lotDelai('02')]).toBe('3');
    expect(v[nomChamp.tva]).toBe('20');
  });

  it('sans fiche contact : seul le nom de l’entreprise consultée, rien d’inventé', () => {
    const v = valeursActe(undefined, entreprises[1], { numero: '01' }, 500, 20);
    expect(v[nomChamp.entreprise('entreprise')]).toBe('Martin');
    expect(v[nomChamp.entreprise('siret')]).toBeUndefined();
    expect(v[nomChamp.lotDelai('01')]).toBeUndefined();
  });

  it('une fiche de personne sans société ne donne pas de signataire', () => {
    const v = valeursActe({ ...contact, company_name: undefined } as Contact, entreprises[0], { numero: '02' }, 1, 20);
    expect(v[nomChamp.entreprise('representant')]).toBeUndefined();
  });
});

describe('charge utile et noms de fichier', () => {
  it('construit la charge utile de constitution', () => {
    const l = lignesMarches([{ lot_id: 'L2', entreprise_id: 'E1', montant: 1000.004 }], entreprises, lots, [])[0];
    expect(marcheACreer(l, null, 20)).toMatchObject({ act_lot_id: 'L2', act_entreprise_id: 'E1', contact_id: 'C1', montant_ht: 1000, tva_rate: 20, lot_numero: '02' });
  });

  it('nomme les pièces sans accent ni caractère réservé', () => {
    expect(nomPiece('CCTP', '26001', { numero: '02' }, 'Maçonnerie Dupont & fils')).toBe('CCTP_Lot-02_Maconnerie-Dupont-fils_26001.pdf');
    expect(nomPiece('CCAP', '26001', undefined, undefined, 'docx')).toBe('CCAP_26001.docx');
  });
});
