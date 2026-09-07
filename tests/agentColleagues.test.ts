// Un agent doit savoir rediriger une demande qui n'est pas la sienne vers le
// collègue compétent, au lieu de l'improviser avec le mauvais outil — c'est
// exactement ce qui avait produit 19 CCTP vides le 7 septembre 2026, pour des
// demandes qui visaient en réalité la Bibliothèque d'ouvrages (voir
// agentAutonomy.test.ts). buildAgentContext peuple la liste des collègues du
// cabinet (toujours, sans condition de context_scopes) et
// buildAgentSystemPrompt la traduit en une consigne de délégation.
import { describe, expect, it } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { buildAgentContext } from '../packages/archioffice-agents/src/server/context';
import { buildAgentSystemPrompt } from '../packages/archioffice-agents/src/server/systemPrompts';
import type { AgentContext, AgentRow } from '../packages/archioffice-agents/src/types';

function baseAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-sophie', tenant_id: 'tenant-1', slug: 'sophie', name: 'Sophie',
    role_title: 'Secrétaire Administrative', avatar_initials: 'SA', avatar_color: '#000',
    context_scopes: [], action_scopes: [],
    web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false,
    geo_enabled: false, docs_read_enabled: false, delegate_enabled: false, notify_users_enabled: false,
    is_active: true, is_system_template: false,
    ...overrides,
  };
}

function baseContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    tenantName: 'AAZS', currentDate: '7 septembre 2026', currentUserName: 'Khaldoun',
    projects: [], contacts: [], upcomingMeetings: [], recentDocuments: [], tasks: [],
    documentContents: [], colleagues: [], teamMembers: [],
    firmKnowledge: { phaseBenchmarks: [], priceCatalog: [], projectCostHistory: [], cctpExcerpts: [] },
    ...overrides,
  };
}

describe('buildAgentContext — collègues du cabinet', () => {
  function seedTenantAndUser(db: FakeSupabaseAdmin, tenantId: string) {
    db.seed('tenants', [{ id: tenantId, name: 'AAZS' }]);
    db.seed('profiles', [{ id: 'user-1', name: 'Khaldoun' }]);
  }

  it('liste les autres agents actifs avec ce qu\'ils sont autorisés à écrire', async () => {
    const db = new FakeSupabaseAdmin();
    seedTenantAndUser(db, 'tenant-1');
    db.seed('agents', [
      { id: 'agent-sophie', tenant_id: 'tenant-1', name: 'Sophie', role_title: 'Secrétaire Administrative', action_scopes: ['contacts', 'meetings'], is_active: true },
      { id: 'agent-marc', tenant_id: 'tenant-1', name: 'Marc', role_title: 'Économiste de la Construction', action_scopes: ['articles_type'], is_active: true },
    ]);

    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-sophie', []);

    expect(ctx.colleagues).toEqual([
      { id: 'agent-marc', name: 'Marc', roleTitle: 'Économiste de la Construction', resourceLabels: ["Bibliothèque d'ouvrages"] },
    ]);
  });

  it('exclut l\'agent lui-même de sa propre liste de collègues', async () => {
    const db = new FakeSupabaseAdmin();
    seedTenantAndUser(db, 'tenant-1');
    db.seed('agents', [{ id: 'agent-sophie', tenant_id: 'tenant-1', name: 'Sophie', role_title: 'Secrétaire', action_scopes: [], is_active: true }]);

    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-sophie', []);
    expect(ctx.colleagues).toEqual([]);
  });

  it('exclut les agents désactivés', async () => {
    const db = new FakeSupabaseAdmin();
    seedTenantAndUser(db, 'tenant-1');
    db.seed('agents', [
      { id: 'agent-sophie', tenant_id: 'tenant-1', name: 'Sophie', role_title: 'Secrétaire', action_scopes: [], is_active: true },
      { id: 'agent-retired', tenant_id: 'tenant-1', name: 'Ancien agent', role_title: 'Juridique', action_scopes: [], is_active: false },
    ]);

    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-sophie', []);
    expect(ctx.colleagues).toEqual([]);
  });

  it('est peuplée même sans context_scopes — connaître ses collègues n\'expose aucune donnée métier', async () => {
    const db = new FakeSupabaseAdmin();
    seedTenantAndUser(db, 'tenant-1');
    db.seed('agents', [
      { id: 'agent-sophie', tenant_id: 'tenant-1', name: 'Sophie', role_title: 'Secrétaire', action_scopes: [], is_active: true },
      { id: 'agent-marc', tenant_id: 'tenant-1', name: 'Marc', role_title: 'Économiste de la Construction', action_scopes: [], is_active: true },
    ]);

    // scopes vide : aucune donnée du cabinet (projets, contacts...) ne serait
    // récupérée, mais colleagues n'est pas conditionné par cette liste.
    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-sophie', []);
    expect(ctx.colleagues.map(c => c.name)).toEqual(['Marc']);
  });

  it('peuple teamMembers depuis profiles, même sans context_scopes', async () => {
    const db = new FakeSupabaseAdmin();
    db.seed('tenants', [{ id: 'tenant-1', name: 'AAZS' }]);
    db.seed('profiles', [
      { id: 'user-1', tenant_id: 'tenant-1', name: 'Khaldoun' },
      { id: 'user-2', tenant_id: 'tenant-1', name: 'Marie Curie' },
    ]);
    db.seed('agents', [{ id: 'agent-sophie', tenant_id: 'tenant-1', name: 'Sophie', role_title: 'Secrétaire', action_scopes: [], is_active: true }]);

    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-sophie', []);
    expect(ctx.teamMembers).toEqual(expect.arrayContaining([
      { id: 'user-1', name: 'Khaldoun' },
      { id: 'user-2', name: 'Marie Curie' },
    ]));
  });
});

