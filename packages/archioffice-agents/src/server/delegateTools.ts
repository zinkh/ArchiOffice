// ── Consultation d'un collègue (agent-à-agent) ───────────────────────────────
// Un agent qui reçoit une demande hors de son métier peut consulter le
// collègue compétent (voir AgentContext.colleagues, systemPrompts.ts) et
// recevoir sa réponse dans le même tour, plutôt que de se contenter d'en
// suggérer le nom à l'utilisateur.
//
// La consultation passe par la route de chat de l'application elle-même
// (POST /api/agents/:id/chat), avec le jeton de l'utilisateur qui parle à
// l'agent appelant — même principe que le reste des outils d'agent (tools.ts) :
// une consultation se comporte exactement comme si l'utilisateur avait
// lui-même ouvert la conversation du collègue et lui avait posé la question.
// Le collègue répond donc dans SA PROPRE conversation avec cet utilisateur
// (pas dans une conversation « entre agents » séparée), facturée normalement
// à ses crédits IA.
//
// Un seul niveau de profondeur : l'en-tête X-Agent-Delegation, posé sur cette
// requête interne, dit à la route de chat de ne jamais exposer consulter_agent
// pour ce tour — un collègue consulté ne peut donc pas en consulter un autre.
// Sans ce garde-fou, deux agents qui se renvoient la question boucleraient
// indéfiniment, chaque tour étant facturé.
import type { FunctionDeclarationLike, ToolOutcome } from './toolTypes.js';

export const DELEGATE_TOOL_NAMES = ['consulter_agent'];

// Nettement sous le budget d'abandon du client (130 s, AgentChat.tsx) : mieux
// vaut rendre la main à l'agent appelant avec une erreur claire que de laisser
// la requête entière courir jusqu'à la coupure du client, qui n'aurait alors
// aucun moyen de savoir laquelle des deux consultations a bloqué.
const DELEGATE_TIMEOUT_MS = 90_000;

export function buildDelegateTools(): FunctionDeclarationLike[] {
  return [
    {
      name: 'consulter_agent',
      description:
        "Pose une question à un collègue (un autre agent IA actif du cabinet, voir la liste COLLÈGUES DU CABINET dans tes instructions) et reçois sa réponse immédiatement. " +
        "La question et la réponse sont enregistrées dans la conversation de ce collègue avec l'utilisateur, exactement comme s'il la lui avait posée lui-même.",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: "Identifiant du collègue à consulter, tel qu'indiqué dans COLLÈGUES DU CABINET." },
          message: { type: 'string', description: 'La question à lui poser, formulée entièrement — le collègue ne voit pas la conversation en cours.' },
        },
        required: ['agent_id', 'message'],
      },
    },
  ];
}

interface TenantAgentSummary { id: string; name: string; is_active: boolean }

export async function executeDelegateTool(
  baseUrl: string,
  authHeader: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (name !== 'consulter_agent') return { response: { error: `Outil de délégation inconnu : ${name}` } };

  const agentId = String(args.agent_id || '').trim();
  const message = String(args.message || '').trim();
  if (!agentId) return { response: { error: 'agent_id est requis.' } };
  if (!message) return { response: { error: 'message est requis.' } };

  let target: TenantAgentSummary | undefined;
  try {
    const listRes = await fetch(baseUrl + '/api/agents', { headers: { Authorization: authHeader } });
    const list: TenantAgentSummary[] = listRes.ok ? await listRes.json().catch(() => []) : [];
    target = list.find(a => a.id === agentId);
  } catch {
    return { response: { error: "Impossible de vérifier ce collègue pour l'instant." } };
  }
  if (!target || !target.is_active) {
    return { response: { error: `Aucun collègue actif avec l'identifiant "${agentId}". Vérifie la liste COLLÈGUES DU CABINET.` } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELEGATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(target.id)}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        // Lu par la route de chat pour retirer consulter_agent des outils de
        // ce tour, quelle que soit la capacité du collègue — voir l'en-tête
        // du fichier.
        'X-Agent-Delegation': '1',
      },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { response: { error: `${target.name} n'a pas pu répondre : ${data?.error || `erreur ${res.status}`}` } };
    }
    return {
      response: { agent_id: target.id, agent_name: target.name, reponse: data.reply ?? '' },
      summary: `Collègue consulté : ${target.name}`,
      consulted: { id: target.id, name: target.name },
    };
  } catch (e: any) {
    const timedOut = e?.name === 'AbortError';
    return { response: { error: timedOut ? `${target.name} n'a pas répondu à temps.` : `Consultation de ${target.name} impossible : ${e?.message || 'erreur inconnue'}.` } };
  } finally {
    clearTimeout(timer);
  }
}
