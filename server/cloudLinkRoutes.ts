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
import { readLocalAccount, writeLocalAccount, signLocalJwt, goTrueUserFromAccount, LocalAccount } from './offlineAccount';
import { readCloudLinkState, writeCloudLinkState, writeEncryptedCloudSession } from './cloudLinkState';
import { createCloudSupabaseClient } from './cloudSyncClient';
import { encryptForStorage } from './ipcCrypto';
import { runInitialImport, getImportJob } from './initialImport';

function accountResponse(account: LocalAccount) {
  return { access_token: signLocalJwt(account.userId), user: goTrueUserFromAccount(account) };
}

export function createCloudLinkRouter(supabaseAdmin: SupabaseClient): Router {
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
    if (profileErr || !profile || !profile.tenant_id) {
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
      .then(() => {
        const job = getImportJob(jobId);
        const state = readCloudLinkState();
        if (job?.status === 'done' && state) {
          writeCloudLinkState({ ...state, importCompleted: true, initialWatermarkId: job.initialWatermarkId });
        }
      })
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

  return router;
}
