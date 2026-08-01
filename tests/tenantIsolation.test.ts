// Regression tests for the tenant-isolation bugs fixed in Phase 2: a route
// resolves the caller's tenantId, but then reads or mutates another tenant's
// row because a query in the same handler was missing `.eq('tenant_id', ...)`.
// See CLAUDE.md / the engineering-maturity plan for the audit that found
// these. Each test seeds a "victim" resource under tenant B, then calls the
// route as an authenticated user of tenant A with the victim's id — the
// response must never contain tenant B's data, and no cross-tenant row may
// actually be mutated.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('tenant isolation — filtered update + previously-unfiltered read-back', () => {
  it('PUT /api/invoices/:id never returns another tenant\'s invoice fields', async () => {
    const tenantB = makeTenant();
    const invoiceId = 'invoice-1';
    fakeSupabaseAdmin.seed('invoices', [{
      id: invoiceId, tenant_id: tenantB, seller_iban: 'FR-SECRET-IBAN-TENANT-B',
      seller_bic: 'SECRETBIC', amount: 9999, project_id: null,
    }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).put(`/api/invoices/${invoiceId}`).set(authHeader(token)).send({});

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('FR-SECRET-IBAN-TENANT-B');
    expect(res.body.seller_iban).toBeUndefined();
  });

  it('PUT /api/tenders/:id never returns another tenant\'s tender fields', async () => {
    const tenantB = makeTenant();
    const tenderId = 'tender-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantB, title: 'SECRET-TENDER-B', client: 'Client B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).put(`/api/tenders/${tenderId}`).set(authHeader(token)).send({});

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-TENDER-B');
  });

  it('PUT /api/contrats_moe/:id never returns another tenant\'s contrat fields', async () => {
    const tenantB = makeTenant();
    const contratId = 'contrat-1';
    fakeSupabaseAdmin.seed('contrats_moe', [{ id: contratId, tenant_id: tenantB, intitule_projet: 'SECRET-CONTRAT-B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).put(`/api/contrats_moe/${contratId}`).set(authHeader(token)).send({});

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-CONTRAT-B');
  });

  it('PUT /api/notes_honoraires/:id never returns another tenant\'s note fields', async () => {
    const tenantB = makeTenant();
    const noteId = 'note-1';
    fakeSupabaseAdmin.seed('notes_honoraires', [{ id: noteId, tenant_id: tenantB, numero: 'SECRET-NOTE-B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).put(`/api/notes_honoraires/${noteId}`).set(authHeader(token)).send({});

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-NOTE-B');
  });

  it('PUT /api/proposals/:id never returns another tenant\'s proposal fields', async () => {
    const tenantB = makeTenant();
    const proposalId = 'proposal-1';
    fakeSupabaseAdmin.seed('proposals', [{ id: proposalId, tenant_id: tenantB, title: 'SECRET-PROPOSAL-B', status: 'Draft' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).put(`/api/proposals/${proposalId}`).set(authHeader(token)).send({});

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-PROPOSAL-B');
  });

  it('PUT /api/reports/:reportId never returns another tenant\'s report fields', async () => {
    const tenantB = makeTenant();
    const reportId = 'report-1';
    fakeSupabaseAdmin.seed('site_reports', [{ id: reportId, tenant_id: tenantB, meetingNotes: 'SECRET-REPORT-B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).put(`/api/reports/${reportId}`).set(authHeader(token)).send({});

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-REPORT-B');
  });
});

describe('tenant isolation — mutation with no tenant filter at all', () => {
  it('POST /api/feed/posts/:id/like does not mutate another tenant\'s post', async () => {
    const tenantB = makeTenant();
    const postId = 'post-1';
    fakeSupabaseAdmin.seed('feed_posts', [{ id: postId, tenant_id: tenantB, likes_count: 5 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).post(`/api/feed/posts/${postId}/like`).set(authHeader(token)).send({});

    expect(res.status).toBe(200);
    const post = fakeSupabaseAdmin.getTable('feed_posts').find(p => p.id === postId);
    expect(post?.likes_count).toBe(5);
  });

  it('POST /api/feed/activities/:id/like does not mutate another tenant\'s activity', async () => {
    const tenantB = makeTenant();
    const activityId = 'activity-1';
    fakeSupabaseAdmin.seed('activities', [{ id: activityId, tenant_id: tenantB, likes_count: 3 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).post(`/api/feed/activities/${activityId}/like`).set(authHeader(token)).send({});

    expect(res.status).toBe(200);
    const activity = fakeSupabaseAdmin.getTable('activities').find(a => a.id === activityId);
    expect(activity?.likes_count).toBe(3);
  });
});

describe('tenant isolation — legitimate same-tenant access still works', () => {
  it('PUT /api/invoices/:id returns the caller\'s own invoice data', async () => {
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const invoiceId = 'invoice-own';
    fakeSupabaseAdmin.seed('invoices', [{ id: invoiceId, tenant_id: tenantA, seller_iban: 'FR-OWN-IBAN', amount: 100 }]);

    const res = await request(app).put(`/api/invoices/${invoiceId}`).set(authHeader(token)).send({ amount: 250, seller_iban: 'FR-OWN-IBAN' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(invoiceId);
    expect(res.body.amount).toBe(250);
    expect(res.body.seller_iban).toBe('FR-OWN-IBAN');
  });
});
