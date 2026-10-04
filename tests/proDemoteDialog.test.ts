// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CCTPEditor } from '../src/components/pro/CCTPEditor';
import type { DPGF } from '../src/types/dpgf';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../src/components/pro/PriceLibraryPanel', () => ({ PriceLibraryPanel: () => null }));
vi.mock('../src/components/pro/CctpGenerateDialog', () => ({ CctpGenerateDialog: () => null }));
vi.mock('../src/components/pro/DecoupagePanel', () => ({ DecoupagePanel: () => null, SelecteursDecoupage: () => null }));

let root: Root;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

it('descend un chapitre puis son article avec sélection et description conservées', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const line = (id: string) => ({ id, numero: '', designation: id, unite: 'u', quantite: 1, prixUnitaire: 10, prixTotal: 10, type: 'ouvrage' as const, cctpDescription: `Description ${id}` });
  let current: DPGF = {
    id: 'doc', projectId: 'p', titre: 'CCTP', version: '1', dateCreation: '', statut: 'draft', TVA: 20, totalHT: 30, totalTTC: 36,
    lots: [{ id: 'lot', numero: '01', titre: 'Lot test', sousTotal: 30, chapitres: [
      { id: 'c1', numero: '01.1', titre: 'Premier chapitre', lignes: [line('Alpha')] },
      { id: 'c2', numero: '01.2', titre: 'Second chapitre', cctpDescription: 'Texte du chapitre', lignes: [line('Beta'), line('Gamma')] },
    ] }],
  };
  function Harness() {
    const [doc, setDoc] = useState(current);
    return React.createElement(CCTPEditor, { dpgf: doc, onSave: vi.fn(), onChange: next => { current = next; setDoc(next); } });
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Harness)));
  const button = () => container.querySelector<HTMLButtonElement>('button[title="pro_demote"]')!;
  const select = async (label: string) => {
    const span = [...container.querySelectorAll('span')].find(el => el.textContent === label)!;
    await act(async () => span.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };
  expect(button().disabled).toBe(true);
  await select('Premier chapitre'); expect(button().disabled).toBe(true);
  await select('Second chapitre'); expect(button().disabled).toBe(false);
  await act(async () => button().click());
  expect(current.lots[0].chapitres).toHaveLength(1);
  expect(container.querySelector('textarea')?.value).toBe('Texte du chapitre');
  await select('Gamma');
  await act(async () => button().click());
  expect(container.querySelector('textarea')?.value).toBe('Description Gamma');
  const group = current.lots[0].chapitres[0].lignes[1].children![0];
  expect(group.children?.map(l => l.id)).toEqual(['Beta', 'Gamma']);
  expect(current.totalHT).toBe(30);
});
