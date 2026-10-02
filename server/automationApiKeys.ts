// ── Clés d'API d'automatisation (n8n, ou tout appelant HTTP externe) ──
// Même principe que les jetons mcp_at_ (packages/archioffice-agents/src/
// server/mcp/store.ts) et tg_at_ (server/telegramBot.ts), déjà dispatchés
// dans le middleware /api de server.ts : un préfixe reconnaissable résolu
// vers un (userId, tenantId) réel, jamais un JWT. Liaison persistante mais
// révocable, comme tg_at_ — un scénario n8n rappelle la même clé à chaque
// exécution, contrairement au jeton à usage unique mail_at_.
//
// Les droits appliqués à chaque appel sont ceux de la personne qui a émis
// la clé, jamais un compte de service séparé : un scénario n8n construit
// avec la clé d'un collaborateur n'a jamais plus de droits que lui.
import crypto from 'crypto';
import { hashToken } from './telegramBot';

function randomKey(): string {
  return `auto_at_${crypto.randomBytes(32).toString('base64url')}`;
}

export interface AutomationApiKeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** @returns la clé en clair — n'est jamais ni stockée ni re-rendue ensuite. */
export async function issueAutomationApiKey(
  supabaseAdmin: any,
  tenantId: string,
  userId: string,
  name: string,
): Promise<{ id: string; key: string }> {
  const id = crypto.randomUUID();
  const key = randomKey();
  const { error } = await supabaseAdmin.from('automation_api_keys').insert({
    id,
    tenant_id: tenantId,
    user_id: userId,
    name,
    token_hash: hashToken(key),
  });
  if (error) throw error;
  return { id, key };
}

export async function listAutomationApiKeys(supabaseAdmin: any, tenantId: string): Promise<AutomationApiKeySummary[]> {
  const { data } = await supabaseAdmin
    .from('automation_api_keys')
    .select('id, name, created_at, last_used_at, revoked_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeAutomationApiKey(supabaseAdmin: any, tenantId: string, id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('automation_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export interface ResolvedAutomationApiKey {
  tenantId: string;
  userId: string;
}

/** Comme resolveAccessToken côté Telegram : jamais d'exception sur une clé
 *  absente/révoquée — un cas attendu, pas une panne. */
export async function resolveAutomationApiKey(supabaseAdmin: any, token: string): Promise<ResolvedAutomationApiKey | null> {
  if (!token || !token.startsWith('auto_at_')) return null;
  const { data: row } = await supabaseAdmin
    .from('automation_api_keys')
    .select('*')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (!row || row.revoked_at) return null;
  supabaseAdmin.from('automation_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(() => {}, () => {});
  return { tenantId: row.tenant_id, userId: row.user_id };
}
