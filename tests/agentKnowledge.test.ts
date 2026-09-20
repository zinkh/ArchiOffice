// Bibliothèque de connaissances d'un agent (knowledge_enabled) : des
// documents (réglementation, DTU, notices) déposés une fois pour toutes sur
// la fiche d'UN agent (documents.resource_type = 'agents', resource_id =
// l'agent), relus intégralement à chaque tour de conversation avec lui —
// voir CLAUDE.md, "Bibliothèque de connaissances des agents".
import { describe, expect, it } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { buildAgentContext } from '../packages/archioffice-agents/src/server/context';
import { buildAgentSystemPrompt } from '../packages/archioffice-agents/src/server/systemPrompts';
import { capabilitiesFromAgent } from '../packages/archioffice-agents/src/types';
import type { AgentContext, AgentRow } from '../packages/archioffice-agents/src/types';

function baseAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1', tenant_id: 'tenant-1', slug: 'reglementaire', name: 'Réglo',
    role_title: 'Assistant réglementaire', avatar_initials: 'RG', avatar_color: '#000',
    context_scopes: [], action_scopes: [],
    web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false, mail_attachments_enabled: false,
    geo_enabled: false, docs_read_enabled: false, docs_write_enabled: false,
    delegate_enabled: false, notify_users_enabled: false, web_search_enabled: false,
    knowledge_enabled: false,
    is_active: true, is_system_template: false,
    ...overrides,
  };
}

function baseContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    tenantName: 'AAZS', currentDate: '17 septembre 2026', currentUserName: 'Khaldoun',
    projects: [], contacts: [], upcomingMeetings: [], recentDocuments: [], tasks: [],
    documentContents: [], documentImages: [], colleagues: [], teamMembers: [],
    firmKnowledge: { phaseBenchmarks: [], priceCatalog: [], projectCostHistory: [], cctpExcerpts: [] },
    knowledgeDocuments: [],
    ...overrides,
  };
}

describe('capabilitiesFromAgent — knowledge', () => {
  it('lit knowledge_enabled indépendamment des autres capacités', () => {
    expect(capabilitiesFromAgent({ knowledge_enabled: true }).knowledge).toBe(true);
    expect(capabilitiesFromAgent({ knowledge_enabled: false }).knowledge).toBe(false);
    expect(capabilitiesFromAgent({}).knowledge).toBe(false);
  });
});

describe('buildAgentSystemPrompt — bibliothèque de connaissances', () => {
  it("n'affiche rien quand ctx.knowledgeDocuments est vide", () => {
    const prompt = buildAgentSystemPrompt(baseAgent({ knowledge_enabled: true }), baseContext(), false);
    expect(prompt).not.toContain('BIBLIOTHÈQUE DE CONNAISSANCES');
  });

  it('injecte le contenu des documents et le signale dans la liste des capacités', () => {
    const ctx = baseContext({ knowledgeDocuments: [{ title: 'DTU 20.1 — Maçonnerie', excerpt: 'Les murs de façade en maçonnerie...' }] });
    const prompt = buildAgentSystemPrompt(baseAgent({ knowledge_enabled: true }), ctx, false);
    expect(prompt).toContain('BIBLIOTHÈQUE DE CONNAISSANCES');
    expect(prompt).toContain('DTU 20.1 — Maçonnerie');
    expect(prompt).toContain('Les murs de façade en maçonnerie...');
    expect(prompt).toContain('T\'appuyer sur ta bibliothèque de connaissances (1 document(s)');
  });

  it('reste injecté même quand system_prompt_override remplace le prompt généré', () => {
    const ctx = baseContext({ knowledgeDocuments: [{ title: 'PLU — Zone UA', excerpt: 'Hauteur maximale : 12 mètres.' }] });
    const prompt = buildAgentSystemPrompt(
      baseAgent({ knowledge_enabled: true, system_prompt_override: 'Tu es un agent personnalisé.' }),
      ctx, false,
    );
    expect(prompt).toContain('Tu es un agent personnalisé.');
    expect(prompt).toContain('Hauteur maximale : 12 mètres.');
  });
});

describe('buildAgentContext — bibliothèque de connaissances', () => {
  function seedTenantAndUser(db: FakeSupabaseAdmin, tenantId: string) {
    db.seed('tenants', [{ id: tenantId, name: 'AAZS' }]);
    db.seed('profiles', [{ id: 'user-1', name: 'Khaldoun' }]);
  }

  it("ne consulte pas la bibliothèque quand la capacité n'est pas activée, même si des documents existent", async () => {
    const db = new FakeSupabaseAdmin();
    seedTenantAndUser(db, 'tenant-1');
    db.seed('documents', [{ id: 'doc-1', tenant_id: 'tenant-1', resource_type: 'agents', resource_id: 'agent-1', name: 'reglement.txt', file_url: 'https://fake.supabase.test/storage/v1/object/public/documents/reglement.txt' }]);

    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-1', [], [], false, /* knowledgeEnabled */ false);
    expect(ctx.knowledgeDocuments).toEqual([]);
  });

  it("ne lit que les documents de CET agent, jamais ceux d'un collègue", async () => {
    const db = new FakeSupabaseAdmin();
    seedTenantAndUser(db, 'tenant-1');
    db.seed('documents', [
      { id: 'doc-other', tenant_id: 'tenant-1', resource_type: 'agents', resource_id: 'agent-2', name: 'notice-autre-agent.txt', file_url: 'https://fake.supabase.test/storage/v1/object/public/documents/notice-autre-agent.txt' },
    ]);
    await db.storage.from('documents').upload('notice-autre-agent.txt', Buffer.from('contenu'));

    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-1', [], [], false, true);
    expect(ctx.knowledgeDocuments).toEqual([]);
  });

  it('extrait le contenu texte du document et le pose dans ctx.knowledgeDocuments', async () => {
    const db = new FakeSupabaseAdmin();
    seedTenantAndUser(db, 'tenant-1');
    const path = 'tenant-1/agents/agent-1/reglement.txt';
    db.seed('documents', [{ id: 'doc-1', tenant_id: 'tenant-1', resource_type: 'agents', resource_id: 'agent-1', name: 'reglement.txt', file_url: `https://fake.supabase.test/storage/v1/object/public/documents/${path}` }]);
    await db.storage.from('documents').upload(path, Buffer.from('contenu'));
    // FakeSupabaseAdmin's download() always returns fixed bytes without a
    // content-type — text extraction needs one to route to the plain-text
    // branch (see extractKnowledgeDocText, context.ts), so it's added here
    // locally rather than in the shared fake, which every other test relies
    // on staying untyped.
    const originalFrom = db.storage.from.bind(db.storage);
    (db.storage as any).from = (bucket: string) => {
      const orig = originalFrom(bucket);
      return { ...orig, download: async (p: string) => {
        const res = await orig.download(p);
        return res.data ? { data: { ...res.data, type: 'text/plain' }, error: null } : res;
      } };
    };

    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-1', [], [], false, true);
    expect(ctx.knowledgeDocuments).toHaveLength(1);
    expect(ctx.knowledgeDocuments[0].title).toBe('reglement.txt');
    expect(ctx.knowledgeDocuments[0].excerpt).toContain('fake-file-content');
  });
});
