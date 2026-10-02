// La connexion de l'espace de stockage du cabinet (Nextcloud, kDrive — et,
// aux lots suivants, Google Drive et Dropbox) et son état.
//
// Réglage du CABINET et non d'une personne : un architecte et son collaborateur
// déposent dans le même espace. Les écritures sont donc réservées à un
// administrateur du cabinet (`requireTenantAdmin`), pendant que la lecture de
// l'état reste ouverte à tout membre — l'écran Documents doit pouvoir dire où
// partent les nouveaux fichiers.
//
// Aucun secret n'est jamais réémis en lecture : GET /status ne rend que des
// booléens de présence, sur le modèle de SECRET_COLS dans
// server/routes/settings.ts.
import type { Express } from 'express';
import crypto from 'crypto';
import { assertPublicHttpUrl } from '../ssrfGuard';
import { encryptSecret } from '../secretsCrypto';
import { createOAuthState, consumeOAuthState, oauthErrorParam } from '../oauthState';
import { createProvider, hasProviderFactory } from '../externalStorage/providerFactory';
import {
  getActiveConnection,
  invalidateConnectionCache,
  type ExternalStorageConnection,
} from '../externalStorage/externalConnection';
import { sanitizeFolderSegment } from '../externalStorage/folderNaming';
import { clearStorageTokenCache } from '../externalStorage/oauthTokens';
import { GOOGLE_DRIVE_SCOPE, GOOGLE_TOKEN_URL } from '../externalStorage/providers/googleDrive';
import { DROPBOX_AUTH_URL, DROPBOX_SCOPE, DROPBOX_TOKEN_URL } from '../externalStorage/providers/dropbox';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  requireTenantAdmin: (userId: string) => Promise<string>;
}

const WEBDAV_FLAVORS = new Set(['nextcloud', 'kdrive']);

/** Ce qu'un membre du cabinet a le droit de voir : de quoi afficher l'état,
 *  jamais de quoi s'authentifier. */
function publicView(connection: ExternalStorageConnection | null) {
  if (!connection) return { connected: false };
  return {
    connected: true,
    id: connection.id,
    provider: connection.provider,
    webdavFlavor: connection.webdav_flavor ?? null,
    displayName: connection.display_name ?? null,
    account: connection.external_account_email ?? connection.username ?? null,
    baseUrl: connection.base_url ?? null,
    rootFolderPath: connection.root_folder_path,
    status: connection.status,
    lastError: connection.status === 'ok' ? null : (connection as any).last_error ?? null,
    // Une connexion dont les accès ont été révoqués existe encore — c'est ce qui
    // garde résolubles les fichiers déjà déposés — mais ne peut plus rien lire.
    credentialsPresent: Boolean(connection.password_encrypted || connection.refresh_token),
  };
}

/** Les fournisseurs branchés par consentement OAuth, par opposition au WebDAV
 *  qui se configure par formulaire. */
const OAUTH_PROVIDERS: Record<string, {
  label: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  redirectEnv: string;
  /** Paramètres propres au fournisseur sur l'URL de consentement. */
  extraAuthParams: Record<string, string>;
}> = {
  google_drive: {
    label: 'Google Drive',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: GOOGLE_TOKEN_URL,
    scope: `${GOOGLE_DRIVE_SCOPE} email`,
    clientId: () => process.env.VITE_GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    redirectEnv: 'GOOGLE_DRIVE_REDIRECT_URI',
    // access_type=offline + prompt=consent : sans les deux, Google ne délivre
    // pas de refresh token à une application déjà autorisée, et la connexion
    // mourrait au bout d'une heure.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  dropbox: {
    label: 'Dropbox',
    authUrl: DROPBOX_AUTH_URL,
    tokenUrl: DROPBOX_TOKEN_URL,
    scope: DROPBOX_SCOPE,
    clientId: () => process.env.DROPBOX_CLIENT_ID,
    clientSecret: () => process.env.DROPBOX_CLIENT_SECRET,
    redirectEnv: 'DROPBOX_REDIRECT_URI',
    // token_access_type=offline est LE piège de cette API : sans lui, Dropbox
    // ne délivre aucun refresh token et la connexion meurt au bout de quatre
    // heures, sans que rien ne l'ait annoncé.
    extraAuthParams: { token_access_type: 'offline' },
  },
};

