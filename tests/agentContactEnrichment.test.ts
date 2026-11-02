// Un contact « entreprise » ajouté par l'utilisateur : l'agent (Sophie) cherche ses
// coordonnées publiques sur le web et PROPOSE de compléter la fiche, spécialités
// comprises (corps d'état, discipline). La règle suit les capacités réelles de
// l'agent, pas le texte de son prompt.
import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt, contactEnrichmentSection } from '../packages/archioffice-agents/src/server/systemPrompts';
import { prepareRecord } from '../packages/archioffice-agents/src/server/tools';
import { AGENT_RESOURCES } from '../packages/archioffice-agents/src/types';
import type { AgentContext, AgentRow } from '../packages/archioffice-agents/src/types';

function agent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-sophie', tenant_id: 'tenant-1', slug: 'secretaire', name: 'Sophie',
    role_title: 'Secrétaire Administrative', avatar_initials: 'SA', avatar_color: '#000',
    context_scopes: [], action_scopes: ['contacts'],
    web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false, mail_attachments_enabled: false,
    geo_enabled: false, docs_read_enabled: false, docs_write_enabled: false, delegate_enabled: false, notify_users_enabled: false,
    web_search_enabled: true, knowledge_enabled: false, learning_enabled: false,
    is_active: true, is_system_template: false,
    ...overrides,
  };
}

const ctx: AgentContext = {
  tenantName: 'AAZS', currentDate: '2 novembre 2026', currentUserName: 'Khaldoun',
  projects: [], contacts: [], upcomingMeetings: [], recentDocuments: [], tasks: [],
  documentContents: [], documentImages: [], colleagues: [], teamMembers: [],
  firmKnowledge: { phaseBenchmarks: [], priceCatalog: [], projectCostHistory: [], cctpExcerpts: [] },
  knowledgeDocuments: [], learningNotes: [],
};

describe('fiche d\'un nouveau contact entreprise', () => {
  it('demande de chercher sur le web, de proposer puis d\'ajouter les spécialités', () => {
    const prompt = buildAgentSystemPrompt(agent(), ctx, true);
    expect(prompt).toContain('FICHE D\'UN NOUVEAU CONTACT ENTREPRISE');
    expect(prompt).toContain('PROPOSE, n\'écris pas');
    expect(prompt).toContain('corps_etat');
    expect(prompt).toContain('Couverture');
    expect(prompt).toContain('Bardage');
  });

  it('reste présente quand l\'architecte a réécrit tout le prompt', () => {
    const prompt = buildAgentSystemPrompt(agent({ system_prompt_override: 'Tu es Sophie.' }), ctx, true);
    expect(prompt).toContain('FICHE D\'UN NOUVEAU CONTACT ENTREPRISE');
  });

  it('est absente sans écriture sur les contacts ou sans recherche web', () => {
    expect(contactEnrichmentSection(agent({ action_scopes: ['tasks'] }), true)).toBe('');
    expect(contactEnrichmentSection(agent(), false)).toBe('');
    expect(buildAgentSystemPrompt(agent(), ctx, false)).not.toContain('NOUVEAU CONTACT ENTREPRISE');
  });
});

describe('contacts : site, SIRET et spécialités', () => {
  const contacts = AGENT_RESOURCES.find(r => r.key === 'contacts')!;

  it('accepte corps_etat, specialite, siret et website sans les écarter', () => {
    const prepared = prepareRecord(contacts, {
      company_name: 'Couverture Dupont', corps_etat: ['Couverture', 'Bardage'], specialite: ['Structure'],
      siret: '12345678901234', website: 'https://exemple.fr',
    });
    expect(prepared.ignoredFields).toEqual([]);
    expect(prepared.data.corps_etat).toEqual(['Couverture', 'Bardage']);
  });
});
