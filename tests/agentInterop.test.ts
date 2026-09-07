// Les agents peuvent se consulter entre eux (consulter_agent) et prévenir un
// utilisateur réel en dehors de leur conversation (publier_flux_activite).
// Ces tests couvrent la couche outil (delegateTools.ts, notifyTools.ts) et
// son branchement dans executeAgentAction — la route de chat elle-même n'est
// pas exercée de bout en bout ici : comme le reste des outils d'agent, elle
// dépend d'un aller-retour HTTP en boucle locale (voir tools.ts) qui suppose
// un serveur réellement à l'écoute, ce qu'aucun test de ce dépôt ne simule
// (agentAutonomy.test.ts appelle executeAgentAction directement pour la même
// raison).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAgentTools, executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import { capabilitiesFromAgent } from '../packages/archioffice-agents/src/types';

const NO_CAPS = {
  action_scopes: [], web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false,
  geo_enabled: false, docs_read_enabled: false, delegate_enabled: false, notify_users_enabled: false,
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('capabilitiesFromAgent — delegate / notifyUsers', () => {
  it('lit les deux colonnes indépendamment', () => {
    expect(capabilitiesFromAgent({ delegate_enabled: true }).delegate).toBe(true);
    expect(capabilitiesFromAgent({ delegate_enabled: true }).notifyUsers).toBe(false);
    expect(capabilitiesFromAgent({ notify_users_enabled: true }).delegate).toBe(false);
    expect(capabilitiesFromAgent({}).delegate).toBe(false);
    expect(capabilitiesFromAgent({}).notifyUsers).toBe(false);
  });
});

describe("périmètre des outils — consulter_agent / publier_flux_activite", () => {
  it("n'expose ni l'un ni l'autre sans la capacité correspondante", () => {
    const names = buildAgentTools(capabilitiesFromAgent(NO_CAPS)).map(t => t.name);
    expect(names).not.toContain('consulter_agent');
    expect(names).not.toContain('publier_flux_activite');
  });

  it('expose consulter_agent uniquement avec delegate_enabled', () => {
    const names = buildAgentTools(capabilitiesFromAgent({ ...NO_CAPS, delegate_enabled: true })).map(t => t.name);
    expect(names).toEqual(['consulter_agent']);
  });

  it('expose publier_flux_activite uniquement avec notify_users_enabled', () => {
    const names = buildAgentTools(capabilitiesFromAgent({ ...NO_CAPS, notify_users_enabled: true })).map(t => t.name);
    expect(names).toEqual(['publier_flux_activite']);
  });
});

describe('executeAgentAction — consulter_agent', () => {
  const caps = capabilitiesFromAgent({ ...NO_CAPS, delegate_enabled: true });

  it("refuse l'appel quand la capacité n'est pas activée, sans toucher le réseau", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', capabilitiesFromAgent(NO_CAPS), {
      name: 'consulter_agent', args: { agent_id: 'agent-marc', message: 'Question' },
    });
    expect(result.response.error).toMatch(/pas activée/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consulte le collègue et rapporte sa réponse, avec `consulted` pour ouvrir sa conversation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).endsWith('/api/agents')) {
        return { ok: true, json: async () => [{ id: 'agent-marc', name: 'Marc', is_active: true }] } as any;
      }
      expect(String(url)).toContain('/api/agents/agent-marc/chat');
      expect(init.headers['X-Agent-Delegation']).toBe('1');
      expect(JSON.parse(init.body)).toEqual({ message: 'Quel est le prix du m² de chape fluide ?' });
      return { ok: true, json: async () => ({ reply: '42 € HT le m².' }) } as any;
    }));

    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'consulter_agent', args: { agent_id: 'agent-marc', message: 'Quel est le prix du m² de chape fluide ?' },
    });

    expect(result.response).toMatchObject({ agent_id: 'agent-marc', agent_name: 'Marc', reponse: '42 € HT le m².' });
    expect(result.consulted).toEqual({ id: 'agent-marc', name: 'Marc' });
    expect(result.summary).toContain('Marc');
  });

  it('refuse un collègue inexistant sans jamais appeler sa conversation', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] } as any));
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'consulter_agent', args: { agent_id: 'agent-inconnu', message: 'Question' },
    });
    expect(result.response.error).toMatch(/Aucun collègue actif/);
    expect(result.consulted).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1); // seulement le GET de la liste
  });

  it('refuse un collègue désactivé', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ id: 'agent-marc', name: 'Marc', is_active: false }] } as any)));
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'consulter_agent', args: { agent_id: 'agent-marc', message: 'Question' },
    });
    expect(result.response.error).toMatch(/Aucun collègue actif/);
  });

  it("rapporte l'échec du collègue sans poser `consulted` — rien n'a été enregistré chez lui", async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/agents')) return { ok: true, json: async () => [{ id: 'agent-marc', name: 'Marc', is_active: true }] } as any;
      return { ok: false, status: 402, json: async () => ({ error: 'Crédit IA épuisé.' }) } as any;
    }));
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'consulter_agent', args: { agent_id: 'agent-marc', message: 'Question' },
    });
    expect(result.response.error).toContain('Marc');
    expect(result.response.error).toContain('Crédit IA épuisé');
    expect(result.consulted).toBeUndefined();
  });

  it("rend la main proprement si le collègue ne répond pas à temps", async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).endsWith('/api/agents')) return { ok: true, json: async () => [{ id: 'agent-marc', name: 'Marc', is_active: true }] } as any;
      const err: any = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }));
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'consulter_agent', args: { agent_id: 'agent-marc', message: 'Question' },
    });
    expect(result.response.error).toMatch(/Marc n'a pas répondu à temps/);
    expect(result.consulted).toBeUndefined();
  });

  it('exige agent_id et message', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, { name: 'consulter_agent', args: { message: 'Question' } })).response.error).toMatch(/agent_id/);
    expect((await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, { name: 'consulter_agent', args: { agent_id: 'agent-marc' } })).response.error).toMatch(/message/);
  });
});

