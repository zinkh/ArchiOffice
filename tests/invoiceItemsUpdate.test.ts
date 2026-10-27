// Enregistrer deux factures dont les lignes portent le même identifiant côté
// client ("1", valeur par défaut historique de l'éditeur) ne doit plus violer
// la clé primaire invoice_items_pkey, et le contact d'envoi s'enregistre.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const body = (extra: object = {}) => ({
  amount: 100, tax_amount: 20, total_amount: 120, vat_rate: 20, status: 'Draft',
  items: [{ id: '1', description: 'Prestation', quantity: 1, unit_price: 100, vat_rate: 20 }],
  ...extra,
});

describe('PUT /api/invoices/:id : lignes', () => {
  it('deux factures avec une ligne d\'id "1" s\'enregistrent sans conflit', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('invoices', [
      { id: `${tenantId}-a`, tenant_id: tenantId, status: 'Draft', created_at: '2026-10-01T00:00:00Z' },
      { id: `${tenantId}-b`, tenant_id: tenantId, status: 'Draft', created_at: '2026-10-02T00:00:00Z' },
    ]);
    for (const suffix of ['a', 'b']) {
      const res = await request(app).put(`/api/invoices/${tenantId}-${suffix}`).set(authHeader(admin.token)).send(body());
      expect(res.status).toBe(200);
    }
    const ids = fakeSupabaseAdmin.getTable('invoice_items').filter((r: any) => r.tenant_id === tenantId).map((r: any) => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('1');
  });

  it('enregistre le contact d\'envoi, y compris sur une facture déjà envoyée', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('contacts', [{ id: `${tenantId}-c`, tenant_id: tenantId, company_name: 'Compta' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: `${tenantId}-s`, tenant_id: tenantId, status: 'Sent', amount: 100, created_at: '2026-10-01T00:00:00Z' }]);
    const res = await request(app).put(`/api/invoices/${tenantId}-s`).set(authHeader(admin.token))
      .send({ status: 'Sent', billing_contact_id: `${tenantId}-c` });
    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('invoices').find((r: any) => r.id === `${tenantId}-s`);
    expect(row?.billing_contact_id).toBe(`${tenantId}-c`);
  });

  it('refuse un contact d\'envoi d\'un autre cabinet', async () => {
    const tenantId = makeTenant();
    const other = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('contacts', [{ id: `${other}-c`, tenant_id: other, company_name: 'Autre' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: `${tenantId}-x`, tenant_id: tenantId, status: 'Draft', created_at: '2026-10-01T00:00:00Z' }]);
    const res = await request(app).put(`/api/invoices/${tenantId}-x`).set(authHeader(admin.token))
      .send({ billing_contact_id: `${other}-c` });
    expect(res.status).toBe(400);
  });
});
