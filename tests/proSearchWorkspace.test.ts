// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
vi.mock('../src/hooks/useSettings', () => ({ useSettings: () => ({ settings: {} }) }));
import '../src/i18n';
import { DPGFWorkspace } from '../src/components/pro/DPGFWorkspace';
import { clePourCible, rechercherDansDocument, type CibleRecherche } from '../src/lib/proRecherche';

const l = (id: string, n: string, d: string, children: any[] = []): any => ({ id, numero: n, designation: d, unite: 'u', quantite: 1, prixUnitaire: 1, prixTotal: 1, type: 'ouvrage', children });
const dpgf: any = { id: 'd', projectId: 'p', titre: 't', version: '1', dateCreation: '', statut: 'draft', totalHT: 0, TVA: 20, totalTTC: 0,
  lots: [{ id: 'l1', numero: '01', titre: 'Lot', sousTotal: 0, chapitres: [{ id: 'c1', numero: '1', titre: 'Chap', lignes: [l('a', '1.1', 'Alpha'), l('b', '1.2', 'Parent', [l('b1', '1.2.1', 'Sous-article introuvable sans dépliage')])] }] }] };

describe('recherche dans le DPGF', () => {
  it('déplie le parent du sous-article trouvé, le sélectionne et le rend visible', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } as any));
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(React.createElement(DPGFWorkspace as any, { dpgf, onChange: () => {} })); });
    // Les sous-articles sont repliés au départ.
    expect(el.querySelector('[data-search-id="b1"]')).toBeNull();

    const trouvaille = rechercherDansDocument(dpgf, 'dépliage')[0];
    expect(trouvaille.id).toBe('b1');
    const cible: CibleRecherche = { ...trouvaille, nonce: 1 };
    await act(async () => { root.render(React.createElement(DPGFWorkspace as any, { dpgf, onChange: () => {}, searchTarget: cible })); });

    expect(el.querySelector('[data-search-id="b1"]')).not.toBeNull();
    expect(clePourCible(cible)).toBe('ligne-0-0-1-0');
    // La ligne est cochée : la barre d'actions de la sélection apparaît.
    expect(el.querySelector('[role=toolbar][aria-label]')?.textContent).toMatch(/1 item selected/);
    await act(async () => { root.unmount(); });
  });
});
