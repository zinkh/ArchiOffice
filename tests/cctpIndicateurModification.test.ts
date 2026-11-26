// @vitest-environment jsdom
// Indicateur « Modifié le … à … par … » de chaque poste du CCTP : dans l'arbre (infobulle) et dans la fiche de
// l'élément sélectionné. Ce test monte l'éditeur complet : la fiche lit une copie réduite de l'élément
// sélectionné, et un champ oublié dans cette copie ferait disparaître l'indicateur sans qu'aucun type ne le dise.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CCTPEditor } from '../src/components/pro/CCTPEditor';
import type { DPGF } from '../src/types/dpgf';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${Object.values(options).join(' ')}` : key),
    i18n: { language: 'fr' },
  }),
}));
vi.mock('../src/components/pro/PriceLibraryPanel', () => ({ PriceLibraryPanel: () => null }));
vi.mock('../src/components/pro/CctpGenerateDialog', () => ({ CctpGenerateDialog: () => null }));
vi.mock('../src/components/pro/CctpExportLibraryDialog', () => ({ CctpExportLibraryDialog: () => null }));
vi.mock('../src/components/pro/CctpDraftPosteDialog', () => ({ CctpDraftPosteDialog: () => null }));
vi.mock('../src/components/pro/CctpBulkEditDialog', () => ({ CctpBulkEditDialog: () => null }));
vi.mock('../src/components/SignedImage', () => ({ SignedImage: () => null }));
vi.mock('../src/components/pro/FichesTechniquesEditor', () => ({ FichesTechniquesEditor: () => null }));
vi.mock('../src/lib/cctpImagesUpload', () => ({ envoyerIllustration: async () => { throw new Error('non utilisé'); } }));
vi.mock('../src/components/pro/DecoupagePanel', () => ({ DecoupagePanel: () => null, SelecteursDecoupage: () => null }));

let root: Root;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

const ligne = (id: string, extra: Record<string, unknown> = {}) => ({
  id, numero: '', designation: id, unite: 'u', quantite: 1, prixUnitaire: 10, prixTotal: 10, type: 'ouvrage' as const, cctpDescription: `Description ${id}`, ...extra,
});

const dpgf: DPGF = {
  id: 'doc', projectId: 'p', titre: 'CCTP', version: '1', dateCreation: '', statut: 'draft', TVA: 20, totalHT: 20, totalTTC: 24,
  lots: [{ id: 'lot', numero: '01', titre: 'Lot test', sousTotal: 20, chapitres: [
    { id: 'c1', numero: '01.1', titre: 'Chapitre daté', modifieLe: '2026-01-02T09:15:00.000Z', modifiePar: 'Bob Test', lignes: [
      ligne('Alpha', { modifieLe: '2026-11-08T17:40:00.000Z', modifiePar: 'Alice Test' }),
      ligne('Beta'),
    ] },
  ] }],
} as unknown as DPGF;

async function monter() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = globalThis.document.createElement('div');
  globalThis.document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(CCTPEditor, { dpgf, onChange: () => {} })));
}

const selectionner = async (libelle: string) => {
  const span = [...container.querySelectorAll('span')].find(el => el.textContent === libelle)!;
  await act(async () => span.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const fiche = () => container.querySelector('[data-testid="indicateur-modification"]');

it('affiche la date, l\'heure et l\'auteur de la dernière modification dans la fiche de l\'article', async () => {
  await monter();
  expect(fiche()).toBeNull(); // rien de sélectionné

  await selectionner('Alpha');
  expect(fiche()?.textContent).toContain('pro_modifie_complet');
  expect(fiche()?.textContent).toContain('Alice Test');
  expect(fiche()?.textContent).toContain('08/11/2026');
});

it('n\'affiche rien pour un article jamais modifié depuis la mise en place', async () => {
  await monter();
  await selectionner('Beta');
  expect(fiche()).toBeNull();
});

it('affiche aussi l\'indicateur d\'un chapitre', async () => {
  await monter();
  await selectionner('Chapitre daté');
  expect(fiche()?.textContent).toContain('Bob Test');
});

it('marque chaque poste daté dans l\'arbre, avec la phrase complète en infobulle', async () => {
  await monter();
  const reperes = [...container.querySelectorAll('[aria-label*="pro_modifie_complet"]')];
  expect(reperes.map(r => r.getAttribute('title'))).toEqual([
    expect.stringContaining('Bob Test'),
    expect.stringContaining('Alice Test'),
  ]);
});
