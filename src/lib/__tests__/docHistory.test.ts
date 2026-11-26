import { describe, expect, it } from 'vitest';
import {
  FENETRE_REGROUPEMENT_MS, HISTORIQUE_LIMITE, annuler, enregistrer, historiqueVide, retablir,
} from '../docHistory';

const LOIN = FENETRE_REGROUPEMENT_MS + 1;

describe('enregistrer', () => {
  it('ouvre une étape par modification espacée dans le temps', () => {
    let h = historiqueVide<string>();
    h = enregistrer(h, 'a', 'b', 1000);
    h = enregistrer(h, 'b', 'c', 1000 + LOIN);
    expect(h.passe).toEqual(['a', 'b']);
  });

  it("regroupe des modifications rapprochées en une seule étape, en gardant l'état d'avant la première", () => {
    let h = historiqueVide<string>();
    h = enregistrer(h, 'a', 'b', 1000);
    h = enregistrer(h, 'b', 'c', 1100);
    h = enregistrer(h, 'c', 'd', 1200);
    expect(h.passe).toEqual(['a']);
  });

  it("n'enregistre rien quand le document n'a pas changé", () => {
    const doc = { x: 1 };
    const h = enregistrer(historiqueVide<typeof doc>(), doc, doc, 1000);
    expect(h.passe).toEqual([]);
  });

  it('efface ce qui pouvait être rétabli', () => {
    let h = enregistrer(historiqueVide<string>(), 'a', 'b', 1000);
    h = annuler(h, 'b')!.historique;
    expect(h.futur).toEqual(['b']);
    h = enregistrer(h, 'a', 'z', 5000);
    expect(h.futur).toEqual([]);
    expect(h.passe).toEqual(['a']);
  });

  it('oublie les plus anciennes étapes au-delà de la limite', () => {
    let h = historiqueVide<number>();
    for (let i = 0; i < HISTORIQUE_LIMITE + 10; i += 1) h = enregistrer(h, i, i + 1, i * LOIN + LOIN);
    expect(h.passe).toHaveLength(HISTORIQUE_LIMITE);
    expect(h.passe[0]).toBe(10);
  });
});

describe('annuler et rétablir', () => {
  it('rien à annuler ni à rétablir sur un historique vide', () => {
    expect(annuler(historiqueVide<string>(), 'a')).toBeNull();
    expect(retablir(historiqueVide<string>(), 'a')).toBeNull();
  });

  it("revient à l'état d'avant puis le rejoue", () => {
    let h = enregistrer(historiqueVide<string>(), 'a', 'b', 1000);
    h = enregistrer(h, 'b', 'c', 1000 + LOIN);
    const un = annuler(h, 'c')!;
    expect(un.cible).toBe('b');
    const deux = annuler(un.historique, 'b')!;
    expect(deux.cible).toBe('a');
    expect(annuler(deux.historique, 'a')).toBeNull();
    const refait = retablir(deux.historique, 'a')!;
    expect(refait.cible).toBe('b');
    expect(retablir(refait.historique, 'b')!.cible).toBe('c');
  });

  it('une modification juste après une annulation ouvre sa propre étape (pas de regroupement)', () => {
    let h = enregistrer(historiqueVide<string>(), 'a', 'b', 1000);
    h = annuler(h, 'b')!.historique;
    h = enregistrer(h, 'a', 'c', 1010);
    expect(h.passe).toEqual(['a']);
    expect(h.futur).toEqual([]);
  });
});
