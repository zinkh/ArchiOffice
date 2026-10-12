import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

describe('renommer la catégorie d\'une rubrique de CR', () => {
  it('change la catégorie sans toucher aux autres champs', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('site_report_notes', [
      { id: 'n1', tenant_id: tenantId, report_id: 'r1', category: 'Sécurité', text: 'Port du casque', status: 'open' },
    ]);
    const res = await request(app).put('/api/notes/n1').set(authHeader(token)).send({ category: '  Hygiène et sécurité ' });
    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('site_report_notes').find(n => n.id === 'n1');
    expect(row?.category).toBe('Hygiène et sécurité');
    expect(row?.text).toBe('Port du casque');
  });

  it('refuse un nom vide', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('site_report_notes', [{ id: 'n2', tenant_id: tenantId, report_id: 'r1', category: 'Sécurité', text: '', status: 'open' }]);
    const res = await request(app).put('/api/notes/n2').set(authHeader(token)).send({ category: '   ' });
    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('site_report_notes').find(n => n.id === 'n2')?.category).toBe('Sécurité');
  });
});
