// Dépôt par morceaux d'un client desktop (docs/desktop-sync-contract.md, section 8) :
// ouverture contrôlée, reprise, empreinte, conflits, et surtout la règle de la section 8.4 :
// un fichier CAO n'atteint JAMAIS Supabase Storage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { connectExternalStorage, fakeSupabaseAdmin, getTestApp } from './testServer';
import {
  makeDriveTenant as makeTenant, API, makeActor, seedDocument, seedLockMode, seedProject, sha256, type Actor,
} from './desktopSyncSupport';
import { invalidateConnectionCache } from '../server/externalStorage/externalConnection';
import { memoryDrive } from '../server/externalStorage/memoryProvider';
import { mergeRanges, coversAll, parseContentRange, nextIndice } from '../server/desktop/uploads';

let app: Express;
let tempDir: string;
let supabaseUploads = 0;
const originalFrom = (fakeSupabaseAdmin as any).storage.from;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-desktop-test-'));
  process.env.DESKTOP_UPLOAD_DIR = tempDir;
  app = await getTestApp();
});

afterAll(() => {
  delete process.env.DESKTOP_UPLOAD_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  memoryDrive.reset();
  supabaseUploads = 0;
  // Compte les écritures vers Supabase Storage : c'est ce que la règle CAO doit tenir à zéro.
  (fakeSupabaseAdmin as any).storage.from = (bucket: string) => {
    const handle = originalFrom(bucket);
    const upload = handle.upload;
    handle.upload = async (...args: any[]) => { supabaseUploads += 1; return upload(...args); };
    return handle;
  };
});

afterEach(() => {
  (fakeSupabaseAdmin as any).storage.from = originalFrom;
  delete process.env.DESKTOP_MAX_UPLOAD_MB;
});

const open = (actor: Actor, body: object) => request(app).post(`${API}/uploads`).set(actor.headers).send(body);
const status = (actor: Actor, id: string) => request(app).get(`${API}/uploads/${id}`).set(actor.headers);
const complete = (actor: Actor, id: string, body: object = {}) => request(app).post(`${API}/uploads/${id}/complete`).set(actor.headers).send(body);
const put = (actor: Actor, id: string, data: Buffer, start: number, total: number, rangeOverride?: string) =>
  request(app).put(`${API}/uploads/${id}`).set(actor.headers)
    .set('Content-Type', 'application/octet-stream')
    .set('Content-Range', rangeOverride ?? `bytes ${start}-${start + data.length - 1}/${total}`)
    .send(data);

/** Ouvre, envoie par morceaux de `chunk` octets et termine. */
async function upload(
  actor: Actor,
  options: { name: string; content: string | Buffer; target: object; chunk?: number; extra?: object },
) {
  const data = Buffer.isBuffer(options.content) ? options.content : Buffer.from(options.content);
  const opened = await open(actor, {
    name: options.name, size: data.length, sha256: sha256(data), mimeType: 'application/octet-stream',
    target: options.target, ...options.extra,
  });
  if (opened.status !== 201) return { opened };
  const id = opened.body.uploadId;
  const chunk = options.chunk ?? Math.max(data.length, 1);
  for (let start = 0; start < data.length; start += chunk) {
    const sent = await put(actor, id, data.subarray(start, start + chunk), start, data.length);
    expect(sent.status).toBe(204);
  }
  return { opened, id, completed: await complete(actor, id) };
}

const documentRow = (tenantId: string, id: string) =>
  fakeSupabaseAdmin.getTable('documents').find(d => d.id === id && d.tenant_id === tenantId)!;

