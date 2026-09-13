// Le dépôt d'un document, d'un plan ou d'un visa quand le cabinet a branché son
// propre espace de stockage — server/externalStorage/storeBusinessFile.ts, câblé
// dans server/routes/{documents,plans,visas}.ts.
//
// fakeSupabaseAdmin n'émule aucun drive : le fournisseur en mémoire
// (server/externalStorage/memoryProvider.ts) tient ce rôle, et compte ses
// appels pour qu'on puisse vérifier le cache d'arborescence.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage,
} from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';
import { parseExternalRef } from '../server/externalStorage/externalRef';
import { ExternalFolderMissingError } from '../server/externalStorage/provider';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

beforeEach(() => {
  memoryDrive.reset();
});

function seedProject(tenantId: string, id: string, overrides: Record<string, any> = {}) {
  fakeSupabaseAdmin.seed('projects', [{
    id, tenant_id: tenantId, project_code: '26014', name: 'Villa Martin', ...overrides,
  }]);
  return id;
}

async function uploadDocument(token: string, projectId: string | null, phase: string, filename = 'cctp.pdf') {
  const req = request(app).post('/api/documents').set(authHeader(token))
    .field('name', 'CCTP Lot 01').field('category', 'CCTP').field('phase', phase);
  if (projectId) req.field('project_id', projectId);
  return req.attach('file', Buffer.from('%PDF-fake'), filename);
}

describe('POST /api/documents — sans espace de stockage branché', () => {
  // Garde-fou de non-régression : le comportement par défaut, celui de tous les
  // cabinets aujourd'hui, ne doit pas bouger d'un caractère.
  it('continue d’écrire dans Supabase Storage', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p1');

    const res = await uploadDocument(token, 'p1', 'DCE');
    expect(res.status).toBe(201);

    const doc = fakeSupabaseAdmin.getTable('documents').find((d) => d.id === res.body.id);
    expect(doc?.file_url).toContain('/object/public/documents/');
    expect(doc?.storage_backend).toBe('supabase');
    expect(memoryDrive.uploadCalls).toBe(0);
  });
});

describe('POST /api/documents — avec espace de stockage branché', () => {
  it('dépose le fichier chez le cabinet, sous affaire puis phase', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p2');

    const res = await uploadDocument(token, 'p2', 'DCE');
    expect(res.status).toBe(201);

    const doc = fakeSupabaseAdmin.getTable('documents').find((d) => d.id === res.body.id);
    expect(doc?.file_url.startsWith('archioffice+external://')).toBe(true);
    expect(doc?.storage_backend).toBe('external');
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/DCE/cctp.pdf']);
  });

  it('marque aussi la version, qui porte le quota', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p3');

    const res = await uploadDocument(token, 'p3', 'APD');
    const version = fakeSupabaseAdmin.getTable('document_versions').find((v) => v.document_id === res.body.id);
    expect(version?.storage_backend).toBe('external');
    expect(version?.size_bytes).toBe(Buffer.from('%PDF-fake').length);
  });

  it('conserve les accents du nom d’affaire dans le dossier', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p4', { project_code: '26020', name: 'Réhabilitation Château' });

    await uploadDocument(token, 'p4', 'PRO');
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26020 - Réhabilitation Château/PRO/cctp.pdf']);
  });

  it('range un document sans affaire sous « Général »', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);

    const res = await uploadDocument(token, null, 'ESQ');
    expect(res.status).toBe(201);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/Général/ESQ/cctp.pdf']);
  });

  it('range un document sans phase sous « Général » dans son affaire', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p5');

    await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'p5').field('name', 'Note').field('category', 'Autre')
      .attach('file', Buffer.from('%PDF-fake'), 'note.pdf');
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/Général/note.pdf']);
  });

  it('respecte la racine choisie par le cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId, { root_folder_path: 'Agence AAZS' });
    seedProject(tenantId, 'p6');

    await uploadDocument(token, 'p6', 'DCE');
    expect(memoryDrive.livePaths()).toEqual(['Agence AAZS/26014 - Villa Martin/DCE/cctp.pdf']);
  });

  // Le choix explicite de storeBusinessFile : pas de repli silencieux sur
  // Supabase, qui remplirait le quota que le cabinet cherche justement à éviter
  // et laisserait deux fichiers de la même affaire à deux endroits.
  it('échoue franchement plutôt que de se rabattre sur Supabase', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p7');
    memoryDrive.failNextUploadWith(new Error('drive injoignable'));
    // La reprise sur cache périmé ne joue pas ici : l'erreur n'est pas un
    // dossier manquant. Un seul essai, un seul échec.
    const res = await uploadDocument(token, 'p7', 'DCE');

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("l'espace de stockage du cabinet");
    expect(fakeSupabaseAdmin.getTable('documents').filter((d) => d.tenant_id === tenantId)).toHaveLength(0);
  });

  it('note l’échec sur la connexion, pour que les Réglages puissent le dire', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const connectionId = connectExternalStorage(tenantId);
    seedProject(tenantId, 'p8');
    memoryDrive.failNextUploadWith(new Error('jeton révoqué'));
    await uploadDocument(token, 'p8', 'DCE');

    const conn = fakeSupabaseAdmin.getTable('external_storage_connections').find((c) => c.id === connectionId);
    expect(conn?.status).toBe('error');
    expect(conn?.last_error).toContain('jeton révoqué');
  });
});

