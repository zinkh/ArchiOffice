import { describe, expect, it } from 'vitest';
import {
  articlesDuBordereau, classerOffres, conditionsDe, lignesCommandeDepuisOffre, membresDuGroupe, subsequentsDuGroupe, teteDuGroupe, totalOffre, verifierOffre, consommation, libelleMarche, lotDuMarche, mentionMarche, montantLigne, totalLignes, validerLignesCommande, verifierEmission,
  type ConditionsAccordCadre, type LigneCommande,
} from '../accordCadre';

const cond = (extra: Partial<ConditionsAccordCadre> = {}): ConditionsAccordCadre => ({
  montantMiniHT: null, montantMaxiHT: 1000, dateFin: null, ...extra,
});
const ligne = (extra: Partial<LigneCommande> = {}): LigneCommande => ({
  articleId: 'a1', designation: 'Carrelage', unite: 'm²', quantite: 10, prixUnitaire: 45, ...extra,
});

describe('consommation', () => {
  it('cumule les subséquents, ignore les résiliés et calcule le reste', () => {
    const c = consommation(cond(), [{ montant_ht: 300 }, { montant_ht: 200, statut: 'resilie' }, { montant_ht: 100, statut: 'en_cours' }]);
    expect(c).toMatchObject({ cumulHT: 400, resteMaxiHT: 600, pctMaxi: 40, statut: 'normal' });
  });

  it('signale la proximité à 80 %, l’atteinte et le dépassement', () => {
    expect(consommation(cond(), [{ montant_ht: 800 }]).statut).toBe('proche');
    expect(consommation(cond(), [{ montant_ht: 1000 }]).statut).toBe('atteint');
    const depasse = consommation(cond(), [{ montant_ht: 1200 }]);
    expect(depasse).toMatchObject({ statut: 'depasse', resteMaxiHT: 0 });
  });

  it('sans maximum, aucun plafond ; le minimum se suit à part', () => {
    const c = consommation(cond({ montantMaxiHT: null, montantMiniHT: 500 }), [{ montant_ht: 200 }]);
    expect(c).toMatchObject({ statut: 'sans_plafond', resteMaxiHT: null, pctMaxi: null, resteAuMiniHT: 300, miniAtteint: false });
    expect(consommation(cond({ montantMiniHT: 100 }), [{ montant_ht: 200 }])).toMatchObject({ resteAuMiniHT: 0, miniAtteint: true });
  });
});

describe('verifierEmission', () => {
  const base = { signe: true, conditions: cond({ dateFin: '2027-12-31' }), cumulAutresHT: 400, montantHT: 600, dateNotification: '2026-10-20' };

  it('accepte jusqu’au maximum exactement', () => {
    expect(verifierEmission(base)).toEqual({ ok: true });
  });

  it('refuse au-delà du maximum', () => {
    expect(verifierEmission({ ...base, montantHT: 600.01 })).toMatchObject({ ok: false, code: 'PLAFOND_DEPASSE' });
  });

  it('refuse un accord-cadre non signé avant tout autre motif', () => {
    expect(verifierEmission({ ...base, signe: false, montantHT: 99999 })).toMatchObject({ ok: false, code: 'ACCORD_CADRE_NON_SIGNE' });
  });

  it('borne la notification, pas l’exécution', () => {
    expect(verifierEmission({ ...base, dateNotification: '2028-01-01' })).toMatchObject({ ok: false, code: 'ACCORD_CADRE_ECHU' });
    expect(verifierEmission({ ...base, dateNotification: '2027-12-31' })).toEqual({ ok: true });
  });

  it('refuse un montant négatif ou illisible', () => {
    expect(verifierEmission({ ...base, montantHT: -1 })).toMatchObject({ code: 'MONTANT_INVALIDE' });
    expect(verifierEmission({ ...base, montantHT: Number.NaN })).toMatchObject({ code: 'MONTANT_INVALIDE' });
  });
});