describe('Création d\'un fichier ordinaire', () => {
  it('reçoit les morceaux, recompose, contrôle l\'empreinte et crée le document dans le bon dossier', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    const content = Buffer.from('%PDF-1.4 ' + 'x'.repeat(2500));

    const { opened, completed } = await upload(actor, {
      name: 'Note de calcul.pdf', content, chunk: 1000, target: { create: { parentId: 'phase:p1:PRO' } },
    });
    expect(opened.body).toMatchObject({ chunkSize: 8 * 1024 * 1024 });
    expect(completed!.status).toBe(200);
    expect(completed!.body).toMatchObject({ version: 1, etag: 'v1' });
    expect(completed!.body.node).toMatchObject({
      name: 'Note de calcul.pdf', parentId: 'phase:p1:PRO', path: '26014 - Villa Martin/PRO/Note de calcul.pdf',
      version: 1, indice: 'A', size: content.length, sha256: sha256(content),
    });

    const docId = completed!.body.node.id.replace('doc:', '');
    const row = documentRow(tenantId, docId);
    expect(row).toMatchObject({
      project_id: 'p1', resource_type: 'projects', resource_id: 'p1', phase: 'PRO', version: 1, indice: 'A',
      doc_statut: 'en_cours', storage_backend: 'supabase', content_sha256: sha256(content),
    });
    expect(row.size_bytes).toBe(content.length);
    // Version technique tracée, octets réellement déposés.
    expect(fakeSupabaseAdmin.getTable('document_versions').filter(v => v.document_id === docId)).toHaveLength(1);
    expect(supabaseUploads).toBe(1);
    // Plus de fichier temporaire une fois le dépôt terminé.
    expect(fs.readdirSync(path.join(tempDir)).filter(f => f.includes(opened.body.uploadId))).toEqual([]);
  });

  it('dépose dans « À classer » un fichier sans affaire, et pose le document d\'origine d\'une copie de conflit', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const original = seedDocument(tenantId, { id: 'orig', project_id: null, phase: null, name: 'Note.pdf' });

    const inbox = await upload(actor, { name: 'Vrac.pdf', content: '%PDF- vrac', target: { create: { parentId: `inbox:${tenantId}` } } });
    expect(inbox.completed!.status).toBe(200);
    expect(inbox.completed!.body.node).toMatchObject({ parentId: `inbox:${tenantId}`, path: 'À classer/Vrac.pdf' });
    expect(documentRow(tenantId, inbox.completed!.body.node.id.replace('doc:', ''))).toMatchObject({ project_id: null, resource_id: null });

    const conflict = await upload(actor, {
      name: 'Note (conflit Sophie 2026-10-24).pdf', content: '%PDF- version locale',
      target: { create: { parentId: `inbox:${tenantId}`, conflictOf: original.id } },
    });
    expect(conflict.completed!.body.node.conflictOf).toBe('orig');
  });

  it('refuse une cible invalide, une affaire d\'un autre cabinet ou une affaire archivée avant le premier octet', async () => {
    const tenantId = makeTenant();
    const other = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(other, 'p-other');
    seedProject(tenantId, 'p-arch', { archived_at: new Date().toISOString() });
    const base = { name: 'a.pdf', size: 3, sha256: sha256('abc') };

    expect((await open(actor, { ...base, target: {} })).body.code).toBe('INVALID_UPLOAD');
    expect((await open(actor, { ...base, target: { create: { parentId: 'doc:x' } } })).body.code).toBe('INVALID_PARENT');
    expect((await open(actor, { ...base, target: { create: { parentId: 'phase:p-other:APD' } } })).status).toBe(404);
    const archived = await open(actor, { ...base, target: { create: { parentId: 'phase:p-arch:APD' } } });
    expect(archived.status).toBe(409);
    expect(archived.body.code).toBe('PROJECT_ARCHIVED');
    expect((await open(actor, { ...base, target: { create: { parentId: `inbox:${other}` } } })).body.code).toBe('INVALID_PARENT');
    expect((await open(actor, { ...base, target: { create: { parentId: `inbox:${tenantId}`, conflictOf: 'inconnu' } } })).body.code).toBe('INVALID_CONFLICT_OF');
    expect(fakeSupabaseAdmin.getTable('desktop_uploads').filter(u => u.tenant_id === tenantId)).toHaveLength(0);
  });
});

