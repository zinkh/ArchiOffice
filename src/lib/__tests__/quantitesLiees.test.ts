// Quantités liées (src/lib/quantitesLiees.ts) : un poste suit la quantité d'un autre, en cascade, avec un
// coefficient ; les liens qui ne tiennent plus sont retirés sans perdre la quantité.
import { describe, expect, it } from 'vitest';
import {
  adapterLiensCopie, candidatsSources, coefficientDe, delierPatch, fusionnerLiensDeCopie, lierPatch, ligneParId, liensDeCopie,
  peutSuivre, propagerLiens, suiveursDe,
} from '../quantitesLiees';
import { quantitePatch } from '../quantites';
import type { Chapitre, Ligne, Lot } from '../../types/dpgf';

const ligne = (id: string, surcharge: Partial<Ligne> = {}): Ligne => ({
  id, numero: id, designation: `Poste ${id}`, unite: 'm²', quantite: 0, prixUnitaire: 10, prixTotal: 0, type: 'ouvrage', ...surcharge,
});
const lot = (lignes: Ligne[], id = 'lot1'): Lot => ({
  id, numero: '01', titre: 'Lot', sousTotal: 0,
  chapitres: [{ id: `${id}-c`, numero: '1', titre: 'Chapitre', lignes } as Chapitre],
});
const lignesDe = (lots: Lot[]): Ligne[] => lots.flatMap(l => l.chapitres.flatMap(c => c.lignes));

