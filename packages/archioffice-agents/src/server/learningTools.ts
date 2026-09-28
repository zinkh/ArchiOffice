// ── Apprentissage d'un agent : proposer, jamais appliquer ───────────────────
// Un agent qui se voit corrigé, ou qui bute sur une capacité qu'il n'a pas,
// n'a aujourd'hui aucun moyen de le retenir au-delà de cette conversation :
// au tour suivant, ou dans une autre conversation, il repart de zéro. Cet
// outil dépose une PROPOSITION (agent_learning_suggestions, statut 'pending')
// que l'architecte revoit depuis /agents/learning — rien ne s'applique tout
// seul, même principe que needs_confirmation sur create_record : mémoriser
// une correction, signaler une capacité manquante ou rédiger une note pour
// sa propre bibliothèque change durablement le comportement de l'agent, ça
// se confirme, ça ne se déduit jamais.
import type { FunctionDeclarationLike, ToolOutcome } from './toolTypes.js';
import { internalHeaders, type InternalAuth } from './internalApi.js';

export const LEARNING_TOOL_NAMES = ['suggerer_amelioration'];

const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 4000;

const SUGGESTED_CAPABILITIES = [
  'web_fetch_enabled', 'mail_enabled', 'mail_send_enabled', 'mail_attachments_enabled',
  'geo_enabled', 'docs_read_enabled', 'docs_write_enabled', 'delegate_enabled',
  'notify_users_enabled', 'web_search_enabled', 'knowledge_enabled',
];

export function buildLearningTools(): FunctionDeclarationLike[] {
  return [
    {
      name: 'suggerer_amelioration',
      description:
        "Dépose une proposition d'amélioration à soumettre à l'architecte — jamais appliquée automatiquement, toujours en attente de validation dans /agents/learning. " +
        "Trois usages : " +
        "'correction' — l'utilisateur vient de corriger une réponse ou une hypothèse que tu avais faite ; propose de la retenir pour ne pas la refaire. " +
        "'missing_capability' — tu n'as pas pu répondre correctement faute d'un outil ou d'un accès que tu n'as pas (renseigne alors capacite_suggeree). " +
        "'knowledge_note' — tu as appris quelque chose d'utile en tâche (une règle, une préférence du cabinet) et proposes de le garder en mémoire. " +
        "N'utilise cet outil que pour une correction ou un apprentissage réel, jamais pour une information déjà connue ou déjà dans ta bibliothèque de connaissances.",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['correction', 'missing_capability', 'knowledge_note'], description: 'Type de proposition.' },
          titre: { type: 'string', description: 'Titre court résumant la proposition.' },
          contenu: { type: 'string', description: 'Le contenu détaillé : la correction à retenir, la note à mémoriser, ou ce qui a manqué et pourquoi.' },
          capacite_suggeree: { type: 'string', enum: SUGGESTED_CAPABILITIES, description: "Uniquement pour 'missing_capability' : la capacité qui aurait permis de répondre." },
        },
        required: ['kind', 'titre', 'contenu'],
      },
    },
  ];
}

export async function executeLearningTool(
  baseUrl: string,
  auth: InternalAuth,
  name: string,
  args: Record<string, unknown>,
  selfAgentId: string,
): Promise<ToolOutcome> {
  if (name !== 'suggerer_amelioration') return { response: { error: `Outil d'apprentissage inconnu : ${name}` } };

  const kind = String(args.kind || '');
  if (!['correction', 'missing_capability', 'knowledge_note'].includes(kind)) {
    return { response: { error: "kind doit être 'correction', 'missing_capability' ou 'knowledge_note'." } };
  }
  const title = String(args.titre || '').trim().slice(0, MAX_TITLE_CHARS);
  const content = String(args.contenu || '').trim().slice(0, MAX_CONTENT_CHARS);
  if (!title || !content) return { response: { error: 'titre et contenu sont requis.' } };
  const suggestedCapability = kind === 'missing_capability' ? String(args.capacite_suggeree || '').trim() || null : null;

  try {
    const res = await fetch(baseUrl + '/api/agent-learning-suggestions', {
      method: 'POST',
      headers: internalHeaders(auth, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ as_agent_id: selfAgentId, kind, title, content, suggested_capability: suggestedCapability }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { response: { error: data?.error || 'Le dépôt de la proposition a échoué.' } };
    return {
      response: { success: true, id: data.id, status: 'pending' },
      summary: "Proposition d'amélioration déposée pour validation par l'architecte",
    };
  } catch (e: any) {
    return { response: { error: e?.message || 'Le dépôt de la proposition a échoué.' } };
  }
}