describe('Règle CAO : jamais dans Supabase', () => {
  const dwg = Buffer.from('AC1027 plan d\'architecte');

  it('refuse un fichier CAO quand le cabinet n\'a pas d\'espace de stockage, avant le premier octet', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');

    const res = await open(actor, {
      name: 'Plan RDC.dwg', size: dwg.length, sha256: sha256(dwg), target: { create: { parentId: 'phase:p1:APD' } },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXTERNAL_STORAGE_REQUIRED');
    expect(res.body.error).toMatch(/espace de stockage/);
    // Rien n'a été créé : ni session, ni document, ni octet chez Supabase.
    expect(fakeSupabaseAdmin.getTable('desktop_uploads').filter(u => u.tenant_id === tenantId)).toHaveLength(0);
    expect(fakeSupabaseAdmin.getTable('documents').filter(d => d.tenant_id === tenantId)).toHaveLength(0);
    expect(supabaseUploads).toBe(0);
  });

  it.each(['plan.DWG', 'maison.rvt', 'famille.rfa', 'maquette.ifc', 'vue.skp', 'projet.pln', 'site.dgn', 'forme.3dm', 'chantier.dxf'])(
    'refuse %s sans espace de stockage',
    async (name) => {
      const tenantId = makeTenant();
      const actor = await makeActor(app, tenantId);
      const res = await open(actor, { name, size: 3, sha256: sha256('abc'), target: { create: { parentId: `inbox:${tenantId}` } } });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EXTERNAL_STORAGE_REQUIRED');
    },
  );

  it('dépose le fichier CAO sur l\'espace du cabinet, et n\'écrit rien dans Supabase Storage', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p1');

    const { completed } = await upload(actor, { name: 'Plan RDC.DWG', content: dwg, chunk: 7, target: { create: { parentId: 'phase:p1:APD' } } });
    expect(completed!.status).toBe(200);
    const row = documentRow(tenantId, completed!.body.node.id.replace('doc:', ''));
    expect(row.storage_backend).toBe('external');
    expect(row.file_url.startsWith('archioffice+external://')).toBe(true);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/APD/Plan RDC.DWG']);
    expect(supabaseUploads).toBe(0);
  });

  it('revérifie la règle à la fin : un espace débranché pendant l\'envoi ne fait jamais basculer sur Supabase', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'p1');
    const opened = await open(actor, {
      name: 'Plan.dwg', size: dwg.length, sha256: sha256(dwg), target: { create: { parentId: 'phase:p1:APD' } },
    });
    expect(opened.status).toBe(201);
    await put(actor, opened.body.uploadId, dwg, 0, dwg.length);

    // Le cabinet débranche son espace entre l'ouverture et la fin : le dépôt a pu durer des heures.
    fakeSupabaseAdmin.getTable('external_storage_connections').forEach(c => { if (c.tenant_id === tenantId) c.is_active = false; });
    invalidateConnectionCache(tenantId);

    const res = await complete(actor, opened.body.uploadId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXTERNAL_STORAGE_REQUIRED');
    expect(supabaseUploads).toBe(0);
    expect(fakeSupabaseAdmin.getTable('documents').filter(d => d.tenant_id === tenantId)).toHaveLength(0);
  });

  it('un fichier ordinaire reste accepté sans espace de stockage', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const res = await upload(actor, { name: 'Note.pdf', content: '%PDF- ok', target: { create: { parentId: `inbox:${tenantId}` } } });
    expect(res.completed!.status).toBe(200);
    expect(supabaseUploads).toBe(1);
  });
});