describe('lignes de commande', () => {
  it('calcule les montants au centime', () => {
    expect(montantLigne(ligne({ quantite: 3, prixUnitaire: 0.1 }))).toBe(0.3);
    expect(totalLignes([ligne(), ligne({ quantite: 2, prixUnitaire: 12.5 })])).toBe(475);
  });

  it('exige des lignes et des valeurs positives', () => {
    expect(validerLignesCommande([], null).ok).toBe(false);
    expect(validerLignesCommande([ligne({ quantite: -1 })], null).ok).toBe(false);
    expect(validerLignesCommande([ligne({ designation: ' ' })], null).ok).toBe(false);
  });

  it('contrôle les prix contre le bordereau figé, sans en inventer', () => {
    const bordereau = { a1: 45, a2: null };
    expect(validerLignesCommande([ligne()], bordereau).ok).toBe(true);
    expect(validerLignesCommande([ligne({ prixUnitaire: 50 })], bordereau).erreurs[0]).toContain('supérieur au bordereau');
    expect(validerLignesCommande([ligne({ prixUnitaire: 40 })], bordereau).ok).toBe(true);
    expect(validerLignesCommande([ligne({ articleId: 'a2' })], bordereau).erreurs[0]).toContain('absent du bordereau');
    expect(validerLignesCommande([ligne({ articleId: undefined })], bordereau).ok).toBe(false);
  });

  it('ne contrôle pas les prix d’un accord-cadre saisi à la main', () => {
    expect(validerLignesCommande([ligne({ prixUnitaire: 999 })], null).ok).toBe(true);
    expect(validerLignesCommande([ligne({ prixUnitaire: 999 })], {}).ok).toBe(true);
  });
});

describe('bordereau de l’accord-cadre', () => {
  const lot: any = {
    id: 'l2', numero: '02', titre: 'Carrelage',
    chapitres: [
      { id: 'c1', numero: '1', titre: 'Sols', lignes: [
        { id: 'a1', numero: '1.1', designation: 'Carrelage', unite: 'm²', quantite: 0, prixUnitaire: 0 },
        { id: 'p', numero: '1.2', designation: 'Parent', unite: '', quantite: 0, prixUnitaire: 0, children: [
          { id: 'a2', numero: '1.2.1', designation: 'Plinthe', unite: 'ml', quantite: 0, prixUnitaire: 0 },
          { id: 'a3', numero: '1.2.2', designation: 'Non chiffré', unite: 'u', quantite: 0, prixUnitaire: 0 },
        ] },
      ] },
      { id: 'c0', numero: '0', titre: 'Prescriptions', cctpOnly: true, lignes: [{ id: 'a9', numero: '0.1', designation: 'Texte', unite: '', quantite: 0, prixUnitaire: 0 }] },
    ],
  };

  it('ne propose que les feuilles chiffrées hors chapitres CCTP', () => {
    const articles = articlesDuBordereau(lot, { a1: 45, a2: 8.5, a3: null, a9: 10 });
    expect(articles.map(a => [a.articleId, a.prixUnitaire])).toEqual([['a1', 45], ['a2', 8.5]]);
  });

  it('rend une liste vide sans lot ni prix', () => {
    expect(articlesDuBordereau(undefined, { a1: 1 })).toEqual([]);
    expect(articlesDuBordereau(lot, null)).toEqual([]);
  });

  it('retrouve le lot par numéro, « 2 » valant « 02 »', () => {
    expect(lotDuMarche([lot], '2')?.id).toBe('l2');
    expect(lotDuMarche([lot], '02')?.id).toBe('l2');
    expect(lotDuMarche([lot], '03')).toBeUndefined();
    expect(lotDuMarche([lot], undefined)).toBeUndefined();
  });

  it('lit les conditions depuis la ligne de marché', () => {
    expect(conditionsDe({ montant_mini_ht: '200.00', montant_maxi_ht: 1000, date_fin_accord_cadre: '2027-12-31T00:00:00Z' }))
      .toEqual({ montantMiniHT: 200, montantMaxiHT: 1000, dateFin: '2027-12-31' });
    expect(conditionsDe({})).toEqual({ montantMiniHT: null, montantMaxiHT: null, dateFin: null });
  });
});

