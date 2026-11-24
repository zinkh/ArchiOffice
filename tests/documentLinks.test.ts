// Liens web en pièces jointes : POST /api/documents/link et normalisation des adresses.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { normalizeWebLink, LINK_MIME_TYPE } from '../server/routes/documents';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

describe('normalizeWebLink', () => {
  it('accepte http(s) et complète une adresse sans schéma', () => {
    expect(normalizeWebLink('https://www.geoportail-urbanisme.gouv.fr/map')).toBe('https://www.geoportail-urbanisme.gouv.fr/map');
    expect(normalizeWebLink('aazs.fr')).toBe('https://aazs.fr/');
  });
  it('refuse les schémas dangereux et les valeurs vides', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', '', '   ', 'localhost', null, 42]) {
      expect(normalizeWebLink(bad)).toBeNull();
    }
  });
});

describe('POST /api/documents/link', () => {
  function seed() {
    const tenantId = makeTenant({});
    const { token } = makeUser(tenantId, 'admin');
    const autre = makeTenant({});
    const proposalId = crypto.randomUUID(), etrangere = crypto.randomUUID();
    fakeSupabaseAdmin.seed('proposals', [
      { id: proposalId, tenant_id: tenantId }, { id: etrangere, tenant_id: autre },
    ]);
    return { token, tenantId, proposalId, etrangere };
  }

  it('enregistre un lien rattaché à une proposition', async () => {
    const { token, tenantId, proposalId } = seed();
    const res = await request(app).post('/api/documents/link').set(authHeader(token))
      .send({ resource_type: 'proposals', resource_id: proposalId, url: 'https://www.plu.fr/zone', name: 'PLU en ligne' });
    expect(res.status).toBe(201);
    const row = fakeSupabaseAdmin.getTable('documents').find((d: any) => d.id === res.body.id)!;
    expect(row).toMatchObject({ tenant_id: tenantId, resource_type: 'proposals', resource_id: proposalId, name: 'PLU en ligne', file_url: 'https://www.plu.fr/zone', mime_type: LINK_MIME_TYPE, storage_backend: 'link' });
  });

  it('refuse une adresse non web et une proposition d\'un autre cabinet', async () => {
    const { token, proposalId, etrangere } = seed();
    const bad = await request(app).post('/api/documents/link').set(authHeader(token))
      .send({ resource_type: 'proposals', resource_id: proposalId, url: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    const foreign = await request(app).post('/api/documents/link').set(authHeader(token))
      .send({ resource_type: 'proposals', resource_id: etrangere, url: 'https://exemple.fr' });
    expect(foreign.status).toBe(400);
  });
});
