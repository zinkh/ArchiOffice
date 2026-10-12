// @vitest-environment jsdom
// L'écran de la mémoire technique collective : src/components/KnowledgeSharingPanel.tsx
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../src/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { KnowledgeSharingPanel } from '../src/components/KnowledgeSharingPanel';

const DOCS = [{ id: 'd1', name: 'CCTP lot 04.pdf' }, { id: 'd2', name: 'Notice acoustique.pdf' }];
const AUTO_OFF = {
  enabled: false, categories: [], daily_cap: 25,
  available: [{ name: 'CCTP', count: 3 }, { name: 'Note technique', count: 1 }, { name: 'DPGF', count: 0 }],
};
const SENT_TEXT = 'Pose par [ENTREPRISE] au [PERMIS], entraxe 600 mm.';

function state(overrides: Record<string, unknown> = {}) {
  return {
    opted_in: true, publication_active: true, auto: AUTO_OFF, publications: [], contributions: [], ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;
const text = () => container.textContent || '';
const button = (label: string | RegExp) => [...container.querySelectorAll('button')].find(b =>
  typeof label === 'string' ? b.textContent?.includes(label) : label.test(b.textContent || '') || label.test(b.getAttribute('aria-label') || ''))!;
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

async function render(initial: unknown, docs = DOCS) {
  apiFetch.mockImplementation(async (url: string) => (url === '/api/knowledge-sharing' ? initial : {}));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(KnowledgeSharingPanel, { documents: docs })));
}

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); apiFetch.mockReset(); });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('n’affiche rien à qui n’est pas administrateur', async () => {
  apiFetch.mockRejectedValue(Object.assign(new Error('Réservé'), { status: 403 }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(KnowledgeSharingPanel, { documents: DOCS })));
  expect(container.innerHTML).toBe('');
});

it('explique le parcours d’un document et précise ce qui ne part jamais', async () => {
  await render(state());
  const how = container.querySelector('details')!;
  expect(how.textContent).toContain('Comment un document est traité');
  expect(how.textContent).toMatch(/ne partent jamais/);
  expect(how.textContent).toMatch(/Mistral/);
  expect(how.textContent).toMatch(/retenu/);
});

it('dit clairement quand l’envoi est désactivé sur l’instance', async () => {
  await render(state({ publication_active: false }));
  expect(text()).toMatch(/L’envoi est désactivé sur cette instance/);
  expect(text()).toMatch(/rien ne quitte ArchiOffice/);
});

it('demande d’abord l’autorisation de contribution, sans proposer le partage automatique', async () => {
  await render(state({ opted_in: false }));
  expect(container.querySelector('input[aria-label^="Autoriser"]')).toBeTruthy();
  expect(text()).not.toContain('Partage automatique');
  expect(text()).not.toContain('Documents analysés et partagés');
});

