import { describe, it, expect } from 'vitest';
import {
  BASE_KEY, negociationVide, remplacerNegociation, trouverNegociation,
  montantOuverture, montantVerifie, montantCourant, baseA, optionsA, totalA,
  objectifTotal, resteAObtenir, gainObtenu, statutNegociation, reperesLot,
  piecesManquantes, basculerPiece, PIECES_OFFRE_DEFAUT, syntheseLot, totauxOperation,
  coefficientActualisation, controleTolerance, ajouterLigne, retirerLigne, formaterPourcent,
  aujourdhui, PARAMETRES_DEFAUT, type Negociation, type OffreMontant, type TourNegociation,
} from '../actNegociation';

const offre = (e: string, base: number, p: Partial<OffreMontant> = {}): OffreMontant => ({
  lot_id: 'L1', entreprise_id: e, montant_base: base, conforme: true, ...p,
});
const tour = (date: string, montants: Record<string, number>, p: Partial<TourNegociation> = {}): TourNegociation => ({
  id: `${date}-${Object.keys(montants).join('')}`, date, montants, ...p,
});
const neg = (p: Partial<Negociation> = {}): Negociation => ({ ...negociationVide('L1', 'A'), ...p });

describe('montants d\'une offre', () => {
  it('la base vient de l\'offre, les options de la négociation', () => {
    const n = neg({ lignes: [{ id: 'o1', kind: 'option', libelle: 'Option 1', montant_ouverture: 500 }] });
    const o = offre('A', 10000);
    expect(montantOuverture(o, n, BASE_KEY)).toBe(10000);
    expect(montantOuverture(o, n, 'o1')).toBe(500);
  });

  it('le prix vérifié corrige l\'ouverture sans la modifier', () => {
    const n = neg({ montants_verifies: { [BASE_KEY]: 9800 } });
    const o = offre('A', 10000);
    expect(montantVerifie(o, n, BASE_KEY)).toBe(9800);
    expect(montantOuverture(o, n, BASE_KEY)).toBe(10000);
  });

  it('le prix courant est celui du dernier tour qui a touché la ligne', () => {
    const n = neg({
      lignes: [{ id: 'o1', kind: 'option', libelle: 'O', montant_ouverture: 500 }],
      tours: [tour('2026-09-01', { [BASE_KEY]: 9500, o1: 450 }), tour('2026-09-10', { [BASE_KEY]: 9200 })],
    });
    const o = offre('A', 10000);
    expect(montantCourant(o, n, BASE_KEY)).toBe(9200);
    // L'option n'a pas bougé au second tour : elle garde le prix du premier.
    expect(montantCourant(o, n, 'o1')).toBe(450);
  });

  it('les tours se lisent dans l\'ordre des dates, pas de la saisie', () => {
    const n = neg({ tours: [tour('2026-09-10', { [BASE_KEY]: 9200 }), tour('2026-09-01', { [BASE_KEY]: 9500 })] });
    expect(montantCourant(offre('A', 10000), n, BASE_KEY)).toBe(9200);
  });

  it('sans négociation, le courant est l\'ouverture', () => {
    expect(montantCourant(offre('A', 10000), undefined, BASE_KEY)).toBe(10000);
  });

  it('les variantes ne s\'additionnent jamais au total', () => {
    const n = neg({
      lignes: [
        { id: 'o1', kind: 'option', libelle: 'O', montant_ouverture: 500 },
        { id: 'v1', kind: 'variante', libelle: 'V', montant_ouverture: 7000 },
      ],
    });
    const o = offre('A', 10000);
    expect(optionsA(o, n, 'ouverture')).toBe(500);
    expect(totalA(o, n, 'ouverture')).toBe(10500);
    expect(baseA(o, n, 'ouverture')).toBe(10000);
  });

  it('arrondit au centime', () => {
    const n = neg({ lignes: [{ id: 'o1', kind: 'option', libelle: 'O', montant_ouverture: 0.1 }, { id: 'o2', kind: 'option', libelle: 'O', montant_ouverture: 0.2 }] });
    expect(optionsA(offre('A', 1), n, 'ouverture')).toBe(0.3);
  });
});