describe('propagerLiens', () => {
  it('un suiveur reprend la quantité de sa source et son prix total suit', () => {
    const lots = [lot([
      ligne('doublage', { quantite: 120, prixTotal: 1200 }),
      ligne('peinture', { quantite: 5, quantiteLiee: { sourceId: 'doublage' }, prixUnitaire: 8 }),
    ])];
    const [, peinture] = lignesDe(propagerLiens(lots));
    expect(peinture.quantite).toBe(120);
    expect(peinture.prixTotal).toBe(960);
  });

  it('le coefficient multiplie la quantité de la source', () => {
    const lots = [lot([
      ligne('menuiserie', { quantite: 10 }),
      ligne('volets', { quantiteLiee: { sourceId: 'menuiserie', coefficient: 0.8 }, prixUnitaire: 100 }),
    ])];
    const [, volets] = lignesDe(propagerLiens(lots));
    expect(volets.quantite).toBe(8);
    expect(volets.prixTotal).toBe(800);
  });

  it('efface le reste de calcul flottant', () => {
    const lots = [lot([ligne('a', { quantite: 3 }), ligne('b', { quantiteLiee: { sourceId: 'a', coefficient: 0.1 } })])];
    expect(lignesDe(propagerLiens(lots))[1].quantite).toBe(0.3);
  });

  it('suit une chaîne : la peinture suit le doublage, qui suit les cloisons', () => {
    const lots = [lot([
      ligne('peinture', { quantiteLiee: { sourceId: 'doublage' } }),
      ligne('doublage', { quantiteLiee: { sourceId: 'cloisons', coefficient: 2 } }),
      ligne('cloisons', { quantite: 50 }),
    ])];
    const [peinture, doublage] = lignesDe(propagerLiens(lots));
    expect(doublage.quantite).toBe(100);
    expect(peinture.quantite).toBe(100);
  });

  it('suit une source située dans un autre lot et recalcule les deux sous-totaux', () => {
    const lots = [
      lot([ligne('doublage', { quantite: 20, prixTotal: 200 })], 'a'),
      lot([ligne('peinture', { quantiteLiee: { sourceId: 'doublage' }, prixUnitaire: 5 })], 'b'),
    ];
    const resultat = propagerLiens(lots);
    expect(resultat[1].sousTotal).toBe(100);
    expect(resultat[0]).toBe(lots[0]);
  });

  it('descend dans les sous-articles', () => {
    const parent = ligne('parent', { children: [ligne('enfant', { quantiteLiee: { sourceId: 'source' }, prixUnitaire: 2 })] });
    const lots = [lot([ligne('source', { quantite: 7 }), parent])];
    const enfant = lignesDe(propagerLiens(lots))[1].children![0];
    expect(enfant.quantite).toBe(7);
    expect(enfant.prixTotal).toBe(14);
  });

  it('un article pour mémoire garde un montant à 0', () => {
    const lots = [lot([ligne('a', { quantite: 4 }), ligne('b', { quantiteLiee: { sourceId: 'a' }, pourMemoire: true })])];
    const b = lignesDe(propagerLiens(lots))[1];
    expect(b.quantite).toBe(4);
    expect(b.prixTotal).toBe(0);
  });

  it('rend le même tableau quand rien ne change, et quand aucun lien n\'existe', () => {
    const sans = [lot([ligne('a', { quantite: 1 })])];
    expect(propagerLiens(sans)).toBe(sans);
    const juste = [lot([ligne('a', { quantite: 4, prixTotal: 40 }), ligne('b', { quantite: 4, prixTotal: 40, quantiteLiee: { sourceId: 'a' } })])];
    expect(propagerLiens(juste)).toBe(juste);
  });

  it('efface la formule mémorisée d\'un suiveur', () => {
    const lots = [lot([ligne('a', { quantite: 9 }), ligne('b', { quantite: 3, quantiteFormule: '=1+2', quantiteLiee: { sourceId: 'a' } })])];
    expect(lignesDe(propagerLiens(lots))[1].quantiteFormule).toBeUndefined();
  });

  it('source supprimée : le lien est retiré et la dernière quantité est gardée', () => {
    const lots = [lot([ligne('b', { quantite: 42, prixTotal: 420, quantiteLiee: { sourceId: 'disparue' } })])];
    const b = lignesDe(propagerLiens(lots))[0];
    expect(b.quantiteLiee).toBeUndefined();
    expect(b.quantite).toBe(42);
    expect(b.prixTotal).toBe(420);
  });

  it('une boucle (données importées) est défaite sans rien remettre à 0', () => {
    const lots = [lot([
      ligne('a', { quantite: 5, quantiteLiee: { sourceId: 'b' } }),
      ligne('b', { quantite: 6, quantiteLiee: { sourceId: 'a' } }),
    ])];
    const [a, b] = lignesDe(propagerLiens(lots));
    expect(a.quantiteLiee).toBeUndefined();
    expect(b.quantiteLiee).toBeUndefined();
    expect([a.quantite, b.quantite]).toEqual([5, 6]);
  });

  it('un article qui se suit lui-même perd son lien', () => {
    const lots = [lot([ligne('a', { quantite: 3, quantiteLiee: { sourceId: 'a' } })])];
    expect(lignesDe(propagerLiens(lots))[0].quantiteLiee).toBeUndefined();
  });

  it('un suiveur devenu parent, ou portant un métré, perd son lien et garde sa quantité', () => {
    const parent = ligne('p', { quantite: 8, quantiteLiee: { sourceId: 's' }, children: [ligne('e', { quantite: 1 })] });
    const metre = ligne('m', { quantite: 8, quantiteLiee: { sourceId: 's' }, quantiteDetails: [{ id: 'd', quantite: 8 }] });
    const lots = [lot([ligne('s', { quantite: 99 }), parent, metre])];
    const [, p, m] = lignesDe(propagerLiens(lots));
    expect(p.quantiteLiee).toBeUndefined();
    expect(p.quantite).toBe(8);
    expect(m.quantiteLiee).toBeUndefined();
    expect(m.quantite).toBe(8);
  });

  it('une source devenue parent ne se suit plus : le lien est retiré', () => {
    const lots = [lot([
      ligne('s', { quantite: 99, children: [ligne('e', { quantite: 1 })] }),
      ligne('b', { quantite: 7, quantiteLiee: { sourceId: 's' } }),
    ])];
    const b = lignesDe(propagerLiens(lots))[1];
    expect(b.quantiteLiee).toBeUndefined();
    expect(b.quantite).toBe(7);
  });

  it('ne modifie pas le tableau d\'origine', () => {
    const lots = [lot([ligne('a', { quantite: 2 }), ligne('b', { quantiteLiee: { sourceId: 'a' } })])];
    propagerLiens(lots);
    expect(lots[0].chapitres[0].lignes[1].quantite).toBe(0);
  });
});