describe('buildAgentSystemPrompt — délégation vers le bon collègue', () => {
  it('nomme les collègues et ce qu\'ils couvrent', () => {
    const prompt = buildAgentSystemPrompt(baseAgent(), baseContext({
      colleagues: [{ id: 'agent-marc', name: 'Marc', roleTitle: 'Économiste de la Construction', resourceLabels: ["Bibliothèque d'ouvrages", 'Devis'] }],
    }));
    expect(prompt).toContain('COLLÈGUES DU CABINET');
    expect(prompt).toContain("Marc (Économiste de la Construction) — s'occupe de : Bibliothèque d'ouvrages, Devis");
  });

  it('dit explicitement qu\'aucun collègue n\'est configuré plutôt que de laisser la section vide', () => {
    const prompt = buildAgentSystemPrompt(baseAgent(), baseContext({ colleagues: [] }));
    expect(prompt).toContain("Aucun autre agent IA n'est configuré dans ce cabinet");
  });

  it('porte la consigne de délégation : nommer le collègue plutôt qu\'improviser, ou demander à défaut', () => {
    const prompt = buildAgentSystemPrompt(baseAgent(), baseContext());
    expect(prompt).toContain("ne se traite JAMAIS en te rabattant sur l'outil le plus proche");
    expect(prompt).toContain('celui dont le métier ou les ressources correspondent');
    expect(prompt).toContain("Si aucun collègue listé ne correspond, dis-le franchement et demande à l'utilisateur qui");
  });

  it('conserve la délégation même sur un prompt entièrement personnalisé', () => {
    // Comme pour fetch_url et la messagerie : le comportement vient des
    // données (ctx.colleagues), pas du texte du prompt, donc un architecte
    // qui réécrit tout le prompt d'un agent ne doit pas perdre cette règle.
    const prompt = buildAgentSystemPrompt(
      baseAgent({ system_prompt_override: 'Tu es un agent sur mesure.' }),
      baseContext({ colleagues: [{ id: 'agent-marc', name: 'Marc', roleTitle: 'Économiste', resourceLabels: [] }] }),
    );
    expect(prompt).toContain('Tu es un agent sur mesure.');
    expect(prompt).toContain('COLLÈGUES DU CABINET');
    expect(prompt).toContain('Marc (Économiste)');
  });
});

describe('buildAgentSystemPrompt — consultation directe (delegate_enabled)', () => {
  const ctx = baseContext({
    colleagues: [{ id: 'agent-marc', name: 'Marc', roleTitle: 'Économiste', resourceLabels: [] }],
  });

  it("affiche l'id du collègue et demande de consulter directement, plutôt que de simplement l'orienter", () => {
    const prompt = buildAgentSystemPrompt(baseAgent({ delegate_enabled: true }), ctx);
    expect(prompt).toContain('Marc [id: agent-marc]');
    expect(prompt).toContain('consulte-le directement avec consulter_agent(agent_id, message)');
    expect(prompt).toContain('CONSULTATION D\'UN COLLÈGUE (consulter_agent)');
    expect(prompt).toContain('✓ Consulter un collègue');
  });

  it("n'affiche jamais l'id ni la consigne d'outil quand la consultation n'est pas activée", () => {
    const prompt = buildAgentSystemPrompt(baseAgent({ delegate_enabled: false }), ctx);
    expect(prompt).not.toContain('[id: agent-marc]');
    expect(prompt).not.toContain('consulter_agent(');
    expect(prompt).toContain('✗ Tu NE peux PAS consulter un autre agent');
  });

  it('conserve la consigne de consultation directe sur un prompt personnalisé', () => {
    const prompt = buildAgentSystemPrompt(
      baseAgent({ delegate_enabled: true, system_prompt_override: 'Tu es un agent sur mesure.' }),
      ctx,
    );
    expect(prompt).toContain('utilise consulter_agent(agent_id, message)');
  });
});

describe('buildAgentSystemPrompt — flux d\'activité (notify_users_enabled)', () => {
  const ctx = baseContext({ teamMembers: [{ id: 'user-1', name: 'Khaldoun Sektaoui' }] });

  it('liste les membres du cabinet et la consigne de mention quand activé', () => {
    const prompt = buildAgentSystemPrompt(baseAgent({ notify_users_enabled: true }), ctx);
    expect(prompt).toContain("MEMBRES DE L'ÉQUIPE");
    expect(prompt).toContain('Khaldoun Sektaoui');
    expect(prompt).toContain('FLUX D\'ACTIVITÉ DU CABINET (publier_flux_activite)');
    expect(prompt).toContain('✓ Publier dans Notifications & Flux d\'activité');
  });

  it("n'expose ni la liste ni l'outil quand ce n'est pas activé", () => {
    const prompt = buildAgentSystemPrompt(baseAgent({ notify_users_enabled: false }), ctx);
    expect(prompt).not.toContain("MEMBRES DE L'ÉQUIPE");
    expect(prompt).not.toContain('publier_flux_activite(');
    expect(prompt).toContain('✗ Tu NE peux PAS publier dans le flux');
  });

  it('conserve la consigne de mention sur un prompt personnalisé', () => {
    const prompt = buildAgentSystemPrompt(
      baseAgent({ notify_users_enabled: true, system_prompt_override: 'Tu es un agent sur mesure.' }),
      ctx,
    );
    expect(prompt).toContain('Khaldoun Sektaoui');
    expect(prompt).toContain('publier_flux_activite');
  });
});
