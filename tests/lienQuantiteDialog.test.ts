// @vitest-environment jsdom
// Fenêtre « Lier la quantité » : choix du poste suivi, coefficient, quantité obtenue, détacher.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LienQuantiteDialog } from '../src/components/pro/LienQuantiteDialog';
import type { Chapitre, Ligne, Lot } from '../src/types/dpgf';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key) }),
}));
vi.mock('motion/react', () => ({ AnimatePresence: ({ children }: any) => children }));
vi.mock('../src/components/ui/ModalShell', () => ({
  ModalShell: ({ children, footer }: any) => React.createElement('div', { role: 'dialog' }, children, footer),
}));

const ligne = (id: string, designation: string, surcharge: Partial<Ligne> = {}): Ligne => ({
  id, numero: id, designation, unite: 'u', quantite: 0, prixUnitaire: 100, prixTotal: 0, type: 'ouvrage', ...surcharge,
});
const lots = (): Lot[] => [{
  id: 'lot', numero: '03', titre: 'Menuiseries', sousTotal: 0,
  chapitres: [{ id: 'c', numero: '1', titre: 'Chapitre', lignes: [
    ligne('fenetres', 'Fenêtres PVC', { quantite: 10 }),
    ligne('portes', 'Portes intérieures', { quantite: 6, unite: 'm²' }),
    ligne('volets', 'Volets roulants'),
    ligne('stores', 'Stores', { quantiteLiee: { sourceId: 'volets' } }),
  ] } as Chapitre],
}];

let root: Root;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

async function ouvrir(cible: Ligne, onSave = vi.fn(), onClose = vi.fn()) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // L'article fourni prend la place de celui du document : un test peut ainsi l'ouvrir déjà lié.
  const tous = lots();
  const chapitre = tous[0].chapitres[0];
  chapitre.lignes = chapitre.lignes.map(l => (l.id === cible.id ? cible : l));
  await act(async () => {
    root.render(React.createElement(LienQuantiteDialog, { ligne: cible, lots: tous, onSave, onClose }));
  });
  return { onSave, onClose };
}
const cible = (id: string) => lots()[0].chapitres[0].lignes.find(l => l.id === id)!;
const options = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const option = (texte: string) => options().find(o => o.textContent?.includes(texte))!;
const bouton = (cle: string) => [...container.querySelectorAll('button')].find(b => b.textContent === cle) as HTMLButtonElement | undefined;
const coefficient = () => container.querySelector<HTMLInputElement>('#lien-quantite-coefficient')!;
const recherche = () => container.querySelector<HTMLInputElement>('#lien-quantite-recherche')!;
async function saisir(el: HTMLInputElement, valeur: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const choisir = (texte: string) => act(async () => { option(texte).click(); });

describe('LienQuantiteDialog', () => {
  it('propose les autres ouvrages, pas l\'article lui-même ni ceux qui le suivent', async () => {
    await ouvrir(cible('volets'));
    const textes = options().map(o => o.textContent);
    expect(textes.some(t => t?.includes('Fenêtres PVC'))).toBe(true);
    expect(textes.some(t => t?.includes('Portes intérieures'))).toBe(true);
    expect(textes.some(t => t?.includes('Volets roulants'))).toBe(false);
    expect(textes.some(t => t?.includes('Stores'))).toBe(false);
  });

  it('filtre la liste à la frappe, sans tenir compte des accents ni de la casse', async () => {
    await ouvrir(cible('volets'));
    await saisir(recherche(), 'FENETRES');
    expect(options().map(o => o.textContent).join(' ')).toContain('Fenêtres PVC');
    expect(options()).toHaveLength(1);
    await saisir(recherche(), 'introuvable');
    expect(options()).toHaveLength(0);
    expect(container.textContent).toContain('pro_link_none');
  });

  it('on ne peut pas lier sans avoir choisi un poste', async () => {
    await ouvrir(cible('volets'));
    expect(bouton('pro_link_apply')!.disabled).toBe(true);
  });

  it('lie au poste choisi avec un coefficient de 1 : quantité de la source, prix total qui suit', async () => {
    const { onSave, onClose } = await ouvrir(cible('volets'));
    await choisir('Fenêtres PVC');
    expect(container.textContent).toContain('pro_link_result');
    expect(bouton('pro_link_apply')!.disabled).toBe(false);
    await act(async () => { bouton('pro_link_apply')!.click(); });
    expect(onSave).toHaveBeenCalledWith({ quantiteLiee: { sourceId: 'fenetres' }, quantite: 10, prixTotal: 1000, quantiteFormule: undefined });
    expect(onClose).toHaveBeenCalled();
  });

  it('applique le coefficient saisi, virgule française ou calcul', async () => {
    const { onSave } = await ouvrir(cible('volets'));
    await choisir('Fenêtres PVC');
    await saisir(coefficient(), '0,8');
    await act(async () => { bouton('pro_link_apply')!.click(); });
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ quantiteLiee: { sourceId: 'fenetres', coefficient: 0.8 }, quantite: 8, prixTotal: 800 }));
  });

  it('un coefficient nul, négatif ou illisible est signalé et empêche de lier', async () => {
    const { onSave } = await ouvrir(cible('volets'));
    await choisir('Fenêtres PVC');
    for (const saisie of ['0', '-2', 'abc', '']) {
      await saisir(coefficient(), saisie);
      expect(container.textContent).toContain('pro_link_coefficient_invalid');
      expect(bouton('pro_link_apply')!.disabled).toBe(true);
    }
    expect(onSave).not.toHaveBeenCalled();
  });

  it('signale des unités différentes sans bloquer', async () => {
    await ouvrir(cible('volets'));
    await choisir('Portes intérieures');
    expect(container.textContent).toContain('pro_link_unit_mismatch');
    expect(bouton('pro_link_apply')!.disabled).toBe(false);
  });

  it('un article déjà lié montre son poste, son coefficient, et se détache en gardant sa quantité', async () => {
    const lie = { ...cible('volets'), quantite: 8, quantiteLiee: { sourceId: 'fenetres', coefficient: 0.8 } };
    const { onSave, onClose } = await ouvrir(lie);
    expect(container.textContent).toContain('pro_link_current');
    expect(coefficient().value).toBe('0,8');
    expect(option('Fenêtres PVC').getAttribute('aria-checked')).toBe('true');
    expect(bouton('pro_link_apply')!.disabled).toBe(true);
    await act(async () => { bouton('pro_link_detach')!.click(); });
    expect(onSave).toHaveBeenCalledWith({ quantiteLiee: undefined });
    expect(onClose).toHaveBeenCalled();
  });

  it('un article qui ne suit rien n\'a pas de bouton « Détacher »', async () => {
    await ouvrir(cible('volets'));
    expect(bouton('pro_link_detach')).toBeUndefined();
  });
});
