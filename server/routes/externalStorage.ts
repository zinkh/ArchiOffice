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
import { createProvider, hasProviderFactory } from '../externalStorage/providerFactory';
import {
  getActiveConnection,
  invalidateConnectionCache,
  type ExternalStorageConnection,
} from '../externalStorage/externalConnection';
import { sanitizeFolderSegment } from '../externalStorage/folderNaming';

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

export function registerExternalStorageRoutes(
  app: Express,
  { supabaseAdmin, getTenantId, requireTenantAdmin }: RouteDeps,
) {
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
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/external-storage/:id]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec de la révocation' });
    }
  });
}