describe('executeAgentAction — publier_flux_activite', () => {
  const caps = capabilitiesFromAgent({ ...NO_CAPS, notify_users_enabled: true });
  const self = { id: 'agent-sophie', name: 'Sophie' };

  it("refuse l'appel quand la capacité n'est pas activée, sans toucher le réseau", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', capabilitiesFromAgent(NO_CAPS), {
      name: 'publier_flux_activite', args: { message: 'Bonjour' },
    }, self);
    expect(result.response.error).toMatch(/pas activée/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("poste sous l'identité de l'agent appelant (as_agent_id), jamais celle de l'utilisateur", async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      expect(String(url)).toContain('/api/feed/posts');
      expect(JSON.parse(init.body)).toEqual({ content: 'Le devis est prêt @Khaldoun Sektaoui', as_agent_id: 'agent-sophie' });
      return { ok: true, json: async () => ({ id: 'post-1' }) } as any;
    }));

    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'publier_flux_activite', args: { message: 'Le devis est prêt @Khaldoun Sektaoui' },
    }, self);

    expect(result.response).toEqual({ post_id: 'post-1', published: true });
    expect(result.consulted).toBeUndefined();
  });

  it('exige un identifiant agent appelant, faute de quoi l\'attribution serait impossible', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'publier_flux_activite', args: { message: 'Bonjour' },
    } /* pas de selfAgent */);
    expect(result.response.error).toMatch(/Identité agent manquante/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exige un message', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'publier_flux_activite', args: {},
    }, self);
    expect(result.response.error).toMatch(/message/);
  });

  it('refuse un message trop long avant tout appel réseau', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'publier_flux_activite', args: { message: 'a'.repeat(3000) },
    }, self);
    expect(result.response.error).toMatch(/trop long/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('remonte le refus du serveur (agent invalide, etc.) tel quel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Agent introuvable ou inactif pour ce cabinet.' }) } as any)));
    const result = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, {
      name: 'publier_flux_activite', args: { message: 'Bonjour' },
    }, self);
    expect(result.response.error).toBe('Agent introuvable ou inactif pour ce cabinet.');
  });
});
