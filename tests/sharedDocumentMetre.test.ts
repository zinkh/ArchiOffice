// @vitest-environment jsdom
// Écran du confrère : prix, montant et métré dans le CCTP ; lecture d'abord, annotation au clic ; ce qu'il propose
// s'accumule en brouillons et part en une fois ; le métré se propose par la fenêtre de l'éditeur ; ce qu'il a saisi
// reste en brouillon quand l'envoi est refusé. Données synthétiques.
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
    if (url.endsWith('/cctp') || url.endsWith('/dpgf')) return VUE;
    return [];
  });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

type Droits = { kind: string; access: 'read' | 'comment' | 'write'; lotId: string }[];
async function monter(grants: Droits, props: { mode?: 'cctp' | 'dpgf'; modes?: ('cctp' | 'dpgf')[] } = { mode: 'cctp' }) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(SharedDocument, { projectId: 'p', grants, archived: false, ...props })); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

// Intl met des espaces insécables (U+00A0, U+202F) : on les ramène à une espace simple pour comparer.
const texte = () => (container.textContent ?? '').replace(/[  ]/g, ' ');
const boutons = (contient: string) => [...container.querySelectorAll('button')].filter(b => (b.textContent ?? '').includes(contient));
const parLabel = (contient: string) => [...container.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label') ?? '').includes(contient));
const champ = (label: string) => [...document.querySelectorAll<HTMLInputElement>('input')].find(i => i.getAttribute('aria-label') === label)!;
const boutonDialogue = (texteBouton: string) => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === texteBouton) as HTMLButtonElement;
async function saisir(el: HTMLInputElement, valeur: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function valider(el: HTMLInputElement) {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
}
const choisir = async (id: string) => { await act(async () => { document.getElementById(`node-ligne:${id}`)!.click(); }); };
const envoyer = async () => { await act(async () => { boutons('shared_feedback_send')[0].click(); }); await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const proposalCalls = () => apiFetch.mock.calls.filter(([url, o]) => String(url).endsWith('/proposals') && o?.method === 'POST');

describe('SharedDocument : lecture d\'abord', () => {
  it('montre le prix, le montant et les lignes du métré sans rien sélectionner', async () => {
    await monter(ECRITURE);
    expect(texte()).toContain('27,6 m² × 48,50 € = 1 338,60 €');
    expect(texte()).toContain('Façade Est');
    expect(texte()).toContain('=4*5');
    // Aucune action n'est affichée tant qu'un passage n'est pas sélectionné.
    expect(parLabel('shared_field_prixUnitaire')).toHaveLength(0);
    expect(boutons('shared_propose_metre')).toHaveLength(0);
    expect(boutons('shared_comment_add')).toHaveLength(0);
  });

  it('en lecture seule : ni actions, ni « Mes retours », ni bascule', async () => {
    await monter(LECTURE);
    await choisir('a2');
    expect(parLabel('shared_field_prixUnitaire')).toHaveLength(0);
    expect(boutons('shared_propose_metre')).toHaveLength(0);
    expect(boutons('shared_comment_add')).toHaveLength(0);
    expect(boutons('shared_mode_annotate')).toHaveLength(0);
    expect(container.querySelector('aside')).toBeNull();
    expect(texte()).toContain('Façade Est'); // il voit le métré
  });

  it('le mode Lecture retire toutes les actions, même sur un passage sélectionné', async () => {
    await monter(ECRITURE);
    await choisir('a2');
    expect(parLabel('shared_field_prixUnitaire')).toHaveLength(1);
    await act(async () => { boutons('shared_mode_read')[0].click(); });
    expect(parLabel('shared_field_prixUnitaire')).toHaveLength(0);
    expect(boutons('shared_comment_add')).toHaveLength(0);
    expect(container.querySelector('aside')).toBeNull();
  });
});

describe('SharedDocument : chiffres et métré dans le CCTP', () => {
  it('propose la quantité seulement quand l\'article n\'a pas de métré ; le prix et le métré toujours', async () => {
    await monter(ECRITURE);
    // a1 a un métré : pas de proposition de quantité seule ; a2 n'en a pas : une.
    await choisir('a1');
    expect(parLabel('shared_field_quantite')).toHaveLength(0);
    expect(parLabel('shared_field_prixUnitaire')).toHaveLength(1);
    expect(boutons('shared_propose_metre')).toHaveLength(1);
    await choisir('a2');
    expect(parLabel('shared_field_quantite')).toHaveLength(1);
    expect(parLabel('shared_field_prixUnitaire')).toHaveLength(1);
    expect(boutons('shared_propose_metre')).toHaveLength(1);
  });

  it('proposer un métré : la fenêtre de l\'éditeur, un brouillon, puis une seule proposition avec la liste de lignes', async () => {
    await monter(ECRITURE);
    await choisir('a1');
    await act(async () => { boutons('shared_propose_metre')[0].click(); });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(champ('pro_metre_aria_label {"n":1}').value).toBe('Façade Est');

    await saisir(champ('pro_metre_aria_calc {"n":1}'), '12');
    await act(async () => { boutonDialogue('shared_edit_add').click(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // le brouillon est pris : la fenêtre se ferme
    expect(proposalCalls()).toHaveLength(0); // rien n'est envoyé avant « Envoyer mes retours »
    expect(texte()).toContain('shared_status_draft');

    await envoyer();
    const [, options] = proposalCalls()[0];
    const corps = JSON.parse(options.body);
    expect(corps).toMatchObject({ lotId: 'L1', targetType: 'ligne', targetId: 'a1', field: 'metre' });
    expect(JSON.parse(corps.value)).toEqual([{ libelle: 'Façade Est', expression: '12' }, { libelle: 'Façade Ouest', expression: '=4*5' }]);
  });

  it('un envoi refusé garde le brouillon et ce qui a été saisi, avec le message', async () => {
    apiFetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') throw Object.assign(new Error('Limite atteinte : 50 propositions en attente.'), { code: 'PROPOSAL_LIMIT' });
      if (url.endsWith('/cctp')) return VUE;
      return [];
    });
    await monter(ECRITURE);
    await choisir('a1');
    await act(async () => { boutons('shared_propose_metre')[0].click(); });
    await saisir(champ('pro_metre_aria_calc {"n":1}'), '12');
    await act(async () => { boutonDialogue('shared_edit_add').click(); });
    await envoyer();

    expect(texte()).toContain('Limite atteinte');
    expect(texte()).toContain('shared_status_draft'); // le brouillon reste, rien n'est perdu
    expect(boutons('shared_feedback_send')[0].textContent).toContain('"count":1');
  });
});

describe('SharedDocument : retours envoyés en une fois', () => {
  it('un prix et une quantité saisis dans le CCTP partent ensemble, dans l\'ordre', async () => {
    await monter(ECRITURE);
    await choisir('a2');
    await act(async () => { parLabel('shared_field_prixUnitaire')[0].click(); });
    await saisir(champ('shared_field_prixUnitaire'), '12,5');
    await valider(champ('shared_field_prixUnitaire'));
    await act(async () => { parLabel('shared_field_quantite')[0].click(); });
    await saisir(champ('shared_field_quantite'), '8');
    await valider(champ('shared_field_quantite'));

    expect(proposalCalls()).toHaveLength(0);
    expect(boutons('shared_feedback_send')[0].textContent).toContain('"count":2');
    await envoyer();

    const envoyes = proposalCalls().map(([, o]) => JSON.parse(o.body));
    expect(envoyes).toHaveLength(2);
    expect(envoyes).toContainEqual({ lotId: 'L1', targetType: 'ligne', targetId: 'a2', field: 'prixUnitaire', value: '12.5' });
    expect(envoyes).toContainEqual({ lotId: 'L1', targetType: 'ligne', targetId: 'a2', field: 'quantite', value: '8' });
    expect(texte()).toContain('shared_feedback_sent');
  });

  it('refuse un prix qui n\'est pas un nombre positif, sans créer de brouillon', async () => {
    await monter(ECRITURE);
    await choisir('a2');
    await act(async () => { parLabel('shared_field_prixUnitaire')[0].click(); });
    await saisir(champ('shared_field_prixUnitaire'), 'abc');
    await valider(champ('shared_field_prixUnitaire'));
    expect(texte()).toContain('shared_figure_invalid');
    expect(boutons('shared_feedback_send')[0].textContent).not.toContain('"count"');
  });

  it('un commentaire part avec les propositions', async () => {
    await monter(ECRITURE);
    await choisir('a2');
    await act(async () => { boutons('shared_comment_add')[0].click(); });
    const zone = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(zone, 'Teinte à confirmer');
      zone.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { boutons('shared_edit_add')[0].click(); });
    await envoyer();

    const appel = apiFetch.mock.calls.find(([url, o]) => String(url).endsWith('/comments') && o?.method === 'POST')!;
    expect(JSON.parse(appel[1].body)).toMatchObject({ resourceKind: 'cctp', lotId: 'L1', targetType: 'ligne', targetId: 'a2', body: 'Teinte à confirmer' });
  });
});

describe('SharedDocument : CCTP et DPGF sur le même écran', () => {
  it('le DPGF s\'affiche en tableau, avec les quantités et les prix modifiables au clic', async () => {
    await monter(ECRITURE, { modes: ['cctp', 'dpgf'] });
    await act(async () => { container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click(); });
    expect(container.querySelector('table')).not.toBeNull();
    expect(texte()).toContain('shared_col_qty');
    // a1 a un métré : sa quantité n'est pas modifiable seule ; a2 oui. Le prix l'est pour les deux.
    expect(parLabel('shared_field_quantite')).toHaveLength(1);
    expect(parLabel('shared_field_prixUnitaire')).toHaveLength(2);
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
    await choisir('a3');
    await act(async () => { boutons('shared_propose_metre')[0].click(); });
    expect(document.querySelector('[data-testid="metre-branch-b1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="metre-branch-b2"]')).not.toBeNull();

    await act(async () => { (document.querySelector('[data-testid="metre-add-b2"]') as HTMLButtonElement).click(); });
    await saisir(champ('pro_metre_aria_label {"n":3}'), 'Pignon');
    await saisir(champ('pro_metre_aria_calc {"n":3}'), '5');
    await act(async () => { boutonDialogue('shared_edit_add').click(); });
    await envoyer();

    const corps = JSON.parse(proposalCalls()[0][1].body);
    expect(JSON.parse(corps.value)).toEqual([
      { libelle: 'Façade Est', expression: '10', batimentId: 'b1' },
      { libelle: 'Façade Ouest', expression: '=4*5', batimentId: 'b2' },
      { libelle: 'Pignon', expression: '5', batimentId: 'b2' },
    ]);
  });

  it('la quantité seule d\'un article par bâtiment n\'est pas proposée, le métré oui', async () => {
    await monter(ECRITURE);
    await choisir('a3');
    expect(parLabel('shared_field_quantite')).toHaveLength(0);
    expect(boutons('shared_propose_metre')).toHaveLength(1);
  });
});
