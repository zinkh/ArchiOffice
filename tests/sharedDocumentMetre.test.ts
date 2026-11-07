// @vitest-environment jsdom
// Écran du confrère : prix, montant et métré dans le CCTP ; proposer un métré par la fenêtre de l'éditeur ;
// ce qu'il a saisi reste dans la fenêtre quand l'envoi est refusé. Données synthétiques.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../src/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
// `t` est stable, comme celui d'i18next : SharedDocument l'a dans les dépendances de son chargement.
vi.mock('react-i18next', () => {
  const t = (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key);
  return { useTranslation: () => ({ t }) };
});

import SharedDocument from '../src/components/SharedDocument';

const VUE = {
  titre: 'CCTP Villa', version: 'V1',
  lots: [{
    id: 'lot-a', numero: '01', titre: 'Façades', projectLotId: 'L1',
    chapitres: [{
      id: 'c1', numero: '1', titre: 'Enduits', cctpDescription: null,
      lignes: [
        {
          id: 'a1', numero: '1.1', designation: 'Enduit', unite: 'm²', localisation: null, cctpDescription: 'Texte technique',
          quantite: 27.6, prixUnitaire: 48.5, prixTotal: 1338.6, pourMemoire: false,
          quantiteDetails: [
            { id: 'q1', libelle: 'Façade Est', expression: '10', quantite: 10, niveau: null, local: null },
            { id: 'q2', libelle: 'Façade Ouest', expression: '=4*5', quantite: 20, niveau: null, local: null },
          ],
        },
        { id: 'a2', numero: '1.2', designation: 'Peinture', unite: 'm²', localisation: null, cctpDescription: null, quantite: 5, prixUnitaire: 10, prixTotal: 50, pourMemoire: false },
      ],
    }],
  }],
};

const ECRITURE = [{ kind: 'cctp', access: 'write' as const, lotId: 'L1' }, { kind: 'dpgf', access: 'write' as const, lotId: 'L1' }];
const LECTURE = [{ kind: 'cctp', access: 'read' as const, lotId: 'L1' }, { kind: 'dpgf', access: 'read' as const, lotId: 'L1' }];

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, options?: { method?: string }) => {
    if (options?.method === 'POST') return { id: 'p1' };
    if (url.endsWith('/cctp')) return VUE;
    return [];
  });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

async function monter(grants: { kind: string; access: 'read' | 'comment' | 'write'; lotId: string }[]) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(SharedDocument, { projectId: 'p', mode: 'cctp', grants, archived: false })); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

