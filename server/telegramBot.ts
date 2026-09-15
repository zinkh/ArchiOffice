// Bot Telegram — alternative au lien MCP/Gemini (payant, hors conduite) pour
// parler à un agent ArchiOffice en voiture : la messagerie est une catégorie
// pleinement supportée par Android Auto (dictée vocale en entrée, lecture à
// voix haute des réponses en sortie), donc un bot fonctionne nativement là où
// App Actions ne garantit rien et où Gemini Spark exige un abonnement payant.
//
// Telegram n'a aucune notion d'OAuth utilisateur : la liaison se fait par un
// code à usage unique généré depuis /settings et envoyé au bot en message
// privé (`/start <code>`), sur le modèle du code d'autorisation MCP — voir
// packages/archioffice-agents/src/server/mcp/store.ts, dont ce fichier
// reprend la même logique de hachage plutôt que de la dupliquer autrement.
import crypto from 'crypto';
import { encryptSecret, decryptSecret } from './secretsCrypto';

export function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
}

// Code court et lisible (l'architecte le retape ou le colle dans Telegram) —
// pas besoin de l'entropie d'un jeton d'accès, juste d'être imprévisible sur
// sa courte durée de vie.
function randomLinkCode(): string {
  return crypto.randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
}

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

export async function createLinkCode(
  supabaseAdmin: any,
  params: { tenantId: string; userId: string; agentId: string }
): Promise<{ code: string; expiresAt: string }> {
  const code = randomLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
  const { error } = await supabaseAdmin.from('telegram_link_codes').insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    agent_id: params.agentId,
    code_hash: hashToken(code),
    expires_at: expiresAt,
  });
  if (error) throw error;
  return { code, expiresAt };
}

/** Consomme le code ET crée la liaison dans la même fonction — un code de
 *  liaison, comme un code d'autorisation OAuth, ne doit jamais pouvoir servir
 *  deux fois. Rend le jeton d'accès en clair une seule fois (il n'est jamais
 *  relu ensuite), à charge pour l'appelant de ne le garder qu'en mémoire le
 *  temps de l'utiliser. */
export async function consumeLinkCode(
  supabaseAdmin: any,
  code: string,
  chatId: number
): Promise<{ accessToken: string } | { error: 'invalid' | 'expired' | 'already_linked' }> {
  const { data: grant } = await supabaseAdmin.from('telegram_link_codes').select('*').eq('code_hash', hashToken(code)).maybeSingle();
  if (!grant || grant.used_at) return { error: 'invalid' };
  if (new Date(grant.expires_at).getTime() < Date.now()) return { error: 'expired' };

  // Un même chat Telegram ne doit pas porter deux liaisons : un /start répété
  // depuis un chat déjà lié doit échouer plutôt que créer une seconde ligne
  // orpheline (la contrainte UNIQUE sur chat_id le referait de toute façon
  // échouer côté base, mais un message d'erreur clair vaut mieux qu'une 500).
  const { data: existing } = await supabaseAdmin.from('telegram_connections').select('id').eq('chat_id', chatId).is('revoked_at', null).maybeSingle();
  if (existing) return { error: 'already_linked' };

  await supabaseAdmin.from('telegram_link_codes').update({ used_at: new Date().toISOString() }).eq('id', grant.id);

  const accessToken = randomToken('tg_at');
  const { error } = await supabaseAdmin.from('telegram_connections').insert({
    tenant_id: grant.tenant_id,
    user_id: grant.user_id,
    agent_id: grant.agent_id,
    chat_id: chatId,
    access_token_hash: hashToken(accessToken),
    access_token_encrypted: encryptSecret(accessToken),
  });
  if (error) throw error;
  return { accessToken };
}

export interface TelegramResolvedConnection {
  userId: string;
  tenantId: string;
  agentId: string;
  connectionId: string;
}

/** Comme resolveAccessToken côté MCP : résout un jeton d'accès vers
 *  l'utilisateur/cabinet/agent qu'il désigne, jamais d'exception sur un jeton
 *  absent/révoqué — c'est un cas attendu (message reçu d'un chat non lié,
 *  liaison révoquée depuis /settings), pas une panne. */
export async function resolveAccessToken(supabaseAdmin: any, token: string): Promise<TelegramResolvedConnection | null> {
  if (!token || !token.startsWith('tg_at_')) return null;
  const { data: conn } = await supabaseAdmin.from('telegram_connections').select('*').eq('access_token_hash', hashToken(token)).maybeSingle();
  if (!conn || conn.revoked_at) return null;
  supabaseAdmin.from('telegram_connections').update({ last_used_at: new Date().toISOString() }).eq('id', conn.id).then(() => {}, () => {});
  return { userId: conn.user_id, tenantId: conn.tenant_id, agentId: conn.agent_id, connectionId: conn.id };
}

/** Résout la liaison par chat_id plutôt que par jeton — c'est ce que le
 *  webhook Telegram fait à chaque message reçu. Rend le jeton d'accès en
 *  clair (déchiffré depuis access_token_encrypted) : c'est ArchiOffice
 *  elle-même qui doit le re-présenter à son propre appel interne juste après
 *  (voir routes/telegram.ts) — Telegram, contrairement à Gemini côté MCP, ne
 *  garde et ne présente aucun jeton lui-même. */
export async function resolveByChatId(supabaseAdmin: any, chatId: number): Promise<(TelegramResolvedConnection & { accessToken: string }) | null> {
  const { data: conn } = await supabaseAdmin.from('telegram_connections').select('*').eq('chat_id', chatId).is('revoked_at', null).maybeSingle();
  if (!conn) return null;
  return { userId: conn.user_id, tenantId: conn.tenant_id, agentId: conn.agent_id, connectionId: conn.id, accessToken: decryptSecret(conn.access_token_encrypted) };
}

export async function listConnections(supabaseAdmin: any, tenantId: string, userId: string) {
  const { data } = await supabaseAdmin.from('telegram_connections')
    .select('id, agent_id, created_at, last_used_at, revoked_at')
    .eq('tenant_id', tenantId).eq('user_id', userId).is('revoked_at', null)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function revokeConnection(supabaseAdmin: any, tenantId: string, userId: string, connectionId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('telegram_connections')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', connectionId).eq('tenant_id', tenantId).eq('user_id', userId)
    .select('id').maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Best-effort : un échec d'envoi Telegram (bot bloqué, quota) ne doit jamais
 *  faire échouer le traitement du message entrant qui l'a déclenché. */
export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // Meilleur effort — voir commentaire ci-dessus.
  }
}