describe('peutSuivre et candidatsSources', () => {
  const lots = [lot([
    ligne('a', { quantite: 1 }),
    ligne('b', { quantiteLiee: { sourceId: 'a' } }),
    ligne('c', { quantiteLiee: { sourceId: 'b' } }),
    ligne('parent', { children: [ligne('e')] }),
    ligne('titre', { type: 'titre' }),
    ligne('metre', { quantiteDetails: [{ id: 'd', quantite: 1 }] }),
    ligne('bat', { quantitesBatiments: { x: 1 } }),
  ])];

  it('accepte un lien simple', () => {
    expect(peutSuivre(lots, 'c', 'a')).toEqual({ ok: true });
  });

  it('refuse soi-même, un inconnu, et une boucle directe ou par la chaîne', () => {
    expect(peutSuivre(lots, 'a', 'a')).toEqual({ ok: false, raison: 'soi' });
    expect(peutSuivre(lots, 'a', 'inconnu')).toEqual({ ok: false, raison: 'introuvable' });
    expect(peutSuivre(lots, 'a', 'b')).toEqual({ ok: false, raison: 'cycle' });
    expect(peutSuivre(lots, 'a', 'c')).toEqual({ ok: false, raison: 'cycle' });
  });

  it('refuse une source parent ou non chiffrable, et un suiveur parent, à métré ou par bâtiment', () => {
    expect(peutSuivre(lots, 'a', 'parent')).toEqual({ ok: false, raison: 'source_invalide' });
    expect(peutSuivre(lots, 'a', 'titre')).toEqual({ ok: false, raison: 'source_invalide' });
    expect(peutSuivre(lots, 'parent', 'a')).toEqual({ ok: false, raison: 'suiveur_invalide' });
    expect(peutSuivre(lots, 'metre', 'a')).toEqual({ ok: false, raison: 'suiveur_invalide' });
  });

  it('un article par bâtiment ne peut suivre qu\'une source par bâtiment', () => {
    expect(peutSuivre(lots, 'bat', 'a')).toEqual({ ok: false, raison: 'batiments_incompatibles' });
    const deux = [lot([ligne('s', { quantitesBatiments: { x: 4 } }), ligne('f', { quantitesBatiments: { x: 0 } })])];
    expect(peutSuivre(deux, 'f', 's')).toEqual({ ok: true });
  });

  it('une source peut elle-même avoir un métré ou des bâtiments : seul le total compte', () => {
    expect(peutSuivre(lots, 'a', 'metre')).toEqual({ ok: true });
    expect(peutSuivre(lots, 'c', 'bat')).toEqual({ ok: true });
  });

  it('propose les ouvrages chiffrables hors soi et hors ses propres suiveurs', () => {
    const ids = candidatsSources(lots, 'a').map(c => c.id);
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('c');
    expect(ids).not.toContain('parent');
    expect(ids).not.toContain('titre');
    expect(ids).toEqual(expect.arrayContaining(['e', 'metre', 'bat']));
  });

  it('un candidat porte son lot, sa quantité et son unité pour l\'affichage', () => {
    const [premier] = candidatsSources([lot([ligne('x', { quantite: 12, unite: 'ml' }), ligne('y')])], 'y');
    expect(premier).toMatchObject({ id: 'x', quantite: 12, unite: 'ml', lotNumero: '01', lotTitre: 'Lot' });
  });
});

describe('lierPatch, delierPatch et suiveursDe', () => {
  it('lie : quantité de la source, coefficient et prix total, formule effacée', () => {
    const patch = lierPatch(ligne('b', { prixUnitaire: 10, quantiteFormule: '=2' }), ligne('a', { quantite: 6 }), 0.5)!;
    expect(patch).toEqual({ quantiteLiee: { sourceId: 'a', coefficient: 0.5 }, quantite: 3, prixTotal: 30, quantiteFormule: undefined });
  });

  it('un coefficient de 1 n\'est pas enregistré', () => {
    expect(lierPatch(ligne('b'), ligne('a', { quantite: 6 }))!.quantiteLiee).toEqual({ sourceId: 'a' });
  });

  it('refuse un coefficient nul, négatif, infini ou hors borne', () => {
    for (const c of [0, -1, Infinity, NaN, 1e7]) expect(lierPatch(ligne('b'), ligne('a'), c)).toBeNull();
  });

  it('délier garde la quantité (le patch ne touche que le lien)', () => {
    expect(delierPatch()).toEqual({ quantiteLiee: undefined });
  });

  it('retrouve les suiveurs directs et un article par son identifiant', () => {
    const lots = [lot([ligne('a'), ligne('b', { quantiteLiee: { sourceId: 'a' } }), ligne('c', { quantiteLiee: { sourceId: 'b' } })])];
    expect(suiveursDe(lots, 'a').map(l => l.id)).toEqual(['b']);
    expect(suiveursDe(lots, 'c')).toEqual([]);
    expect(ligneParId(lots, 'c')?.id).toBe('c');
    expect(ligneParId(lots, 'zz')).toBeUndefined();
  });

  it('le coefficient par défaut vaut 1, y compris pour une valeur absurde', () => {
    expect(coefficientDe(undefined)).toBe(1);
    expect(coefficientDe({ sourceId: 'a' })).toBe(1);
    expect(coefficientDe({ sourceId: 'a', coefficient: -3 })).toBe(1);
    expect(coefficientDe({ sourceId: 'a', coefficient: 2.5 })).toBe(2.5);
  });
});

