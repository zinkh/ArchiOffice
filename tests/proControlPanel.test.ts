// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/i18n';

vi.mock('../src/lib/api', () => ({ apiFetch: async () => ({ corrections: [] }) }));
import { ProControlPanel } from '../src/components/pro/ProControlPanel';
import { trouvaillePourId } from '../src/lib/proRecherche';

const l = (id: string, numero: string, designation: string, extra: any = {}): any => ({
  id, numero, designation, unite: 'u', quantite: 1, prixUnitaire: 10, prixTotal: 10, type: 'ouvrage', cctpDescription: 'Texte.', children: [], ...extra,
});
const doc: any = {
  totalHT: 30,
  lots: [
    { id: 'l1', numero: '01', titre: 'Démolition', chapitres: [{ id: 'c1', numero: '1', titre: 'Ouvrages', lignes: [
      l('a', '1.1', 'Dépose', { unite: '' }),
      l('p', '1.2', 'Parent', { children: [l('p1', '1.2.1', 'Benne', { quantite: 0 })] }),
    ] }] },
    { id: 'l2', numero: '02', titre: 'Menuiseries', chapitres: [{ id: 'c2', numero: '1', titre: 'Portes', lignes: [l('b', '1.1', 'Bloc-porte', { unite: '' })] }] },
  ],
};

describe('trouvaillePourId', () => {
  it('retrouve un article, y compris un sous-article, par son identifiant', () => {
    expect(trouvaillePourId(doc, 'b')).toMatchObject({ lotIdx: 1, chapIdx: 0, lignePath: [0], lotId: 'l2' });
    expect(trouvaillePourId(doc, 'p1')).toMatchObject({ lotIdx: 0, lignePath: [1, 0], ancetresIds: ['p'] });
  });
  it('rend null pour un article disparu', () => {
    expect(trouvaillePourId(doc, 'absent')).toBeNull();
    expect(trouvaillePourId(null, 'a')).toBeNull();
  });
});

describe('ProControlPanel', () => {
  it('classe les remarques par lot dans l\'ordre du document et ouvre l\'article cliqué', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const onGoTo = vi.fn();
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(React.createElement(ProControlPanel, { dpgf: doc, onClose: () => {}, onGoTo })); });

    const lots = [...el.querySelectorAll('section')].map(s => s.getAttribute('aria-label'));
    expect(lots).toEqual(['01 Démolition', '02 Menuiseries']);

    const boutons = [...el.querySelectorAll('li button')] as HTMLButtonElement[];
    expect(boutons.length).toBe(3);
    const bloc = boutons.find(b => b.textContent?.includes('Bloc-porte'))!;
    await act(async () => { bloc.click(); });
    expect(onGoTo).toHaveBeenCalledWith('b');
    await act(async () => { root.unmount(); });
  });

  it('n\'affiche que les erreurs sur demande', async () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(React.createElement(ProControlPanel, { dpgf: doc, onClose: () => {}, onGoTo: () => {} })); });
    // Le sous-article « Benne » n'a qu'un avertissement (quantité nulle) : il disparaît du filtre.
    expect(el.textContent).toContain('Benne');
    const filtre = [...el.querySelectorAll('button[aria-pressed]')][1] as HTMLButtonElement;
    await act(async () => { filtre.click(); });
    expect(el.textContent).not.toContain('Benne');
    expect(el.textContent).toContain('Dépose');
    await act(async () => { root.unmount(); });
  });
});
