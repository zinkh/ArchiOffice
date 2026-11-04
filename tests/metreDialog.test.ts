// @vitest-environment jsdom
// Fenêtre du métré : une ligne par libellé, avec son calcul qui reste affiché ; le total est la somme ;
// un calcul invalide ou un total négatif se voit et empêche d'appliquer ; rien n'est écrit sans « Appliquer ».
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetreDialog } from '../src/components/pro/MetreDialog';
import type { Ligne, QuantiteDetail } from '../src/types/dpgf';

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

async function ouvrir(ligne: Ligne) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onSave = vi.fn();
  const onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(MetreDialog, { ligne, onSave, onClose })); });
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