describe('liens par bâtiment', () => {
  const source = () => ligne('s', { quantite: 30, quantitesBatiments: { x: 10, y: 20 } });

  it('un suiveur par bâtiment suit sa source bâtiment par bâtiment, coefficient compris', () => {
    const lots = [lot([source(), ligne('f', { quantite: 0, quantitesBatiments: { x: 0, y: 0 }, quantiteLiee: { sourceId: 's', coefficient: 0.5 } })])];
    const f = lignesDe(propagerLiens(lots))[1];
    expect(f.quantitesBatiments).toEqual({ x: 5, y: 10 });
    expect(f.quantite).toBe(15);
    expect(f.prixTotal).toBe(150);
  });

  it('ne suit que SES bâtiments : le total est la somme de ses parts', () => {
    const lots = [lot([source(), ligne('f', { quantitesBatiments: { y: 0 }, quantiteLiee: { sourceId: 's' } })])];
    const f = lignesDe(propagerLiens(lots))[1];
    expect(f.quantitesBatiments).toEqual({ y: 20 });
    expect(f.quantite).toBe(20);
  });

  it('un bâtiment que la source n\'a pas vaut 0', () => {
    const lots = [lot([source(), ligne('f', { quantitesBatiments: { z: 7 }, quantiteLiee: { sourceId: 's' } })])];
    const f = lignesDe(propagerLiens(lots))[1];
    expect(f.quantitesBatiments).toEqual({ z: 0 });
    expect(f.quantite).toBe(0);
  });

  it('un suiveur sans bâtiments suit le total d\'une source par bâtiment', () => {
    const lots = [lot([source(), ligne('f', { quantiteLiee: { sourceId: 's', coefficient: 2 } })])];
    const f = lignesDe(propagerLiens(lots))[1];
    expect(f.quantite).toBe(60);
    expect(f.quantitesBatiments).toBeUndefined();
  });

  it('suit une chaîne par bâtiment', () => {
    const lots = [lot([
      ligne('c', { quantitesBatiments: { x: 0, y: 0 }, quantiteLiee: { sourceId: 'b' } }),
      ligne('b', { quantitesBatiments: { x: 0, y: 0 }, quantiteLiee: { sourceId: 's', coefficient: 2 } }),
      source(),
    ])];
    const [c, b] = lignesDe(propagerLiens(lots));
    expect(b.quantitesBatiments).toEqual({ x: 20, y: 40 });
    expect(c.quantitesBatiments).toEqual({ x: 20, y: 40 });
    expect(c.quantite).toBe(60);
  });

  it('une source qui n\'est plus par bâtiment défait le lien et garde les parts du suiveur', () => {
    const lots = [lot([ligne('s', { quantite: 30 }), ligne('f', { quantite: 9, quantitesBatiments: { x: 4, y: 5 }, quantiteLiee: { sourceId: 's' } })])];
    const f = lignesDe(propagerLiens(lots))[1];
    expect(f.quantiteLiee).toBeUndefined();
    expect(f.quantitesBatiments).toEqual({ x: 4, y: 5 });
    expect(f.quantite).toBe(9);
  });

  it('rend le même tableau quand les parts sont déjà justes', () => {
    const juste = [lot([source(), ligne('f', { quantite: 30, prixTotal: 300, quantitesBatiments: { x: 10, y: 20 }, quantiteLiee: { sourceId: 's' } })])];
    expect(propagerLiens(juste)).toBe(juste);
  });

  it('lierPatch donne à un article par bâtiment la part de la source pour chacun de ses bâtiments', () => {
    const patch = lierPatch(ligne('f', { quantitesBatiments: { x: 0, y: 0 } }), source(), 0.5)!;
    expect(patch.quantitesBatiments).toEqual({ x: 5, y: 10 });
    expect(patch.quantite).toBe(15);
  });

  it('lierPatch refuse un article par bâtiment sur une source qui n\'en a pas', () => {
    expect(lierPatch(ligne('f', { quantitesBatiments: { x: 0 } }), ligne('s', { quantite: 3 }))).toBeNull();
  });

  it('un article par bâtiment ne se voit proposer que des sources par bâtiment', () => {
    const lots = [lot([source(), ligne('p', { quantite: 1 }), ligne('f', { quantitesBatiments: { x: 0 } })])];
    expect(candidatsSources(lots, 'f').map(c => c.id)).toEqual(['s']);
    expect(candidatsSources(lots, 'p').map(c => c.id)).toEqual(['s', 'f']);
  });
});

