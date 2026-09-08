// Le seul endroit qui décide QUEL compte mail sert une requête donnée.
//
// Avant ce fichier, email_connections portait UNIQUE(user_id, provider) : au
// plus une boîte Gmail, une Outlook, une IMAP par utilisateur, donc "le
// compte de ce fournisseur" suffisait à identifier une ligne partout
// (server/routes/{gmailSync,outlookSync,imapMailSync}.ts, chacun avec son
// propre getConnection(tenantId, userId) en .maybeSingle()). Plusieurs
// adresses par fournisseur (cabinet + personnelle, par ex.) rendent cette
// question ambiguë : il faut un compte explicite, ou un défaut.
//
// resolveMailAccount() est le remplaçant direct de ces trois getConnection —
// même forme (tenantId, userId), plus un provider et un accountId optionnel.
export interface MailAccountRow {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: 'google' | 'microsoft' | 'infomaniak';
  auth_type: 'oauth' | 'imap';
  is_default: boolean;
  display_name: string | null;
  external_account_email: string | null;
  [key: string]: any; // tokens/secrets — jamais renvoyés au client, cf. listMailAccounts
}

export interface MailAccountSummary {
  id: string;
  provider: 'google' | 'microsoft' | 'infomaniak';
  authType: 'oauth' | 'imap';
  email: string | null;
  displayName: string | null;
  isDefault: boolean;
  hasSmtp: boolean;
  lastSyncedAt: string | null;
}

import { tenantScopedFrom } from './tenantScopedFrom';

/**
 * Résout le compte mail d'un fournisseur donné pour cet utilisateur :
 * - `accountId` fourni et appartenant bien à cet utilisateur/fournisseur → ce compte ;
 * - `accountId` fourni mais introuvable pour ce fournisseur → null (l'appelant renvoie 400) ;
 * - sinon, le compte par défaut de l'utilisateur pour ce fournisseur ;
 * - à défaut de défaut (compte créé avant la notion de défaut, cas transitoire),
 *   le plus ancien.
 */
export async function resolveMailAccount(
  supabaseAdmin: any,
  tenantId: string,
  userId: string,
  provider: 'google' | 'microsoft' | 'infomaniak',
  accountId?: string | null,
): Promise<MailAccountRow | null> {
  const table = () => tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections');

  if (accountId) {
    const { data } = await table().select('*').eq('id', accountId).eq('user_id', userId).eq('provider', provider).maybeSingle();
    return (data as MailAccountRow) || null;
  }

  const { data: def } = await table().select('*').eq('user_id', userId).eq('provider', provider).eq('is_default', true).maybeSingle();
  if (def) return def as MailAccountRow;

  const { data: rows } = await table().select('*').eq('user_id', userId).eq('provider', provider).order('created_at', { ascending: true }).limit(1);
  return (rows && rows[0]) || null;
}

/** Toutes les boîtes connectées d'un utilisateur, tous fournisseurs confondus, sans jamais exposer un secret. */
export async function listMailAccounts(supabaseAdmin: any, tenantId: string, userId: string): Promise<MailAccountSummary[]> {
  const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
    .select('id, provider, auth_type, external_account_email, display_name, is_default, smtp_host, last_synced_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return ((data || []) as any[]).map(row => ({
    id: row.id,
    provider: row.provider,
    authType: row.auth_type,
    email: row.external_account_email || null,
    displayName: row.display_name || null,
    isDefault: !!row.is_default,
    hasSmtp: !!row.smtp_host,
    lastSyncedAt: row.last_synced_at || null,
  }));
}

/**
 * true si cet utilisateur n'a encore aucune boîte connectée (tous
 * fournisseurs confondus) — utilisé par les callbacks OAuth/IMAP pour poser
 * is_default sur la toute première connexion, sans quoi personne n'aurait de
 * défaut avant de le régler soi-même depuis les Réglages.
 */
export async function isFirstMailAccountForUser(supabaseAdmin: any, tenantId: string, userId: string): Promise<boolean> {
  const { count } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId);
  return !count;
}

/** Effacer-puis-poser, comme server/routes/documentTemplates.ts:set-default — jamais deux défauts, jamais zéro une fois posé. */
export async function setDefaultMailAccount(supabaseAdmin: any, tenantId: string, userId: string, accountId: string): Promise<boolean> {
  const table = () => tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections');
  const { data: target } = await table().select('id').eq('id', accountId).eq('user_id', userId).maybeSingle();
  if (!target) return false;
  await table().update({ is_default: false }).eq('user_id', userId).eq('is_default', true);
  await table().update({ is_default: true }).eq('id', accountId);
  return true;
}
