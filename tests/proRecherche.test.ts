import { describe, expect, it } from 'vitest';
import { clePourCible, extraitAutour, normaliser, rechercherDansDocument, surligner, termesDe } from '../src/lib/proRecherche';
import type { Ligne } from '../src/types/dpgf';

const ligne = (id: string, numero: string, designation: string, extra: Partial<Ligne> = {}): Ligne => ({
  id, numero, designation, unite: 'u', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', children: [], ...extra,
});

const doc = {
  lots: [
    { id: 'l1', numero: '01', titre: 'Démolition', chapitres: [
      { id: 'c1', numero: '1', titre: 'Description des ouvrages', lignes: [
        ligne('a', '1.1', 'Dépose des menuiseries extérieures', { localisation: 'Salle, Cuisine' }),
        ligne('b', '1.2', 'Évacuation des gravats', { children: [ligne('b1', '1.2.1', 'Benne de 10 m3', { cctpDescription: 'La benne sera enlevée chaque semaine.' })] }),
      ] },
      { id: 'c2', numero: '2', titre: 'Prescriptions techniques', cctpOnly: true, lignes: [
        ligne('c', '2.1', 'Poussières', { cctpOnly: true, cctpDescription: 'Arrosage des zones de démolition.' }),
      ] },
    ] },
    { id: 'l2', numero: '02', titre: 'Menuiseries intérieures', chapitres: [
      { id: 'c3', numero: '1', titre: 'Portes', lignes: [ligne('d', '1.1', 'Bloc-porte à âme alvéolaire')] },
    ] },
  ],
};

describe('normalisation', () => {
  it('ignore casse et accents sans décaler les positions', () => {
    expect(normaliser('Évacuation Œuvre')).toBe('evacuation œuvre');
    expect(normaliser('Étage').length).toBe('Étage'.length);
    expect(termesDe('  DÉPOSE  menuiserie ')).toEqual(['depose', 'menuiserie']);
  });

  it('surligne sans tenir compte des accents', () => {
    const m = surligner('Évacuation des gravats', ['evac']);
    expect(m[0]).toEqual({ texte: 'Évac', trouve: true });
    expect(m.map(x => x.texte).join('')).toBe('Évacuation des gravats');
  });

  it('extrait un passage autour du terme', () => {
    const texte = `${'mot '.repeat(40)}benne enlevée ${'fin '.repeat(40)}`;
    const e = extraitAutour(texte, ['benne']);
    expect(e).toContain('benne');
    expect(e.startsWith('…')).toBe(true);
    expect(e.length).toBeLessThan(120);
  });
});

describe('rechercherDansDocument', () => {
  it('trouve par intitulé, accents et casse ignorés, tous les mots', () => {
    const r = rechercherDansDocument(doc, 'MENUISERIES exterieures');
    expect(r.map(t => t.id)).toEqual(['a']);
    expect(r[0].contexte).toBe('01 Démolition › 1 Description des ouvrages');
  });

  it('trouve un lot, un chapitre, un article et un sous-article avec leurs repères', () => {
    const lot = rechercherDansDocument(doc, 'menuiseries int')[0];
    expect(lot).toMatchObject({ kind: 'lot', id: 'l2', lotIdx: 1 });
    const chap = rechercherDansDocument(doc, 'portes')[0];
    expect(chap).toMatchObject({ kind: 'chapitre', id: 'c3', lotIdx: 1, chapIdx: 0 });
    const sous = rechercherDansDocument(doc, 'benne')[0];
    expect(sous).toMatchObject({ kind: 'ligne', id: 'b1', lignePath: [1, 0], ancetresIds: ['b'] });
    expect(clePourCible(sous)).toBe('ligne-0-0-1-0');
    expect(clePourCible(lot)).toBe('lot-1');
    expect(clePourCible(chap)).toBe('chap-1-0');
  });

  it('cherche dans la localisation et le dit', () => {
    const r = rechercherDansDocument(doc, 'cuisine');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'a', champ: 'localisation', extrait: 'Salle, Cuisine' });
  });

  it('le texte du CCTP et les éléments réservés au CCTP ne comptent que dans le CCTP', () => {
    expect(rechercherDansDocument(doc, 'arrosage')).toEqual([]);
    expect(rechercherDansDocument(doc, 'poussieres')).toEqual([]);
    const r = rechercherDansDocument(doc, 'arrosage', { cctp: true });
    expect(r[0]).toMatchObject({ id: 'c', champ: 'cctp' });
    expect(r[0].extrait).toContain('Arrosage');
    expect(rechercherDansDocument(doc, 'enlevée chaque semaine', { cctp: true })[0]).toMatchObject({ id: 'b1', champ: 'cctp' });
  });

  it('un numéro exact passe avant un intitulé qui le contient', () => {
    const r = rechercherDansDocument(doc, '1.1');
    expect(r.map(t => t.id)).toEqual(['a', 'd']);
  });

  it('rend vide pour une requête vide ou un document absent, et plafonne', () => {
    expect(rechercherDansDocument(doc, '   ')).toEqual([]);
    expect(rechercherDansDocument(null, 'x')).toEqual([]);
    expect(rechercherDansDocument(doc, 'e', { max: 2 })).toHaveLength(2);
  });
});
