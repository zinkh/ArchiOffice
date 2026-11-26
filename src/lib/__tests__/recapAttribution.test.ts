import { describe, expect, it } from 'vitest';
import type { MarcheTravaux, SituationTravaux } from '../certificatPaiement';
import { recapMarche, recapParLot } from '../recapSituations';
import { avecEntrepriseAttribuee, entrepriseAttribuee } from '../attributionMarche';

const marche: MarcheTravaux = {
  id: 'm1', entreprise_nom: 'Ancienne SARL', lot_numero: '02', lot_titre: 'Gros oeuvre',
  montant_ht: 100000, tva_rate: 20, retenue_garantie_pct: 5,
};

const situation = (o: Partial<SituationTravaux>): SituationTravaux => ({
  id: 's', marche_id: 'm1', numero_situation: 1, etat: 'Brouillon', montant_presente_ht: 0, ...o,
});

describe('recapMarche', () => {
  const sits = [
    situation({ id: 's1', numero_situation: 1, date_situation: '2026-09-15', montant_presente_ht: 20000, etat: 'Payée', date_paiement: '2026-10-20' }),
    situation({ id: 's2', numero_situation: 2, date_situation: '2026-10-15', montant_presente_ht: 50000, etat: 'Validée' }),
    situation({ id: 's3', numero_situation: 3, date_situation: '2026-11-05', montant_presente_ht: 60000, etat: 'Brouillon' }),
  ];

  it('liste toutes les situations avec date, date de paiement, reste à payer et retenue', () => {
    const recap = recapMarche(marche, sits);
    expect(recap.lignes).toHaveLength(3);
    const [s1, s2, s3] = recap.lignes;
    // Période 1 : 20 000 HT, TTC 24 000, retenue 5 % du TTC = 1 200, net 22 800.
    expect(s1).toMatchObject({ dateSituation: '2026-09-15', datePaiement: '2026-10-20', payee: true, resteAPayer: 0, retenue: 1200, netAPayer: 22800 });
    expect(s2).toMatchObject({ dateSituation: '2026-10-15', datePaiement: null, payee: false });
    expect(s2.resteAPayer).toBe(s2.netAPayer);
    expect(s3.certifiee).toBe(false);
  });

  it('totalise le payé, le reste à payer et la retenue cumulée', () => {
    const recap = recapMarche(marche, sits);
    expect(recap.totalPaye).toBe(22800);
    expect(recap.totalResteAPayer).toBeCloseTo(recap.lignes[1].netAPayer + recap.lignes[2].netAPayer, 2);
    expect(recap.retenueCumulee).toBeCloseTo(recap.lignes.reduce((t, l) => t + l.retenue, 0), 2);
    expect(recap.lot).toBe('02 Gros oeuvre');
  });

  it('n\'affiche pas de date de paiement pour une situation non payée, ni une date illisible', () => {
    const recap = recapMarche(marche, [situation({ id: 'x', etat: 'Validée', montant_presente_ht: 1000, date_paiement: '2026-10-20' }), situation({ id: 'y', numero_situation: 2, etat: 'Payée', montant_presente_ht: 2000, date_paiement: 'hier' })]);
    expect(recap.lignes[0].datePaiement).toBeNull();
    expect(recap.lignes[1].datePaiement).toBeNull();
  });

  it('omet les marchés sans situation et les accords-cadres', () => {
    const autre: MarcheTravaux = { ...marche, id: 'm2' };
    const ac: MarcheTravaux = { ...marche, id: 'm3', type_marche: 'accord_cadre' };
    const recaps = recapParLot([marche, autre, ac], [...sits, situation({ id: 'z', marche_id: 'm3', montant_presente_ht: 5 })]);
    expect(recaps.map(r => r.marche.id)).toEqual(['m1']);
  });
});

describe('attribution ACT', () => {
  const lots = [{ id: 'lot-uuid', lot_number: '2', lot_title: 'Gros oeuvre' }];
  const consultation = {
    entreprises: [{ id: 'e1', nom: 'Maçonnerie Durand', contact_id: 'c1' }],
    attributions: [{ lot_id: 'lot-uuid', entreprise_id: 'e1', montant: 98000 }],
  };

  it('retrouve l\'entreprise et le montant attribués à un lot', () => {
    expect(entrepriseAttribuee('lot-uuid', consultation)).toMatchObject({ nom: 'Maçonnerie Durand', montant: 98000, contactId: 'c1' });
    expect(entrepriseAttribuee('autre', consultation)).toBeNull();
    expect(entrepriseAttribuee('lot-uuid', null)).toBeNull();
  });

  it('prend l\'entreprise de l\'attribution pour un marché non signé, lot retrouvé par son numéro (« 02 » = « 2 »)', () => {
    expect(avecEntrepriseAttribuee(marche, lots, consultation).entreprise_nom).toBe('Maçonnerie Durand');
  });

  it('laisse intacts un marché signé, un accord-cadre, un subséquent ou un lot sans attribution', () => {
    expect(avecEntrepriseAttribuee({ ...marche, statut_signature: 'signe' }, lots, consultation)).toMatchObject({ entreprise_nom: 'Ancienne SARL' });
    expect(avecEntrepriseAttribuee({ ...marche, type_marche: 'accord_cadre' }, lots, consultation).entreprise_nom).toBe('Ancienne SARL');
    expect(avecEntrepriseAttribuee({ ...marche, type_marche: 'subsequent' }, lots, consultation).entreprise_nom).toBe('Ancienne SARL');
    expect(avecEntrepriseAttribuee({ ...marche, lot_numero: '09' }, lots, consultation).entreprise_nom).toBe('Ancienne SARL');
  });
});
