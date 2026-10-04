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
const CLAIM_ATTEMPTS = 5;

function randomToken(): string {
  return `mail_at_${crypto.randomBytes(32).toString('base64url')}`;
}

/** Plafond d'usages d'un jeton multi-usage : une revue lit quelques boîtes et
 *  quelques dizaines de messages, jamais davantage. */
const MAX_TOKEN_USES = 100;

/**
 * Par défaut le jeton ne sert qu'UNE fois. `maxUses` > 1 sert un traitement qui
 * rappelle plusieurs fois l'API interne (la revue matinale lit les boîtes puis
 * chaque message) : la durée de vie reste de quelques minutes et le jeton
 * s'éteint dès son dernier usage. Les colonnes `max_uses`/`use_count` ne sont
 * écrites que dans ce cas, pour que le cas ordinaire n'en dépende pas.
 */
export async function issueMailRelayToken(
  supabaseAdmin: any,
  tenantId: string,
  userId: string,
  options: { maxUses?: number } = {},
): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const maxUses = Math.min(Math.max(Math.floor(options.maxUses ?? 1), 1), MAX_TOKEN_USES);
  const { error } = await supabaseAdmin.from('agent_mail_relay_tokens').insert({
    token_hash: hashToken(token),
    tenant_id: tenantId,
    user_id: userId,
    expires_at: expiresAt,
    ...(maxUses > 1 ? { max_uses: maxUses, use_count: 0 } : {}),
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
 *  même s'il fuitait (log, réseau), il ne rejoue rien une seconde fois.
 *  Un jeton multi-usage décompte `use_count` et reçoit `used_at` à son
 *  dernier usage ; le décompte est conditionnel (`use_count` relu) pour que
 *  deux appels simultanés ne dépensent pas le même usage. */
export async function resolveMailRelayToken(supabaseAdmin: any, token: string): Promise<ResolvedMailRelayToken | null> {
  if (!token || !token.startsWith('mail_at_')) return null;
  const tokenHash = hashToken(token);
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const { data: row } = await supabaseAdmin
      .from('agent_mail_relay_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (!row || row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    const maxUses: number = row.max_uses ?? 1;
    if (maxUses <= 1) {
      await supabaseAdmin.from('agent_mail_relay_tokens').update({ used_at: new Date().toISOString() }).eq('token_hash', tokenHash);
      return { tenantId: row.tenant_id, userId: row.user_id };
    }

    const used: number = row.use_count ?? 0;
    if (used >= maxUses) return null;
    const exhausted = used + 1 >= maxUses;
    const { data: claimed } = await supabaseAdmin
      .from('agent_mail_relay_tokens')
      .update({ use_count: used + 1, ...(exhausted ? { used_at: new Date().toISOString() } : {}) })
      .eq('token_hash', tokenHash)
      .eq('use_count', used)
      .select('token_hash');
    if (claimed && claimed.length > 0) return { tenantId: row.tenant_id, userId: row.user_id };
    // Un autre appel a pris cet usage entre la lecture et l'écriture : on relit.
  }
  return null;
}