export function registerExternalStorageRoutes(
  app: Express,
  { supabaseAdmin, getTenantId, requireTenantAdmin }: RouteDeps,
) {
  /** L'URI de redirection : une variable d'environnement si l'exploitant en a
   *  posé une, sinon déduite de la requête — même mécanique que
   *  server/routes/googleCalendarSync.ts. */
  function redirectUri(req: any, providerId: string): string {
    const override = process.env[OAUTH_PROVIDERS[providerId].redirectEnv];
    if (override) return override;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
    return `${proto}://${host}/api/external-storage/callback`;
  }

  // L'URI à recopier dans la console du fournisseur — même service rendu que
  // GET /api/zoho/callback-url.
  app.get('/api/external-storage/callback-url', async (req: any, res: any) => {
    try {
      await getTenantId(req.user.id);
      // Les deux fournisseurs partagent le même chemin de retour ; seul un
      // override d'environnement pourrait les distinguer, d'où le paramètre.
      const provider = OAUTH_PROVIDERS[req.query.provider as string] ? (req.query.provider as string) : 'google_drive';
      res.json({ url: redirectUri(req, provider) });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Échec' });
    }
  });

  // Rend l'URL de consentement en JSON : une navigation nue vers cette route ne
  // porterait aucun JWT et serait refusée avant d'atteindre le fournisseur.
  // C'est le frontend qui navigue ensuite (patron Zoho, Settings.tsx).
  app.get('/api/external-storage/:provider/auth', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const config = OAUTH_PROVIDERS[req.params.provider];
      if (!config) return res.status(400).json({ error: 'Fournisseur inconnu.' });

      const clientId = config.clientId();
      // Refuser ici plutôt que de rediriger vers une page d'erreur du
      // fournisseur, incompréhensible pour l'architecte.
      if (!clientId || !config.clientSecret()) {
        return res.status(503).json({ error: `${config.label} n'est pas configuré sur cette instance.` });
      }

      const url = new URL(config.authUrl);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', redirectUri(req, req.params.provider));
      url.searchParams.set('scope', config.scope);
      for (const [k, v] of Object.entries(config.extraAuthParams)) url.searchParams.set(k, v);
      // Nonce à usage unique : sans lui, quiconque connaît l'identifiant d'un
      // cabinet pourrait rattacher SON espace de stockage à celui d'un autre.
      // La racine choisie voyage avec, la redirection du fournisseur ne pouvant
      // rien porter d'autre.
      const rootFolderPath = sanitizeFolderSegment((req.query.rootFolderPath as string) || 'ArchiOffice');
      url.searchParams.set('state', await createOAuthState(tenantId, req.user.id, `${req.params.provider}|${rootFolderPath}`));

      res.json({ url: url.toString() });
    } catch (e: any) {
      console.error('[GET /api/external-storage/:provider/auth]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec' });
    }
  });

  // La redirection du fournisseur est une navigation nue : aucun JWT. Le
  // cabinet est récupéré depuis le nonce, jamais depuis req.user (inexistant
  // ici). Route inscrite dans AUTH_EXEMPT (server.ts).
  app.get('/api/external-storage/callback', async (req: any, res: any) => {
    const { code, error: oauthError, state } = req.query as any;
    const back = (reason?: unknown) =>
      res.redirect(reason ? `/settings?external_storage_error=${oauthErrorParam(reason)}` : '/settings?external_storage_connected=1');

    const stateData = await consumeOAuthState(state);
    if (oauthError || !code || !stateData?.tenantId) return back(oauthError || 'invalid_request');

    const [providerId, rootFolderPath] = String(stateData.returnTo || 'google_drive|ArchiOffice').split('|');
    const config = OAUTH_PROVIDERS[providerId];
    if (!config) return back('invalid_request');

    try {
      const tokenResp = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: config.clientId() || '',
          client_secret: config.clientSecret() || '',
          redirect_uri: redirectUri(req, providerId),
          grant_type: 'authorization_code',
        }).toString(),
      });
      const tokenData: any = await tokenResp.json().catch(() => ({}));
      // Sans refresh token, la connexion mourrait à l'expiration du premier
      // jeton d'accès : mieux vaut refuser tout de suite que plus tard.
      if (!tokenResp.ok || !tokenData.refresh_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'missing_refresh_token');
      }

      // L'adresse du compte n'est qu'un confort d'affichage (« Connecté en tant
      // que… ») : un échec ici ne doit pas faire échouer la connexion.
      let account: string | null = null;
      try {
        if (providerId === 'google_drive') {
          const info = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          if (info.ok) account = (await info.json())?.email ?? null;
        } else if (providerId === 'dropbox') {
          const info = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          if (info.ok) account = (await info.json())?.email ?? null;
        }
      } catch { /* rien d'essentiel */ }

      await supabaseAdmin.from('external_storage_connections')
        .update({ is_active: false }).eq('tenant_id', stateData.tenantId).eq('is_active', true);

      const { error } = await supabaseAdmin.from('external_storage_connections').insert({
        id: crypto.randomUUID(),
        tenant_id: stateData.tenantId,
        provider: providerId,
        display_name: config.label,
        external_account_email: account,
        refresh_token: encryptSecret(tokenData.refresh_token),
        scopes: config.scope,
        root_folder_path: sanitizeFolderSegment(rootFolderPath || 'ArchiOffice'),
        is_active: true,
        status: 'ok',
        created_by: stateData.userId ?? null,
        created_at: new Date().toISOString(),
      });
      if (error) throw error;

      invalidateConnectionCache(stateData.tenantId);
      return back();
    } catch (err: any) {
      console.error('[GET /api/external-storage/callback]', err);
      return back(err?.message);
    }
  });

  app.get('/api/external-storage/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      res.json(publicView(await getActiveConnection(supabaseAdmin, tenantId)));
    } catch (e: any) {
      console.error('[GET /api/external-storage/status]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec de la lecture du stockage externe' });
    }
  });

  // Branche un espace WebDAV — Nextcloud et kDrive partagent ce chemin, ils ne
  // diffèrent que par l'URL de base que le cabinet saisit.
  app.post('/api/external-storage/webdav', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { flavor, baseUrl, username, password, rootFolderPath, displayName } = req.body || {};

      if (!WEBDAV_FLAVORS.has(flavor)) {
        return res.status(400).json({ error: 'Fournisseur inconnu.' });
      }
      if (!baseUrl || !username || !password) {
        return res.status(400).json({ error: "URL, identifiant et mot de passe d'application sont requis." });
      }
      if (!hasProviderFactory('webdav')) {
        return res.status(503).json({ error: "Le connecteur WebDAV n'est pas disponible sur cette instance." });
      }
      // L'URL vient du cabinet : elle ne doit jamais pouvoir viser un service
      // interne. Lève une erreur portant son propre statut (400 ou 403).
      await assertPublicHttpUrl(baseUrl);

      const candidate: ExternalStorageConnection = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        provider: 'webdav',
        webdav_flavor: flavor,
        display_name: displayName || (flavor === 'kdrive' ? 'kDrive' : 'Nextcloud'),
        external_account_email: username,
        base_url: String(baseUrl).trim(),
        username: String(username).trim(),
        password_encrypted: encryptSecret(String(password)),
        root_folder_path: sanitizeFolderSegment(rootFolderPath || 'ArchiOffice'),
        root_folder_external_id: null,
        is_active: true,
        status: 'ok',
      };

      // On sonde AVANT d'enregistrer : repartir avec une configuration
      // silencieusement cassée ne se découvrirait qu'au premier dépôt, c'est-à-dire
      // au pire moment.
      try {
        await createProvider(candidate).probe();
      } catch (err: any) {
        return res.status(400).json({
          error: `Connexion refusée par le serveur : ${err?.message || err}`,
        });
      }

      // Un seul espace actif par cabinet (index unique partiel). L'ancien est
      // désactivé, jamais supprimé : c'est lui qui garde résolubles les fichiers
      // qu'il a reçus.
      await supabaseAdmin.from('external_storage_connections')
        .update({ is_active: false }).eq('tenant_id', tenantId).eq('is_active', true);

      const { error } = await supabaseAdmin.from('external_storage_connections')
        .insert({ ...candidate, created_by: req.user.id, created_at: new Date().toISOString() });
      if (error) throw error;

      invalidateConnectionCache(tenantId);
      res.status(201).json(publicView(candidate));
    } catch (e: any) {
      console.error('[POST /api/external-storage/webdav]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec de la connexion du stockage externe' });
    }
  });

  app.post('/api/external-storage/test', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const connection = await getActiveConnection(supabaseAdmin, tenantId);
      if (!connection) return res.status(404).json({ error: 'Aucun espace de stockage branché.' });

      await createProvider(connection).probe();
      await supabaseAdmin.from('external_storage_connections')
        .update({ status: 'ok', last_error: null, last_error_at: null }).eq('id', connection.id);
      invalidateConnectionCache(tenantId);
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[POST /api/external-storage/test]', e);
      res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message || 'Test de connexion échoué' });
    }
  });

  // Déconnecter : les nouveaux fichiers repartent dans ArchiOffice, mais ceux
  // déjà déposés restent consultables — les identifiants sont conservés.
  app.post('/api/external-storage/:id/disable', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { error } = await supabaseAdmin.from('external_storage_connections')
        .update({ is_active: false }).eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      invalidateConnectionCache(tenantId);
      clearStorageTokenCache(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      console.error('[POST /api/external-storage/:id/disable]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec de la déconnexion' });
    }
  });

  // Révoquer les accès : efface les identifiants, garde la ligne. La ligne est
  // ce qui rend une référence `archioffice+external://…/<connexion>/…` encore
  // résoluble ; la supprimer rendrait d'un coup illisibles, DEPUIS
  // L'APPLICATION, tous les fichiers déposés chez le cabinet. Ils ne sont pas
  // perdus — ils sont dans son espace — mais ArchiOffice ne saurait plus les
  // retrouver, d'où l'avertissement explicite côté écran.
  app.delete('/api/external-storage/:id', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { error } = await supabaseAdmin.from('external_storage_connections')
        .update({
          is_active: false,
          status: 'needs_reauth',
          refresh_token: null,
          access_token: null,
          password_encrypted: null,
        })
        .eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      invalidateConnectionCache(tenantId);
      clearStorageTokenCache(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/external-storage/:id]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec de la révocation' });
    }
  });
}