describe('objectif, reste à obtenir et gain', () => {
  const n = neg({
    lignes: [{ id: 'o1', kind: 'option', libelle: 'O', montant_ouverture: 1000 }],
    objectifs: { [BASE_KEY]: 9000 },
    tours: [tour('2026-09-01', { [BASE_KEY]: 9600, o1: 900 })],
  });
  const o = offre('A', 10000);

  it('l\'objectif retombe sur le prix vérifié d\'une ligne sans objectif', () => {
    expect(objectifTotal(o, n)).toBe(9000 + 1000);
  });
  it('le reste à obtenir est positif tant que le prix est au-dessus de l\'objectif', () => {
    expect(resteAObtenir(o, n)).toBe(9600 + 900 - 10000);
  });
  it('le gain est la baisse depuis l\'ouverture', () => {
    expect(gainObtenu(o, n)).toBe(11000 - 10500);
  });
});

describe('statut', () => {
  const o = offre('A', 10000);
  it('à vérifier par défaut', () => expect(statutNegociation(undefined, o, false)).toBe('a_verifier'));
  it('à négocier une fois vérifiée', () => expect(statutNegociation(neg({ verifie: true }), o, false)).toBe('a_negocier'));
  it('en négociation dès le premier tour', () => {
    expect(statutNegociation(neg({ tours: [tour('2026-09-01', { [BASE_KEY]: 9000 })] }), o, false)).toBe('en_negociation');
  });
  it('offre finale quand le dernier tour (par date) l\'est', () => {
    const n = neg({ tours: [tour('2026-09-10', { [BASE_KEY]: 8800 }, { finale: true }), tour('2026-09-01', { [BASE_KEY]: 9000 })] });
    expect(statutNegociation(n, o, false)).toBe('offre_finale');
  });
  it('écartée si non conforme ou écartée de la négociation', () => {
    expect(statutNegociation(undefined, offre('A', 1, { conforme: false }), false)).toBe('ecartee');
    expect(statutNegociation(neg({ ecartee: true }), o, false)).toBe('ecartee');
  });
  it('retenue l\'emporte sur tout', () => {
    expect(statutNegociation(neg({ ecartee: true }), o, true)).toBe('retenue');
  });
});

describe('repères d\'un lot', () => {
  const offres = [offre('A', 10000), offre('B', 8000), offre('C', 6000, { conforme: false }), offre('D', 0)];

  it('ignore les offres non conformes, non chiffrées et écartées', () => {
    const r = reperesLot(offres, [neg({ entreprise_id: 'B', ecartee: true })], 'L1', 'ouverture');
    expect(r.moinsDisantId).toBe('A');
    expect(r.nbOffres).toBe(1);
  });

  it('le moins-disant et la moyenne portent sur la base', () => {
    const r = reperesLot(offres, [], 'L1', 'ouverture');
    expect(r.moinsDisantId).toBe('B');
    expect(r.base).toBe(8000);
    expect(r.moyenneBase).toBe(9000);
  });

  it('suit les prix négociés : le classement peut changer', () => {
    const negs = [neg({ entreprise_id: 'A', tours: [tour('2026-09-01', { [BASE_KEY]: 7000 })] })];
    const r = reperesLot(offres, negs, 'L1', 'courant');
    expect(r.moinsDisantId).toBe('A');
    expect(r.base).toBe(7000);
    // À l'ouverture, B restait le moins-disant.
    expect(reperesLot(offres, negs, 'L1', 'ouverture').moinsDisantId).toBe('B');
  });

  it('sans offre exploitable, rien', () => {
    const r = reperesLot([], [], 'L1', 'ouverture');
    expect(r).toEqual({ moinsDisantId: null, base: null, total: null, moyenneBase: null, nbOffres: 0 });
  });
});

