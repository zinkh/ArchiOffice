// @vitest-environment jsdom
// Auto-complétion des articles depuis la bibliothèque : ce que choisir un ouvrage reprend (sans écraser la saisie),
// et le comportement de la saisie de désignation du DPGF.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchJson = vi.fn();
vi.mock('../src/lib/api', () => ({ fetchJson: (...a: unknown[]) => fetchJson(...a), apiFetch: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { CellInput } from '../src/components/pro/EditableCell';
import { TitreArticleCctp } from '../src/components/pro/TitreArticleCctp';
import { patchDepuisArticle } from '../src/lib/bibliothequeAutocompletion';
import type { Ligne } from '../src/types/dpgf';
import type { ArticleBibliotheque } from '../src/types/library';

const article = (surcharge: Partial<ArticleBibliotheque> = {}): ArticleBibliotheque => ({
  id: 'art1', designation: 'Enduit monocouche projeté', unite: 'm²', prix_unitaire: 48.5, code: null, categorie: null, lot_type: null,
  description: 'Enduit de façade.', notes: null, source: null, date_prix: null, usage_count: 0, last_used_at: null, favori: false,
  origine: 'saisie', created_by: null, created_at: null, sfb_code: null, dtu_code: null, corps_etat_code: null, naf_code: null, ...surcharge,
});
const ligne = (surcharge: Partial<Ligne> = {}): Ligne => ({
  id: 'l1', numero: '1.1', designation: 'Nouvel article', unite: 'u', quantite: 10, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', ...surcharge,
});

describe('patchDepuisArticle', () => {
  it('reprend titre, lien, unité, prix (montant recalculé) et description sur une ligne neuve', () => {
    expect(patchDepuisArticle(ligne(), article())).toEqual({
      designation: 'Enduit monocouche projeté', articleTypeId: 'art1', cctpDescription: 'Enduit de façade.',
      unite: 'm²', prixUnitaire: 48.5, prixTotal: 485,
    });
  });

  it('ne remplace jamais une unité, un prix ou une description déjà saisis', () => {
    const patch = patchDepuisArticle(ligne({ unite: 'ml', prixUnitaire: 30, prixTotal: 300, cctpDescription: 'Mon texte' }), article());
    expect(patch).toEqual({ designation: 'Enduit monocouche projeté', articleTypeId: 'art1' });
  });

  it('un article sans prix ni unité ne change que le titre et le lien', () => {
    expect(patchDepuisArticle(ligne(), article({ unite: null, prix_unitaire: 0, description: null }))).toEqual({
      designation: 'Enduit monocouche projeté', articleTypeId: 'art1',
    });
  });

  it('un article à sous-articles ou réservé au CCTP ne reçoit ni prix ni unité', () => {
    for (const l of [ligne({ children: [ligne({ id: 'e' })] }), ligne({ cctpOnly: true })]) {
      expect(patchDepuisArticle(l, article())).toEqual({ designation: 'Enduit monocouche projeté', articleTypeId: 'art1', cctpDescription: 'Enduit de façade.' });
    }
  });

  it('un article « pour mémoire » chiffré garde un montant à 0', () => {
    expect(patchDepuisArticle(ligne({ pourMemoire: true }), article())).toMatchObject({ prixUnitaire: 48.5, prixTotal: 0 });
  });
});

describe('CellInput : désignation avec les ouvrages de la bibliothèque', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => { fetchJson.mockReset(); fetchJson.mockResolvedValue([article(), article({ id: 'art2', designation: 'Enduit gratté', unite: 'm²', prix_unitaire: 0 })]); });
  afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

  async function monter(onChoisir = vi.fn(), onCommit = vi.fn(), onCancel = vi.fn()) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(CellInput, { value: 'Nouvel article', onCommit, onCancel, label: 'Désignation', articles: { onChoisir } }));
    });
    return { onChoisir, onCommit, onCancel };
  }
  const champ = () => container.querySelector('input')!;
  async function taper(valeur: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(champ(), valeur);
      champ().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
  }

  it('ne cherche rien tant que le texte n\'a pas été modifié', async () => {
    await monter();
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('propose les ouvrages qui correspondent, ouvrages seulement (jamais les clauses)', async () => {
    await monter();
    await taper('enduit');
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const url = String(fetchJson.mock.calls[0][0]);
    expect(url).toContain('dossier=ouvrages');
    expect(url).toContain('q=enduit');
    expect([...container.querySelectorAll('[role="option"]')].map(o => o.textContent)).toEqual([
      expect.stringContaining('Enduit monocouche projeté'), expect.stringContaining('Enduit gratté'),
    ]);
  });

  it('un caractère ne suffit pas pour chercher', async () => {
    await monter();
    await taper('e');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('choisir une proposition la donne à l\'éditeur, ferme la saisie et ne valide pas le texte tapé', async () => {
    const { onChoisir, onCommit, onCancel } = await monter();
    await taper('enduit');
    const option = container.querySelector('[role="option"]')!;
    await act(async () => { option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
    expect(onChoisir).toHaveBeenCalledWith(expect.objectContaining({ id: 'art1' }));
    expect(onCancel).toHaveBeenCalled();
    await act(async () => { champ().dispatchEvent(new FocusEvent('focusout', { bubbles: true })); champ().blur(); });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('au clavier, flèche bas puis Entrée choisit ; Entrée seul valide le texte tapé', async () => {
    const a = await monter();
    await taper('enduit');
    await act(async () => { champ().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { champ().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(a.onChoisir).toHaveBeenCalledWith(expect.objectContaining({ id: 'art1' }));

    await act(async () => root.unmount());
    container.remove();
    const b = await monter();
    await taper('enduit');
    await act(async () => { champ().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(b.onChoisir).not.toHaveBeenCalled();
    expect(b.onCommit).toHaveBeenCalledWith('enduit');
  });
});

describe('TitreArticleCctp : titre d\'un article du CCTP', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => { fetchJson.mockReset(); fetchJson.mockResolvedValue([article()]); });
  afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

  // Le titre vient du document : le parent le remet à jour à chaque frappe, comme l'éditeur du CCTP.
  function Hote({ onChoisir, onChange }: { onChoisir: (a: ArticleBibliotheque) => void; onChange: (v: string) => void }) {
    const [valeur, setValeur] = React.useState('Nouvel article');
    return React.createElement(TitreArticleCctp, { value: valeur, onChange: v => { setValeur(v); onChange(v); }, onChoisir });
  }
  const champ = () => container.querySelector('input')!;

  it('ne propose rien à l\'ouverture, propose après modification, et Entrée choisit la proposition surlignée', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onChoisir = vi.fn();
    const onChange = vi.fn();
    await act(async () => { root.render(React.createElement(Hote, { onChoisir, onChange })); });
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    expect(fetchJson).not.toHaveBeenCalled();

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(champ(), 'enduit');
      champ().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    expect(onChange).toHaveBeenCalledWith('enduit');
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);

    await act(async () => { champ().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onChoisir).not.toHaveBeenCalled(); // rien de surligné : Entrée ne choisit pas
    await act(async () => { champ().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { champ().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onChoisir).toHaveBeenCalledWith(expect.objectContaining({ id: 'art1' }));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
