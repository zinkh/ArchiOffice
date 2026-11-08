import { describe, expect, it } from 'vitest';
import {
  RESERVE_COULEUR_NEUTRE, RESERVE_PALETTE, construireLegende, couleurDe, couleursParCle, hexVersRgb, responsableDe,
} from '../reserveCouleurs';

const r = (entreprises: string[], lots: string[] = []) => ({ entreprises: JSON.stringify(entreprises), lots: JSON.stringify(lots) });

describe('responsableDe', () => {
  it("préfère l'entreprise au lot", () => {
    expect(responsableDe(r(['Dupont SARL'], ['01 Gros oeuvre']))).toMatchObject({ kind: 'entreprise', nom: 'Dupont SARL' });
  });
  it('retombe sur le lot sans entreprise', () => {
    expect(responsableDe(r([], ['01 Gros oeuvre']))).toMatchObject({ kind: 'lot', nom: '01 Gros oeuvre' });
  });
  it('rend null sans entreprise ni lot', () => {
    expect(responsableDe(r([]))).toBeNull();
  });
  it('ignore casse, accents et espaces pour la clé', () => {
    expect(responsableDe(r(['  Électricité  Martin']))!.cle).toBe(responsableDe(r(['electricite martin']))!.cle);
  });
});

describe('construireLegende', () => {
  it('donne des couleurs distinctes et compte les réserves', () => {
    const l = construireLegende([r(['B']), r(['A']), r(['B']), r([], ['Lot 2'])]);
    expect(l).toHaveLength(3);
    expect(new Set(l.map(x => x.couleur)).size).toBe(3);
    expect(l.find(x => x.nom === 'B')!.total).toBe(2);
  });
  it("ne dépend pas de l'ordre des réserves", () => {
    const a = couleursParCle(construireLegende([r(['A']), r(['B'])]));
    const b = couleursParCle(construireLegende([r(['B']), r(['A'])]));
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
  it('compte trente teintes toutes différentes', () => {
    expect(RESERVE_PALETTE).toHaveLength(30);
    expect(new Set(RESERVE_PALETTE).size).toBe(30);
  });
  it('donne trente couleurs distinctes à trente responsables puis boucle', () => {
    const n = RESERVE_PALETTE.length;
    const l = construireLegende(Array.from({ length: n + 1 }, (_, i) => r([`Ent ${String(i).padStart(2, '0')}`])));
    expect(new Set(l.slice(0, n).map(x => x.couleur)).size).toBe(n);
    expect(l[n].couleur).toBe(RESERVE_PALETTE[0]);
  });
});

describe('hexVersRgb', () => {
  it('convertit #rrggbb en composantes', () => {
    expect(hexVersRgb('#2563eb')).toEqual([37, 99, 235]);
  });
  it('rend le gris neutre pour une valeur illisible', () => {
    expect(hexVersRgb('bleu')).toEqual(hexVersRgb(RESERVE_COULEUR_NEUTRE));
  });
});

describe('couleurDe', () => {
  it('utilise la table, et le gris neutre sans responsable', () => {
    const rows = [r(['A'])];
    const table = couleursParCle(construireLegende(rows));
    expect(couleurDe(rows[0], table)).toBe(RESERVE_PALETTE[0]);
    expect(couleurDe(r([]), table)).toBe(RESERVE_COULEUR_NEUTRE);
  });
});