it('ne permet d’activer le partage automatique qu’après choix des types ET compréhension de l’analyse par l’IA', async () => {
  await render(state());
  const enable = () => button('Activer le partage automatique') as HTMLButtonElement;
  expect(enable().disabled).toBe(true);
  expect(text()).toMatch(/CCTP.*3 documents/);
  expect(text()).toMatch(/DPGF.*0 document/);
  expect(text()).toMatch(/contrats, devis, ordres de service/);

  const boxes = [...container.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')];
  await click(boxes[0]);                       // CCTP
  expect(enable().disabled).toBe(true);        // la compréhension manque encore
  await click(boxes[boxes.length - 1]);        // « je comprends »
  expect(enable().disabled).toBe(false);
  expect(text()).toMatch(/analysé par Mistral avant toute relecture humaine/);

  await click(enable());
  expect(apiFetch).toHaveBeenCalledWith('/api/knowledge-sharing/auto', {
    method: 'PUT', body: JSON.stringify({ enabled: true, categories: ['CCTP'], confirmed_ai_review: true }),
  });
});

it('affiche le partage actif, propose de traiter l’existant et permet de le désactiver après confirmation', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await render(state({ auto: { ...AUTO_OFF, enabled: true, categories: ['CCTP'] } }));
  expect(text()).toMatch(/Partage automatique actif.*CCTP/);
  expect(text()).toMatch(/Traiter aussi les 3 documents déjà présents/);

  await click(button('Traiter aussi'));
  expect(apiFetch).toHaveBeenCalledWith('/api/knowledge-sharing/auto/backfill', { method: 'POST' });

  await click(button('Désactiver le partage automatique'));
  expect(window.confirm).toHaveBeenCalled();
  expect(apiFetch).toHaveBeenCalledWith('/api/knowledge-sharing/auto', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
});

it('journal : un état en toutes lettres, un bilan, et le texte exact avec les passages masqués visibles', async () => {
  await render(state({
    contributions: [{
      id: 'c1', document_id: 'd1', status: 'reviewed', origin: 'auto', review_mode: 'auto', sanitized_text: SENT_TEXT,
      warnings: [], created_at: '2026-10-11T10:00:00Z', reviewed_at: '2026-10-11T10:05:00Z',
      withheld: [{ index: 3, text: 'Le client [PERSONNE] valide à Nancy.', reasons: ['à vérifier : Nancy'] }],
      analysis: { paragraphs: 5, kept: 4, withheld: 1, masked: { PERSONNE: 2, ENTREPRISE: 1, PERMIS: 1 } },
    }],
    publications: [{ contribution_id: 'c1', remote_document_id: 'r1', state: 'published', deletion_requested_at: null, deleted_at: null, published_at: '2026-10-11T10:06:00Z' }],
  }));
  expect(text()).toContain('CCTP lot 04.pdf');
  expect(text()).toContain('Envoyé');
  expect(text()).toContain('4 paragraphes sur 5 partageables · 1 retenu par prudence · 4 éléments masqués');
  expect(container.querySelector('mark')).toBeNull();      // détail fermé : rien d'autre à lire

  await click(button('Voir le détail'));
  expect(text()).toContain('Texte envoyé');
  expect(text()).toContain('2 personnes, 1 entreprise, 1 permis');
  const marks = [...container.querySelectorAll('mark')].map(m => m.textContent);
  expect(marks).toEqual(['[ENTREPRISE]', '[PERMIS]']);
  expect(container.querySelector('pre')!.textContent).toBe(SENT_TEXT);
  expect(text()).toContain('Retenu, non envoyé (1 paragraphe)');
  expect(text()).toContain('à vérifier : Nancy');
});

it('journal : un document en cours d’analyse est annoncé, sans texte à montrer', async () => {
  await render(state({
    contributions: [{ id: 'c2', document_id: 'd2', status: 'analyzing', origin: 'auto', sanitized_text: '', warnings: [], created_at: '2026-10-11T10:00:00Z' }],
  }));
  expect(text()).toContain('Analyse en cours');
  await click(button('Voir le détail'));
  expect(container.querySelector('pre')).toBeNull();
});

it('retire un texte envoyé, après confirmation, et le dit', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await render(state({
    contributions: [{ id: 'c1', document_id: 'd1', status: 'reviewed', origin: 'auto', sanitized_text: SENT_TEXT, warnings: [], created_at: '2026-10-11T10:00:00Z' }],
    publications: [{ contribution_id: 'c1', remote_document_id: 'r1', state: 'published', deletion_requested_at: null, deleted_at: null }],
  }));
  await click(button(/Retirer et supprimer CCTP lot 04\.pdf/));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Retirer de la bibliothèque Mistral'));
  expect(apiFetch).toHaveBeenCalledWith('/api/knowledge-sharing/contributions/c1', { method: 'DELETE' });
});

it('ne retire rien si l’utilisateur annule', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  await render(state({
    contributions: [{ id: 'c1', document_id: 'd1', status: 'held', origin: 'auto', sanitized_text: '', warnings: [], created_at: '2026-10-11T10:00:00Z', analysis: { reason: 'Rien de partageable sans risque.' } }],
  }));
  expect(text()).toContain('Retenu, rien n’a été envoyé');
  expect(text()).toContain('Rien de partageable sans risque.');
  await click(button(/Retirer et supprimer/));
  expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/contributions/'), expect.anything());
});

it('alerte quand un retrait échoue de façon répétée', async () => {
  await render(state({
    contributions: [{ id: 'c1', document_id: 'd1', status: 'reviewed', origin: 'auto', sanitized_text: 'x', warnings: [], created_at: '2026-10-11T10:00:00Z' }],
    publications: [{ contribution_id: 'c1', remote_document_id: 'r1', state: 'delete_pending', deletion_requested_at: '2026-10-11T11:00:00Z', deleted_at: null, delete_attempts: 6 }],
  }));
  expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/échoue de façon répétée/);
  expect(text()).toContain('Retrait en échec');
  expect(button('Vérifier les transferts et suppressions Mistral')).toBeTruthy();
});

it('affiche un document supprimé de la GED sans casser le journal', async () => {
  await render(state({
    contributions: [{ id: 'c1', document_id: 'inconnu', status: 'queued', origin: 'auto', sanitized_text: '', warnings: [], created_at: '2026-10-11T10:00:00Z' }],
  }));
  expect(text()).toContain('Document supprimé de la GED');
  expect(text()).toContain('En attente d’analyse');
});
