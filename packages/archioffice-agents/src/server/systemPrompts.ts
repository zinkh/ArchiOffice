import type { AgentRow, AgentContext } from '../types.js';

export function buildAgentSystemPrompt(agent: AgentRow, ctx: AgentContext): string {
  if (agent.system_prompt_override) {
    return agent.system_prompt_override
      .replace('{{tenantName}}', ctx.tenantName)
      .replace('{{currentDate}}', ctx.currentDate)
      .replace('{{currentUserName}}', ctx.currentUserName);
  }

  const projectsList = ctx.projects.length > 0
    ? ctx.projects.map(p => `- [${p.id.slice(0, 8)}] ${p.name} — Client : ${p.client || '—'} — Statut : ${p.status}`).join('\n')
    : 'Aucun projet en cours.';

  const meetingsList = ctx.upcomingMeetings.length > 0
    ? ctx.upcomingMeetings.map(m => `- ${m.title} le ${new Date(m.date).toLocaleDateString('fr-FR')}`).join('\n')
    : 'Aucune réunion planifiée.';

  const contactsList = ctx.contacts.slice(0, 30).length > 0
    ? ctx.contacts.slice(0, 30).map(c => `- ${c.first_name} ${c.last_name}${c.company_name ? ' (' + c.company_name + ')' : ''} — ${c.email || ''}`).join('\n')
    : 'Aucun contact.';

  const documentsList = ctx.recentDocuments.length > 0
    ? ctx.recentDocuments.map(d => `- ${d.name} [Phase : ${d.phase || '—'}] ajouté le ${new Date(d.uploaded_at).toLocaleDateString('fr-FR')}`).join('\n')
    : 'Aucun document récent.';

  const tasksList = ctx.tasks.length > 0
    ? ctx.tasks.map(t => `- ${t.title} — Statut : ${t.status} — Échéance : ${t.due_date ? new Date(t.due_date).toLocaleDateString('fr-FR') : '—'}`).join('\n')
    : 'Aucune tâche.';

  return `Tu es ${agent.name}, ${agent.role_title} du cabinet d'architecture "${ctx.tenantName}".
Date du jour : ${ctx.currentDate}.
Tu réponds à : ${ctx.currentUserName}.

═══ PERSONNALITÉ ET TON ═══
${agent.tone || 'Professionnel et courtois.'}

═══ DIRECTIVES IMPÉRATIVES ═══
${agent.directives || 'Être précis et factuel. Ne jamais inventer de données.'}

═══ CAPACITÉS ═══
✓ Consulter et résumer les données du cabinet (réunions, contacts, projets, documents, tâches)
✓ Répondre aux questions métier de ton domaine d'expertise
✗ Tu NE peux PAS créer, modifier ou supprimer des données
✗ Tu NE peux PAS révéler de montants confidentiels
✗ Tu NE peux PAS prendre de décision à la place de l'architecte

═══ DONNÉES TEMPS RÉEL DU CABINET ═══

[PROJETS EN COURS — ${ctx.projects.length} projet(s)]
${projectsList}

[RÉUNIONS À VENIR]
${meetingsList}

[CONTACTS — ${ctx.contacts.length} fiche(s)]
${contactsList}

[DOCUMENTS RÉCENTS]
${documentsList}

[TÂCHES]
${tasksList}

═══ RÈGLES DE RÉPONSE ═══
1. Si une information est absente de tes données, dis-le clairement et propose une action concrète.
2. Réponds en français. Si l'utilisateur écrit en anglais, réponds en anglais.
3. Sois concis : max 3 paragraphes sauf demande explicite de détail.
4. N'invente jamais de données (noms, dates, montants, références).`;
}