describe('Nouvelle version d\'un document existant', () => {
  it('crée la version suivante sans faire avancer l\'indice de diffusion', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', name: 'Plan.pdf', version: 1, indice: 'A' });

    const res = await upload(actor, { name: 'Plan.pdf', content: '%PDF- v2', target: { documentId: 'd1' }, extra: { baseVersion: 1 } });
    expect(res.completed!.status).toBe(200);
    expect(res.completed!.body.version).toBe(2);
    expect(res.completed!.body.node).toMatchObject({ version: 2, indice: 'A', etag: 'v2' });
    expect(documentRow(tenantId, 'd1')).toMatchObject({ version: 2, indice: 'A', doc_statut: 'en_cours' });
    expect(fakeSupabaseAdmin.getTable('document_versions').filter(v => v.document_id === 'd1' && v.tenant_id === tenantId).map(v => v.version)).toEqual([2]);

    // Un enregistrement automatique de plus : toujours le même indice.
    const again = await upload(actor, { name: 'Plan.pdf', content: '%PDF- v3', target: { documentId: 'd1' }, extra: { baseVersion: 2 } });
    expect(again.completed!.body.node).toMatchObject({ version: 3, indice: 'A' });
  });

  it('ne fait avancer l\'indice que sur demande explicite', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', indice: 'A' });
    const res = await upload(actor, {
      name: 'Plan.pdf', content: '%PDF- diffusé', target: { documentId: 'd1' }, extra: { baseVersion: 1, bumpIndice: true },
    });
    expect(res.completed!.body.node.indice).toBe('B');

    seedDocument(tenantId, { id: 'dz', project_id: 'p1', indice: 'Z', name: 'Fin.pdf' });
    const limit = await open(actor, {
      name: 'Fin.pdf', size: 3, sha256: sha256('abc'), target: { documentId: 'dz' }, baseVersion: 1, bumpIndice: true,
    });
    expect(limit.status).toBe(409);
    expect(limit.body.code).toBe('INDICE_LIMIT');
  });

  it('refuse une version de base périmée en rendant l\'état courant, sans rien perdre', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', version: 4 });
    const stale = await open(actor, { name: 'Plan.pdf', size: 3, sha256: sha256('abc'), target: { documentId: 'd1' }, baseVersion: 3 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 4 });
    expect(stale.body.currentNode).toMatchObject({ id: 'doc:d1', version: 4 });
    expect(documentRow(tenantId, 'd1').version).toBe(4);

    const missing = await open(actor, { name: 'Plan.pdf', size: 3, sha256: sha256('abc'), target: { documentId: 'd1' } });
    expect(missing.body.code).toBe('BASE_VERSION_REQUIRED');
  });

  it('détecte à la fin du dépôt une modification arrivée pendant l\'envoi', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', version: 1 });
    const data = Buffer.from('%PDF- long');
    const opened = await open(actor, { name: 'Plan.pdf', size: data.length, sha256: sha256(data), target: { documentId: 'd1' }, baseVersion: 1 });
    await put(actor, opened.body.uploadId, data, 0, data.length);

    // Quelqu'un d'autre dépose la version 2 pendant ce temps.
    documentRow(tenantId, 'd1').version = 2;

    const res = await complete(actor, opened.body.uploadId);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
    expect(documentRow(tenantId, 'd1').version).toBe(2);
    expect(fakeSupabaseAdmin.getTable('document_versions').filter(v => v.document_id === 'd1' && v.tenant_id === tenantId)).toHaveLength(0);
  });

  it('refuse un document approuvé, une affaire archivée et, en mode obligatoire, le verrou d\'un autre', async () => {
    const tenantId = makeTenant();
    seedLockMode(tenantId, 'enforced');
    const actor = await makeActor(app, tenantId, 'user');
    const colleague = await makeActor(app, tenantId, 'user');
    seedProject(tenantId, 'p1');
    seedProject(tenantId, 'arch', { archived_at: new Date().toISOString() });
    seedDocument(tenantId, { id: 'appr', project_id: 'p1', doc_statut: 'approuve' });
    seedDocument(tenantId, { id: 'old', project_id: 'arch' });
    seedDocument(tenantId, { id: 'locked', project_id: 'p1' });
    fakeSupabaseAdmin.seed('document_locks', [{
      document_id: 'locked', tenant_id: tenantId, user_id: colleague.userId, user_name: 'Sophie',
      locked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }]);
    const body = (id: string) => ({ name: 'Plan.pdf', size: 3, sha256: sha256('abc'), target: { documentId: id }, baseVersion: 1 });

    expect((await open(actor, body('appr'))).body.code).toBe('DOCUMENT_APPROVED');
    expect((await open(actor, body('old'))).body.code).toBe('PROJECT_ARCHIVED');
    const locked = await open(actor, body('locked'));
    expect(locked.status).toBe(423);
    expect(locked.body).toMatchObject({ code: 'LOCKED', lock: { mine: false } });
    // Son propre verrou ne la bloque pas.
    expect((await open(colleague, body('locked'))).status).toBe(201);
  });

  it('ne fait que signaler le verrou d\'un autre en mode indicatif', async () => {
    const tenantId = makeTenant();
    seedLockMode(tenantId, 'advisory');
    const actor = await makeActor(app, tenantId, 'user');
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'locked', project_id: 'p1' });
    fakeSupabaseAdmin.seed('document_locks', [{
      document_id: 'locked', tenant_id: tenantId, user_id: 'someone-else', user_name: 'Sophie',
      locked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }]);
    const res = await open(actor, { name: 'Plan.pdf', size: 3, sha256: sha256('abc'), target: { documentId: 'locked' }, baseVersion: 1 });
    expect(res.status).toBe(201);
  });
});

