// Les effets de bord du stockage externe : ce que l'export RGPD doit inclure,
// et ce que la fermeture d'un cabinet ne doit surtout pas supprimer.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage,
} from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

beforeEach(() => {
  memoryDrive.reset();
});

describe('export RGPD', () => {
  // Sans cette passe, l'export ne parcourrait que les buckets Supabase et les
  // fichiers déposés chez le cabinet en seraient silencieusement absents, alors
  // que l'archive se présente comme complète. Un export à motif légal ne peut
  // pas mentir par omission.
  it('inclut les fichiers hébergés sur l’espace du cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    connectExternalStorage(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'e1', tenant_id: tenantId, project_code: '26014', name: 'Villa Martin' }]);
    await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'e1').field('name', 'CCTP').field('category', 'CCTP').field('phase', 'DCE')
      .attach('file', Buffer.from('contenu'), 'cctp.pdf');

    const res = await request(app).get('/api/settings/tenant-export').set(authHeader(token)).buffer().parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    const zip = (res.body as Buffer).toString('latin1');
    // Les noms d'entrée d'un ZIP sont en clair dans l'archive, même compressée.
    expect(zip).toContain('fichiers/externe/documents/');
    expect(zip).toContain('manifest.json');
  });

  // Un ZIP d'export est facile à transmettre ou à stocker sans précaution : il
  // ne doit jamais contenir de quoi accéder au Drive du cabinet.
  it('masque les jetons de la connexion de stockage', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('external_storage_connections', [{
      id: `conn-secret-${tenantId}`, tenant_id: tenantId, provider: 'webdav',
      root_folder_path: 'ArchiOffice', is_active: true, status: 'ok',
      password_encrypted: 'SECRET-A-NE-PAS-EXPORTER',
      refresh_token: 'JETON-A-NE-PAS-EXPORTER',
    }]);

    const res = await request(app).get('/api/settings/tenant-export').set(authHeader(token)).buffer().parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const zip = (res.body as Buffer).toString('latin1');
    expect(zip).not.toContain('SECRET-A-NE-PAS-EXPORTER');
    expect(zip).not.toContain('JETON-A-NE-PAS-EXPORTER');
  });
});

describe('fermeture de cabinet', () => {
  // Ces fichiers vivent sur un compte qui appartient au cabinet. Les détruire
  // reviendrait à anéantir son bien hors de notre système, alors que
  // l'effacement RGPD porte sur les données que NOUS détenons.
  it('ne supprime jamais les fichiers déposés sur l’espace du cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    connectExternalStorage(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId, project_code: '26014', name: 'Villa Martin' }]);
    await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'p1').field('name', 'CCTP').field('category', 'CCTP').field('phase', 'DCE')
      .attach('file', Buffer.from('contenu'), 'cctp.pdf');
    expect(memoryDrive.livePaths()).toHaveLength(1);

    // On passe par le vrai point d'entrée du traitement de fond, en datant la
    // demande de fermeture au-delà du délai de grâce de 30 jours.
    const tenantRow = fakeSupabaseAdmin.getTable('tenants').find((t) => t.id === tenantId);
    tenantRow!.deletion_requested_at = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    const { purgeExpiredTenants } = await import('../server/tenantPurge');
    await purgeExpiredTenants(fakeSupabaseAdmin as any);

    expect(memoryDrive.deleteCalls).toBe(0);
    expect(memoryDrive.livePaths()).toHaveLength(1);
  });
});
