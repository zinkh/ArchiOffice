// @vitest-environment jsdom
// Fenêtre « description » du DPGF : le titre de l'article (sa désignation) se modifie avec le texte technique.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LigneDescriptionDialog } from '../src/components/pro/LigneDescriptionDialog';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('motion/react', () => ({ AnimatePresence: ({ children }: any) => children }));
vi.mock('../src/components/pro/FichesTechniquesEditor', () => ({ FichesTechniquesEditor: () => null }));
vi.mock('../src/components/ui/ModalShell', () => ({
  ModalShell: ({ children, footer }: any) => React.createElement('div', { role: 'dialog' }, children, footer),
}));

let root: Root;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

async function ouvrir(onSave = vi.fn()) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(LigneDescriptionDialog, { numero: '1.2', designation: 'Enduit', valeur: 'Texte', onSave, onClose: vi.fn() }));
  });
  return onSave;
}
const titre = () => container.querySelector<HTMLInputElement>('#ligne-description-titre')!;
const enregistrer = () => [...container.querySelectorAll('button')].find(b => b.textContent === 'pro_description_save') as HTMLButtonElement;
async function saisir(el: HTMLInputElement, valeur: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('LigneDescriptionDialog : titre de l\'article', () => {
  it('montre la désignation actuelle et n\'enregistre rien tant qu\'elle n\'a pas changé', async () => {
    await ouvrir();
    expect(titre().value).toBe('Enduit');
    expect(enregistrer().disabled).toBe(true);
  });

  it('enregistre le nouveau titre avec le texte', async () => {
    const onSave = await ouvrir();
    await saisir(titre(), '  Enduit monocouche ');
    expect(enregistrer().disabled).toBe(false);
    await act(async () => { enregistrer().click(); });
    expect(onSave).toHaveBeenCalledWith('Texte', 'Enduit monocouche');
  });

  it('un titre vide est signalé et empêche d\'enregistrer', async () => {
    const onSave = await ouvrir();
    await saisir(titre(), '   ');
    expect(container.textContent).toContain('pro_description_title_required');
    expect(enregistrer().disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
