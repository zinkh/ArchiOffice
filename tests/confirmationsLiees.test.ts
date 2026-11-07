// @vitest-environment jsdom
// Fenêtres de la phase 2 : « Supprimer aussi les postes liés » à la suppression d'une source, et choix des liens
// (conserver, conserver entre copies, rompre) avant de copier, coller ou dupliquer. Vraie fenêtre de confirmation.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConfirmerSuppression } from '../src/components/pro/useConfirmerSuppression';
import { useChoisirLiensCopie } from '../src/components/pro/useChoisirLiensCopie';
import { liensDeCopie } from '../src/lib/quantitesLiees';
import type { Chapitre, Ligne, Lot } from '../src/types/dpgf';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key) }),
}));
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: any) => children,
  motion: { div: React.forwardRef(({ children, initial, animate, exit, ...rest }: any, ref: any) => React.createElement('div', { ...rest, ref }, children)) },
}));

const ligne = (id: string, surcharge: Partial<Ligne> = {}): Ligne => ({
  id, numero: id, designation: `Poste ${id}`, unite: 'u', quantite: 1, prixUnitaire: 1, prixTotal: 1, type: 'ouvrage', ...surcharge,
});
// a est suivi par b, qui est suivi par c (cascade) ; x est indépendant
const lots = (): Lot[] => [{
  id: 'lot', numero: '01', titre: 'Lot', sousTotal: 0,
  chapitres: [{ id: 'c', numero: '1', titre: 'C', lignes: [
    ligne('a'), ligne('b', { quantiteLiee: { sourceId: 'a' } }), ligne('c', { quantiteLiee: { sourceId: 'b' } }), ligne('x'),
  ] } as Chapitre],
}];

let root: Root;
let container: HTMLDivElement;
let api: any;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