describe('mentionMarche', () => {
  it('garde la formule habituelle pour un marché ordinaire', () => {
    expect(mentionMarche({ entreprise_nom: 'Dupont SARL', lot_numero: '02' })).toBe('Dupont SARL, lot 02');
    expect(mentionMarche({ entreprise_nom: 'Dupont SARL' })).toBe('Dupont SARL');
  });

  it('cite l’accord-cadre pour un marché subséquent', () => {
    expect(mentionMarche({ type_marche: 'subsequent', numero_subsequent: 3, entreprise_nom: 'Dupont SARL', lot_numero: '02' }))
      .toBe("Dupont SARL, lot 02, marché subséquent n°3 de l'accord-cadre");
  });
});

describe('libelleMarche', () => {
  it('distingue accord-cadre, subséquent et marché ordinaire', () => {
    expect(libelleMarche({ type_marche: 'accord_cadre', lot_numero: '02', entreprise_nom: 'Dupont' })).toBe('AC lot 02 Dupont');
    expect(libelleMarche({ type_marche: 'subsequent', numero_subsequent: 3, lot_numero: '02', entreprise_nom: 'Dupont' })).toBe('MS n°3 lot 02 Dupont');
    expect(libelleMarche({ type_marche: 'marche', lot_numero: '02', entreprise_nom: 'Dupont' })).toBe('lot 02 Dupont');
  });
});

describe('groupe de titulaires', () => {
  const tous: any[] = [
    { id: 'a', type_marche: 'accord_cadre' },
    { id: 'b', type_marche: 'accord_cadre', accord_cadre_groupe_id: 'a' },
    { id: 'c', type_marche: 'accord_cadre' },
    { id: 's1', type_marche: 'subsequent', parent_marche_id: 'b' },
    { id: 's2', type_marche: 'subsequent', parent_marche_id: 'c' },
  ];
  it('retrouve la tête et les membres depuis n’importe quel titulaire', () => {
    expect(teteDuGroupe(tous[1], tous).id).toBe('a');
    expect(membresDuGroupe(tous[1], tous).map(x => x.id)).toEqual(['a', 'b']);
    expect(membresDuGroupe(tous[2], tous).map(x => x.id)).toEqual(['c']);
  });
  it('réunit les subséquents de tout le groupe', () => {
    expect(subsequentsDuGroupe(membresDuGroupe(tous[0], tous), tous).map(x => x.id)).toEqual(['s1']);
  });
});

describe('remise en concurrence', () => {
  const lignes = [
    { articleId: 'a1', designation: 'Carrelage', unite: 'm²', quantite: 10 },
    { articleId: 'a2', designation: 'Plinthe', unite: 'ml', quantite: 5 },
  ];
  const offre = (marche_id: string, p1: number | null, p2: number | null, extra = {}) => ({ marche_id, prix: { a1: p1, a2: p2 }, ...extra });

  it('totalise une offre complète, null sinon ou si déclinée', () => {
    expect(totalOffre(lignes, offre('x', 40, 8))).toBe(440);
    expect(totalOffre(lignes, offre('x', 40, null))).toBeNull();
    expect(totalOffre(lignes, offre('x', 40, 8, { declinee: true }))).toBeNull();
  });
  it('classe du moins-disant au plus cher, les incomplètes écartées', () => {
    const r = classerOffres(lignes, [offre('cher', 50, 9), offre('inc', 1, null), offre('bon', 40, 8)]);
    expect(r.map(x => x.offre.marche_id)).toEqual(['bon', 'cher']);
  });
  it('refuse un prix supérieur au bordereau du titulaire', () => {
    expect(verifierOffre(lignes, { a1: 46, a2: 8 }, { a1: 45, a2: 8 }).ok).toBe(false);
    expect(verifierOffre(lignes, { a1: 44, a2: 8 }, { a1: 45, a2: 8 }).ok).toBe(true);
  });
  it('compose les lignes de commande aux prix retenus', () => {
    expect(lignesCommandeDepuisOffre(lignes, offre('x', 40, 8)).map(l => l.prixUnitaire)).toEqual([40, 8]);
  });
});
