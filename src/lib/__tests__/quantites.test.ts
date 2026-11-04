// Calcul des quantités et métré (src/lib/quantites.ts) : un calcul invalide se voit au lieu de valoir 0,
// la formule saisie est mémorisée, un métré est une liste de lignes dont la somme est la quantité.
import { describe, expect, it } from 'vitest';
import {
  appliquerMetre, calculerSaisie, formuleCourante, libelleDetail, MAX_LIGNES_METRE, metreEnTexte, prixPatch, quantitePatch,
  serialiserMetre, totalMetre, validerMetre,
} from '../quantites';
import type { Ligne, QuantiteDetail } from '../../types/dpgf';

const ligne = (surcharge: Partial<Ligne> = {}): Ligne => ({
  id: 'a1', numero: '1.2', designation: 'Enduit', unite: 'm²', quantite: 27.6, prixUnitaire: 48.5, prixTotal: 1338.6, type: 'ouvrage', ...surcharge,
});
const detail = (id: string, surcharge: Partial<QuantiteDetail> = {}): QuantiteDetail => ({ id, quantite: 0, ...surcharge });

describe('calculerSaisie', () => {
  it('lit un nombre, virgule française et espaces admis', () => {
    expect(calculerSaisie('10')).toEqual({ ok: true, valeur: 10 });
    expect(calculerSaisie(' 10,5 ')).toEqual({ ok: true, valeur: 10.5 });
    expect(calculerSaisie('1 234,5')).toEqual({ ok: true, valeur: 1234.5 });
    expect(calculerSaisie('-2,4')).toEqual({ ok: true, valeur: -2.4 });
  });

  it('une saisie vide vaut 0', () => {
    expect(calculerSaisie('')).toEqual({ ok: true, valeur: 0 });
    expect(calculerSaisie('   ')).toEqual({ ok: true, valeur: 0 });
  });

  it('évalue une formule : opérateurs, priorités, parenthèses, moins unaire', () => {
    expect(calculerSaisie('=4*5')).toEqual({ ok: true, valeur: 20 });
    expect(calculerSaisie(' = 12 * 3,5 ')).toEqual({ ok: true, valeur: 42 });
    expect(calculerSaisie('=2+3*4')).toEqual({ ok: true, valeur: 14 });
    expect(calculerSaisie('=(2+3)*4')).toEqual({ ok: true, valeur: 20 });
    expect(calculerSaisie('=-(2+3)')).toEqual({ ok: true, valeur: -5 });
    expect(calculerSaisie('=10/4')).toEqual({ ok: true, valeur: 2.5 });
  });

  it('efface le reste de calcul flottant sans rien arrondir de ce qui est écrit', () => {
    expect(calculerSaisie('=17,7+7,35')).toEqual({ ok: true, valeur: 25.05 });
    expect(calculerSaisie('=0,1+0,2')).toEqual({ ok: true, valeur: 0.3 });
  });

  it('refuse ce qui n\'est pas de l\'arithmétique, au lieu de le transformer en 0', () => {
    for (const mauvais of ['abc', '12 m', '=4*', '=*4', '=(2+3', '=2+3)', '=4*abc', '=2**3', '=1/0', '=', '=()', '1,2,3', '=1.2.3']) {
      expect(calculerSaisie(mauvais), mauvais).toEqual({ ok: false });
    }
  });

  it('refuse du code : seuls chiffres, opérateurs et parenthèses comptent', () => {
    expect(calculerSaisie('=alert(1)')).toEqual({ ok: false });
    expect(calculerSaisie('=constructor')).toEqual({ ok: false });
  });
});

