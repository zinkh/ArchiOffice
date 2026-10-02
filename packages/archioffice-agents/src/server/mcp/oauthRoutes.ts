// Serveur d'autorisation OAuth 2.1 minimal pour la liaison MCP (« Custom
// apps for Spark ») — ArchiOffice y joue le rôle de fournisseur OAuth, pas
// de consommateur comme pour Gmail/Calendar/Zoho. Trois familles de routes :
//
//   - /.well-known/*                 découverte (métadonnées du serveur
//                                     d'autorisation + de la ressource MCP,
//                                     lues par Gemini avant toute connexion)
//   - /oauth/mcp/register            enregistrement dynamique du client
//                                     (RFC 7591) — Gemini n'a pas d'identifiant
//                                     ArchiOffice préalable
//   - /oauth/mcp/token               échange code→jeton et rafraîchissement,
//                                     sans session utilisateur (le client
//                                     appelle directement, PKCE fait la preuve)
//   - /api/mcp/authorize             sous /api, donc protégé par le middleware
//                                     d'auth Supabase existant : c'est l'écran
//                                     de consentement (SPA) qui l'appelle une
//                                     fois l'architecte déjà connecté à
//                                     ArchiOffice, jamais Gemini directement
//   - /api/mcp/connections           lister/révoquer ses liaisons, pour /settings
import crypto from 'crypto';
import {
  registerOAuthClient, getOAuthClient, createAuthorizationCode, consumeAuthorizationCode,
  createConnection, refreshConnection, listConnections, revokeConnection,
} from './store.js';

function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method === 'plain') return verifier === challenge;
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  return computed === challenge;
}

export function registerMcpOAuthRoutes(app: any, supabaseAdmin: any, getTenantId: (userId: string) => Promise<string>, baseUrl: string): void {
  const issuer = baseUrl.replace(/\/$/, '');

  // Aucune de ces réponses n'est jamais la même deux fois pour deux
  // utilisateurs (jetons, état, code par usage unique) : un CDN devant
  // l'app (Cloudflare, ici) qui en mettrait une seule en cache — même par
  // accident, avant l'existence de cette route, quand le chemin tombait sur
  // le fallback SPA — la resservirait indéfiniment à la place du serveur, et
  // personne côté application ne verrait jamais passer la requête suivante.
  app.use(['/oauth/mcp', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource'], (_req: any, res: any, next: any) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/.well-known/oauth-authorization-server', (_req: any, res: any) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/mcp/authorize`,
      token_endpoint: `${issuer}/oauth/mcp/token`,
      registration_endpoint: `${issuer}/oauth/mcp/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  app.get('/.well-known/oauth-protected-resource', (_req: any, res: any) => {
    res.json({
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
    });
  });

  // RFC 7591 minimal : n'importe quel appelant peut s'enregistrer (comme la
  // quasi-totalité des serveurs MCP publics) — ce n'est pas ça qui protège
  // les données du cabinet, c'est l'écran de consentement de /api/mcp/authorize
  // et le fait que le jeton final désigne un utilisateur ArchiOffice précis.
  app.post('/oauth/mcp/register', async (req: any, res: any) => {
    try {
      const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.filter((u: any) => typeof u === 'string') : [];
      if (redirectUris.length === 0) return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris requis' });
      const { client_id } = await registerOAuthClient(supabaseAdmin, redirectUris, req.body?.client_name);
      res.status(201).json({
        client_id,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    } catch (e: any) { res.status(500).json({ error: 'server_error', error_description: e.message }); }
  });

  // Redirection GET brute (Gemini y navigue directement) — sans session
  // ArchiOffice exploitable côté serveur (le JWT vit dans le navigateur, pas
  // dans un cookie), donc on renvoie vers l'écran de consentement de la SPA
  // en lui transmettant tel quel ce que Gemini a fourni.
  app.get('/oauth/mcp/authorize', (req: any, res: any) => {
    const params = new URLSearchParams(req.query as Record<string, string>).toString();
    res.redirect(`/mcp/authorize?${params}`);
  });

  // Appelée par la page de consentement de la SPA, déjà authentifiée via le
  // middleware /api standard (JWT Supabase de l'architecte connecté).
  app.post('/api/mcp/authorize', async (req: any, res: any) => {
    try {
      const { client_id, redirect_uri, code_challenge, code_challenge_method, scope, state } = req.body || {};
      if (!client_id || !redirect_uri || !code_challenge) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      const client = await getOAuthClient(supabaseAdmin, client_id);
      if (!client || !client.redirect_uris.includes(redirect_uri)) {
        return res.status(400).json({ error: 'invalid_client_or_redirect' });
      }
      const tenantId = await getTenantId(req.user.id);
      const { code } = await createAuthorizationCode(supabaseAdmin, {
        clientId: client_id, tenantId, userId: req.user.id, redirectUri: redirect_uri,
        codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method || 'S256', scope: scope || '',
      });
      const redirect = new URL(redirect_uri);
      redirect.searchParams.set('code', code);
      if (state) redirect.searchParams.set('state', state);
      res.json({ redirect_to: redirect.toString() });
    } catch (e: any) { res.status(500).json({ error: 'server_error', error_description: e.message }); }
  });

  app.post('/oauth/mcp/token', async (req: any, res: any) => {
    try {
      const grantType = req.body?.grant_type;
      if (grantType === 'authorization_code') {
        const { code, redirect_uri, code_verifier, client_id } = req.body || {};
        if (!code || !code_verifier) return res.status(400).json({ error: 'invalid_request' });
        const grant = await consumeAuthorizationCode(supabaseAdmin, code);
        if (!grant) return res.status(400).json({ error: 'invalid_grant' });
        if (grant.redirect_uri !== redirect_uri || grant.client_id !== client_id) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri ou client_id incohérent' });
        }
        if (!verifyPkce(code_verifier, grant.code_challenge, grant.code_challenge_method)) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE invalide' });
        }
        const { accessToken, refreshToken, expiresIn } = await createConnection(supabaseAdmin, {
          clientId: grant.client_id, tenantId: grant.tenant_id, userId: grant.user_id, scope: grant.scope,
        });
        return res.json({ access_token: accessToken, token_type: 'bearer', expires_in: expiresIn, refresh_token: refreshToken, scope: grant.scope });
      }
      if (grantType === 'refresh_token') {
        const { refresh_token } = req.body || {};
        if (!refresh_token) return res.status(400).json({ error: 'invalid_request' });
        const refreshed = await refreshConnection(supabaseAdmin, refresh_token);
        if (!refreshed) return res.status(400).json({ error: 'invalid_grant' });
        return res.json({ access_token: refreshed.accessToken, token_type: 'bearer', expires_in: refreshed.expiresIn, scope: refreshed.scope });
      }
      res.status(400).json({ error: 'unsupported_grant_type' });
    } catch (e: any) { res.status(500).json({ error: 'server_error', error_description: e.message }); }
  });

  app.get('/api/mcp/connections', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      res.json(await listConnections(supabaseAdmin, tenantId, req.user.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/mcp/connections/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const ok = await revokeConnection(supabaseAdmin, tenantId, req.user.id, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Connexion introuvable' });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
