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

/** Une agence (cabinet) à laquelle la personne appartient réellement. */
export interface McpAgency {
  id: string;
  name: string | null;
  slug: string | null;
  /** Rôle système tenu DANS cette agence (admin, manager, pm, user). */
  role: string | null;
  /** Intitulé métier libre tenu dans cette agence. */
  roleLabel: string | null;
}

/**
 * Accès aux adhésions, injecté par server.ts : ce paquet n'importe rien de
 * server/ (même raison que setExternalFileReader), alors que
 * server/tenantMemberships.ts est la seule source de vérité de l'appartenance.
 */
export interface McpAgencyDirectory {
  /** Toutes les agences de la personne, celle par défaut en tête. */
  list(userId: string): Promise<McpAgency[]>;
  /** L'agence si — et seulement si — la personne en est membre MAINTENANT. */
  find(userId: string, tenantId: string): Promise<McpAgency | null>;
  /** Le cabinet existe-t-il (distingue « inconnue » de « accès refusé ») ? */
  exists(tenantId: string): Promise<boolean>;
}

let agencyDirectory: McpAgencyDirectory | null = null;

export function setMcpAgencyDirectory(dir: McpAgencyDirectory | null): void {
  agencyDirectory = dir;
}

export function getMcpAgencyDirectory(): McpAgencyDirectory | null {
  return agencyDirectory;
}

/**
 * - selected     : une agence est active et la personne en est membre.
 * - not_selected : aucune agence n'est désignée pour cette connexion.
 * - access_lost  : une agence est désignée mais la personne n'en est plus
 *                  membre (appartenance révoquée), ou l'annuaire est absent.
 */
export type McpAgencyState = 'selected' | 'not_selected' | 'access_lost';

export interface McpResolvedToken {
  userId: string;
  connectionId: string;
  /** L'agence effective de CET appel, ou null hors état `selected`. */
  tenantId: string | null;
  agency: McpAgency | null;
  agencyState: McpAgencyState;
  /** Agence désignée (stockée), même quand l'accès a été perdu. */
  selectedTenantId: string | null;
  /** `consent` tant que switch_agency n'a jamais été appelé sur cette connexion. */
  selectionSource: 'consent' | 'switch';
  /** Vrai dès qu'un changement d'agence a eu lieu sur cette connexion. */
  hasSwitched: boolean;
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

/** Résout un jeton d'accès présenté par le client MCP (en-tête Authorization,
 *  aussi bien sur /mcp que — repris tel quel — sur les appels internes vers
 *  /api/* que font les outils, voir tools.ts) vers la personne, la connexion et
 *  l'agence qu'il désigne. Rend null sur tout jeton absent, expiré ou révoqué,
 *  jamais une exception : c'est un cas attendu, pas une panne.
 *
 *  L'agence n'est jamais lue « telle qu'enregistrée » : l'appartenance est
 *  revérifiée à CHAQUE résolution. `pinnedTenantId` fige l'agence d'une opération
 *  déjà démarrée (en-tête X-Tenant-Id des appels internes d'un outil) : un
 *  changement d'agence survenu entre-temps ne la redirige pas, mais
 *  l'appartenance à l'agence figée est elle aussi revérifiée. */
export async function resolveAccessToken(
  supabaseAdmin: any,
  token: string,
  options: { pinnedTenantId?: string | null } = {},
): Promise<McpResolvedToken | null> {
  if (!token || !token.startsWith('mcp_at_')) return null;
  const { data: conn } = await supabaseAdmin.from('mcp_connections').select('*').eq('access_token_hash', hashToken(token)).maybeSingle();
  if (!conn || conn.revoked_at) return null;
  if (new Date(conn.access_expires_at).getTime() < Date.now()) return null;
  // Meilleur effort : un échec d'écriture de `last_used_at` ne doit jamais
  // faire échouer l'appel qu'on est justement en train d'authentifier.
  supabaseAdmin.from('mcp_connections').update({ last_used_at: new Date().toISOString() }).eq('id', conn.id).then(() => {}, () => {});

  // Sélection : le choix fait depuis le connecteur, à défaut le cabinet de
  // consentement. Jamais le cabinet affiché dans le navigateur.
  const hasSwitched = !!conn.active_tenant_id;
  const stored: string | null = conn.active_tenant_id || conn.tenant_id || null;
  const target = options.pinnedTenantId || stored;
  const base = {
    userId: conn.user_id, connectionId: conn.id, selectedTenantId: stored,
    selectionSource: (hasSwitched ? 'switch' : 'consent') as 'consent' | 'switch', hasSwitched,
  };
  if (!target) return { ...base, tenantId: null, agency: null, agencyState: 'not_selected' };
  // Sans annuaire des adhésions, on ne peut rien garantir : on ferme plutôt que
  // de servir un cabinet dont l'appartenance n'est pas vérifiée.
  const agency = agencyDirectory ? await agencyDirectory.find(conn.user_id, target) : null;
  if (!agency) return { ...base, tenantId: null, agency: null, agencyState: 'access_lost' };
  return { ...base, tenantId: agency.id, agency, agencyState: 'selected' };
}

/**
 * Enregistre l'agence active d'UNE connexion et relit la ligne pour confirmer
 * que la sélection est bien celle qui est enregistrée (deux changements
 * simultanés : le dernier écrit gagne, et chacun le voit à la relecture).
 */
export async function persistActiveAgency(
  supabaseAdmin: any,
  params: { connectionId: string; userId: string; tenantId: string },
): Promise<{ confirmed: boolean; unavailable?: boolean }> {
  const { error } = await supabaseAdmin.from('mcp_connections')
    .update({ active_tenant_id: params.tenantId, active_tenant_set_at: new Date().toISOString() })
    .eq('id', params.connectionId).eq('user_id', params.userId).is('revoked_at', null);
  // Colonne absente : instance où migrate_mcp_active_agency.sql n'a pas été jouée.
  if (error) return { confirmed: false, unavailable: true };
  const { data: row } = await supabaseAdmin.from('mcp_connections')
    .select('active_tenant_id, revoked_at').eq('id', params.connectionId).eq('user_id', params.userId).maybeSingle();
  return { confirmed: !!row && !row.revoked_at && row.active_tenant_id === params.tenantId };
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