describe('cache d’arborescence', () => {
  it('ne recrée aucun dossier au second dépôt dans la même phase', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p9');

    await uploadDocument(token, 'p9', 'DCE', 'un.pdf');
    memoryDrive.resetCounters();
    await uploadDocument(token, 'p9', 'DCE', 'deux.pdf');

    expect(memoryDrive.createCalls).toBe(0);
    expect(memoryDrive.findCalls).toBe(0);
    expect(memoryDrive.uploadCalls).toBe(1);
    expect(memoryDrive.livePaths()).toEqual([
      'ArchiOffice/26014 - Villa Martin/DCE/deux.pdf',
      'ArchiOffice/26014 - Villa Martin/DCE/un.pdf',
    ]);
  });

  it('mémorise un dossier par niveau, racine comprise', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const connectionId = connectExternalStorage(tenantId);
    seedProject(tenantId, 'p10');

    await uploadDocument(token, 'p10', 'DCE');
    const keys = fakeSupabaseAdmin.getTable('external_storage_folders')
      .filter((f) => f.connection_id === connectionId).map((f) => f.folder_key).sort();
    expect(keys).toEqual([
      'ArchiOffice',
      'ArchiOffice/26014 - Villa Martin',
      'ArchiOffice/26014 - Villa Martin/DCE',
    ]);
  });

  it('oublie le sous-arbre et rejoue une fois quand le dossier a disparu du drive', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p11');

    await uploadDocument(token, 'p11', 'DCE', 'un.pdf');
    // Quelqu'un a renommé ou mis à la corbeille le dossier depuis son drive :
    // l'identifiant mémorisé ne vaut plus rien.
    memoryDrive.failNextUploadWith(new ExternalFolderMissingError());
    const res = await uploadDocument(token, 'p11', 'DCE', 'deux.pdf');

    expect(res.status).toBe(201);
    expect(memoryDrive.livePaths()).toContain('ArchiOffice/26014 - Villa Martin/DCE/deux.pdf');
  });
});

describe('plans et visas', () => {
  it('dépose un plan dans le sous-dossier « Plans » de son affaire', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p12');

    const res = await request(app).post('/api/plans').set(authHeader(token))
      .field('project_id', 'p12').field('name', 'Plan de masse')
      .attach('file', Buffer.from('%PDF-fake'), 'masse.pdf');

    expect(res.status).toBe(200);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/Plans/masse.pdf']);
    const plan = fakeSupabaseAdmin.getTable('plans').find((p) => p.id === res.body.id);
    expect(plan?.storage_backend).toBe('external');
  });

  it('dépose un visa dans le sous-dossier « VISA » de son affaire', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p13');

    const res = await request(app).post('/api/visas').set(authHeader(token))
      .field('project_id', 'p13').field('title', 'Visa béton').field('date', '2026-09-01')
      .attach('file', Buffer.from('%PDF-fake'), 'visa.pdf');

    expect(res.status).toBe(200);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/VISA/visa.pdf']);
  });
});

describe('DELETE /api/documents/:id', () => {
  // Non-régression de la garde `includes('/object/public/documents/')`, qui
  // rendait faux sur une référence externe et laissait le fichier orphelin.
  it('supprime aussi bien la version restée chez nous que celle déposée chez le cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    seedProject(tenantId, 'p14');

    // Version 1 sur Supabase, avant que le cabinet ne branche son espace.
    const created = await uploadDocument(token, 'p14', 'DCE', 'v1.pdf');
    expect(fakeSupabaseAdmin.getTable('documents').find((d) => d.id === created.body.id)?.storage_backend).toBe('supabase');

    // Version 2 après branchement.
    connectExternalStorage(tenantId);
    await request(app).put(`/api/documents/${created.body.id}`).set(authHeader(token))
      .field('name', 'CCTP Lot 01').field('category', 'CCTP')
      .attach('file', Buffer.from('%PDF-v2'), 'v2.pdf');
    const externalVersion = fakeSupabaseAdmin.getTable('document_versions')
      .find((v) => v.document_id === created.body.id && v.version === 2);
    expect(externalVersion?.storage_backend).toBe('external');
    const externalId = parseExternalRef(externalVersion!.file_url)!.externalId;
    expect(memoryDrive.livePaths()).toContain('ArchiOffice/26014 - Villa Martin/DCE/v2.pdf');

    const res = await request(app).delete(`/api/documents/${created.body.id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    // La suppression chez le fournisseur est en meilleur effort, donc détachée.
    await new Promise((resolve) => setImmediate(resolve));
    expect(memoryDrive.files.get(externalId)?.trashed).toBe(true);
  });
});