describe('liens et copie', () => {
  const arbre = (): Lot[] => [lot([
    ligne('a', { quantite: 5 }),
    ligne('b', { quantiteLiee: { sourceId: 'a' } }),
    ligne('x', { quantiteLiee: { sourceId: 'exterieur' } }),
  ])];

  it('compte les liens entre articles copiés et vers un article resté en place', () => {
    const liens = liensDeCopie(arbre()[0].chapitres);
    expect(liens.suiveurs.map(s => s.id)).toEqual(['b', 'x']);
    expect(liens.internes).toBe(1);
    expect(liens.externes).toBe(1);
  });

  it('un article copié seul est tourné vers l\'extérieur, sa source n\'étant pas copiée', () => {
    const liens = liensDeCopie([arbre()[0].chapitres[0].lignes[1]]);
    expect(liens).toMatchObject({ internes: 0, externes: 1 });
  });

  it('rien à signaler sans lien', () => {
    expect(liensDeCopie([ligne('a')]).suiveurs).toEqual([]);
  });

  it('fusionne les liens de plusieurs copies', () => {
    const f = fusionnerLiensDeCopie([liensDeCopie([arbre()[0]]), liensDeCopie([arbre()[0].chapitres[0].lignes[1]])]);
    expect(f.internes + f.externes).toBe(f.suiveurs.length);
    expect(f.suiveurs).toHaveLength(3);
  });

  const copies = () => {
    const racines = structuredClone(arbre()[0].chapitres[0].lignes);
    const correspondance = new Map([['a', 'a2'], ['b', 'b2'], ['x', 'x2']]);
    racines.forEach(l => { l.id = correspondance.get(l.id)!; });
    return { racines, correspondance };
  };
  const liens = (racines: Ligne[]) => racines.map(l => l.quantiteLiee?.sourceId);

  it('« tout » : le lien interne suit la copie, le lien externe reste sur l\'original', () => {
    const { racines, correspondance } = copies();
    adapterLiensCopie(racines, correspondance, 'tout');
    expect(liens(racines)).toEqual([undefined, 'a2', 'exterieur']);
  });

  it('« internes » : le lien externe est rompu', () => {
    const { racines, correspondance } = copies();
    adapterLiensCopie(racines, correspondance, 'internes');
    expect(liens(racines)).toEqual([undefined, 'a2', undefined]);
  });

  it('« rompre » : plus aucun lien, les quantités sont gardées', () => {
    const { racines, correspondance } = copies();
    racines[1].quantite = 5;
    adapterLiensCopie(racines, correspondance, 'rompre');
    expect(liens(racines)).toEqual([undefined, undefined, undefined]);
    expect(racines[1].quantite).toBe(5);
  });

  it('un coefficient est conservé quand le lien suit la copie', () => {
    const racines = structuredClone(arbre()[0].chapitres[0].lignes);
    racines[1].quantiteLiee = { sourceId: 'a', coefficient: 0.8 };
    adapterLiensCopie(racines, new Map([['a', 'a2']]), 'tout');
    expect(racines[1].quantiteLiee).toEqual({ sourceId: 'a2', coefficient: 0.8 });
  });

  it('descend dans les sous-articles et les chapitres', () => {
    const l = lot([ligne('p', { children: [ligne('e', { quantiteLiee: { sourceId: 'a' } })] }), ligne('a')]);
    adapterLiensCopie([l], new Map([['a', 'a2']]), 'tout');
    expect(l.chapitres[0].lignes[0].children![0].quantiteLiee).toEqual({ sourceId: 'a2' });
  });
});

describe('quantité saisie sur un article lié', () => {
  it('la case quantité refuse la saisie : la quantité vient de la source', () => {
    expect(quantitePatch(ligne('b', { quantiteLiee: { sourceId: 'a' } }), '12')).toBeNull();
  });
});
