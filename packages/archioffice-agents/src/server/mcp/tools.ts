// Outils exposés au serveur MCP (voir httpServer.ts). Deux familles :
//
//   - Cinq outils de lecture "riches", écrits à la main pour les cas les
//     plus courants (le détail complet d'une affaire, une liste simple sans
//     mot-clé) — rien d'équivalent n'existe dans buildAgentTools, qui ne sait
//     que chercher par mot-clé ou lire un enregistrement après l'avoir trouvé.
//   - Le jeu générique create_record / update_record / search_records —
//     ainsi que mail/géo/CCTP-DPGF — RÉUTILISÉ tel quel depuis tools.ts, le
//     même que le chat des agents internes. C'est ce qui permet d'ouvrir
//     d'un coup toutes les ressources du cabinet (contacts, devis, appels
//     d'offres, réunions, jalons, réserves, contrats MOE...) sans écrire un
//     outil par ressource : AGENT_RESOURCES en est la seule source, une
//     ressource qui y gagne une entrée devient disponible ici sans y toucher.
//
// Restriction volontaire par rapport au chat interne, quel que soit
// AGENT_RESOURCES : jamais delete_record (aucune suppression depuis une
// liaison externe, quel que soit le connecteur), jamais l'envoi réel de mail
// (mailSend: false — create_draft suffit, voir mailTools.ts), jamais
// fetch_url/consulter un collègue/publier au flux d'activité (des capacités
// pensées pour un agent interne du cabinet, pas pour Claude/Gemini).
import { internalHeaders, type InternalAuth } from '../internalApi.js';
import type { FunctionDeclarationLike } from '../toolTypes.js';
import { buildAgentTools, executeAgentAction, describeAuthorizedResources } from '../tools.js';
import { AGENT_RESOURCES, type AgentCapabilities } from '../../types.js';

async function callApi(baseUrl: string, auth: InternalAuth, method: string, path: string, body?: unknown) {
  try {
    const res = await fetch(baseUrl + path, {
      method,
      headers: internalHeaders(auth, body ? { 'Content-Type': 'application/json' } : undefined),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: data?.error || `Échec (${res.status})` }) }], isError: true };
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e?.message || 'Requête impossible.' }) }], isError: true };
  }
}

const RICH_TOOLS: FunctionDeclarationLike[] = [
  {
    name: 'list_projects',
    description: "Liste les affaires (projets) du cabinet : id, nom, code, adresse, statut. Utilise-le pour retrouver l'id d'une affaire nommée avant d'appeler get_project.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_project',
    description: "Détail complet d'une affaire : contrat MOE, jalons, cotraitants, réserves. Nécessite l'id renvoyé par list_projects.",
    parametersJsonSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'] },
  },
  {
    name: 'list_tasks',
    description: "Tâches du cabinet, éventuellement filtrées par affaire. Utile pour un point d'avancement ou une liste de choses à faire.",
    parametersJsonSchema: { type: 'object', properties: { project_id: { type: 'string', description: "Optionnel — id d'affaire pour filtrer" } } },
  },
  {
    name: 'create_task',
    description: "Crée une tâche, éventuellement rattachée à une affaire. N'invente jamais de champ hors de ceux fournis ici.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        project_id: { type: 'string', description: 'Optionnel' },
        due_date: { type: 'string', description: 'Optionnel, format AAAA-MM-JJ' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_invoices',
    description: "Factures du cabinet et leur statut (brouillon, envoyée, payée, en retard). N'inclut pas le détail des lignes.",
    parametersJsonSchema: { type: 'object', properties: { project_id: { type: 'string', description: 'Optionnel — id d\'affaire pour filtrer' } } },
  },
];
const RICH_TOOL_NAMES = RICH_TOOLS.map(t => t.name);

async function executeRichTool(baseUrl: string, auth: InternalAuth, name: string, args: Record<string, any>) {
  switch (name) {
    case 'list_projects':
      return callApi(baseUrl, auth, 'GET', '/api/projects');
    case 'get_project':
      if (!args.project_id) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'project_id est requis.' }) }], isError: true };
      return callApi(baseUrl, auth, 'GET', `/api/projects/${encodeURIComponent(args.project_id)}/full`);
    case 'list_tasks':
      return callApi(baseUrl, auth, 'GET', `/api/tasks${args.project_id ? `?project_id=${encodeURIComponent(args.project_id)}` : ''}`);
    case 'create_task':
      if (!args.title) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'title est requis.' }) }], isError: true };
      return callApi(baseUrl, auth, 'POST', '/api/tasks', {
        title: args.title,
        project_id: args.project_id || null,
        due_date: args.due_date || null,
        start_date: args.due_date || new Date().toISOString().slice(0, 10),
        end_date: args.due_date || new Date().toISOString().slice(0, 10),
      });
    case 'list_invoices':
      return callApi(baseUrl, auth, 'GET', `/api/invoices${args.project_id ? `?project_id=${encodeURIComponent(args.project_id)}` : ''}`);
    default:
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Outil inconnu : ${name}` }) }], isError: true };
  }
}

// Toutes les ressources du cabinet (contacts, devis, appels d'offres,
// réunions, jalons, réserves, contrats MOE, bibliothèque d'ouvrages...),
// jamais la suppression, jamais l'envoi de mail réel (create_draft suffit),
// jamais fetch_url/consulter un collègue/publier au flux d'activité,
// jamais l'écriture du CCTP/DPGF (write_dpgf_article) — même prudence que
// pour la suppression : un outil MCP externe reste en lecture/écriture de
// fiches simples, jamais sur un document arborescent aux totaux dérivés.
const MCP_CAPS: AgentCapabilities = {
  actionScopes: AGENT_RESOURCES.map(r => r.key),
  webFetch: false,
  mailRead: true,
  mailSend: false,
  geo: true,
  docsRead: true,
  docsWrite: false,
  delegate: false,
  notifyUsers: false,
  webSearch: false,
};

function genericTools(): FunctionDeclarationLike[] {
  const schema = describeAuthorizedResources(MCP_CAPS.actionScopes);
  return buildAgentTools(MCP_CAPS)
    .filter(t => t.name !== 'delete_record') // jamais depuis une liaison externe, quel que soit le connecteur
    .map(t => (
      ['create_record', 'update_record', 'search_records'].includes(t.name)
        ? { ...t, description: `${t.description}\n\nSCHÉMA DES RESSOURCES :\n${schema}` }
        : t
    ));
}

export const MCP_TOOLS: FunctionDeclarationLike[] = [...RICH_TOOLS, ...genericTools()];
export const MCP_TOOL_NAMES = MCP_TOOLS.map(t => t.name);

export async function executeMcpTool(baseUrl: string, auth: InternalAuth, name: string, args: Record<string, any>) {
  if (name === 'delete_record') {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Action non autorisée depuis cette liaison.' }) }], isError: true };
  }
  if (RICH_TOOL_NAMES.includes(name)) return executeRichTool(baseUrl, auth, name, args);

  const result = await executeAgentAction(baseUrl, auth, MCP_CAPS, { name, args });
  const isError = typeof (result.response as any)?.error === 'string';
  return { content: [{ type: 'text' as const, text: JSON.stringify(result.response) }], isError };
}
