// Nomic comme moteur de lecture des documents et de génération du CCTP :
// protocole du client (dépôt → tâche → statut → résultat), bascule du moteur
// depuis /admin (refus sans clé), repli sur le moteur local quand Nomic
// échoue, et la route « Générer le CCTP » (pièces d'une autre affaire
// écartées, proposition normalisée, aucun enregistrement).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import {
  extractDocumentText, invalidateDocumentParserCache, nomicParseResultToText,
} from '@zinkh/archioffice-agents/server';
import { normalizeGeneratedCctp } from '../server/routes/cctpGeneration';

let app: Express;
const SUPER_ADMIN_EMAIL = 'doc-parser-admin@archioffice.test';
const savedKey = process.env.NOMIC_API_KEY;
const realFetch = globalThis.fetch;

function superAdminToken(): string {
  const token = `super-admin-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fakeSupabaseAdmin.registerUser(token, { id: crypto.randomUUID(), email: SUPER_ADMIN_EMAIL });
  return token;
}

/** Simule l'API Nomic ; `onTask` choisit le JSON rendu par result_url. */
function mockNomic(result: unknown, calls: string[] = []) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (!url.includes('nomic') && !url.includes('s3.test')) return realFetch(input, init);
    calls.push(`${init?.method || 'GET'} ${new URL(url).pathname}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/v1/upload')) {
      const name = JSON.parse(init.body).files[0].id;
      return json({ files: [{ upload_url: `https://s3.test/put/${name}`, nomic_url: `nomic://files/${name}` }] });
    }
    if (url.startsWith('https://s3.test/put/')) return new Response('', { status: 200 });
    if (url.endsWith('/v1/parse') || url.endsWith('/v1/extract')) return json({ task_id: 'task-1' });
    if (url.includes('/v1/status/task-1')) return json({ status: 'COMPLETED', result_url: 'https://s3.test/result/task-1' });
    if (url === 'https://s3.test/result/task-1') return json(result);
    return new Response('not found', { status: 404 });
  });
}

beforeAll(async () => {
  process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
  process.env.NOMIC_API_URL = 'https://api.nomic.test';
  app = await getTestApp();
});

beforeEach(() => {
  invalidateDocumentParserCache();
  fakeSupabaseAdmin.seed('platform_settings', []);
  fakeSupabaseAdmin.getTable('platform_settings').splice(0);
  process.env.NOMIC_API_KEY = 'nk-test';
  delete process.env.DOCUMENT_PARSER;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedKey === undefined) delete process.env.NOMIC_API_KEY;
  else process.env.NOMIC_API_KEY = savedKey;
  invalidateDocumentParserCache();
});

describe('nomicParseResultToText', () => {
  it('prend le premier champ texte de chaque nœud sans répéter ses blocs', () => {
    const text = nomicParseResultToText({
      pages: [
        { markdown: '# Plan RDC', blocks: [{ text: 'répété' }] },
        { blocks: [{ text: 'Cartouche' }, { content: 'Échelle 1/100' }] },
      ],
    });
    expect(text).toBe('# Plan RDC\n\nCartouche\n\nÉchelle 1/100');
  });
});

describe('/api/admin/document-parser', () => {
  it('refuse de basculer sur Nomic sans clé', async () => {
    delete process.env.NOMIC_API_KEY;
    const res = await request(app).put('/api/admin/document-parser').set(authHeader(superAdminToken())).send({ engine: 'nomic' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('NOMIC_API_KEY');
  });

  it('enregistre Nomic et le rend comme moteur actif', async () => {
    const token = superAdminToken();
    const put = await request(app).put('/api/admin/document-parser').set(authHeader(token)).send({ engine: 'nomic' });
    expect(put.status).toBe(200);
    const get = await request(app).get('/api/admin/document-parser').set(authHeader(token));
    expect(get.body.current).toEqual({ engine: 'nomic', source: 'database' });
    expect(get.body.engines.find((e: any) => e.engine === 'nomic').configured).toBe(true);
  });

  it('est réservé au super-administrateur', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).get('/api/admin/document-parser').set(authHeader(token));
    expect(res.status).toBe(403);
  });
});