describe('métré', () => {
  const lignes = [
    detail('1', { libelle: 'Façade Est', expression: '10', quantite: 10 }),
    detail('2', { libelle: 'Façade Ouest', expression: '=4*5', quantite: 20 }),
    detail('3', { libelle: 'Déduction baie', expression: '-2,4', quantite: -2.4 }),
  ];

  it('le total est la somme des valeurs, déductions comprises', () => {
    expect(totalMetre(lignes)).toBe(27.6);
  });

  it('une ligne sans calcul garde sa quantité (ventilation d\'avant)', () => {
    expect(totalMetre([detail('1', { local: 'Salle', quantite: 8 }), detail('2', { local: 'Hall', quantite: 2.5 })])).toBe(10.5);
  });

  it('le calcul saisi prime sur la quantité enregistrée', () => {
    expect(totalMetre([detail('1', { expression: '=3*3', quantite: 0 })])).toBe(9);
  });

  it('valide un métré correct', () => {
    expect(validerMetre(lignes)).toEqual({ ok: true, total: 27.6 });
  });

  it('refuse un total négatif', () => {
    expect(validerMetre([detail('1', { expression: '5', quantite: 5 }), detail('2', { expression: '-8', quantite: -8 })]))
      .toEqual({ ok: false, erreur: { type: 'total_negatif' } });
  });

  it('désigne la première ligne invalide', () => {
    expect(validerMetre([detail('1', { expression: '10', quantite: 10 }), detail('2', { expression: '=4*', quantite: 0 })]))
      .toEqual({ ok: false, erreur: { type: 'ligne_invalide', index: 1 } });
  });

  it('borne le nombre de lignes et les valeurs', () => {
    const trop = Array.from({ length: MAX_LIGNES_METRE + 1 }, (_, i) => detail(String(i), { expression: '1', quantite: 1 }));
    expect(validerMetre(trop)).toEqual({ ok: false, erreur: { type: 'trop_de_lignes' } });
    expect(validerMetre([detail('1', { expression: '=1000000*1000000', quantite: 0 })])).toEqual({ ok: false, erreur: { type: 'hors_limites' } });
  });

  it('libellé : le libellé libre, sinon niveau et local d\'une ventilation d\'avant', () => {
    expect(libelleDetail(detail('1', { libelle: ' Façade Est ' }))).toBe('Façade Est');
    expect(libelleDetail(detail('1', { niveau: 'R+1', local: 'Chambre 2' }))).toBe('R+1 · Chambre 2');
    expect(libelleDetail(detail('1'))).toBe('');
  });
});

describe('appliquerMetre', () => {
  const lignes = [
    detail('1', { libelle: 'Façade Est', expression: '10', quantite: 10 }),
    detail('2', { libelle: 'Façade Ouest', expression: '=4*5', quantite: 20 }),
    detail('3', { libelle: 'Déduction baie', expression: '-2,4', quantite: -2.4 }),
  ];

  it('la quantité devient la somme, le prix total suit, le calcul reste', () => {
    const patch = appliquerMetre(ligne({ quantite: 5 }), lignes)!;
    expect(patch.quantite).toBe(27.6);
    expect(patch.prixTotal).toBeCloseTo(1338.6, 6);
    expect(patch.quantiteDetails).toHaveLength(3);
    expect(patch.quantiteDetails![1]).toMatchObject({ libelle: 'Façade Ouest', expression: '=4*5', quantite: 20 });
  });

  it('une ligne pour mémoire garde un montant à 0', () => {
    expect(appliquerMetre(ligne({ pourMemoire: true, prixUnitaire: 0 }), lignes)!.prixTotal).toBe(0);
  });

  it('retire la formule mémorisée : la quantité vient du métré', () => {
    const patch = appliquerMetre(ligne({ quantiteFormule: '=10+20' }), lignes)!;
    expect(patch.quantiteFormule).toBeUndefined();
  });

  it('garde les champs d\'une ventilation d\'avant (bâtiment, phase, note)', () => {
    const avant = [detail('1', { batimentId: 'b1', phaseId: 'p1', niveau: 'R+1', local: 'Salle', note: 'à vérifier', quantite: 8 })];
    expect(appliquerMetre(ligne(), avant)!.quantiteDetails![0]).toMatchObject({ batimentId: 'b1', phaseId: 'p1', niveau: 'R+1', local: 'Salle', note: 'à vérifier', quantite: 8 });
  });

  it('ignore les lignes entièrement vides', () => {
    const patch = appliquerMetre(ligne(), [...lignes, detail('4', { libelle: '', expression: '', quantite: 0 })])!;
    expect(patch.quantiteDetails).toHaveLength(3);
  });

  it('sans aucune ligne, le métré est retiré et la quantité reste', () => {
    const patch = appliquerMetre(ligne({ quantite: 27.6 }), [detail('1')])!;
    expect(patch.quantiteDetails).toBeUndefined();
    expect('quantite' in patch).toBe(false);
  });

  it('refuse un métré invalide', () => {
    expect(appliquerMetre(ligne(), [detail('1', { expression: '=4*', quantite: 0 })])).toBeNull();
    expect(appliquerMetre(ligne(), [detail('1', { expression: '-3', quantite: -3 })])).toBeNull();
  });
});

describe('quantitePatch : saisie dans la case quantité', () => {
  it('mémorise la formule tapée et en tire la quantité', () => {
    expect(quantitePatch(ligne({ quantite: 0, prixTotal: 0 }), '=10+20')).toEqual({ quantite: 30, prixTotal: 1455, quantiteFormule: '=10+20' });
  });

  it('un nombre simple efface la formule mémorisée', () => {
    expect(quantitePatch(ligne({ quantiteFormule: '=10+20' }), '25')).toEqual({ quantite: 25, prixTotal: 1212.5, quantiteFormule: undefined });
  });

  it('une formule invalide ne change rien (au lieu de mettre 0)', () => {
    expect(quantitePatch(ligne(), '=4*')).toBeNull();
    expect(quantitePatch(ligne(), 'abc')).toBeNull();
  });

  it('refuse un article dont la quantité vient d\'ailleurs : métré, bâtiments, sous-articles', () => {
    expect(quantitePatch(ligne({ quantiteDetails: [detail('1', { quantite: 3 })] }), '5')).toBeNull();
    expect(quantitePatch(ligne({ quantitesBatiments: { b1: 3 } } as Partial<Ligne>), '5')).toBeNull();
    expect(quantitePatch(ligne({ children: [ligne({ id: 'c1' })] }), '5')).toBeNull();
  });

  it('pour mémoire : quantité enregistrée, montant à 0', () => {
    expect(quantitePatch(ligne({ pourMemoire: true, prixUnitaire: 0 }), '12')).toMatchObject({ quantite: 12, prixTotal: 0 });
  });
});

