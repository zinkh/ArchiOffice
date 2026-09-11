// First-run "log into your existing cloud account" flow for the offline
// desktop build — distinct from server/localAuthRoutes.ts's local-only
// account creation. A successful cloud-link provisions local tenants/
// profiles rows with IDs copied verbatim from the cloud (so they stay
// aligned for sync), sets a local unlock password (reusing the existing
// local-JWT machinery unchanged), persists an encrypted cloud refresh
// token, and kicks off a one-time full data import.
import express, { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readLocalAccount, writeLocalAccount, signLocalJwt, verifyLocalJwt, goTrueUserFromAccount, LocalAccount,
} from './offlineAccount';
import {
  readCloudLinkState, writeCloudLinkState, writeEncryptedCloudSession, readEncryptedCloudSession, CloudLinkState,
} from './cloudLinkState';
import { createCloudSupabaseClient, restoreCloudSession } from './cloudSyncClient';
import { encryptForStorage, decryptFromStorage } from './ipcCrypto';
import { runInitialImport, getImportJob } from './initialImport';

function accountResponse(account: LocalAccount) {
  return { access_token: signLocalJwt(account.userId), user: goTrueUserFromAccount(account) };
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [, token] = header.split(' ');
  return token || null;
}

/**
 * Un import réussi termine sur cet appel commun aux deux chemins (premier
 * lien et relance) : marque le lien comme complet et bascule la synchro
 * cloud en direct, sans attendre un redémarrage de l'application — même
 * logique que server/localCloudUpgrade.ts, qui documente pourquoi
 * (« so the user doesn't have to restart the app »). Manquait sur ce
 * chemin-ci jusqu'ici : un premier lien réussi laissait la synchro éteinte
 * jusqu'au prochain lancement de l'appli.
 */
async function finalizeImport(
  jobId: string,
  activateCloudSync: (linkState: CloudLinkState) => Promise<void>,
): Promise<void> {
  const job = getImportJob(jobId);
  const state = readCloudLinkState();
  if (job?.status !== 'done' || !state) return;
  const updated: CloudLinkState = { ...state, importCompleted: true, initialWatermarkId: job.initialWatermarkId };
  writeCloudLinkState(updated);
  try {
    await activateCloudSync(updated);
  } catch (err: any) {
    console.error('[cloud-link] failed to activate background sync live:', err.message);
  }
}