describe('Contrôles du fichier', () => {
  it('refuse un type dangereux, un nom temporaire et une taille démesurée à l\'ouverture', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const target = { create: { parentId: `inbox:${tenantId}` } };
    const ok = { size: 3, sha256: sha256('abc'), target };

    for (const name of ['setup.exe', 'page.html', 'icone.svg', 'run.ps1']) {
      expect((await open(actor, { ...ok, name })).body.code, name).toBe('FILE_TYPE_REFUSED');
    }
    for (const name of ['~$Plan.docx', 'Thumbs.db', '.DS_Store', 'plan.tmp', 'plan.dwl']) {
      expect((await open(actor, { ...ok, name })).body.code, name).toBe('NAME_IGNORED');
    }
    expect((await open(actor, { ...ok, name: '' })).body.code).toBe('INVALID_UPLOAD');
    expect((await open(actor, { ...ok, name: 'a.pdf', size: -1 })).body.code).toBe('INVALID_UPLOAD');
    expect((await open(actor, { ...ok, name: 'a.pdf', sha256: 'pas-une-empreinte' })).body.code).toBe('INVALID_UPLOAD');

    process.env.DESKTOP_MAX_UPLOAD_MB = '1';
    const tooBig = await open(actor, { ...ok, name: 'gros.pdf', size: 2 * 1024 * 1024 });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.code).toBe('FILE_TOO_LARGE');
  });

  it('refuse à la fin un contenu actif déguisé sous un nom inoffensif', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const res = await upload(actor, {
      name: 'note.txt', content: '<html><script>alert(1)</script></html>', target: { create: { parentId: `inbox:${tenantId}` } },
    });
    expect(res.completed!.status).toBe(400);
    expect(res.completed!.body.code).toBe('FILE_TYPE_REFUSED');
    expect(fakeSupabaseAdmin.getTable('documents').filter(d => d.tenant_id === tenantId)).toHaveLength(0);
    expect(supabaseUploads).toBe(0);
  });

  it('refuse un fichier dont l\'empreinte ne correspond pas à l\'annonce', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const opened = await open(actor, { name: 'a.pdf', size: 5, sha256: sha256('autre'), target: { create: { parentId: `inbox:${tenantId}` } } });
    await put(actor, opened.body.uploadId, Buffer.from('12345'), 0, 5);
    const res = await complete(actor, opened.body.uploadId);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CHECKSUM_MISMATCH');
    expect(supabaseUploads).toBe(0);

    const mismatchBody = await open(actor, { name: 'b.pdf', size: 5, sha256: sha256('12345'), target: { create: { parentId: `inbox:${tenantId}` } } });
    await put(actor, mismatchBody.body.uploadId, Buffer.from('12345'), 0, 5);
    expect((await complete(actor, mismatchBody.body.uploadId, { sha256: sha256('autre') })).body.code).toBe('CHECKSUM_MISMATCH');
  });

  it('accepte un fichier vide', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const res = await upload(actor, { name: 'vide.txt', content: '', target: { create: { parentId: `inbox:${tenantId}` } } });
    expect(res.completed!.status).toBe(200);
    expect(res.completed!.body.node.size).toBe(0);
  });
});

