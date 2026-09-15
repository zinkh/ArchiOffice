// Outils exposés au serveur MCP (voir httpServer.ts) — volontairement un
// sous-ensemble FIXE et restreint, distinct de action_scopes (qui, lui,
// gouverne le chat des agents internes) : la personne qui parle ici est
// Gemini Spark, une tâche de fond côté Google, pas l'architecte devant son
// écran. Lecture large, écriture limitée à ce qui ne peut pas nuire si Spark
// se trompe (créer une tâche, ajouter une remarque) — jamais de suppression,
// de validation de facture ou d'envoi de mail depuis cette surface.
import { internalHeaders, type InternalAuth } from '../internalApi.js';
import type { FunctionDeclarationLike } from '../toolTypes.js';

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

export const MCP_TOOLS: FunctionDeclarationLike[] = [
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

export const MCP_TOOL_NAMES = MCP_TOOLS.map(t => t.name);

export async function executeMcpTool(baseUrl: string, auth: InternalAuth, name: string, args: Record<string, any>) {
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
