// Arborescence lisible du client Electron, de bout en bout : la vraie passerelle de
// stockage hors ligne, le vrai client supabase-js et la vraie storeBusinessFile.
//
// Ce qui est vérifié ici ne l'est nulle part ailleurs : l'encodage des espaces dans
// l'URL publique, la suppression d'un fichier à nom lisible, et surtout l'absence
// d'écrasement quand deux fichiers portent le même nom dans la même phase.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createBusinessFileStore } from '../server/externalStorage/storeBusinessFile';
import { objectPathFromRef, parseStorageRef } from '../server/storagePaths';

const SECRET = 'test-service-role-secret';
const TENANT = '3f1c2a9e-8b7d-4c5e-9a10-1234567890ab';
const FOLDERS = ['26014 - Villa Martin', 'DCE'];

let dataDir: string;
let storageRoot: string;
let server: http.Server;
let baseUrl: string;
let admin: SupabaseClient;
let store: ReturnType<typeof createBusinessFileStore>;
const previousEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string) {
  previousEnv[key] = process.env[key];
  process.env[key] = value;
}

/** Même logique que uploadToStorage / deleteFromStorage de server.ts. */
async function uploadToStorage(bucket: string, storagePath: string, buffer: Buffer, mimetype: string) {
  const { error } = await admin.storage.from(bucket).upload(storagePath, buffer, { contentType: mimetype, upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return admin.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
}
async function deleteFromStorage(bucket: string, fileUrl: string) {
  await admin.storage.from(bucket).remove([objectPathFromRef(bucket, fileUrl)]).catch(() => {});
}

function put(fileName: string, content: string, folderPath = FOLDERS, bucket: 'documents' | 'plans' = 'documents') {
  return store.storeBusinessFile({
    tenantId: TENANT,
    bucket,
    folderPath,
    fileName,
    supabasePath: `${TENANT}/ignored/${fileName}`,
  }, Buffer.from(content), 'application/pdf');
}

const onDisk = (...segments: string[]) => path.join(storageRoot, 'documents', ...segments);

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-tree-data-'));
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-tree-storage-'));
  setEnv('OFFLINE_DATA_DIR', dataDir);
  setEnv('OFFLINE_STORAGE_DIR', storageRoot);
  setEnv('OFFLINE_MODE', 'true');

  const { createOfflineGateway } = await import('../server/offlineGateway');
  const app = express();
  app.use(createOfflineGateway({ postgrestUrl: 'http://127.0.0.1:1', serviceRoleKey: SECRET }));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  admin = createClient(baseUrl, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const bucket of ['documents', 'plans']) {
    await fetch(`${baseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket }),
    });
  }

  store = createBusinessFileStore({
    // Hors ligne, aucune lecture de connexion externe : la base n'est jamais interrogée.
    supabaseAdmin: {} as any,
    uploadToStorage,
    deleteFromStorage,
    checkStorageQuota: async () => {},
  });
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(storageRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('stockage hors ligne : arborescence lisible', () => {
  it('range le fichier sous cabinet / affaire / phase, avec son vrai nom', async () => {
    const stored = await put('CCTP lot 02.pdf', 'contenu-un');

    expect(stored.storageBackend).toBe('supabase');
    expect(stored.fileUrl).toContain('/object/public/documents/');
    expect(fs.readFileSync(onDisk(TENANT, '26014 - Villa Martin', 'DCE', 'CCTP lot 02.pdf'), 'utf8')).toBe('contenu-un');
    // La référence décodée est bien le chemin réel, pas sa forme encodée.
    expect(parseStorageRef(stored.fileUrl)?.path).toBe(`${TENANT}/26014 - Villa Martin/DCE/CCTP lot 02.pdf`);
  });

  it('sert le fichier par son URL publique, malgré les espaces encodés', async () => {
    const stored = await put('Notice acoustique.pdf', 'octets-notice');
    const res = await fetch(stored.fileUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('octets-notice');
  });

  it('numérote un second fichier de même nom au lieu d\'écraser le premier', async () => {
    const first = await put('Plan RDC.pdf', 'premier');
    const second = await put('Plan RDC.pdf', 'second');
    const third = await put('Plan RDC.pdf', 'troisieme');

    expect(parseStorageRef(first.fileUrl)?.path.endsWith('/Plan RDC.pdf')).toBe(true);
    expect(parseStorageRef(second.fileUrl)?.path.endsWith('/Plan RDC (2).pdf')).toBe(true);
    expect(parseStorageRef(third.fileUrl)?.path.endsWith('/Plan RDC (3).pdf')).toBe(true);
    // Le point essentiel : le premier est intact.
    expect(fs.readFileSync(onDisk(TENANT, '26014 - Villa Martin', 'DCE', 'Plan RDC.pdf'), 'utf8')).toBe('premier');
    expect(fs.readFileSync(onDisk(TENANT, '26014 - Villa Martin', 'DCE', 'Plan RDC (2).pdf'), 'utf8')).toBe('second');
  });

  it('ne perd aucun fichier quand plusieurs dépôts de même nom arrivent en même temps', async () => {
    const folder = ['26015 - Concurrence', 'PRO'];
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => put('Note.pdf', `contenu-${i}`, folder)),
    );
    const paths = results.map((r) => parseStorageRef(r.fileUrl)!.path);
    expect(new Set(paths).size).toBe(8);

    const contents = paths.map((p) => fs.readFileSync(path.join(storageRoot, 'documents', ...p.split('/')), 'utf8'));
    expect(contents.sort()).toEqual(Array.from({ length: 8 }, (_, i) => `contenu-${i}`).sort());
  });

  it('plie les accents d\'un nom d\'affaire sans perdre le fichier', async () => {
    const stored = await put('Étude thermique n°2.pdf', 'thermique', ['26016 - Réhabilitation « Château »', 'Général']);
    const rel = parseStorageRef(stored.fileUrl)!.path;
    expect(rel).toBe(`${TENANT}/26016 - Rehabilitation Chateau/General/Etude thermique n 2.pdf`);
    expect(fs.existsSync(path.join(storageRoot, 'documents', ...rel.split('/')))).toBe(true);
  });

  it('supprime réellement le fichier d\'un nom lisible', async () => {
    const stored = await put('A supprimer.pdf', 'temporaire', ['26017 - Suppression', 'DCE']);
    const rel = parseStorageRef(stored.fileUrl)!.path;
    const target = path.join(storageRoot, 'documents', ...rel.split('/'));
    expect(fs.existsSync(target)).toBe(true);

    await store.removeBusinessFile(TENANT, 'documents', stored.fileUrl);

    expect(fs.existsSync(target)).toBe(false);
  });

  it('range aussi les plans dans leur bucket', async () => {
    const stored = await put('Façade nord.pdf', 'plan', ['26014 - Villa Martin', 'Plans'], 'plans');
    expect(stored.fileUrl).toContain('/object/public/plans/');
    expect(fs.existsSync(path.join(storageRoot, 'plans', TENANT, '26014 - Villa Martin', 'Plans', 'Facade nord.pdf'))).toBe(true);
  });
});

describe('passerelle : x-upsert', () => {
  const url = () => `${baseUrl}/storage/v1/object/documents/${TENANT}/upsert/test.txt`;
  const write = (headers: Record<string, string>, body: string) => fetch(url(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'text/plain', ...headers },
    body,
  });

  it('refuse d\'écraser avec x-upsert: false (409) et garde l\'original', async () => {
    expect((await write({ 'x-upsert': 'false' }, 'original')).status).toBe(200);
    expect((await write({ 'x-upsert': 'false' }, 'remplace')).status).toBe(409);
    expect(fs.readFileSync(onDisk(TENANT, 'upsert', 'test.txt'), 'utf8')).toBe('original');
  });

  it('écrase avec x-upsert: true, et sans en-tête (comportement historique)', async () => {
    expect((await write({ 'x-upsert': 'true' }, 'deux')).status).toBe(200);
    expect(fs.readFileSync(onDisk(TENANT, 'upsert', 'test.txt'), 'utf8')).toBe('deux');
    expect((await write({}, 'trois')).status).toBe(200);
    expect(fs.readFileSync(onDisk(TENANT, 'upsert', 'test.txt'), 'utf8')).toBe('trois');
  });
});

describe('objectPathFromRef', () => {
  it('décode une URL encodée et laisse un chemin nu inchangé', () => {
    expect(objectPathFromRef('documents', 'http://h/storage/v1/object/public/documents/a%20b/c%20(2).pdf')).toBe('a b/c (2).pdf');
    expect(objectPathFromRef('documents', 'a b/c.pdf')).toBe('a b/c.pdf');
  });

  it('ne plante pas sur un « % » littéral', () => {
    expect(objectPathFromRef('documents', 'http://h/storage/v1/object/public/documents/100%.pdf')).toBe('100%.pdf');
  });
});
