// @vitest-environment jsdom
// Fiche quantité, unité et prix du CCTP : la formule saisie est réaffichée à la modification, un calcul
// refusé reste à l'écran avec son erreur, le prix se saisit ici comme dans le DPGF, le métré remplace la case.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CctpQuantiteUnite } from '../src/components/pro/CctpQuantiteUnite';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key) }),
}));

type Props = React.ComponentProps<typeof CctpQuantiteUnite>;

let root: Root;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

async function monter(surcharge: Partial<Props> = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const props: Props = {
    quantite: 30, unite: 'm²', prixUnitaire: 48.5, montant: 1455, prixVisible: true, unitesConnues: [],
    onQuantite: vi.fn(() => true), onUnite: vi.fn(), onPrix: vi.fn(() => true), onDetailler: vi.fn(), ...surcharge,
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(CctpQuantiteUnite, props)); });
  return props;
}

const champ = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;
async function saisir(el: HTMLInputElement, valeur: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const focus = (el: HTMLElement) => act(async () => { el.focus(); });
const quitter = (el: HTMLElement) => act(async () => { el.blur(); });

describe('CctpQuantiteUnite', () => {
  it('montre la quantité, l\'unité, le prix et le montant', async () => {
    await monter();
    expect(champ('cctp-quantite').value).toBe('30');
    expect(champ('cctp-unite').value).toBe('m²');
    expect(champ('cctp-prix').value).toContain('48,50');
    expect(container.textContent).toContain('1');
  });

  it('réaffiche la formule mémorisée quand on modifie la quantité, et ne renvoie rien si on la laisse telle quelle', async () => {
    const props = await monter({ formule: '=10+20' });
    expect(champ('cctp-quantite').value).toBe('30');
    await focus(champ('cctp-quantite'));
    expect(champ('cctp-quantite').value).toBe('=10+20');
    await quitter(champ('cctp-quantite'));
    expect(props.onQuantite).not.toHaveBeenCalled();
    expect(champ('cctp-quantite').value).toBe('30');
  });

  it('une quantité modifiée est envoyée telle que saisie, calcul compris', async () => {
    const props = await monter();
    await focus(champ('cctp-quantite'));
    await saisir(champ('cctp-quantite'), '=5*3');
    await quitter(champ('cctp-quantite'));
    expect(props.onQuantite).toHaveBeenCalledWith('=5*3');
  });

  it('un calcul refusé reste à l\'écran avec une erreur, au lieu de remettre 0', async () => {
    const props = await monter({ onQuantite: vi.fn(() => false) });
    await focus(champ('cctp-quantite'));
    await saisir(champ('cctp-quantite'), '=5*');
    await quitter(champ('cctp-quantite'));
    expect(props.onQuantite).toHaveBeenCalledWith('=5*');
    expect(champ('cctp-quantite').value).toBe('=5*');
    expect(champ('cctp-quantite').getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('pro_metre_error_line');
  });

  it('Échap annule la frappe', async () => {
    const props = await monter();
    await focus(champ('cctp-quantite'));
    await saisir(champ('cctp-quantite'), '99');
    await act(async () => { champ('cctp-quantite').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(props.onQuantite).not.toHaveBeenCalled();
    expect(champ('cctp-quantite').value).toBe('30');
  });

  it('le prix se saisit ici : nombre, calcul ou PM', async () => {
    const props = await monter();
    await focus(champ('cctp-prix'));
    expect(champ('cctp-prix').value).toBe('48,5');
    await saisir(champ('cctp-prix'), '=40+12');
    await quitter(champ('cctp-prix'));
    expect(props.onPrix).toHaveBeenCalledWith('=40+12');
  });

  it('un article pour mémoire affiche PM, prix et montant', async () => {
    await monter({ pourMemoire: true, prixUnitaire: 0, montant: 0 });
    expect(champ('cctp-prix').value).toBe('PM');
    expect(container.textContent).toContain('PM');
  });

  it('un article réservé au CCTP n\'a pas de prix', async () => {
    await monter({ prixVisible: false });
    expect(champ('cctp-prix')).toBeNull();
    expect(champ('cctp-quantite')).not.toBeNull();
  });

  it('avec un métré, la quantité est la somme : plus de case, le nombre de lignes et le bouton', async () => {
    const props = await monter({ lignesMetre: 3, quantite: 27.6 });
    expect(champ('cctp-quantite').tagName).toBe('SPAN');
    expect(champ('cctp-quantite').textContent).toContain('27,60');
    expect(container.textContent).toContain('pro_metre_sum_of');
    const bouton = [...container.querySelectorAll('button')].find(b => b.textContent === 'pro_metre_detail')!;
    await act(async () => { bouton.click(); });
    expect(props.onDetailler).toHaveBeenCalled();
  });

  it('une quantité par bâtiment n\'a pas de case mais garde le bouton de métré', async () => {
    await monter({ parBatiment: true });
    expect(champ('cctp-quantite').tagName).toBe('SPAN');
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'pro_metre_detail')).toBe(true);
  });

  it('un article lié à un autre poste n\'a pas de case : la quantité, le lien, plus de métré, et le bouton pour le changer', async () => {
    const onLier = vi.fn();
    await monter({ liee: 'pro_link_badge Fenêtres', onLier, quantite: 8 });
    expect(champ('cctp-quantite').tagName).toBe('SPAN');
    expect(champ('cctp-quantite').textContent).toContain('8');
    expect(container.textContent).toContain('pro_link_badge Fenêtres');
    const boutons = [...container.querySelectorAll('button')].map(b => b.textContent);
    expect(boutons).not.toContain('pro_metre_detail');
    await act(async () => { [...container.querySelectorAll('button')].find(b => b.textContent === 'pro_link_menu')!.click(); });
    expect(onLier).toHaveBeenCalled();
  });

  it('un article sans lien propose de lier, sauf s\'il a déjà un métré ou des bâtiments', async () => {
    const onLier = vi.fn();
    await monter({ onLier });
    const lier = () => [...container.querySelectorAll('button')].find(b => b.textContent === 'pro_link_menu') as HTMLButtonElement;
    expect(lier().disabled).toBe(false);
    await act(async () => root.unmount());
    container.remove();
    await monter({ onLier, lierImpossible: true, lignesMetre: 2 });
    expect(lier().disabled).toBe(true);
  });

  it('sans fonction pour lier (fiche sans document), aucun bouton de lien', async () => {
    await monter();
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'pro_link_menu')).toBe(false);
  });

  it('un article à sous-articles n\'a pas de quantité propre', async () => {
    await monter({ aDesEnfants: true });
    expect(container.textContent).toContain('pro_cctp_quantity_parent');
    expect(champ('cctp-quantite')).toBeNull();
  });
});
