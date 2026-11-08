import { describe, expect, it } from 'vitest';
import {
  RESERVE_COULEUR_NEUTRE, RESERVE_PALETTE, construireLegende, couleurDe, couleursParCle, hexVersRgb, responsableDe, texteSurCouleur,
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

describe('texteSurCouleur', () => {
  it('écrit en blanc sur un fond sombre', () => {
    expect(texteSurCouleur('#1e3a8a')).toBe('#ffffff');
    expect(texteSurCouleur('#1f2937')).toBe('#ffffff');
  });
  it('écrit en noir sur un fond clair', () => {
    expect(texteSurCouleur('#f59e0b')).toBe('#111827');
    expect(texteSurCouleur('#4ade80')).toBe('#111827');
  });
  it('est lisible sur toute la palette (contraste au moins 3 : 1)', () => {
    const lum = (hex: string) => {
      const [r, g, b] = hexVersRgb(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const fond of RESERVE_PALETTE) {
      const l1 = lum(fond);
      const l2 = lum(texteSurCouleur(fond));
      const contraste = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      expect(contraste).toBeGreaterThanOrEqual(3);
    }
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
