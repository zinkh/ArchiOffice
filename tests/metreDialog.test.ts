// @vitest-environment jsdom
// Fenêtre du métré : une ligne par libellé, avec son calcul qui reste affiché ; le total est la somme ;
// un calcul invalide ou un total négatif se voit et empêche d'appliquer ; rien n'est écrit sans « Appliquer ».
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetreDialog } from '../src/components/pro/MetreDialog';
import type { Batiment, Ligne, QuantiteDetail } from '../src/types/dpgf';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o && 'n' in o ? `${key} ${o.n}` : key) }),
}));

const article = (surcharge: Partial<Ligne> = {}): Ligne => ({
  id: 'a1', numero: '1.2', designation: 'Enduit monocouche', unite: 'm²', quantite: 0, prixUnitaire: 48.5, prixTotal: 0, type: 'ouvrage', ...surcharge,
});
const metre: QuantiteDetail[] = [
  { id: 'l1', libelle: 'Façade Est', expression: '10', quantite: 10 },
  { id: 'l2', libelle: 'Façade Ouest', expression: '=4*5', quantite: 20 },
  { id: 'l3', libelle: 'Déduction baie', expression: '-2,4', quantite: -2.4 },
];

let root: Root;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

async function ouvrir(ligne: Ligne, batiments?: Batiment[]) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onSave = vi.fn();
  const onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(MetreDialog, { ligne, onSave, onClose, batiments })); });
  return { onSave, onClose };
}