describe('négociations d\'une consultation', () => {
  it('remplace sans muter, ou ajoute', () => {
    const a = neg({ entreprise_id: 'A' });
    const liste = [a];
    const maj = remplacerNegociation(liste, { ...a, verifie: true });
    expect(liste[0].verifie).toBeUndefined();
    expect(maj).toHaveLength(1);
    expect(maj[0].verifie).toBe(true);
    expect(remplacerNegociation(maj, neg({ entreprise_id: 'B' }))).toHaveLength(2);
    expect(remplacerNegociation(undefined, a)).toHaveLength(1);
  });
  it('retrouve par lot et entreprise', () => {
    expect(trouverNegociation([neg({ entreprise_id: 'A' })], 'L1', 'A')).toBeDefined();
    expect(trouverNegociation([neg({ entreprise_id: 'A' })], 'L2', 'A')).toBeUndefined();
  });
  it('ajoute puis retire une ligne avec tout ce qui s\'y rapporte', () => {
    const avec = ajouterLigne(ajouterLigne(neg(), 'option', 'o1'), 'variante', 'v1');
    expect(avec.lignes.map(l => l.libelle)).toEqual(['Option 1', 'Variante 1']);
    const charge = {
      ...avec,
      montants_verifies: { o1: 5, v1: 6 }, objectifs: { o1: 4 },
      tours: [tour('2026-09-01', { o1: 3, [BASE_KEY]: 9 })],
    };
    const sans = retirerLigne(charge, 'o1');
    expect(sans.lignes.map(l => l.id)).toEqual(['v1']);
    expect(sans.montants_verifies).toEqual({ v1: 6 });
    expect(sans.objectifs).toEqual({});
    expect(sans.tours[0].montants).toEqual({ [BASE_KEY]: 9 });
    // L'original n'a pas bougé.
    expect(charge.lignes).toHaveLength(2);
  });
});

describe('pièces', () => {
  it('liste les pièces manquantes et se coche sans muter', () => {
    const attendues = PIECES_OFFRE_DEFAUT.slice(0, 3);
    expect(piecesManquantes(attendues, undefined, 'A')).toHaveLength(3);
    const recues = basculerPiece(undefined, 'A', 'rc');
    expect(piecesManquantes(attendues, recues, 'A').map(p => p.id)).toEqual(['ae', 'cctp']);
    const rouverte = basculerPiece(recues, 'A', 'rc');
    expect(rouverte.A).toEqual([]);
    expect(recues.A).toEqual(['rc']);
  });
});

describe('synthèse d\'un lot', () => {
  const lot = { id: 'L1' };
  const offres = [offre('A', 120000), offre('B', 100000)];

  it('reprend l\'estimatif du DPGF quand rien n\'est saisi', () => {
    const l = syntheseLot({ lot, estimatifDpgf: 110000, offres, etage: 'ouverture' });
    expect(l.estimation_pro_base).toBe(110000);
    expect(l.estimation_pro_options).toBe(110000);
    expect(l.moinsDisantId).toBe('B');
    expect(l.ecart_base).toBe(-10000);
    expect(l.ecart_base_pct).toBeCloseTo(-10000 / 110000);
    expect(l.decision).toBe('a_negocier');
  });

  it('la saisie l\'emporte sur le DPGF, et l\'évolution compare à l\'APD', () => {
    const l = syntheseLot({
      lot, estimatifDpgf: 1, offres, etage: 'ouverture',
      saisie: { estimation_apd: 90000, estimation_pro_base: 100000, estimation_pro_options: 108000 },
    });
    expect(l.evolution).toBe(18000);
    expect(l.evolution_pct).toBeCloseTo(0.2);
    expect(l.ecart_total).toBe(-8000);
  });

  it('un lot attribué passe en attribution, un lot sans offre reste à l\'estimation', () => {
    expect(syntheseLot({ lot, offres, attributionEntrepriseId: 'B', etage: 'courant' }).decision).toBe('attribution');
    const vide = syntheseLot({ lot, offres: [], estimatifDpgf: 50, etage: 'courant' });
    expect(vide.decision).toBe('estimation');
    expect(vide.valoriseALEstimation).toBe(true);
  });

  it('l\'objectif saisi l\'emporte sur celui de l\'offre moins-disante', () => {
    const negs = [neg({ entreprise_id: 'B', objectifs: { [BASE_KEY]: 95000 } })];
    expect(syntheseLot({ lot, offres, negociations: negs, etage: 'ouverture' }).objectif).toBe(95000);
    expect(syntheseLot({ lot, offres, negociations: negs, etage: 'ouverture', saisie: { objectif: 90000 } }).objectif).toBe(90000);
  });
});