describe('formuleCourante', () => {
  it('rend la formule tant qu\'elle donne encore la quantité', () => {
    expect(formuleCourante(ligne({ quantite: 30, quantiteFormule: '=10+20' }))).toBe('=10+20');
  });

  it('l\'oublie quand la quantité a changé par un autre chemin', () => {
    expect(formuleCourante(ligne({ quantite: 31, quantiteFormule: '=10+20' }))).toBeUndefined();
    expect(formuleCourante(ligne({ quantite: 30 }))).toBeUndefined();
    expect(formuleCourante(ligne({ quantite: 30, quantiteFormule: '=4*' }))).toBeUndefined();
  });
});

describe('serialiserMetre et metreEnTexte : le métré proposé par un confrère', () => {
  it('prépare la valeur envoyée : libellé et calcul de chaque ligne, lignes vides ignorées', () => {
    const json = serialiserMetre([
      detail('1', { libelle: ' Façade Est ', expression: '10', quantite: 10 }),
      detail('2', { niveau: 'R+1', local: 'Chambre 2', quantite: 20.5 }),
      detail('3', { libelle: '', expression: '', quantite: 0 }),
    ]);
    expect(JSON.parse(json)).toEqual([
      { libelle: 'Façade Est', expression: '10' },
      { libelle: 'R+1 · Chambre 2', expression: '20,5' },
    ]);
  });

  it('un métré vide se sérialise en liste vide', () => {
    expect(serialiserMetre([])).toBe('[]');
    expect(serialiserMetre([detail('1')])).toBe('[]');
  });

  it('affiche un métré en lignes lisibles, avec le total', () => {
    const texte = metreEnTexte(JSON.stringify([{ libelle: 'Façade Est', expression: '10' }, { libelle: 'Façade Ouest', expression: '=4*5' }, { libelle: 'Baie', expression: '-2,4' }]), 'm²');
    expect(texte).toBe('Façade Est : 10\nFaçade Ouest : =4*5\nBaie : -2,4\nTotal : 27,60 m²');
  });

  it('un métré vide ou illisible ne casse pas l\'affichage', () => {
    expect(metreEnTexte('[]')).toBe('');
    expect(metreEnTexte('')).toBe('');
    expect(metreEnTexte('pas du json')).toBe('pas du json');
  });
});

describe('prixPatch : saisie du prix unitaire', () => {
  it('un prix chiffre l\'article et sort du « pour mémoire »', () => {
    expect(prixPatch(ligne({ pourMemoire: true, prixUnitaire: 0, prixTotal: 0 }), '52')).toEqual({ pourMemoire: undefined, prixUnitaire: 52, prixTotal: 1435.2 });
  });

  it('accepte une formule et la virgule française', () => {
    expect(prixPatch(ligne(), '=40+8,5')).toMatchObject({ prixUnitaire: 48.5 });
    expect(prixPatch(ligne(), '48,5')).toMatchObject({ prixUnitaire: 48.5 });
  });

  it('« PM » remet l\'article pour mémoire', () => {
    expect(prixPatch(ligne(), 'PM')).toEqual({ pourMemoire: true, prixUnitaire: 0, prixTotal: 0 });
    expect(prixPatch(ligne(), 'P.M.')).toEqual({ pourMemoire: true, prixUnitaire: 0, prixTotal: 0 });
  });

  it('un prix invalide ne change rien', () => {
    expect(prixPatch(ligne(), '=4*')).toBeNull();
    expect(prixPatch(ligne(), 'beaucoup')).toBeNull();
  });

  it('refuse un prix chiffré sur un article à sous-articles : il porte la somme de ses enfants', () => {
    expect(prixPatch(ligne({ children: [ligne({ id: 'c1' })] }), '52')).toBeNull();
  });

  it('« PM » reste possible sur un article à sous-articles : il exclut tout son contenu du total', () => {
    expect(prixPatch(ligne({ children: [ligne({ id: 'c1' })] }), 'PM')).toEqual({ pourMemoire: true, prixUnitaire: 0, prixTotal: 0 });
  });
});