const champ = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const bouton = (texte: string) => [...container.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(texte) || b.getAttribute('aria-label')?.includes(texte))!;
async function saisir(el: HTMLInputElement, valeur: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const total = () => container.querySelector('[data-testid="metre-total"]')?.textContent ?? '';

describe('MetreDialog', () => {
  it('montre les lignes du métré, leur calcul et le total', async () => {
    await ouvrir(article({ quantite: 27.6, quantiteDetails: metre }));
    expect(champ('pro_metre_aria_label 1').value).toBe('Façade Est');
    expect(champ('pro_metre_aria_calc 2').value).toBe('=4*5');
    expect(champ('pro_metre_aria_calc 3').value).toBe('-2,4');
    expect(total()).toContain('27,60');
    expect(total()).toContain('m²');
  });

  it('un article sans métré repart de sa quantité : une première ligne, formule mémorisée comprise', async () => {
    await ouvrir(article({ quantite: 30, quantiteFormule: '=10+20' }));
    expect(champ('pro_metre_aria_calc 1').value).toBe('=10+20');
    expect(total()).toContain('30,00');
  });

  it('une quantité simple devient la première ligne, avec la virgule française', async () => {
    await ouvrir(article({ quantite: 12.5 }));
    expect(champ('pro_metre_aria_calc 1').value).toBe('12,5');
  });

  it('le total suit la saisie', async () => {
    await ouvrir(article({ quantite: 27.6, quantiteDetails: metre }));
    await saisir(champ('pro_metre_aria_calc 1'), '=5*3');
    expect(total()).toContain('32,60');
  });

  it('un calcul invalide est signalé et empêche d\'appliquer', async () => {
    await ouvrir(article({ quantite: 27.6, quantiteDetails: metre }));
    await saisir(champ('pro_metre_aria_calc 2'), '=4*');
    expect(container.textContent).toContain('pro_metre_error_line');
    expect((bouton('pro_metre_apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('un total négatif est signalé et empêche d\'appliquer', async () => {
    await ouvrir(article({ quantite: 27.6, quantiteDetails: metre }));
    await saisir(champ('pro_metre_aria_calc 3'), '-40');
    expect(container.textContent).toContain('pro_metre_error_negative');
    expect((bouton('pro_metre_apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('appliquer envoie la quantité somme, le prix total et les lignes avec leur calcul', async () => {
    const { onSave } = await ouvrir(article({ quantite: 27.6, quantiteDetails: metre }));
    await saisir(champ('pro_metre_aria_calc 1'), '=5*3');
    await act(async () => { bouton('pro_metre_apply').click(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    const patch = onSave.mock.calls[0][0];
    expect(patch.quantite).toBe(32.6);
    expect(patch.prixTotal).toBeCloseTo(1581.1, 6);
    expect(patch.quantiteDetails[0]).toMatchObject({ libelle: 'Façade Est', expression: '=5*3', quantite: 15 });
    expect(patch.quantiteFormule).toBeUndefined();
  });

  it('ajouter une ligne ouvre un champ libellé vide', async () => {
    await ouvrir(article({ quantite: 27.6, quantiteDetails: metre }));
    await act(async () => { bouton('pro_metre_add').click(); });
    expect(champ('pro_metre_aria_label 4')).not.toBeNull();
    expect(champ('pro_metre_aria_label 4').value).toBe('');
    expect(total()).toContain('27,60'); // une ligne vide ne change rien
  });

  it('supprimer une ligne retire sa valeur du total', async () => {
    await ouvrir(article({ quantite: 27.6, quantiteDetails: metre }));
    await act(async () => { bouton('pro_metre_aria_remove 3').click(); });
    expect(total()).toContain('30,00');
  });

  it('une ventilation d\'avant s\'affiche avec son niveau et son local, sans rien perdre à l\'enregistrement', async () => {
    const avant: QuantiteDetail[] = [{ id: 'v1', niveau: 'R+1', local: 'Chambre 2', batimentId: 'b1', quantite: 8 }];
    const { onSave } = await ouvrir(article({ quantite: 8, quantiteDetails: avant }));
    expect(champ('pro_metre_aria_label 1').value).toBe('R+1 · Chambre 2');
    await act(async () => { bouton('pro_metre_apply').click(); });
    expect(onSave.mock.calls[0][0].quantiteDetails[0]).toMatchObject({ niveau: 'R+1', local: 'Chambre 2', batimentId: 'b1', quantite: 8 });
  });

  it('Échap ferme sans rien enregistrer', async () => {
    const { onSave, onClose } = await ouvrir(article({ quantite: 27.6, quantiteDetails: metre }));
    await act(async () => { container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('MetreDialog : article réparti par bâtiment', () => {
  const batiments: Batiment[] = [
    { id: 'DX', code: 'DX', libelle: 'Bâtiment X', ordre: 1 },
    { id: 'DY', code: 'DY', libelle: 'Bâtiment Y', ordre: 2 },
  ];
  const parBatiment = (surcharge: Partial<Ligne> = {}) => article({
    quantitesBatiments: { DX: 7.6, DY: 20, DZ: 0 }, quantite: 27.6, ...surcharge,
  } as Partial<Ligne>);
  const select = (label: string) => [...document.querySelectorAll<HTMLSelectElement>('select')].find(s => s.getAttribute('aria-label') === label)!;
  const totalBatiment = (id: string) => container.querySelector(`[data-testid="metre-total-${id}"]`)?.textContent ?? '';
  async function choisir(el: HTMLSelectElement, valeur: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, valeur);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  const branche = (id: string) => container.querySelector<HTMLElement>(`[data-testid="metre-branch-${id}"]`);

  it('repart des quantités par bâtiment : une branche par bâtiment qui en a, avec ses lignes', async () => {
    await ouvrir(parBatiment(), batiments);
    expect(branche('DX')!.contains(champ('pro_metre_aria_calc 1'))).toBe(true);
    expect(champ('pro_metre_aria_calc 1').value).toBe('7,6');
    expect(branche('DY')!.contains(champ('pro_metre_aria_calc 2'))).toBe(true);
    expect(champ('pro_metre_aria_calc 2').value).toBe('20');
    expect(branche('DZ')).toBeNull(); // DZ n'est pas un bâtiment du projet : pas de branche
    expect(champ('pro_metre_aria_calc 3')).toBeNull();
    expect(total()).toContain('27,60');
  });

  it('une branche se replie et son total reste visible', async () => {
    await ouvrir(parBatiment(), batiments);
    await act(async () => { bouton('pro_metre_aria_collapse').click(); });
    expect(champ('pro_metre_aria_calc 1')).toBeNull();
    expect(totalBatiment('DX')).toContain('7,60');
  });

  it('montre le total de chaque bâtiment', async () => {
    await ouvrir(parBatiment(), batiments);
    expect(totalBatiment('DX')).toContain('7,60');
    expect(totalBatiment('DY')).toContain('20,00');
    await saisir(champ('pro_metre_aria_calc 1'), '=10-2,4');
    expect(totalBatiment('DX')).toContain('7,60');
    await saisir(champ('pro_metre_aria_calc 1'), '12');
    expect(totalBatiment('DX')).toContain('12,00');
    expect(total()).toContain('32,00');
  });

  it('un article sans bâtiments proposés n\'a ni colonne ni totaux par bâtiment', async () => {
    await ouvrir(article({ quantite: 12 }));
    expect(select('pro_metre_aria_building 1')).toBeUndefined();
    expect(container.querySelector('[data-testid^="metre-total-"]')).toBeNull();
  });

  it('une nouvelle ligne est ajoutée dans la branche où l\'on clique', async () => {
    await ouvrir(parBatiment(), batiments);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="metre-add-DX"]')!.click(); });
    expect(branche('DX')!.contains(champ('pro_metre_aria_calc 3'))).toBe(true);
  });

  it('on ajoute une branche pour un bâtiment qui n\'en a pas encore', async () => {
    const trois: Batiment[] = [...batiments, { id: 'DW', code: 'DW', libelle: 'Bâtiment W', ordre: 3 }];
    await ouvrir(parBatiment(), trois);
    expect(branche('DW')).toBeNull();
    await choisir(select('pro_metre_add_building'), 'DW');
    expect(branche('DW')!.contains(champ('pro_metre_aria_calc 3'))).toBe(true);
  });

  it('une ligne sans bâtiment est signalée, empêche d\'appliquer, et s\'affecte depuis sa branche', async () => {
    const sans: QuantiteDetail[] = [{ id: 'q1', libelle: 'A', expression: '10', quantite: 10 }];
    await ouvrir(article({ quantitesBatiments: { DX: 1, DY: 1 }, quantite: 2, quantiteDetails: sans } as Partial<Ligne>), batiments);
    expect(container.textContent).toContain('pro_metre_error_building 1');
    expect((bouton('pro_metre_apply') as HTMLButtonElement).disabled).toBe(true);
    await choisir(select('pro_metre_aria_building 1'), 'DY');
    expect((bouton('pro_metre_apply') as HTMLButtonElement).disabled).toBe(false);
  });

  it('le total d\'un bâtiment ne peut pas être négatif, même si le total général ne l\'est pas', async () => {
    await ouvrir(parBatiment(), batiments);
    await saisir(champ('pro_metre_aria_calc 1'), '-5');
    expect(container.textContent).toContain('pro_metre_error_building_negative');
    expect((bouton('pro_metre_apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('appliquer envoie les quantités par bâtiment, la quantité somme et le bâtiment de chaque ligne', async () => {
    const { onSave } = await ouvrir(parBatiment(), batiments);
    await saisir(champ('pro_metre_aria_calc 1'), '12');
    await act(async () => { bouton('pro_metre_apply').click(); });
    const patch = onSave.mock.calls[0][0];
    expect(patch.quantitesBatiments).toEqual({ DX: 12, DY: 20, DZ: 0 }); // DZ affecté, sans ligne : reste à 0
    expect(patch.quantite).toBe(32);
    expect(patch.quantiteDetails.map((d: any) => [d.batimentId, d.expression])).toEqual([['DX', '12'], ['DY', '20']]);
  });

  it('un métré existant garde ses lignes ; une ligne d\'avant sans bâtiment reprend l\'unique bâtiment de l\'article', async () => {
    const avant: QuantiteDetail[] = [{ id: 'q1', libelle: 'Façade', expression: '10', quantite: 10 }];
    const { onSave } = await ouvrir(article({ quantitesBatiments: { DX: 10 }, quantite: 10, quantiteDetails: avant } as Partial<Ligne>), batiments);
    expect(branche('DX')!.contains(champ('pro_metre_aria_calc 1'))).toBe(true);
    await act(async () => { bouton('pro_metre_apply').click(); });
    expect(onSave.mock.calls[0][0].quantitesBatiments).toEqual({ DX: 10 });
  });
});
