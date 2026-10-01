// Apprentissage des agents (suggerer_amelioration, agent_learning_suggestions)
// — voir CLAUDE.md, "Apprentissage des agents : proposer, jamais appliquer".
// Deux garanties couvertes ici : l'outil ne s'expose et ne s'exécute que si
// learning_enabled est vrai, et seule une proposition APPROUVÉE de nature
// correction/knowledge_note devient de la mémoire injectée au prompt —
// jamais une proposition 'pending', 'rejected', ni 'missing_capability'.
import { describe, expect, it } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { buildAgentTools, executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import { buildAgentContext } from '../packages/archioffice-agents/src/server/context';
import { capabilitiesFromAgent } from '../packages/archioffice-agents/src/types';

const NO_CAPS = {
  action_scopes: [], web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false,
  geo_enabled: false, docs_read_enabled: false,
};

describe('suggerer_amelioration — exposition selon learning_enabled', () => {
  it("n'expose pas l'outil sans learning_enabled", () => {
    const caps = capabilitiesFromAgent(NO_CAPS);
    expect(buildAgentTools(caps).map(t => t.name)).not.toContain('suggerer_amelioration');
  });

  it('expose l\'outil quand learning_enabled est vrai', () => {
    const caps = capabilitiesFromAgent({ ...NO_CAPS, learning_enabled: true });
    expect(buildAgentTools(caps).map(t => t.name)).toContain('suggerer_amelioration');
  });

  it('refuse l\'appel si la capacité est éteinte, même tenté par le modèle', async () => {
    const caps = capabilitiesFromAgent(NO_CAPS);
    const result = await executeAgentAction(
      'http://127.0.0.1:1', { authorization: 'Bearer x' }, caps,
      { name: 'suggerer_amelioration', args: { kind: 'correction', titre: 'x', contenu: 'y' } },
      { id: 'agent-1', name: 'Sophie' }
    );
    expect(String(result.response.error)).toMatch(/amélioration/i);
  });
});

function seedTenantAndUser(db: FakeSupabaseAdmin, tenantId: string) {
  db.seed('tenants', [{ id: tenantId, name: 'AAZS' }]);
  db.seed('profiles', [{ id: 'user-1', name: 'Khaldoun' }]);
}

describe('buildAgentContext — mémoire d\'apprentissage', () => {
  it('n\'injecte que les propositions APPROUVÉES de nature correction/knowledge_note', async () => {
    const db = new FakeSupabaseAdmin();
    seedTenantAndUser(db, 'tenant-1');
    db.seed('agents', []);
    db.seed('agent_learning_suggestions', [
      { id: 's1', tenant_id: 'tenant-1', agent_id: 'agent-1', kind: 'correction', title: 'Titre corrigé', content: 'Contenu approuvé', status: 'approved', created_at: '2026-09-01T00:00:00Z' },
      { id: 's2', tenant_id: 'tenant-1', agent_id: 'agent-1', kind: 'knowledge_note', title: 'Encore en attente', content: 'Ne doit pas apparaître', status: 'pending', created_at: '2026-09-02T00:00:00Z' },
      { id: 's3', tenant_id: 'tenant-1', agent_id: 'agent-1', kind: 'correction', title: 'Rejetée', content: 'Ne doit pas apparaître', status: 'rejected', created_at: '2026-09-03T00:00:00Z' },
      { id: 's4', tenant_id: 'tenant-1', agent_id: 'agent-1', kind: 'missing_capability', title: 'Capacité manquante', content: 'Ne doit jamais devenir mémoire', status: 'approved', created_at: '2026-09-04T00:00:00Z' },
      { id: 's5', tenant_id: 'tenant-1', agent_id: 'agent-2', kind: 'correction', title: 'Un autre agent', content: "Ne doit pas apparaître pour agent-1", status: 'approved', created_at: '2026-09-05T00:00:00Z' },
    ]);

    const ctx = await buildAgentContext(db as any, 'tenant-1', 'user-1', 'agent-1', [], [], false, false, true);
    expect(ctx.learningNotes).toEqual([{ kind: 'correction', title: 'Titre corrigé', content: 'Contenu approuvé' }]);
  });

  it('ne peuple rien quand learningEnabled est faux', async () => {
    const db = new FakeSupabaseAdmin();
    seedTenantAndUser(db, 'tenant-1');
    db.seed('agent_learning_suggestions', [
      { id: 's1', tenant_id: 'tenant-1', agent_id: 'agent-1', kind: 'correction', title: 'x', content: 'y', status: 'approved', created_at: '2026-09-01T00:00:00Z' },
    ]);
    const ctx = await buildAgentContext(db as any, 'tenant-1', 'user-1', 'agent-1', [], [], false, false, false);
    expect(ctx.learningNotes).toEqual([]);
  });
});
