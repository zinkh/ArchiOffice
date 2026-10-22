// Un agent doit retrouver une réunion par l'adresse ou le nom de la fiche à
// laquelle elle est rattachée (devis, affaire, appel d'offres), pas seulement
// par son titre, souvent générique (« Visite du Site »).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import { capabilitiesFromAgent } from '../packages/archioffice-agents/src/types';

const AGENT = {
  action_scopes: ['meetings'], web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false,
} as any;

const DATA: Record<string, unknown[]> = {
  '/api/meetings': [
    { id: 'm1', title: 'Visite du Site', date: '2026-10-22', proposal_id: 'p1', notes: 'Le client souhaite loger le personnel sur site.' },
    { id: 'm2', title: 'Visite du Site', date: '2026-10-20', proposal_id: 'p2', notes: 'Autre opération.' },
  ],
  '/api/proposals': [
    { id: 'p1', title: '9 RUE DES MICHOTTES', adresse_terrain: '9 rue des Michottes' },
    { id: 'p2', title: '12 avenue de la Gare' },
  ],
  '/api/projects': [],
  '/api/tenders': [],
};

function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace('http://127.0.0.1:1', '').split('?')[0];
    return { ok: true, json: async () => DATA[path] ?? [] } as any;
  }));
}

const run = (name: string, args: Record<string, unknown>) =>
  executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, capabilitiesFromAgent(AGENT), { name, args });

afterEach(() => vi.unstubAllGlobals());

describe('réunions : recherche par fiche rattachée', () => {
  it('retrouve la réunion d\'un devis par son adresse, sans tenir compte des accents ni de la casse', async () => {
    stubApi();
    const { response } = await run('search_records', { resource: 'meetings', query: '9 rue des michottes' });
    expect(response.count).toBe(1);
    expect((response.matches as any[])[0]).toMatchObject({ id: 'm1', rattache_a: { type: 'proposal', intitule: '9 RUE DES MICHOTTES' } });
  });

  it('ne rend rien quand aucune réunion ne correspond', async () => {
    stubApi();
    const { response } = await run('search_records', { resource: 'meetings', query: 'Zorglub' });
    expect(response.count).toBe(0);
  });

  it('get_record rend les notes et la fiche rattachée', async () => {
    stubApi();
    const { response } = await run('get_record', { resource: 'meetings', id: 'm1' });
    expect((response.record as any).notes).toMatch(/loger le personnel/);
    expect(response.rattache_a).toEqual({ type: 'proposal', intitule: '9 RUE DES MICHOTTES' });
  });
});