function Harness({ hook }: { hook: () => any }) {
  const h = hook();
  api = h;
  return h.dialog;
}
async function monter(hook: () => any) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(Harness, { hook })); });
}
const boutons = () => [...container.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')];
const bouton = (debut: string) => boutons().find(b => b.textContent?.startsWith(debut))!;
const libelles = () => boutons().map(b => b.textContent ?? '');

/** Ouvre la fenêtre (la promesse reste en attente), clique un bouton, rend ce que la promesse a rendu. */
async function repondre<T>(ouvrir: () => Promise<T>, clic: string): Promise<T> {
  let promesse!: Promise<T>;
  await act(async () => { promesse = ouvrir(); });
  await act(async () => { bouton(clic).click(); });
  return promesse;
}
async function ouvrirSansRepondre<T>(ouvrir: () => Promise<T>) {
  let promesse!: Promise<T>;
  await act(async () => { promesse = ouvrir(); });
  // Dans un objet : rendre la promesse nue ferait attendre sa résolution, c'est-à-dire le clic qu'on n'a pas encore fait.
  return { promesse };
}

describe('confirmerSuppressionAvecLiens', () => {
  it('sans suiveur : la fenêtre habituelle, les clés reçues sont rendues', async () => {
    await monter(useConfirmerSuppression);
    const { promesse } = await ouvrirSansRepondre(() => api.confirmerSuppressionAvecLiens(lots(), ['ligne-0-0-3']));
    expect(libelles()).toEqual(['pro_undo', 'pro_delete']);
    await act(async () => { bouton('pro_delete').click(); });
    expect(await promesse).toEqual(['ligne-0-0-3']);
  });

  it('avec des suiveurs : annuler, supprimer aussi les postes liés, ou supprimer et figer', async () => {
    await monter(useConfirmerSuppression);
    const { promesse } = await ouvrirSansRepondre(() => api.confirmerSuppressionAvecLiens(lots(), ['ligne-0-0-0']));
    expect(libelles()).toEqual(['pro_undo', 'pro_delete_with_followers {"count":2}', 'pro_delete_and_freeze']);
    expect(container.textContent).toContain('pro_confirm_delete_links');
    await act(async () => { bouton('pro_undo').click(); });
    expect(await promesse).toBeNull();
  });

  it('« Supprimer et figer » rend les clés reçues seulement', async () => {
    await monter(useConfirmerSuppression);
    const cles = await repondre(() => api.confirmerSuppressionAvecLiens(lots(), ['ligne-0-0-0']), 'pro_delete_and_freeze');
    expect(cles).toEqual(['ligne-0-0-0']);
  });

  it('« Supprimer aussi les postes liés » ajoute les clés des suiveurs, en cascade', async () => {
    await monter(useConfirmerSuppression);
    const cles = await repondre(() => api.confirmerSuppressionAvecLiens(lots(), ['ligne-0-0-0']), 'pro_delete_with_followers') as string[];
    expect(cles[0]).toBe('ligne-0-0-0');
    expect(cles.slice(1).sort()).toEqual(['ligne-0-0-1', 'ligne-0-0-2']);
  });

  it('Échap annule', async () => {
    await monter(useConfirmerSuppression);
    const { promesse } = await ouvrirSansRepondre(() => api.confirmerSuppressionAvecLiens(lots(), ['ligne-0-0-0']));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(await promesse).toBeNull();
  });

  it('confirmerSuppression reste une confirmation oui ou non, avec l\'avertissement sur les liens', async () => {
    await monter(useConfirmerSuppression);
    const { promesse } = await ouvrirSansRepondre(() => api.confirmerSuppression(lots(), ['ligne-0-0-0']));
    expect(libelles()).toEqual(['pro_undo', 'pro_delete']);
    expect(container.textContent).toContain('pro_confirm_delete_links');
    await act(async () => { bouton('pro_delete').click(); });
    expect(await promesse).toBe(true);
  });
});

describe('choisirLiens (copie, collage, duplication)', () => {
  const a = () => ligne('a');
  const b = () => ligne('b', { quantiteLiee: { sourceId: 'a' } });
  const x = () => ligne('x', { quantiteLiee: { sourceId: 'zz' } });
  const internes = () => liensDeCopie([a(), b()]);
  const externes = () => liensDeCopie([x()]);
  const mixtes = () => liensDeCopie([a(), b(), x()]);

  it('sans lien à signaler : aucune fenêtre, rien ne change', async () => {
    await monter(useChoisirLiensCopie);
    expect(await api.choisirLiens(liensDeCopie([a()]))).toBe('tout');
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('liens entre copies : conserver ou rompre', async () => {
    await monter(useChoisirLiensCopie);
    const { promesse } = await ouvrirSansRepondre(() => api.choisirLiens(internes()));
    expect(libelles()).toEqual(['pro_undo', 'pro_copy_links_break_all', 'pro_copy_links_keep']);
    await act(async () => { bouton('pro_copy_links_keep').click(); });
    expect(await promesse).toBe('tout');
    expect(await repondre(() => api.choisirLiens(internes()), 'pro_copy_links_break_all')).toBe('rompre');
  });

  it('liens vers des postes restés en place : rester lié à l\'origine ou rompre', async () => {
    await monter(useChoisirLiensCopie);
    const { promesse } = await ouvrirSansRepondre(() => api.choisirLiens(externes()));
    expect(libelles()).toEqual(['pro_undo', 'pro_copy_links_break_all', 'pro_copy_links_keep_origin']);
    await act(async () => { bouton('pro_copy_links_keep_origin').click(); });
    expect(await promesse).toBe('tout');
  });

  it('les deux à la fois : tout conserver, conserver entre copies seulement, ou tout rompre', async () => {
    await monter(useChoisirLiensCopie);
    const { promesse } = await ouvrirSansRepondre(() => api.choisirLiens(mixtes()));
    expect(libelles()).toEqual(['pro_undo', 'pro_copy_links_keep_internal', 'pro_copy_links_break_all', 'pro_copy_links_keep_all']);
    expect(container.textContent).toContain('pro_copy_links_mixed {"internes":1,"externes":1}');
    await act(async () => { bouton('pro_copy_links_keep_all').click(); });
    expect(await promesse).toBe('tout');
    expect(await repondre(() => api.choisirLiens(mixtes()), 'pro_copy_links_keep_internal')).toBe('internes');
    expect(await repondre(() => api.choisirLiens(mixtes()), 'pro_copy_links_break_all')).toBe('rompre');
  });

  it('annuler renonce à copier', async () => {
    await monter(useChoisirLiensCopie);
    expect(await repondre(() => api.choisirLiens(mixtes()), 'pro_undo')).toBeNull();
  });

  it('la fenêtre nomme les postes concernés', async () => {
    await monter(useChoisirLiensCopie);
    const { promesse } = await ouvrirSansRepondre(() => api.choisirLiens(mixtes()));
    expect(container.textContent).toContain('b Poste b, x Poste x');
    await act(async () => { bouton('pro_undo').click(); });
    await promesse;
  });
});
