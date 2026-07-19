import { AGENT_RESOURCES, type AgentResourceDef } from '../types.js';

// ── Gemini function-calling tools — gated per agent by action_scopes ────────
// Rather than hand-writing bespoke Supabase-write logic per resource (which
// would duplicate — and drift from — the validation, id/reference
// generation, and side effects already implemented in server.ts for every
// human-facing form), these tools are generic (create_record / update_record
// / delete_record) and execute by calling the app's own REST API over an
// internal HTTP loopback, forwarding the caller's own auth token. An agent
// action therefore always behaves exactly like a human submitting the same
// form — same validation, same activity log entries, same everything.

export interface FunctionDeclarationLike {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export function buildAgentTools(actionScopes: string[]): FunctionDeclarationLike[] {
  const authorized = AGENT_RESOURCES.filter(r => actionScopes.includes(r.key));
  if (authorized.length === 0) return [];

  const creatable = authorized.filter(r => r.create).map(r => r.key);
  const updatable = authorized.filter(r => r.update).map(r => r.key);
  const deletable = authorized.filter(r => r.delete).map(r => r.key);

  const tools: FunctionDeclarationLike[] = [];

  if (creatable.length > 0) {
    tools.push({
      name: 'create_record',
      description:
        "Crée un nouvel enregistrement dans une des ressources du cabinet auxquelles tu as accès en écriture. " +
        "Consulte la section SCHÉMA DES RESSOURCES AUTORISÉES du prompt système pour connaître les champs attendus par ressource (les champs suivis d'un * sont obligatoires).",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          resource: { type: 'string', enum: creatable, description: 'Type de ressource à créer' },
          data: { type: 'object', description: "Champs de l'enregistrement, selon le schéma de la ressource" },
        },
        required: ['resource', 'data'],
      },
    });
  }

  if (updatable.length > 0) {
    tools.push({
      name: 'update_record',
      description: "Met à jour un enregistrement existant. Seuls les champs fournis dans data sont modifiés, les autres restent inchangés.",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          resource: { type: 'string', enum: updatable, description: 'Type de ressource à modifier' },
          id: { type: 'string', description: "Identifiant de l'enregistrement à modifier" },
          data: { type: 'object', description: 'Champs à mettre à jour' },
        },
        required: ['resource', 'id', 'data'],
      },
    });
  }

  if (deletable.length > 0) {
    tools.push({
      name: 'delete_record',
      description:
        "Supprime définitivement un enregistrement existant. Action IRRÉVERSIBLE : ne l'utilise que si l'utilisateur a demandé explicitement et sans ambiguïté la suppression de cet enregistrement précis dans le message en cours.",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          resource: { type: 'string', enum: deletable, description: 'Type de ressource à supprimer' },
          id: { type: 'string', description: "Identifiant de l'enregistrement à supprimer" },
        },
        required: ['resource', 'id'],
      },
    });
  }

  return tools;
}

export function describeAuthorizedResources(actionScopes: string[]): string {
  const authorized = AGENT_RESOURCES.filter(r => actionScopes.includes(r.key));
  if (authorized.length === 0) return '';
  return authorized
    .map(r => {
      const ops = [r.create && 'créer', r.update && 'modifier', r.delete && 'supprimer'].filter(Boolean).join(', ');
      return `- ${r.label} (resource: "${r.key}") — actions autorisées : ${ops}. Champs : ${r.fields}`;
    })
    .join('\n');
}

export interface AgentActionCall {
  name?: string;
  args?: Record<string, unknown>;
}

export interface AgentActionResult {
  response: Record<string, unknown>;
  summary?: string;
}

function deriveRecordLabel(data?: Record<string, unknown>): string {
  if (!data) return '';
  const candidates = ['title', 'name', 'os_number', 'entreprise_nom', 'numero', 'reference'];
  for (const key of candidates) {
    if (data[key]) return String(data[key]);
  }
  if (data.first_name || data.last_name) return `${data.first_name || ''} ${data.last_name || ''}`.trim();
  return '';
}

export async function executeAgentAction(
  baseUrl: string,
  authHeader: string | undefined,
  actionScopes: string[],
  call: AgentActionCall
): Promise<AgentActionResult> {
  const name = call.name;
  const args = call.args || {};
  const resourceKey = String(args.resource || '');
  const resource: AgentResourceDef | undefined = AGENT_RESOURCES.find(r => r.key === resourceKey);

  if (!resource || !actionScopes.includes(resourceKey)) {
    return { response: { error: `Ressource "${resourceKey}" non autorisée pour cet agent.` } };
  }
  if (!authHeader) {
    return { response: { error: 'Session non authentifiée — action impossible.' } };
  }

  let method: 'POST' | 'PUT' | 'DELETE';
  let path = resource.basePath;
  let body: Record<string, unknown> | undefined;

  if (name === 'create_record') {
    if (!resource.create) return { response: { error: `Création non supportée pour "${resourceKey}".` } };
    method = 'POST';
    body = (args.data as Record<string, unknown>) || {};
  } else if (name === 'update_record') {
    if (!resource.update) return { response: { error: `Modification non supportée pour "${resourceKey}".` } };
    const id = String(args.id || '');
    if (!id) return { response: { error: 'id est requis pour une modification.' } };
    method = 'PUT';
    path = `${resource.basePath}/${encodeURIComponent(id)}`;
    body = (args.data as Record<string, unknown>) || {};
  } else if (name === 'delete_record') {
    if (!resource.delete) return { response: { error: `Suppression non supportée pour "${resourceKey}".` } };
    const id = String(args.id || '');
    if (!id) return { response: { error: 'id est requis pour une suppression.' } };
    method = 'DELETE';
    path = `${resource.basePath}/${encodeURIComponent(id)}`;
  } else {
    return { response: { error: `Fonction inconnue : ${name}` } };
  }

  try {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: method === 'DELETE' ? undefined : JSON.stringify(body),
    });

    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { response: { error: json?.error || `Échec de l'opération (HTTP ${res.status}).` } };
    }

    const verb = name === 'create_record' ? 'créé' : name === 'update_record' ? 'modifié' : 'supprimé';
    const label = name === 'delete_record' ? String(args.id) : deriveRecordLabel(body) || json?.id || '';
    return {
      response: { success: true, ...json },
      summary: `${resource.label} ${verb}${label ? ` : ${label}` : ''}`,
    };
  } catch (e: any) {
    return { response: { error: e?.message || "Erreur inconnue lors de l'exécution de l'action." } };
  }
}
