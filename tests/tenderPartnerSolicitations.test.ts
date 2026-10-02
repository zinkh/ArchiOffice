// Suivi des sollicitations de bureaux d'études — onglet Partenaires
// (server/routes/tenderPartnerSolicitations.ts). Pour une même spécialité,
// le cabinet consulte souvent plusieurs entreprises avant d'en retenir une :
// ces tests couvrent le CRUD, l'isolation multi-tenant, la validation du
// contact et du tender référencés, et les deux routes dédiées qui marquent
// un envoi réel (mark-sent/mark-relance) plutôt qu'un simple changement de
// statut manuel.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('tender partner solicitations', () => {
  it('creates, lists and deletes a solicitation scoped to the tender\'s tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-sol-1';
    const contactId = 'contact-sol-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: contactId, tenant_id: tenantId, first_name: 'BET', last_name: 'Structure', email: 'bet@example.test' }]);

    const created = await request(app).post('/api/tender-partner-solicitations').set(authHeader(token))
      .send({ tender_id: tenderId, specialty_name: 'BET Structure', contact_id: contactId });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('a_solliciter');

    const list = await request(app).get('/api/tender-partner-solicitations').query({ tender_id: tenderId }).set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const del = await request(app).delete(`/api/tender-partner-solicitations/${created.body.id}`).set(authHeader(token));
    expect(del.status).toBe(200);
    const listAfter = await request(app).get('/api/tender-partner-solicitations').query({ tender_id: tenderId }).set(authHeader(token));
    expect(listAfter.body).toHaveLength(0);
  });

  it('rejects a solicitation on a tender belonging to another tenant', async () => {
    const tenantB = makeTenant();
    const tenderId = 'tender-sol-victim';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantB, title: 'Secret', client: 'Client B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const contactId = 'contact-sol-a';
    fakeSupabaseAdmin.seed('contacts', [{ id: contactId, tenant_id: tenantA, first_name: 'BET', last_name: 'A' }]);

    const res = await request(app).post('/api/tender-partner-solicitations').set(authHeader(token))
      .send({ tender_id: tenderId, specialty_name: 'BET Structure', contact_id: contactId });
    expect(res.status).toBe(400);
  });

  it('rejects a solicitation whose contact belongs to another tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-sol-2';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-victim', tenant_id: tenantB, first_name: 'Autre', last_name: 'Cabinet' }]);

    const res = await request(app).post('/api/tender-partner-solicitations').set(authHeader(token))
      .send({ tender_id: tenderId, specialty_name: 'BET Structure', contact_id: 'contact-victim' });
    expect(res.status).toBe(400);
  });

  it('updates the status manually without touching sent_at/relance_count', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tenders', [{ id: 'tender-sol-3', tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-sol-3', tenant_id: tenantId, first_name: 'BET', last_name: 'X' }]);
    fakeSupabaseAdmin.seed('tender_partner_solicitations', [{ id: 'sol-3', tenant_id: tenantId, tender_id: 'tender-sol-3', specialty_name: 'BET Fluides', contact_id: 'contact-sol-3', status: 'sollicite', relance_count: 0 }]);

    const res = await request(app).put('/api/tender-partner-solicitations/sol-3').set(authHeader(token)).send({ status: 'accepte' });
    expect(res.status).toBe(200);
    const stored = fakeSupabaseAdmin.getTable('tender_partner_solicitations').find((s: any) => s.id === 'sol-3');
    expect(stored?.status).toBe('accepte');
    expect(stored?.relance_count).toBe(0);
    expect(stored?.sent_at).toBeUndefined();
  });

  it('rejects an invalid status', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tenders', [{ id: 'tender-sol-4', tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-sol-4', tenant_id: tenantId, first_name: 'BET', last_name: 'X' }]);
    fakeSupabaseAdmin.seed('tender_partner_solicitations', [{ id: 'sol-4', tenant_id: tenantId, tender_id: 'tender-sol-4', specialty_name: 'BET Fluides', contact_id: 'contact-sol-4', status: 'a_solliciter', relance_count: 0 }]);

    const res = await request(app).put('/api/tender-partner-solicitations/sol-4').set(authHeader(token)).send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('mark-sent sets status to sollicite and stamps sent_at', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tenders', [{ id: 'tender-sol-5', tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-sol-5', tenant_id: tenantId, first_name: 'BET', last_name: 'X' }]);
    fakeSupabaseAdmin.seed('tender_partner_solicitations', [{ id: 'sol-5', tenant_id: tenantId, tender_id: 'tender-sol-5', specialty_name: 'BET Fluides', contact_id: 'contact-sol-5', status: 'a_solliciter', relance_count: 0 }]);

    const res = await request(app).post('/api/tender-partner-solicitations/sol-5/mark-sent').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sollicite');
    expect(res.body.sent_at).toBeTruthy();
  });

  it('mark-relance increments relance_count server-side and stamps last_relance_at', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tenders', [{ id: 'tender-sol-6', tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-sol-6', tenant_id: tenantId, first_name: 'BET', last_name: 'X' }]);
    fakeSupabaseAdmin.seed('tender_partner_solicitations', [{ id: 'sol-6', tenant_id: tenantId, tender_id: 'tender-sol-6', specialty_name: 'BET Fluides', contact_id: 'contact-sol-6', status: 'sollicite', relance_count: 1 }]);

    const res = await request(app).post('/api/tender-partner-solicitations/sol-6/mark-relance').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('relance');
    expect(res.body.relance_count).toBe(2);
    expect(res.body.last_relance_at).toBeTruthy();
  });

  it('never lists or mutates another tenant\'s solicitation', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('tenders', [{ id: 'tender-sol-victim2', tenant_id: tenantB, title: 'Secret', client: 'Client B' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-victim2', tenant_id: tenantB, first_name: 'Autre', last_name: 'Cabinet' }]);
    fakeSupabaseAdmin.seed('tender_partner_solicitations', [{ id: 'sol-victim', tenant_id: tenantB, tender_id: 'tender-sol-victim2', specialty_name: 'Secret', contact_id: 'contact-victim2', status: 'a_solliciter', relance_count: 0 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const list = await request(app).get('/api/tender-partner-solicitations').query({ tender_id: 'tender-sol-victim2' }).set(authHeader(token));
    expect(list.body).toEqual([]);

    const del = await request(app).delete('/api/tender-partner-solicitations/sol-victim').set(authHeader(token));
    expect(del.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tender_partner_solicitations').find((s: any) => s.id === 'sol-victim')).toBeDefined();
  });
});
