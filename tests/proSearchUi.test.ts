// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/i18n';
import { ProSearch } from '../src/components/pro/toolbar/ProSearch';
import type { Trouvaille } from '../src/lib/proRecherche';

const l = (id: string, numero: string, designation: string): any => ({ id, numero, designation, unite: 'u', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', children: [] });
const doc: any = { lots: [{ id: 'l1', numero: '01', titre: 'Lot', chapitres: [{ id: 'c1', numero: '1', titre: 'Chap', lignes: [l('a', '1.1', 'Plomberie sanitaire'), l('b', '1.2', 'Plomberie cuisine'), l('c', '1.3', 'Peinture')] }] }] };

const taper = async (input: HTMLInputElement, valeur: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, valeur); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const touche = async (el: Element, key: string) => { await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }); };

describe('ProSearch', () => {
  it('ouvre la fenêtre, liste les trouvailles et en choisit une au clavier', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const choix: Trouvaille[] = [];
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(React.createElement(ProSearch, { doc, onPick: (t: Trouvaille) => choix.push(t) })); });

    const bouton = el.querySelector('button[aria-label]') as HTMLButtonElement;
    expect(bouton).toBeTruthy();
    await act(async () => { bouton.click(); });
    const champ = document.querySelector('input[role=combobox]') as HTMLInputElement;
    expect(champ).toBeTruthy();
    expect(document.querySelector('[role=status]')?.textContent).toMatch(/at least 2/);

    await taper(champ, 'plomb');
    const options = document.querySelectorAll('[role=option]');
    expect(options).toHaveLength(2);
    expect(document.querySelector('[role=status]')?.textContent).toBe('2 results');
    expect(document.querySelector('mark')?.textContent?.toLowerCase()).toBe('plomb');

    await touche(champ, 'ArrowDown');
    expect(document.querySelectorAll('[role=option]')[1].getAttribute('aria-selected')).toBe('true');
    await touche(champ, 'Enter');
    expect(choix).toHaveLength(1);
    expect(choix[0].id).toBe('b');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await act(async () => { root.unmount(); });
  });

  it('dit quand rien ne correspond et se referme à Échap', async () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(React.createElement(ProSearch, { doc, onPick: vi.fn() })); });
    await act(async () => { (el.querySelector('button[aria-label]') as HTMLButtonElement).click(); });
    const champ = document.querySelector('input[role=combobox]') as HTMLInputElement;
    await taper(champ, 'zzzz');
    expect(document.querySelector('[role=status]')?.textContent).toContain('No result');
    await touche(champ, 'Escape');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await act(async () => { root.unmount(); });
  });
});
