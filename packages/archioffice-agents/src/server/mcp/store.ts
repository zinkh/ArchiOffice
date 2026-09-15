// Accès aux trois tables de migrate_mcp_connections.sql. Les jetons ne sont
// jamais stockés ni relus en clair — seul leur haché SHA-256 est comparé,
// sur le même principe qu'un mot de passe : le serveur n'a besoin que de
// vérifier une correspondance, jamais de retrouver la valeur d'origine.
import crypto from 'crypto';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

export interface McpOAuthClient {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string[];
}

export interface McpResolvedToken {
  userId: string;
  tenantId: string;
  connectionId: string;
}

/** RFC 7591 minimal : Gemini se présente sans identifiant préalable, on lui
 *  en attribue un. Pas de secret confidentiel (client "public") : PKCE porte
 *  seule la preuve de possession sur l'échange de code. */
export async function registerOAuthClient(
  supabaseAdmin: any,
  redirectUris: string[],
  clientName?: string
): Promise<{ client_id: string }> {
  const clientId = randomToken('mcp_client');
  const { error } = await supabaseAdmin.from('mcp_oauth_clients').insert({
    client_id: clientId,
    client_secret_hash: null,
    client_name: clientName || null,
    redirect_uris: redirectUris,
  });
  if (error) throw error;
  return { client_id: clientId };
}

export async function getOAuthClient(supabaseAdmin: any, clientId: string): Promise<McpOAuthClient | null> {
  const { data } = await supabaseAdmin.from('mcp_oauth_clients').select('*').eq('client_id', clientId).maybeSingle();
  return data || null;
}

const GRANT_TTL_MS = 5 * 60 * 1000;

export async function createAuthorizationCode(
  supabaseAdmin: any,
  params: {
    clientId: string; tenantId: string; userId: string; redirectUri: string;
    codeChallenge: string; codeChallengeMethod: string; scope: string;
  }
): Promise<{ code: string }> {
  const code = randomToken('mcp_code');
  const { error } = await supabaseAdmin.from('mcp_oauth_grants').insert({
    client_id: params.clientId,
    tenant_id: params.tenantId,
    user_id: params.userId,
    redirect_uri: params.redirectUri,
    code_hash: hashToken(code),
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod || 'S256',
    scope: params.scope || '',
    expires_at: new Date(Date.now() + GRANT_TTL_MS).toISOString(),
  });
  if (error) throw error;
  return { code };
}

/** Marque le code consommé dans le même appel que sa lecture : un code
 *  d'autorisation ne doit jamais pouvoir être échangé deux fois. */
export async function consumeAuthorizationCode(supabaseAdmin: any, code: string) {
  const codeHash = hashToken(code);
  const { data: grant } = await supabaseAdmin.from('mcp_oauth_grants').select('*').eq('code_hash', codeHash).maybeSingle();
  if (!grant) return null;
  if (grant.used_at) return null;
  if (new Date(grant.expires_at).getTime() < Date.now()) return null;
  await supabaseAdmin.from('mcp_oauth_grants').update({ used_at: new Date().toISOString() }).eq('id', grant.id);
  return grant;
}

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

export async function createConnection(
  supabaseAdmin: any,
  params: { clientId: string; tenantId: string; userId: string; scope: string }
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = randomToken('mcp_at');
  const refreshToken = randomToken('mcp_rt');
  const { error } = await supabaseAdmin.from('mcp_connections').insert({
    client_id: params.clientId,
    tenant_id: params.tenantId,
    user_id: params.userId,
    access_token_hash: hashToken(accessToken),
    access_expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
    refresh_token_hash: hashToken(refreshToken),
    scope: params.scope || '',
  });
  if (error) throw error;
  return { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

/** Rotation du jeton d'accès contre le refresh token — le refresh token
 *  lui-même ne change pas, Gemini le garde pour les renouvellements suivants. */
export async function refreshConnection(
  supabaseAdmin: any,
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number; scope: string } | null> {
  const refreshHash = hashToken(refreshToken);
  const { data: conn } = await supabaseAdmin.from('mcp_connections').select('*').eq('refresh_token_hash', refreshHash).maybeSingle();
  if (!conn || conn.revoked_at) return null;
  const accessToken = randomToken('mcp_at');
  const { error } = await supabaseAdmin.from('mcp_connections').update({
    access_token_hash: hashToken(accessToken),
    access_expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
  }).eq('id', conn.id);
  if (error) throw error;
  return { accessToken, expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000), scope: conn.scope || '' };
}

/** Résout un jeton d'accès présenté par Gemini (en-tête Authorization, aussi
 *  bien sur /mcp que — repris tel quel — sur les appels internes vers
 *  /api/* que font les outils, voir tools.ts) vers l'utilisateur et le
 *  cabinet qu'il désigne. Rend null sur tout jeton absent, expiré ou révoqué,
 *  jamais une exception : c'est un cas attendu, pas une panne. */
export async function resolveAccessToken(supabaseAdmin: any, token: string): Promise<McpResolvedToken | null> {
  if (!token || !token.startsWith('mcp_at_')) return null;
  const { data: conn } = await supabaseAdmin.from('mcp_connections').select('*').eq('access_token_hash', hashToken(token)).maybeSingle();
  if (!conn || conn.revoked_at) return null;
  if (new Date(conn.access_expires_at).getTime() < Date.now()) return null;
  // Meilleur effort : un échec d'écriture de `last_used_at` ne doit jamais
  // faire échouer l'appel qu'on est justement en train d'authentifier.
  supabaseAdmin.from('mcp_connections').update({ last_used_at: new Date().toISOString() }).eq('id', conn.id).then(() => {}, () => {});
  return { userId: conn.user_id, tenantId: conn.tenant_id, connectionId: conn.id };
}

export async function listConnections(supabaseAdmin: any, tenantId: string, userId: string) {
  const { data } = await supabaseAdmin.from('mcp_connections').select('id, created_at, last_used_at, revoked_at, scope')
    .eq('tenant_id', tenantId).eq('user_id', userId).is('revoked_at', null).order('created_at', { ascending: false });
  return data || [];
}

export async function revokeConnection(supabaseAdmin: any, tenantId: string, userId: string, connectionId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('mcp_connections')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', connectionId).eq('tenant_id', tenantId).eq('user_id', userId)
    .select('id').maybeSingle();
  if (error) throw error;
  return !!data;
}
