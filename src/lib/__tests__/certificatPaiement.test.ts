import { describe, expect, it } from 'vitest';
import {
  calculerCertificat, calculerDecompteCloture, certificatsDuMarche, prochainNumero, syntheseMarche,
  type MarcheTravaux, type SituationTravaux,
} from '../certificatPaiement';

const marche: MarcheTravaux = {
  id: 'm1', entreprise_nom: 'Maçonnerie Dupont', lot_numero: '02', lot_titre: 'Gros œuvre',
  montant_ht: 100000, tva_rate: 20, retenue_garantie_pct: 5, avance_montant_ttc: 0,
};

const sit = (over: Partial<SituationTravaux>): SituationTravaux => ({
  id: `s${over.numero_situation}`, marche_id: 'm1', numero_situation: 1, etat: 'Brouillon', ...over,
});

describe('calculerCertificat', () => {
  it('déduit la période du cumul admis moins le cumul précédent du même marché', () => {
    const s1 = sit({ numero_situation: 1, montant_presente_ht: 30000, etat: 'Validée' });
    const s2 = sit({ numero_situation: 2, montant_presente_ht: 55000 });
    const autreLot = sit({ id: 'x', marche_id: 'm2', numero_situation: 1, montant_presente_ht: 90000 });
    const c = calculerCertificat(s2, marche, [s1, autreLot].filter((s) => s.marche_id === 'm1'));
    expect(c.cumulPrecedentHt).toBe(30000);
    expect(c.periodeHt).toBe(25000);
    expect(c.tva).toBe(5000);
    expect(c.periodeTtc).toBe(30000);
    expect(c.retenue).toBe(1500);
    expect(c.netAPayer).toBe(28500);
    expect(c.avancementPct).toBe(55);
    expect(c.cumulNetPrecedent).toBe(34200);
  });

  it("retient le cumul admis par l'architecte plutôt que le cumul présenté", () => {
    const c = calculerCertificat(sit({ numero_situation: 1, montant_presente_ht: 40000, montant_admis_ht: 35000 }), marche, []);
    expect(c.ecartHt).toBe(5000);
    expect(c.periodeHt).toBe(35000);
  });

  it('applique révision, avance et pénalités, et aucune retenue sous caution bancaire', () => {
    const c = calculerCertificat(
      sit({ numero_situation: 1, montant_presente_ht: 10000, revision_coeff: 1.02, avance_remboursement: 500, penalites_ht: 200 }),
      { ...marche, revision_active: true, retenue_garantie_bancaire: true },
      [],
    );
    expect(c.revisionHt).toBe(200);
    expect(c.periodeTtc).toBe(12240);
    expect(c.retenue).toBe(0);
    expect(c.netAPayer).toBe(11540);
  });

  it('ne prélève pas de retenue sur une période négative', () => {
    const s1 = sit({ numero_situation: 1, montant_presente_ht: 20000 });
    const c = calculerCertificat(sit({ numero_situation: 2, montant_presente_ht: 18000 }), marche, [s1]);
    expect(c.periodeHt).toBe(-2000);
    expect(c.retenue).toBe(0);
  });
});

describe('calculerDecompteCloture', () => {
  it('ne laisse rien à payer hors retenue quand toutes les situations sont certifiées', () => {
    const liste = [
      sit({ numero_situation: 1, montant_presente_ht: 30000, etat: 'Payée' }),
      sit({ numero_situation: 2, montant_presente_ht: 100000, etat: 'Validée' }),
    ];
    const d = calculerDecompteCloture(marche, liste);
    expect(d.totalHt).toBe(100000);
    expect(d.tva).toBe(20000);
    expect(d.totalTtc).toBe(120000);
    expect(d.totalRetenue).toBe(6000);
    expect(d.dejaCertifie).toBe(114000);
    expect(d.resteAPayerTtc).toBe(0);
  });

  it('compte une situation non certifiée dans le reste à payer, avance déduite', () => {
    const avec = { ...marche, avance_montant_ttc: 6000 };
    const liste = [
      sit({ numero_situation: 1, montant_presente_ht: 30000, avance_remboursement: 3000, etat: 'Validée' }),
      sit({ numero_situation: 2, montant_presente_ht: 100000, avance_remboursement: 3000 }),
    ];
    const d = calculerDecompteCloture(avec, liste);
    expect(d.dejaCertifie).toBe(31200);
    expect(d.resteAPayerTtc).toBe(76800);
    expect(certificatsDuMarche(avec, liste)[1].netAPayer).toBe(76800);
  });
});

describe('numérotation et synthèse', () => {
  it('numérote par marché et résume l’avancement', () => {
    const liste = [
      sit({ numero_situation: 1, montant_presente_ht: 30000, etat: 'Validée' }),
      sit({ id: 'b', marche_id: 'm2', numero_situation: 4 }),
    ];
    expect(prochainNumero(liste, 'm1')).toBe(2);
    expect(prochainNumero(liste, 'm3')).toBe(1);
    const s = syntheseMarche(marche, liste);
    expect(s.nbSituations).toBe(1);
    expect(s.avancementPct).toBe(30);
    expect(s.certifieTtc).toBe(34200);
    expect(s.aCertifier).toBe(0);
  });
});