export function createCloudLinkRouter(
  supabaseAdmin: SupabaseClient,
  activateCloudSync: (linkState: CloudLinkState) => Promise<void>,
): Router {
  const router = Router();

  router.get('/cloud-link-status', (req: Request, res: Response) => {
    res.json({ linked: !!readCloudLinkState() });
  });

  router.post('/cloud-link', express.json(), async (req: Request, res: Response) => {
    if (readLocalAccount() || readCloudLinkState()) {
      return res.status(409).json({ error: 'Ce poste est déjà configuré' });
    }

    const email = (req.body?.email || '').trim();
    const password = req.body?.password || '';
    const localPassword = req.body?.localPassword || '';
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }
    if (localPassword.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe local (8 caractères minimum) est requis' });
    }

    let cloudClient: SupabaseClient;
    try {
      cloudClient = createCloudSupabaseClient();
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }

    const { data: authData, error: authErr } = await cloudClient.auth.signInWithPassword({ email, password });
    if (authErr || !authData.session) {
      return res.status(401).json({ error: authErr?.message || 'Identifiants invalides' });
    }
    const { session } = authData;
    const cloudUserId = session.user.id;

    const { data: profile, error: profileErr } = await cloudClient
      .from('profiles')
      .select('id, tenant_id, name, email, role, system_role')
      .eq('id', cloudUserId)
      .single();
    if (profileErr) {
      // A real query failure (DB/network/RLS error) is not the same thing as
      // "no tenant" — collapsing both into the same message hides the actual
      // cause. Log it server-side and say so distinctly.
      console.error('[cloud-link] profile lookup failed:', profileErr.message);
      return res.status(502).json({ error: `Échec de la vérification du compte cloud : ${profileErr.message}` });
    }
    if (!profile || !profile.tenant_id) {
      return res.status(400).json({
        error: "Ce compte n'est rattaché à aucune agence. Connectez-vous sur l'application web pour créer votre agence ou demander à rejoindre une agence existante, puis réessayez ici.",
      });
    }

    const { data: tenant, error: tenantErr } = await cloudClient
      .from('tenants')
      .select('id, slug, name')
      .eq('id', profile.tenant_id)
      .single();
    if (tenantErr || !tenant) {
      return res.status(400).json({ error: 'Agence introuvable' });
    }

    // Provision local tenants/profiles with the SAME ids as the cloud
    // rows — unlike local-setup's crypto.randomUUID(), this is what keeps
    // every subsequently-synced row's foreign keys valid on both sides.
    const { error: localTenantErr } = await supabaseAdmin
      .from('tenants')
      .upsert({ id: tenant.id, slug: tenant.slug, name: tenant.name });
    if (localTenantErr) return res.status(500).json({ error: localTenantErr.message });

    const { error: localProfileErr } = await supabaseAdmin.from('profiles').upsert({
      id: profile.id,
      tenant_id: profile.tenant_id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      system_role: profile.system_role,
    });
    if (localProfileErr) return res.status(500).json({ error: localProfileErr.message });

    const passwordHash = await bcrypt.hash(localPassword, 10);
    const account: LocalAccount = {
      userId: profile.id,
      tenantId: profile.tenant_id,
      email: profile.email,
      agencyName: tenant.name,
      passwordHash,
    };
    writeLocalAccount(account);

    try {
      const encrypted = await encryptForStorage(session.refresh_token);
      writeEncryptedCloudSession(encrypted);
    } catch (err: any) {
      return res.status(500).json({ error: `Échec du chiffrement de la session cloud : ${err.message}` });
    }

    const installId = crypto.randomUUID();
    writeCloudLinkState({
      tenantId: profile.tenant_id,
      cloudUserId,
      email: profile.email,
      linkedAt: new Date().toISOString(),
      importCompleted: false,
      initialWatermarkId: null,
      installId,
    });

    const jobId = crypto.randomUUID();
    // Fire-and-poll: the import can take a while for a large tenant, so the
    // HTTP response returns immediately with a jobId the UI polls instead
    // of blocking this request.
    runInitialImport(jobId, cloudClient, supabaseAdmin, profile.tenant_id)
      .then(() => finalizeImport(jobId, activateCloudSync))
      .catch(() => {
        // getImportJob already captured the error for the polling endpoint below.
      });

    res.json({ ...accountResponse(account), importJobId: jobId });
  });

  router.get('/cloud-link-import/:jobId', (req: Request, res: Response) => {
    const job = getImportJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Import introuvable' });
    res.json(job);
  });

  // Relance l'import initial après un échec (voir server/initialImport.ts :
  // une ligne dont la référence n'a pas encore été importée au premier
  // passage, un décalage de schéma local pas encore rejoué...). L'import
  // est un upsert par identifiant : le rejouer entièrement ne duplique
  // rien, il se contente de rattraper ce qui manquait. Le compte local et
  // le lien cloud existent déjà à ce stade (posés par /cloud-link avant que
  // l'import ne démarre) — seule une nouvelle exécution de l'import est
  // nécessaire, pas de reprendre tout le flux de connexion.
  router.post('/cloud-link-retry-import', express.json(), async (req: Request, res: Response) => {
    const account = readLocalAccount();
    const state = readCloudLinkState();
    if (!account || !state) {
      return res.status(400).json({ error: "Ce poste n'est pas relié à un compte cloud" });
    }

    const token = bearerToken(req);
    const claims = token ? verifyLocalJwt(token) : null;
    if (!claims || claims.sub !== account.userId) {
      return res.status(401).json({ error: 'Authentification locale requise' });
    }

    const encrypted = readEncryptedCloudSession();
    if (!encrypted) {
      return res.status(409).json({ error: 'Session cloud introuvable — reconnectez-vous depuis Réglages.' });
    }

    let cloudClient: SupabaseClient;
    try {
      cloudClient = createCloudSupabaseClient();
      const refreshToken = await decryptFromStorage(encrypted);
      await restoreCloudSession(cloudClient, refreshToken);
    } catch (err: any) {
      // Le jeton stocké n'est plus valide (expiré, révoqué) — pas de
      // rattrapage possible sans une nouvelle authentification complète.
      return res.status(401).json({
        error: `Impossible de rétablir la session cloud (${err.message}). Reconnectez-vous depuis Réglages.`,
      });
    }

    const jobId = crypto.randomUUID();
    runInitialImport(jobId, cloudClient, supabaseAdmin, state.tenantId)
      .then(() => finalizeImport(jobId, activateCloudSync))
      .catch(() => {
        // getImportJob already captured the error for the polling endpoint above.
      });

    res.json({ importJobId: jobId });
  });

  return router;
}
