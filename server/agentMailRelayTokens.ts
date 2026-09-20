// ── Pont d'authentification interne pour le relevé de messagerie entrante ──
// server/agentMailInbox.ts traite un email transféré avec les VRAIS droits
// de la personne reconnue (create_record, écriture DPGF...) : il rejoue
// POST /api/agents/:id/chat en entier plutôt que de dupliquer la boucle
// d'outils/facturation de routes.ts. Mais ce endpoint exige un
// Authorization Bearer validé comme un JWT Supabase (server.ts), et le
// poller ne parle à personne de vivant.
//
// Même principe que les jetons mcp_at_ (packages/archioffice-agents/src/
// server/mcp/store.ts) et tg_at_ (server/telegramBot.ts), déjà dispatchés
// dans le middleware /api de server.ts : un préfixe reconnaissable résolu
// vers un (userId, tenantId) réel, jamais un JWT. Contrairement à ces deux
// liaisons persistantes (révocables mais valables tant qu'elles ne le sont
// pas), un jeton ici ne vit que le temps d'UN appel — émis par le poller
// juste avant de rappeler l'API interne, à usage unique et de courte durée
// de vie, jamais stocké en clair (même hachage que telegramBot.ts, repris
// plutôt que dupliqué).
import crypto from 'crypto';
import { hashToken } from './telegramBot';

const TOKEN_TTL_MS = 5 * 60 * 1000;

function randomToken(): string {
  return `mail_at_${crypto.randomBytes(32).toString('base64url')}`;
}

export async function issueMailRelayToken(
  supabaseAdmin: any,
  tenantId: string,
  userId: string,
): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const { error } = await supabaseAdmin.from('agent_mail_relay_tokens').insert({
    token_hash: hashToken(token),
    tenant_id: tenantId,
    user_id: userId,
    expires_at: expiresAt,
  });
  if (error) throw error;
  return token;
}

export interface ResolvedMailRelayToken {
  tenantId: string;
  userId: string;
}

/** Comme resolveAccessToken côté Telegram/MCP : jamais d'exception sur un
 *  jeton absent/expiré/déjà consommé — un cas attendu, pas une panne. Le
 *  marquage `used_at` rend le jeton inutilisable dès cette résolution :
 *  même s'il fuitait (log, réseau), il ne rejoue rien une seconde fois. */
export async function resolveMailRelayToken(supabaseAdmin: any, token: string): Promise<ResolvedMailRelayToken | null> {
  if (!token || !token.startsWith('mail_at_')) return null;
  const { data: row } = await supabaseAdmin
    .from('agent_mail_relay_tokens')
    .select('*')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  await supabaseAdmin.from('agent_mail_relay_tokens').update({ used_at: new Date().toISOString() }).eq('token_hash', row.token_hash);
  return { tenantId: row.tenant_id, userId: row.user_id };
}
