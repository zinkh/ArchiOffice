// Lets an already-configured "compte local" install (server/localAuthRoutes.ts)
// switch to a cloud-linked one WITHOUT losing the data already captured
// locally — the gap server/cloudLinkRoutes.ts's POST /cloud-link deliberately
// doesn't cover (it 409s if a local account already exists, and its only
// direction is cloud → local, meant for a still-empty install).
//
// The whole thing is one identity swap: every local row that currently
// belongs to this install's own (locally-generated) tenant/profile ids gets
// re-pointed at the cloud tenant/profile ids returned by signing into the
// cloud account, in a single Postgres transaction against OFFLINE_PG_URL —
// then pushed up (server/initialExport.ts) and reconciled against whatever
// already existed on the cloud side (server/initialImport.ts, reused as-is).
//
// Mounted on the SAME router prefix as server/cloudLinkRoutes.ts, and for the
// same reason that router isn't behind the generic /api auth middleware: it's
// registered before that middleware in server.ts's OFFLINE_MODE branch, so a
// request handled here never reaches it. Authentication is therefore done
// inline, the same way server/offlineGateway.ts's /auth/v1/user shim does it.
import express, { Router, Request, Response } from 'express';
import { Client } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readLocalAccount, writeLocalAccount, signLocalJwt, verifyLocalJwt,
  goTrueUserFromAccount, LocalAccount,
} from './offlineAccount';
import { readCloudLinkState, writeCloudLinkState, writeEncryptedCloudSession, CloudLinkState } from './cloudLinkState';
import { createCloudSupabaseClient } from './cloudSyncClient';
import { encryptForStorage } from './ipcCrypto';
import { runInitialExport, getExportJob } from './initialExport';
import { runInitialImport, getImportJob } from './initialImport';
import crypto from 'crypto';

// Best-effort remap targets. None of these carry a real FK (schema.sql's own
// comment: "TEXT sans FK, comme project_members.user_id et
// time_entries.user_id") — a column we miss here just means an old row shows
// an unresolvable "créé par" until it's next edited, never a broken write.
const USER_REF_COLUMNS = ['user_id', 'created_by', 'uploaded_by', 'assigned_to'];

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [, token] = header.split(' ');
  return token || null;
}

function accountResponse(account: LocalAccount, extra: Record<string, unknown>) {
  return { access_token: signLocalJwt(account.userId), user: goTrueUserFromAccount(account), ...extra };
}

