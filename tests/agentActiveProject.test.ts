// L'affaire ouverte à l'écran est donnée à l'agent comme cible par défaut de
// ses demandes, y compris quand l'architecte a entièrement réécrit son prompt.
import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from '../packages/archioffice-agents/src/server/systemPrompts';
import type { AgentContext, AgentRow } from '../packages/archioffice-agents/src/types';

const agent = (overrides: Partial<AgentRow> = {}): AgentRow => ({
  id: 'agent-sophie', tenant_id: 'tenant-1', slug: 'sophie', name: 'Sophie',
  role_title: 'Secrétaire Administrative', avatar_initials: 'SA', avatar_color: '#000',
  context_scopes: [], action_scopes: [],
  web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false, mail_attachments_enabled: false,
  geo_enabled: false, docs_read_enabled: false, docs_write_enabled: false, delegate_enabled: false, notify_users_enabled: false,
  web_search_enabled: false, knowledge_enabled: false, learning_enabled: false,
  is_active: true, is_system_template: false,
  ...overrides,
});

const context = (overrides: Partial<AgentContext> = {}): AgentContext => ({
  tenantName: 'AAZS', currentDate: '5 octobre 2026', currentUserName: 'Khaldoun',
  projects: [], contacts: [], upcomingMeetings: [], recentDocuments: [], tasks: [],
  documentContents: [], documentImages: [], colleagues: [], teamMembers: [],
  firmKnowledge: { phaseBenchmarks: [], priceCatalog: [], projectCostHistory: [], cctpExcerpts: [] },
  knowledgeDocuments: [], learningNotes: [],
  ...overrides,
});

describe('buildAgentSystemPrompt : affaire ouverte à l\'écran', () => {
  const activeProject = { id: 'p-26002', name: 'IUT DE METZ', code: '26002', address: 'Metz' };

  it('désigne l\'affaire ouverte comme cible par défaut, avec son id', () => {
    const prompt = buildAgentSystemPrompt(agent(), context({ activeProject }));
    expect(prompt).toContain('AFFAIRE OUVERTE À L\'ÉCRAN');
    expect(prompt).toContain('26002 IUT DE METZ');
    expect(prompt).toContain('[id: p-26002]');
  });

  it('reste présente quand le prompt est entièrement réécrit', () => {
    const prompt = buildAgentSystemPrompt(agent({ system_prompt_override: 'Tu es un agent sur mesure.' } as Partial<AgentRow>), context({ activeProject }));
    expect(prompt).toContain('Tu es un agent sur mesure.');
    expect(prompt).toContain('[id: p-26002]');
  });

  it('n\'ajoute rien hors d\'une fiche affaire', () => {
    expect(buildAgentSystemPrompt(agent(), context())).not.toContain('AFFAIRE OUVERTE');
  });
});