const texte = () => (container.textContent ?? '').replace(/[  ]/g, ' ');
const boutons = (contient: string) => [...container.querySelectorAll('button')].filter(b => (b.textContent ?? '').includes(contient));
const champ = (label: string) => [...document.querySelectorAll<HTMLInputElement>('input')].find(i => i.getAttribute('aria-label') === label)!;
const boutonDialogue = (texteBouton: string) => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === texteBouton) as HTMLButtonElement;
async function saisir(el: HTMLInputElement, valeur: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const proposalCalls = () => apiFetch.mock.calls.filter(([url, o]) => String(url).endsWith('/proposals') && o?.method === 'POST');

describe('SharedDocument : chiffres et métré dans le CCTP', () => {
  it('montre le prix, le montant et les lignes du métré', async () => {
    await monter(ECRITURE);
    expect(texte()).toContain('27,6 m² × 48,50 € = 1 338,60 €');
    expect(texte()).toContain('Façade Est');
    expect(texte()).toContain('=4*5');
  });

  it('propose la quantité seulement quand l\'article n\'a pas de métré ; le prix et le métré toujours', async () => {
    await monter(ECRITURE);
    // a1 a un métré : pas de proposition de quantité seule ; a2 n'en a pas : une.
    expect(boutons('shared_field_quantite')).toHaveLength(1);
    expect(boutons('shared_field_prixUnitaire')).toHaveLength(2);
    expect(boutons('shared_propose_metre')).toHaveLength(2);
  });

  it('en lecture seule, aucune proposition n\'est offerte', async () => {
    await monter(LECTURE);
    expect(boutons('shared_propose')).toHaveLength(0);
    expect(boutons('shared_propose_metre')).toHaveLength(0);
    expect(texte()).toContain('Façade Est'); // il voit le métré
  });

  it('proposer un métré : la fenêtre de l\'éditeur, puis une seule proposition avec la liste de lignes', async () => {
    await monter(ECRITURE);
    await act(async () => { boutons('shared_propose_metre')[0].click(); });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(champ('pro_metre_aria_label {"n":1}').value).toBe('Façade Est');

    await saisir(champ('pro_metre_aria_calc {"n":1}'), '12');
    await act(async () => { boutonDialogue('shared_proposal_send').click(); });

    const [, options] = proposalCalls()[0];
    const corps = JSON.parse(options.body);
    expect(corps).toMatchObject({ lotId: 'L1', targetType: 'ligne', targetId: 'a1', field: 'metre' });
    expect(JSON.parse(corps.value)).toEqual([{ libelle: 'Façade Est', expression: '12' }, { libelle: 'Façade Ouest', expression: '=4*5' }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // envoyée : la fenêtre se ferme
  });

  it('un envoi refusé garde la fenêtre et ce qui a été saisi, avec le message', async () => {
    apiFetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') throw Object.assign(new Error('Limite atteinte : 50 propositions en attente.'), { code: 'PROPOSAL_LIMIT' });
      if (url.endsWith('/cctp')) return VUE;
      return [];
    });
    await monter(ECRITURE);
    await act(async () => { boutons('shared_propose_metre')[0].click(); });
    await saisir(champ('pro_metre_aria_calc {"n":1}'), '12');
    await act(async () => { boutonDialogue('shared_proposal_send').click(); });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(champ('pro_metre_aria_calc {"n":1}').value).toBe('12');
    expect(document.body.textContent).toContain('Limite atteinte');
  });
});

describe('SharedDocument : métré d\'un article réparti par bâtiment', () => {
  const VUE_BATIMENTS = {
    ...VUE,
    multiBatiments: true,
    batiments: [{ id: 'b1', code: 'DX', libelle: 'Bâtiment X', ordre: 1 }, { id: 'b2', code: 'DY', libelle: 'Bâtiment Y', ordre: 2 }],
    lots: [{
      ...VUE.lots[0],
      chapitres: [{
        ...VUE.lots[0].chapitres[0],
        lignes: [{
          id: 'a3', numero: '1.3', designation: 'Bardage', unite: 'm²', localisation: null, cctpDescription: null,
          quantite: 30, prixUnitaire: 10, prixTotal: 300, pourMemoire: false, quantitesBatiments: { b1: 10, b2: 20 },
          quantiteDetails: [
            { id: 'q1', libelle: 'Façade Est', expression: '10', quantite: 10, niveau: null, local: null, batimentId: 'b1' },
            { id: 'q2', libelle: 'Façade Ouest', expression: '=4*5', quantite: 20, niveau: null, local: null, batimentId: 'b2' },
          ],
        }],
      }],
    }],
  };

  beforeEach(() => {
    apiFetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return { id: 'p1' };
      if (url.endsWith('/cctp')) return VUE_BATIMENTS;
      return [];
    });
  });

  it('ouvre le métré en arbre, une branche par bâtiment, et envoie le bâtiment de chaque ligne', async () => {
    await monter(ECRITURE);
    await act(async () => { boutons('shared_propose_metre')[0].click(); });
    expect(document.querySelector('[data-testid="metre-branch-b1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="metre-branch-b2"]')).not.toBeNull();

    await act(async () => { (document.querySelector('[data-testid="metre-add-b2"]') as HTMLButtonElement).click(); });
    await saisir(champ('pro_metre_aria_label {"n":3}'), 'Pignon');
    await saisir(champ('pro_metre_aria_calc {"n":3}'), '5');
    await act(async () => { boutonDialogue('shared_proposal_send').click(); });

    const corps = JSON.parse(proposalCalls()[0][1].body);
    expect(JSON.parse(corps.value)).toEqual([
      { libelle: 'Façade Est', expression: '10', batimentId: 'b1' },
      { libelle: 'Façade Ouest', expression: '=4*5', batimentId: 'b2' },
      { libelle: 'Pignon', expression: '5', batimentId: 'b2' },
    ]);
  });

  it('la quantité seule d\'un article par bâtiment n\'est pas proposée, le métré oui', async () => {
    await monter(ECRITURE);
    expect(boutons('shared_field_quantite')).toHaveLength(0);
    expect(boutons('shared_propose_metre')).toHaveLength(1);
  });
});