describe('Reprise et morceaux', () => {
  it('rend ce qui est reçu pour reprendre après une coupure, puis refuse de terminer un dépôt incomplet', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const data = Buffer.from('0123456789');
    const opened = await open(actor, { name: 'a.pdf', size: 10, sha256: sha256(data), target: { create: { parentId: `inbox:${tenantId}` } } });
    const id = opened.body.uploadId;

    expect((await put(actor, id, data.subarray(0, 4), 0, 10)).status).toBe(204);
    expect((await put(actor, id, data.subarray(7, 10), 7, 10)).status).toBe(204);
    const partial = await status(actor, id);
    expect(partial.body).toMatchObject({ size: 10, completed: false, received: [[0, 3], [7, 9]] });

    const incomplete = await complete(actor, id);
    expect(incomplete.status).toBe(409);
    expect(incomplete.body).toMatchObject({ code: 'UPLOAD_INCOMPLETE', received: [[0, 3], [7, 9]] });

    // Un morceau renvoyé deux fois et un morceau qui se chevauche ne cassent rien.
    expect((await put(actor, id, data.subarray(0, 4), 0, 10)).status).toBe(204);
    expect((await put(actor, id, data.subarray(3, 8), 3, 10)).status).toBe(204);
    expect((await status(actor, id)).body.received).toEqual([[0, 9]]);
    expect((await complete(actor, id)).status).toBe(200);
  });

  it('refuse un Content-Range invalide, incohérent ou un morceau trop grand', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const opened = await open(actor, { name: 'a.pdf', size: 10, sha256: sha256('0123456789'), target: { create: { parentId: `inbox:${tenantId}` } } });
    const id = opened.body.uploadId;
    const four = Buffer.from('0123');

    for (const range of ['octets 0-3/10', 'bytes 0-3/9', 'bytes 3-1/10', 'bytes 0-10/10', 'bytes 0-3', 'bytes -1-3/10']) {
      const res = await put(actor, id, four, 0, 10, range);
      expect(res.status, range).toBe(400);
      expect(res.body.code, range).toBe('INVALID_RANGE');
    }
    // La taille annoncée par l'en-tête doit être celle du corps.
    expect((await put(actor, id, Buffer.from('01'), 0, 10, 'bytes 0-3/10')).body.code).toBe('INVALID_RANGE');
  });

  it('un dépôt terminé est idempotent : le client qui a perdu la réponse la redemande sans créer de version', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', version: 1 });
    const first = await upload(actor, { name: 'Plan.pdf', content: '%PDF- idem', target: { documentId: 'd1' }, extra: { baseVersion: 1 } });
    expect(first.completed!.status).toBe(200);

    const replay = await complete(actor, first.id!);
    expect(replay.status).toBe(200);
    expect(replay.body.node.id).toBe('doc:d1');
    expect(replay.body.version).toBe(2);
    expect(documentRow(tenantId, 'd1').version).toBe(2);
    // Ni octet de plus, ni morceau accepté après la fin.
    expect(supabaseUploads).toBe(1);
    expect((await put(actor, first.id!, Buffer.from('x'), 0, 10)).status).toBe(409);
  });

  it('refuse une session expirée', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const opened = await open(actor, { name: 'a.pdf', size: 3, sha256: sha256('abc'), target: { create: { parentId: `inbox:${tenantId}` } } });
    const row = fakeSupabaseAdmin.getTable('desktop_uploads').find(u => u.id === opened.body.uploadId)!;
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    const chunk = await put(actor, opened.body.uploadId, Buffer.from('abc'), 0, 3);
    expect(chunk.status).toBe(410);
    expect(chunk.body.code).toBe('UPLOAD_EXPIRED');
    expect((await complete(actor, opened.body.uploadId)).body.code).toBe('UPLOAD_EXPIRED');
  });

  it('une session n\'appartient qu\'à la personne qui l\'a ouverte, dans son cabinet', async () => {
    const tenantId = makeTenant();
    const owner = await makeActor(app, tenantId, 'user');
    const colleague = await makeActor(app, tenantId, 'user');
    const outsider = await makeActor(app, makeTenant(), 'admin');
    const opened = await open(owner, { name: 'a.pdf', size: 3, sha256: sha256('abc'), target: { create: { parentId: `inbox:${tenantId}` } } });
    const id = opened.body.uploadId;

    for (const stranger of [colleague, outsider]) {
      expect((await status(stranger, id)).status).toBe(404);
      expect((await put(stranger, id, Buffer.from('abc'), 0, 3)).status).toBe(404);
      expect((await complete(stranger, id)).status).toBe(404);
    }
    expect((await status(owner, id)).status).toBe(200);
  });

  it('refuse un identifiant de session qui n\'a pas la forme attendue (aucun accès au disque)', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    for (const id of ['..%2F..%2Fetc%2Fpasswd', 'up_zz', 'x']) {
      const res = await status(actor, id);
      expect(res.status, id).toBe(404);
    }
  });
});

describe('Fonctions pures du dépôt', () => {
  it('fusionne les intervalles et dit si le fichier est couvert', () => {
    expect(mergeRanges([[5, 9], [0, 2], [3, 4]])).toEqual([[0, 9]]);
    expect(mergeRanges([[0, 2], [4, 6]])).toEqual([[0, 2], [4, 6]]);
    expect(mergeRanges([[0, 5], [2, 3]])).toEqual([[0, 5]]);
    expect(coversAll([[0, 9]], 10)).toBe(true);
    expect(coversAll([[0, 8]], 10)).toBe(false);
    expect(coversAll([[1, 9]], 10)).toBe(false);
    expect(coversAll([], 0)).toBe(true);
  });

  it('lit un Content-Range et refuse le reste', () => {
    expect(parseContentRange('bytes 0-3/10')).toEqual({ start: 0, end: 3, total: 10 });
    expect(parseContentRange('bytes 0-3/*')).toBeNull();
    expect(parseContentRange(undefined)).toBeNull();
    expect(parseContentRange('bytes 0-3/10 ')).toEqual({ start: 0, end: 3, total: 10 });
  });

  it('avance l\'indice d\'une lettre et s\'arrête à Z', () => {
    expect(nextIndice('A')).toBe('B');
    expect(nextIndice('b')).toBe('C');
    expect(nextIndice(null)).toBe('B');
    expect(nextIndice('Z')).toBeNull();
    expect(nextIndice('AA')).toBeNull();
  });
});
