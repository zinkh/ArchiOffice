// ── Message vers un utilisateur réel (flux d'activité) ──────────────────────
// Un agent qui doit prévenir quelqu'un du cabinet — pas seulement répondre
// dans sa propre conversation — poste dans Notifications & Flux d'activité,
// exactement comme un humain le ferait depuis la page d'accueil : même table
// (feed_posts), même mécanique de mention (« @Prénom Nom »,
// server/routes/activityFeed.ts), donc les mêmes notifications système
// (push + badge) que n'importe quel autre post mentionnant quelqu'un.
//
// Aucun nouveau canal : un agent qui « envoie un message à un utilisateur »
// écrit au même endroit que ses collègues humains, sous son propre nom.
import type { FunctionDeclarationLike, ToolOutcome } from './toolTypes.js';

export const NOTIFY_TOOL_NAMES = ['publier_flux_activite'];

const MAX_MESSAGE_CHARS = 2000;

export function buildNotifyTools(): FunctionDeclarationLike[] {
  return [
    {
      name: 'publier_flux_activite',
      description:
        "Poste un message dans Notifications & Flux d'activité, visible par tout le cabinet. " +
        "Pour prévenir une personne précise plutôt que faire un post général, inclus « @Prénom Nom » dans le message, exactement comme dans MEMBRES DE L'ÉQUIPE dans tes instructions — la mention déclenche une notification pour elle. " +
        "N'utilise cet outil que pour une information qui doit atteindre quelqu'un en dehors de cette conversation : pour répondre à l'utilisateur qui te parle, réponds-lui simplement ici, ne poste pas.",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: "Le message à publier. Inclure « @Prénom Nom » pour notifier une personne précise." },
        },
        required: ['message'],
      },
    },
  ];
}

export async function executeNotifyTool(
  baseUrl: string,
  authHeader: string,
  name: string,
  args: Record<string, unknown>,
  selfAgentId: string,
): Promise<ToolOutcome> {
  if (name !== 'publier_flux_activite') return { response: { error: `Outil de notification inconnu : ${name}` } };

  const message = String(args.message || '').trim();
  if (!message) return { response: { error: 'message est requis.' } };
  if (message.length > MAX_MESSAGE_CHARS) {
    return { response: { error: `Message trop long pour le flux d'activité (${MAX_MESSAGE_CHARS} caractères maximum).` } };
  }

  try {
    const res = await fetch(baseUrl + '/api/feed/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ content: message, as_agent_id: selfAgentId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { response: { error: data?.error || 'La publication dans le flux a échoué.' } };
    return {
      response: { post_id: data.id, published: true },
      summary: "Message publié dans le flux d'activité",
    };
  } catch (e: any) {
    return { response: { error: e?.message || 'La publication dans le flux a échoué.' } };
  }
}