describe('totaux de l\'opération', () => {
  const lignes = [
    syntheseLot({ lot: { id: 'L1' }, offres: [offre('A', 80000)], etage: 'ouverture', saisie: { estimation_apd: 90000, estimation_pro_base: 100000 } }),
    // Lot sans offre : valorisé à son estimation, sinon le dépassement serait faussé.
    syntheseLot({ lot: { id: 'L2' }, offres: [], etage: 'ouverture', saisie: { estimation_apd: 40000, estimation_pro_base: 50000 } }),
  ];
  it('somme les estimations et valorise les lots sans offre à l\'estimation', () => {
    const t = totauxOperation(lignes, PARAMETRES_DEFAUT);
    expect(t.estimation_pro_base).toBe(150000);
    expect(t.offres_base).toBe(130000);
    expect(t.ecart_base).toBe(-20000);
    expect(t.evolution).toBe(20000);
  });
  it('calcule la TVA et le TTC au taux demandé', () => {
    const t = totauxOperation(lignes, { tva_pct: 10, tolerance_pct: 7 });
    expect(t.tva_total).toBe(13000);
    expect(t.ttc_offres_total).toBe(143000);
  });
  it('ne divise pas par zéro', () => {
    const t = totauxOperation([], PARAMETRES_DEFAUT);
    expect(t.evolution_pct).toBeNull();
    expect(t.ecart_total_pct).toBeNull();
  });
});

describe('actualisation et tolérance du CCAP', () => {
  it('coefficient = indice connu / indice à l\'estimation (cas du tableau : 875,1 / 860,2)', () => {
    const c = coefficientActualisation({ ...PARAMETRES_DEFAUT, indice_connu: 875.1, indice_estimation: 860.2 });
    expect(c - 1).toBeCloseTo(0.01732, 4);
  });
  it('sans indices, pas d\'actualisation', () => {
    expect(coefficientActualisation(PARAMETRES_DEFAUT)).toBe(1);
    expect(coefficientActualisation({ ...PARAMETRES_DEFAUT, indice_connu: 875 })).toBe(1);
  });
  it('trois niveaux : sous l\'estimation, dans la tolérance, au-delà', () => {
    expect(controleTolerance(95, 100, PARAMETRES_DEFAUT).niveau).toBe('ok');
    expect(controleTolerance(106, 100, PARAMETRES_DEFAUT).niveau).toBe('tolere');
    expect(controleTolerance(108, 100, PARAMETRES_DEFAUT).niveau).toBe('depasse');
  });
  it('la tolérance joue sur l\'estimation actualisée', () => {
    const c = controleTolerance(103, 100, { tva_pct: 20, tolerance_pct: 7, indice_connu: 102, indice_estimation: 100 });
    expect(c.estimation_actualisee).toBe(102);
    expect(c.plafond).toBe(109.14);
    expect(c.depassement).toBe(1);
    expect(c.niveau).toBe('tolere');
  });
});

describe('mise en forme', () => {
  it('pourcentages à la française, signe seulement quand il informe', () => {
    expect(formaterPourcent(0.0867)).toBe('+8,7 %');
    expect(formaterPourcent(-0.25)).toBe('-25,0 %');
    expect(formaterPourcent(null)).toBe('—');
    expect(formaterPourcent(0.05, false)).toBe('5,0 %');
  });
  it('date du jour en heure locale', () => {
    expect(aujourdhui(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05');
  });
});

describe('assemblage depuis la consultation', () => {
  it('reprend l\'estimatif du sous-total du comparatif et suit l\'attribution', async () => {
    const m = await import('../actNegociation');
    const lignes = m.lignesSynthese(
      [{ id: 'L1' }, { id: 'L2' }],
      {
        offres: [offre('A', 100)], attributions: [{ lot_id: 'L1', entreprise_id: 'A' }],
        comparatif: [{ lot_id: 'L1', articles: [{ is_subtotal: false, estimatif: 5 }, { is_subtotal: true, estimatif: 120 }] }],
      },
      'courant',
    );
    expect(lignes[0].estimation_pro_base).toBe(120);
    expect(lignes[0].decision).toBe('attribution');
    expect(lignes[1].decision).toBe('estimation');
  });

  it('le prix courant alimente l\'analyse et l\'attribution, base + options', async () => {
    const m = await import('../actNegociation');
    const n = neg({
      lignes: [{ id: 'o1', kind: 'option', libelle: 'O', montant_ouverture: 1000 }],
      tours: [tour('2026-09-01', { [BASE_KEY]: 9000 })],
    });
    const o = offre('A', 10000);
    expect(m.offresAuPrixCourant([o, offre('B', 5)], [n]).map(x => x.montant_base)).toEqual([9000, 5]);
    expect(m.montantAttribution(o, [n])).toBe(10000);
    expect(o.montant_base).toBe(10000);
  });
});