export function createLocalCloudUpgradeRouter(
  supabaseAdmin: SupabaseClient,
  activateCloudSync: (linkState: CloudLinkState) => Promise<void>,
): Router {
  const router = Router();

  router.post('/cloud-link-upgrade', express.json(), async (req: Request, res: Response) => {
    const account = readLocalAccount();
    if (!account) {
      return res.status(400).json({ error: "Aucun compte local n'est configuré sur ce poste" });
    }
    if (readCloudLinkState()) {
      return res.status(409).json({ error: 'Ce poste est déjà relié à un compte cloud' });
    }

    const token = bearerToken(req);
    const claims = token ? verifyLocalJwt(token) : null;
    if (!claims || claims.sub !== account.userId) {
      return res.status(401).json({ error: 'Authentification locale requise' });
    }

    const email = (req.body?.email || '').trim();
    const password = req.body?.password || '';
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe du compte cloud requis' });
    }

    const pgUrl = process.env.OFFLINE_PG_URL;
    if (!pgUrl) {
      return res.status(500).json({ error: 'Base de données locale indisponible (OFFLINE_PG_URL manquant)' });
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
      console.error('[cloud-link-upgrade] profile lookup failed:', profileErr.message);
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

    // settings has UNIQUE(tenant_id) — if the cloud tenant already has one
    // (an existing cabinet, likely already used by colleagues), the cloud
    // row wins outright rather than attempting any field-by-field merge:
    // a full-row upsert from this machine would otherwise clobber SMTP/Zoho
    // credentials a colleague already configured. The local row is dropped
    // in the transaction below; runInitialImport brings the cloud one down.
    const { data: cloudSettings } = await cloudClient
      .from('settings')
      .select('id')
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    const cloudHasSettings = !!cloudSettings;

    const oldTenantId = account.tenantId;
    const oldUserId = account.userId;
    const newTenantId = tenant.id as string;
    const newUserId = profile.id as string;

    const pg = new Client({ connectionString: pgUrl });
    await pg.connect();
    try {
      await pg.query('BEGIN');

      if (cloudHasSettings) {
        await pg.query('DELETE FROM settings WHERE tenant_id = $1', [oldTenantId]);
      }

      // Every table actually carrying tenant_id in the local schema, not just
      // server/syncTables.ts's SYNC_TABLES (a deliberately narrower v1 sync
      // scope) — a table outside that list (time_entries, leave_requests,
      // document_templates, ...) still needs remapping here, or it gets
      // CASCADE-deleted below along with the old tenant row it's still
      // pointing at.
      const { rows: tenantTables } = await pg.query<{ table_name: string }>(
        `SELECT DISTINCT c.table_name
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'`,
      );
      for (const { table_name } of tenantTables) {
        if (table_name === 'tenants' || table_name === 'profiles') continue;
        await pg.query(`UPDATE "${table_name}" SET tenant_id = $1 WHERE tenant_id = $2`, [newTenantId, oldTenantId]);
      }

      // Best-effort user-ownership remap (see USER_REF_COLUMNS above).
      const { rows: userRefCols } = await pg.query<{ table_name: string; column_name: string }>(
        `SELECT c.table_name, c.column_name
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = ANY($1::text[])`,
        [USER_REF_COLUMNS],
      );
      for (const { table_name, column_name } of userRefCols) {
        if (table_name === 'profiles') continue;
        await pg.query(`UPDATE "${table_name}" SET "${column_name}" = $1 WHERE "${column_name}" = $2`, [newUserId, oldUserId]);
      }

      await pg.query(
        `INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
        [tenant.id, tenant.slug, tenant.name],
      );
      await pg.query(
        `INSERT INTO profiles (id, tenant_id, name, email, role, system_role) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id, name = EXCLUDED.name, email = EXCLUDED.email,
           role = EXCLUDED.role, system_role = EXCLUDED.system_role`,
        [profile.id, profile.tenant_id, profile.name, profile.email, profile.role, profile.system_role],
      );

      // Nothing should still reference these — every table found above was
      // just remapped. If something was missed, this DELETE fails on its FK
      // and the whole transaction rolls back rather than leaving orphans.
      await pg.query('DELETE FROM profiles WHERE id = $1', [oldUserId]);
      await pg.query('DELETE FROM tenants WHERE id = $1', [oldTenantId]);

      await pg.query('COMMIT');
    } catch (err: any) {
      await pg.query('ROLLBACK').catch(() => {});
      console.error('[cloud-link-upgrade] migration transaction failed:', err);
      return res.status(500).json({ error: `Échec de la migration des données locales : ${err.message}` });
    } finally {
      await pg.end();
    }

    const newAccount: LocalAccount = {
      userId: newUserId,
      tenantId: newTenantId,
      email: profile.email,
      agencyName: tenant.name,
      passwordHash: account.passwordHash,
    };
    writeLocalAccount(newAccount);

    try {
      const encrypted = await encryptForStorage(session.refresh_token);
      writeEncryptedCloudSession(encrypted);
    } catch (err: any) {
      return res.status(500).json({ error: `Échec du chiffrement de la session cloud : ${err.message}` });
    }

    const installId = crypto.randomUUID();
    writeCloudLinkState({
      tenantId: newTenantId,
      cloudUserId,
      email: profile.email,
      linkedAt: new Date().toISOString(),
      importCompleted: false,
      initialWatermarkId: null,
      installId,
    });

    const exportJobId = crypto.randomUUID();
    const importJobId = crypto.randomUUID();

    // Fire-and-poll, like server/cloudLinkRoutes.ts's own import: push what
    // was local first, then pull down whatever the cloud tenant already had
    // (colleagues' data, or its own settings row dropped above).
    runInitialExport(exportJobId, supabaseAdmin, cloudClient, newTenantId)
      .then(() => runInitialImport(importJobId, cloudClient, supabaseAdmin, newTenantId))
      .then(() => {
        const importJob = getImportJob(importJobId);
        const state = readCloudLinkState();
        if (importJob?.status === 'done' && state) {
          const updated = { ...state, importCompleted: true, initialWatermarkId: importJob.initialWatermarkId };
          writeCloudLinkState(updated);
          // Best-effort: activate background sync immediately so the user
          // doesn't have to restart the app. Falls back to starting at next
          // launch (server.ts's own boot check) if this throws.
          activateCloudSync(updated).catch((err) => {
            console.error('[cloud-link-upgrade] failed to activate background sync live:', err.message);
          });
        }
      })
      .catch((err) => {
        console.error('[cloud-link-upgrade] export/import chain failed:', err);
      });

    res.json(accountResponse(newAccount, { exportJobId, importJobId }));
  });

  router.get('/cloud-link-upgrade-export/:jobId', (req: Request, res: Response) => {
    const job = getExportJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Export introuvable' });
    res.json(job);
  });

  return router;
}