describe('extractDocumentText selon le moteur actif', () => {
  it('passe par Nomic (dépôt, tâche, statut, résultat) quand il est choisi', async () => {
    process.env.DOCUMENT_PARSER = 'nomic';
    const calls: string[] = [];
    mockNomic({ pages: [{ markdown: 'Coupe AA : dalle BA 20 cm' }] }, calls);
    const { text, note } = await extractDocumentText('coupe.pdf', 'application/pdf', Buffer.from('%PDF-1.4'));
    expect(text).toBe('Coupe AA : dalle BA 20 cm');
    expect(note).toContain('Nomic');
    expect(calls).toEqual(['POST /v1/upload', 'PUT /put/coupe.pdf', 'POST /v1/parse', 'GET /v1/status/task-1', 'GET /result/task-1']);
  });

  it('reste local quand le moteur choisi est local', async () => {
    const spy = mockNomic({});
    const { text } = await extractDocumentText('notes.txt', 'text/plain', Buffer.from('texte brut'));
    expect(text).toBe('texte brut');
    expect(spy).not.toHaveBeenCalled();
  });

  it('retombe sur le moteur local si Nomic échoue', async () => {
    process.env.DOCUMENT_PARSER = 'nomic';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('quota', { status: 429 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Un .docx illisible : c'est bien mammoth (moteur local) qui est appelé
    // après l'échec, et son erreur remonte telle quelle.
    await expect(extractDocumentText('cctp.docx', '', Buffer.from('pas un docx'))).rejects.toThrow();
  });
});

describe('normalizeGeneratedCctp', () => {
  it('retrouve les lots sous une enveloppe et écarte les nœuds sans intitulé', () => {
    const lots = normalizeGeneratedCctp({ result: { lots: [
      { titre: 'Gros œuvre', chapitres: [{ titre: 'Fondations', articles: [{ designation: 'Semelles filantes', unite: 'ml', description: 'Béton C25/30' }, { description: 'sans désignation' }] }] },
      { chapitres: [] },
    ] } });
    expect(lots).toHaveLength(1);
    expect(lots[0].chapitres[0].articles).toEqual([{ designation: 'Semelles filantes', unite: 'ml', localisation: '', description: 'Béton C25/30' }]);
  });
});

describe('POST /api/projects/:projectId/cctp/generate (Nomic)', () => {
  it('lit les seules pièces de l’affaire et renvoie une proposition sans rien enregistrer', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const projectId = crypto.randomUUID();
    const otherProjectId = crypto.randomUUID();
    fakeSupabaseAdmin.seed('projects', [
      { id: projectId, tenant_id: tenantId, name: 'Villa Martin' },
      { id: otherProjectId, tenant_id: tenantId, name: 'Autre' },
    ]);
    const path = `${tenantId}/${projectId}/plan-rdc.pdf`;
    await fakeSupabaseAdmin.storage.from('documents').upload(path, Buffer.from(''));
    const docId = crypto.randomUUID();
    const foreignDocId = crypto.randomUUID();
    fakeSupabaseAdmin.seed('documents', [
      { id: docId, tenant_id: tenantId, project_id: projectId, name: 'plan-rdc.pdf', file_url: `https://fake.supabase.test/storage/v1/object/public/documents/${path}` },
      { id: foreignDocId, tenant_id: tenantId, project_id: otherProjectId, name: 'autre.pdf', file_url: 'https://fake.supabase.test/storage/v1/object/public/documents/x.pdf' },
    ]);

    const calls: string[] = [];
    mockNomic({ lots: [{ titre: 'Gros œuvre', description: 'NF DTU 21', chapitres: [{ titre: 'Dallage', articles: [{ designation: 'Dallage BA', unite: 'm²', localisation: 'RDC', description: 'Épaisseur 12 cm' }] }] }] }, calls);

    const res = await request(app)
      .post(`/api/projects/${projectId}/cctp/generate`)
      .set(authHeader(token))
      .send({ engine: 'nomic', document_ids: [docId, foreignDocId] });

    expect(res.status).toBe(200);
    expect(res.body.documents_read).toBe(1);
    expect(res.body.lots[0].chapitres[0].articles[0]).toMatchObject({ designation: 'Dallage BA', localisation: 'RDC' });
    expect(calls.filter(c => c === 'POST /v1/upload')).toHaveLength(1);
    expect(calls).toContain('POST /v1/extract');
  });

  it('refuse Nomic sur une instance sans clé', async () => {
    delete process.env.NOMIC_API_KEY;
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const projectId = crypto.randomUUID();
    fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'P' }]);
    const docId = crypto.randomUUID();
    fakeSupabaseAdmin.seed('documents', [{ id: docId, tenant_id: tenantId, project_id: projectId, name: 'a.pdf', file_url: 'x' }]);
    const res = await request(app).post(`/api/projects/${projectId}/cctp/generate`).set(authHeader(token)).send({ engine: 'nomic', document_ids: [docId] });
    expect(res.status).toBe(503);
  });
});
