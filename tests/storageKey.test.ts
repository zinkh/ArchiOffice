// Clés Supabase Storage : ASCII uniquement (server/storageKey.ts). Incident
// d'origine : un partage Android vers « Ajouter à ArchiOffice » échouait en
// « Invalid key : <tenant>/general/Général/<id>/Check-out-this-page.txt ».
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { safeFileName, safeSegment } from '../server/storageKey';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

const ASCII_KEY = /^[a-zA-Z0-9._\/-]+$/;

describe('safeSegment', () => {
  it('retire les diacritiques', () => {
    expect(safeSegment('Général')).toBe('General');
    expect(safeSegment('Réhabilitation Château')).toBe('Rehabilitation-Chateau');
  });

  it('remplace le reste par des tirets fusionnés, sans tiret aux extrémités', () => {
    expect(safeSegment("  L'Atelier -- d'œuvre !  ")).toBe('L-Atelier-d-uvre');
    expect(safeSegment('APS / APD')).toBe('APS-APD');
  });

  it('ne rend jamais un segment vide ni « .. »', () => {
    expect(safeSegment('')).toBe('sans-nom');
    expect(safeSegment('ééé€')).toBe('eee');
    expect(safeSegment('€€')).toBe('sans-nom');
    expect(safeSegment('..')).toBe('sans-nom');
    expect(safeSegment(null, 'x')).toBe('x');
  });
});

describe('safeFileName', () => {
  it('normalise un nom accentué avec espaces et apostrophes, extension gardée', () => {
    expect(safeFileName("Plan d'étage n°2 – Général.pdf")).toBe('Plan-d-etage-n-2-General.pdf');
    expect(safeFileName('Check-out-this-page.txt')).toBe('Check-out-this-page.txt');
  });

  it('garde l\'extension même tronqué', () => {
    const out = safeFileName(`${'é'.repeat(300)}.docx`);
    expect(out.endsWith('.docx')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it('a toujours un nom', () => {
    expect(safeFileName('€€€.pdf')).toBe('fichier.pdf');
    expect(safeFileName('')).toBe('fichier');
  });
});

describe('POST /api/documents (partage Android)', () => {
  let app: Express;
  beforeAll(async () => { app = await getTestApp(); });

  it('dépose un fichier accentué en phase « Général » sans projet, nom d\'origine conservé', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const original = "Plan d'étage – Général.pdf";

    const res = await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', '').field('name', original).field('phase', 'Général').field('category', 'Autre')
      .attach('file', Buffer.from('%PDF-fake'), original);

    expect(res.status).toBe(201);
    const doc = fakeSupabaseAdmin.getTable('documents').find(d => d.id === res.body.id);
    expect(doc?.name).toBe(original);
    expect(doc?.phase).toBe('Général');
    const key = String(doc?.file_url).split('/object/public/documents/')[1];
    expect(key).toBe(`${tenantId}/general/General/${res.body.id}/Plan-d-etage-General.pdf`);
    expect(key).toMatch(ASCII_KEY);
  });

  it('une nouvelle version reste en clé ASCII', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p-acc', tenant_id: tenantId }]);
    const first = await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'p-acc').field('name', 'Notice').field('phase', 'Général')
      .attach('file', Buffer.from('%PDF-1'), 'notice.pdf');
    expect(first.status).toBe(201);

    const v2 = await request(app).put(`/api/documents/${first.body.id}`).set(authHeader(token))
      .field('name', 'Notice').field('phase', 'Général')
      .attach('file', Buffer.from('%PDF-2'), "Notice révisée l'été.pdf");
    expect(v2.status).toBe(200);
    const doc = fakeSupabaseAdmin.getTable('documents').find(d => d.id === first.body.id);
    expect(String(doc?.file_url).split('/object/public/documents/')[1]).toMatch(ASCII_KEY);
    expect(String(doc?.file_url)).toContain('/General/');
  });
});
