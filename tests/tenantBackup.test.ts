// Sauvegardes par cabinet : contenu, restauration non destructive, rétention,
// et accès réservé au superadmin. Voir server/tenantBackup.ts.
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import {
  BACKUP_BUCKET,
  createTenantBackup,
  pruneBackups,
  restoreTenantBackup,
  runDueBackups,
} from '../server/tenantBackup';

const admin = fakeSupabaseAdmin as any;
const SUPER_ADMIN_EMAIL = 'super-admin@archioffice.test';
let app: Express;

function makeSuperAdminToken(): string {
  const token = `super-admin-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fakeSupabaseAdmin.registerUser(token, { id: crypto.randomUUID(), email: SUPER_ADMIN_EMAIL });
  return token;
}

function readSnapshot(dataPath: string): any {
  const bytes = fakeSupabaseAdmin.readObject(BACKUP_BUCKET, dataPath);
  return JSON.parse(gunzipSync(bytes!).toString('utf8'));
}

function seedProject(tenantId: string, id: string, name: string) {
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, name }]);
}

function deleteProject(id: string) {
  const rows = fakeSupabaseAdmin.getTable('projects');
  const index = rows.findIndex(r => r.id === id);
  if (index >= 0) rows.splice(index, 1);
}

beforeAll(async () => {
  process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
  app = await getTestApp();
});

describe('Création d\'une sauvegarde', () => {
  it('capture les lignes du cabinet, et seulement les siennes', async () => {
    const tenantId = makeTenant();
    const otherTenant = makeTenant();
    seedProject(tenantId, 'p-mine', 'Villa Martin');
    seedProject(otherTenant, 'p-other', 'Projet voisin');

    const backup = await createTenantBackup(admin, tenantId, 'manual');
    expect(backup.status).toBe('complete');

    const snapshot = readSnapshot(backup.data_path!);
    expect(snapshot.tables.projects.map((r: any) => r.id)).toEqual(['p-mine']);
    expect(backup.row_counts?.projects).toBe(1);
  });

  it('masque les secrets des intégrations', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('settings', [{ id: tenantId, tenant_id: tenantId, agency_name: 'AAZS', smtp_pass: 'secret-smtp' }]);

    const backup = await createTenantBackup(admin, tenantId, 'manual');
    const snapshot = readSnapshot(backup.data_path!);
    expect(JSON.stringify(snapshot)).not.toContain('secret-smtp');
    expect(snapshot.tables.settings[0].smtp_pass).toBe('[REDACTED]');
    expect(snapshot.tables.settings[0].agency_name).toBe('AAZS');
  });

  it('copie les fichiers une seule fois et rafraîchit ceux déjà copiés', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.putObject('documents', `${tenantId}/plan.pdf`, 'contenu du plan');

    const first = await createTenantBackup(admin, tenantId, 'nightly');
    expect(first.file_count).toBe(1);
    expect(fakeSupabaseAdmin.readObject(BACKUP_BUCKET, `files/${tenantId}/documents/${tenantId}/plan.pdf`)?.toString()).toBe('contenu du plan');

    const second = await createTenantBackup(admin, tenantId, 'nightly');
    expect(second.file_count).toBe(1);
    const pooled = fakeSupabaseAdmin.getTable('tenant_backup_files').filter(f => f.tenant_id === tenantId);
    expect(pooled).toHaveLength(1);
  });

  it("garde les sauvegardes de suspension et de fermeture sans échéance, les autres sur 30 jours", async () => {
    const tenantId = makeTenant();
    const nightly = await createTenantBackup(admin, tenantId, 'nightly');
    const suspension = await createTenantBackup(admin, tenantId, 'suspension');
    const closure = await createTenantBackup(admin, tenantId, 'closure_request');

    expect(nightly.expires_at).toBeTruthy();
    expect(suspension.expires_at).toBeNull();
    expect(closure.expires_at).toBeNull();
  });

  it('refuse un cabinet inconnu', async () => {
    await expect(createTenantBackup(admin, crypto.randomUUID(), 'manual')).rejects.toMatchObject({ status: 404 });
  });

  it("refuse une seconde sauvegarde pendant qu'une est en cours", async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('tenant_backups', [{
      id: crypto.randomUUID(), tenant_id: tenantId, status: 'pending', trigger: 'nightly', created_at: new Date().toISOString(),
    }]);
    await expect(createTenantBackup(admin, tenantId, 'manual')).rejects.toMatchObject({ status: 409 });
  });
});

describe('Restauration', () => {
  it('en aperçu, compte ce qui manque sans rien modifier', async () => {
    const tenantId = makeTenant();
    seedProject(tenantId, 'p-1', 'Villa Martin');
    seedProject(tenantId, 'p-2', 'Médiathèque');
    const backup = await createTenantBackup(admin, tenantId, 'manual');
    deleteProject('p-2');

    const summary = await restoreTenantBackup(admin, tenantId, backup.id, { dryRun: true });
    expect(summary.dry_run).toBe(true);
    expect(summary.rows.find(r => r.table === 'projects')).toMatchObject({ missing: 1, restored: 0 });
    expect(fakeSupabaseAdmin.getTable('projects').some(r => r.id === 'p-2')).toBe(false);
  });

  it("remet les lignes effacées et n'écrase jamais ce qui existe", async () => {
    const tenantId = makeTenant();
    seedProject(tenantId, 'p-keep', 'Nom d\'origine');
    seedProject(tenantId, 'p-gone', 'Effacé par erreur');
    const backup = await createTenantBackup(admin, tenantId, 'manual');

    deleteProject('p-gone');
    // Modifié depuis la sauvegarde : doit rester tel quel.
    fakeSupabaseAdmin.getTable('projects').find(r => r.id === 'p-keep')!.name = 'Nom modifié depuis';

    const summary = await restoreTenantBackup(admin, tenantId, backup.id, { dryRun: false });
    expect(summary.rows.find(r => r.table === 'projects')).toMatchObject({ missing: 1, restored: 1, failed: 0 });
    expect(fakeSupabaseAdmin.getTable('projects').find(r => r.id === 'p-gone')?.name).toBe('Effacé par erreur');
    expect(fakeSupabaseAdmin.getTable('projects').find(r => r.id === 'p-keep')?.name).toBe('Nom modifié depuis');
  });

  it('restaure les fichiers supprimés du stockage vivant', async () => {
    const tenantId = makeTenant();
    const objectPath = `${tenantId}/devis.pdf`;
    fakeSupabaseAdmin.putObject('documents', objectPath, 'devis signé');
    const backup = await createTenantBackup(admin, tenantId, 'manual');

    await admin.storage.from('documents').remove([objectPath]);
    expect(fakeSupabaseAdmin.hasObject('documents', objectPath)).toBe(false);

    const summary = await restoreTenantBackup(admin, tenantId, backup.id, { dryRun: false });
    expect(summary.files).toMatchObject({ missing: 1, restored: 1, failed: 0 });
    expect(fakeSupabaseAdmin.readObject('documents', objectPath)?.toString()).toBe('devis signé');
  });

  it('ne réécrit jamais une valeur masquée', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('settings', [{ id: tenantId, tenant_id: tenantId, agency_name: 'AAZS', smtp_pass: 'secret-smtp' }]);
    const backup = await createTenantBackup(admin, tenantId, 'manual');
    const rows = fakeSupabaseAdmin.getTable('settings');
    rows.splice(rows.findIndex(r => r.tenant_id === tenantId), 1);

    await restoreTenantBackup(admin, tenantId, backup.id, { dryRun: false });
    const restored = fakeSupabaseAdmin.getTable('settings').find(r => r.tenant_id === tenantId);
    expect(restored?.agency_name).toBe('AAZS');
    expect(restored?.smtp_pass).toBeNull();
  });

  it("refuse la sauvegarde d'un autre cabinet", async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    const backupOfA = await createTenantBackup(admin, tenantA, 'manual');

    await expect(restoreTenantBackup(admin, tenantB, backupOfA.id, { dryRun: true })).rejects.toMatchObject({ status: 404 });
  });

  it('refuse une sauvegarde incomplète', async () => {
    const tenantId = makeTenant();
    const failedId = crypto.randomUUID();
    fakeSupabaseAdmin.seed('tenant_backups', [{ id: failedId, tenant_id: tenantId, status: 'failed', trigger: 'manual', data_path: null }]);
    await expect(restoreTenantBackup(admin, tenantId, failedId, { dryRun: true })).rejects.toMatchObject({ status: 409 });
  });
});

describe('Rétention et cycle nocturne', () => {
  it('retire les sauvegardes échues et garde celles sans échéance', async () => {
    const tenantId = makeTenant();
    const kept = await createTenantBackup(admin, tenantId, 'suspension');
    const old = await createTenantBackup(admin, tenantId, 'manual');
    fakeSupabaseAdmin.getTable('tenant_backups').find(b => b.id === old.id)!.expires_at = new Date(Date.now() - 1000).toISOString();

    const pruned = await pruneBackups(admin);
    expect(pruned.snapshots).toBeGreaterThanOrEqual(1);
    expect(fakeSupabaseAdmin.getTable('tenant_backups').some(b => b.id === old.id)).toBe(false);
    expect(fakeSupabaseAdmin.getTable('tenant_backups').some(b => b.id === kept.id)).toBe(true);
    expect(fakeSupabaseAdmin.hasObject(BACKUP_BUCKET, kept.data_path!)).toBe(true);
    expect(fakeSupabaseAdmin.hasObject(BACKUP_BUCKET, old.data_path!)).toBe(false);
  });

  it("retire les fichiers plus revus depuis 30 jours, sauf pour un cabinet à sauvegarde permanente", async () => {
    const free = makeTenant();
    const protectedTenant = makeTenant();
    for (const tenantId of [free, protectedTenant]) {
      fakeSupabaseAdmin.putObject('documents', `${tenantId}/vieux.pdf`, 'ancien');
    }
    await createTenantBackup(admin, free, 'nightly');
    await createTenantBackup(admin, protectedTenant, 'suspension');
    const longAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    fakeSupabaseAdmin.getTable('tenant_backup_files').forEach(f => { f.last_seen_at = longAgo; });

    await pruneBackups(admin);
    expect(fakeSupabaseAdmin.hasObject(BACKUP_BUCKET, `files/${free}/documents/${free}/vieux.pdf`)).toBe(false);
    expect(fakeSupabaseAdmin.hasObject(BACKUP_BUCKET, `files/${protectedTenant}/documents/${protectedTenant}/vieux.pdf`)).toBe(true);
  });

  it("sauvegarde les cabinets en retard, pas les suspendus ni ceux déjà à jour", async () => {
    const due = makeTenant();
    const upToDate = makeTenant();
    const suspended = makeTenant();
    fakeSupabaseAdmin.getTable('tenants').find(t => t.id === suspended)!.suspended_at = new Date().toISOString();
    await createTenantBackup(admin, upToDate, 'nightly');

    await runDueBackups(admin);
    const backedUp = (id: string) => fakeSupabaseAdmin.getTable('tenant_backups').filter(b => b.tenant_id === id && b.status === 'complete');
    expect(backedUp(due)).toHaveLength(1);
    expect(backedUp(upToDate)).toHaveLength(1);
    expect(backedUp(suspended)).toHaveLength(0);
  });
});

describe('Routes superadmin', () => {
  it('sont fermées aux administrateurs de cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const backup = await createTenantBackup(admin, tenantId, 'manual');

    for (const [method, path] of [
      ['get', `/api/admin/tenants/${tenantId}/backups`],
      ['post', `/api/admin/tenants/${tenantId}/backups`],
      ['get', `/api/admin/tenants/${tenantId}/backups/${backup.id}/download`],
      ['post', `/api/admin/tenants/${tenantId}/backups/${backup.id}/restore`],
    ] as const) {
      const res = await (request(app) as any)[method](path).set(authHeader(token));
      expect(res.status).toBe(403);
    }
  });

  it('listent les sauvegardes et lancent une sauvegarde manuelle', async () => {
    const tenantId = makeTenant();
    const superToken = makeSuperAdminToken();

    const started = await request(app).post(`/api/admin/tenants/${tenantId}/backups`).set(authHeader(superToken));
    expect([200, 202]).toContain(started.status);

    const list = await request(app).get(`/api/admin/tenants/${tenantId}/backups`).set(authHeader(superToken));
    expect(list.status).toBe(200);
    expect(list.body.some((b: any) => b.trigger === 'manual')).toBe(true);
  });

  it("renvoie un lien de téléchargement signé", async () => {
    const tenantId = makeTenant();
    const backup = await createTenantBackup(admin, tenantId, 'manual');
    const res = await request(app)
      .get(`/api/admin/tenants/${tenantId}/backups/${backup.id}/download`)
      .set(authHeader(makeSuperAdminToken()));
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('http');
  });

  it("restaure en aperçu par défaut, et pour de bon seulement sur demande explicite", async () => {
    const tenantId = makeTenant();
    seedProject(tenantId, 'p-route', 'Villa');
    const backup = await createTenantBackup(admin, tenantId, 'manual');
    deleteProject('p-route');
    const superToken = makeSuperAdminToken();

    const preview = await request(app)
      .post(`/api/admin/tenants/${tenantId}/backups/${backup.id}/restore`).set(authHeader(superToken)).send({});
    expect(preview.status).toBe(200);
    expect(preview.body.dry_run).toBe(true);
    expect(fakeSupabaseAdmin.getTable('projects').some(r => r.id === 'p-route')).toBe(false);

    const real = await request(app)
      .post(`/api/admin/tenants/${tenantId}/backups/${backup.id}/restore`).set(authHeader(superToken)).send({ dry_run: false });
    expect(real.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('projects').some(r => r.id === 'p-route')).toBe(true);
  });

  it("une suspension déclenche une sauvegarde permanente du cabinet", async () => {
    const tenantId = makeTenant();
    seedProject(tenantId, 'p-susp', 'Villa');

    const res = await request(app)
      .post(`/api/admin/tenants/${tenantId}/suspend`).set(authHeader(makeSuperAdminToken()))
      .send({ reason: 'Accord écrit des associés du 2 octobre' });
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      const row = fakeSupabaseAdmin.getTable('tenant_backups').find(b => b.tenant_id === tenantId && b.trigger === 'suspension');
      expect(row?.status).toBe('complete');
      expect(row?.expires_at).toBeNull();
    });
  });
});

describe('Demande de fermeture par un administrateur', () => {
  it('déclenche une sauvegarde permanente hors de sa portée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    seedProject(tenantId, 'p-close', 'Villa');

    const res = await request(app).post('/api/settings/tenant-deletion').set(authHeader(token));
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      const row = fakeSupabaseAdmin.getTable('tenant_backups').find(b => b.tenant_id === tenantId && b.trigger === 'closure_request');
      expect(row?.status).toBe('complete');
      expect(row?.expires_at).toBeNull();
    });

    // L'administrateur du cabinet ne voit pas cette sauvegarde.
    const asAdmin = await request(app).get(`/api/admin/tenants/${tenantId}/backups`).set(authHeader(token));
    expect(asAdmin.status).toBe(403);
  });
});
