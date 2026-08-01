// Phase 7 batch 3: end-to-end Supertest coverage for the domains extracted
// into server/routes/{observations,meetings,meetingAttendees}.ts — confirms
// the extraction didn't change behavior, that tenantScopedFrom() still
// enforces tenant isolation through the real app, and locks in the fix for
// the observation_reports cross-tenant linking gap found during extraction.
//
// Storage-backed routes (meeting photo upload/delete) are not exercised here:
// FakeSupabaseAdmin's storage stub only implements getBucket/createBucket
// (used by createApp()'s startup bucket check), not from()/upload()/
// getPublicUrl()/remove() — no test in this suite has needed those yet. The
// photo caption route, which only touches the DB, is covered instead.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Observations', () => {
  it('creates, lists, updates, and deletes an observation within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/projects/p1/observations').set(authHeader(token)).send({ texte: 'Fissure mur nord', statut: 'À faire' });
    expect(created.status).toBe(200);
    expect(created.body.tenant_id).toBe(tenantId);
    expect(created.body.number).toBe(1);
    const obsId = created.body.id;

    const listed = await request(app).get('/api/projects/p1/observations').set(authHeader(token));
    expect(listed.status).toBe(200);
    expect(listed.body.some((o: any) => o.id === obsId)).toBe(true);

    const updated = await request(app).put(`/api/observations/${obsId}`).set(authHeader(token)).send({ texte: 'Fissure réparée', statut: 'Levée' });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('observations').find(o => o.id === obsId)?.texte).toBe('Fissure réparée');

    const deleted = await request(app).delete(`/api/observations/${obsId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('observations').find(o => o.id === obsId)).toBeUndefined();
  });

  it('never lets a caller update or delete another tenant\'s observation', async () => {
    const tenantB = makeTenant();
    const obsId = 'obs-b';
    fakeSupabaseAdmin.seed('observations', [{ id: obsId, tenant_id: tenantB, project_id: 'project-b', number: 1, texte: 'SECRET-OBS-B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/observations/${obsId}`).set(authHeader(token)).send({ texte: 'Hacked' });
    expect(fakeSupabaseAdmin.getTable('observations').find(o => o.id === obsId)?.texte).toBe('SECRET-OBS-B');

    await request(app).delete(`/api/observations/${obsId}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('observations').find(o => o.id === obsId)).toBeDefined();
  });

  it('rejects linking another tenant\'s observation or report (security fix)', async () => {
    const tenantB = makeTenant();
    const obsId = 'obs-b2';
    const reportId = 'report-b2';
    fakeSupabaseAdmin.seed('observations', [{ id: obsId, tenant_id: tenantB, project_id: 'project-b', number: 1, texte: 'SECRET' }]);
    fakeSupabaseAdmin.seed('site_reports', [{ id: reportId, tenant_id: tenantB, project_id: 'project-b', date: '2026-01-01', report_number: 1 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    // Neither the observation nor the report belongs to tenant A.
    const res = await request(app).post(`/api/observations/${obsId}/link/${reportId}`).set(authHeader(token));
    expect(res.status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('observation_reports').some(l => l.observation_id === obsId)).toBe(false);

    // Own observation, but another tenant's report.
    const ownObs = await request(app).post('/api/projects/pA/observations').set(authHeader(token)).send({ texte: 'Mine' });
    const res2 = await request(app).post(`/api/observations/${ownObs.body.id}/link/${reportId}`).set(authHeader(token));
    expect(res2.status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('observation_reports').some(l => l.observation_id === ownObs.body.id)).toBe(false);
  });

  it('links an observation to a report within the same tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('site_reports', [{ id: 'report-1', tenant_id: tenantId, project_id: 'p1', date: '2026-01-01', report_number: 1 }]);

    const created = await request(app).post('/api/projects/p1/observations').set(authHeader(token)).send({ texte: 'Fissure' });
    const obsId = created.body.id;

    const res = await request(app).post(`/api/observations/${obsId}/link/report-1`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('observation_reports').some(l => l.observation_id === obsId && l.report_id === 'report-1')).toBe(true);
  });
});

describe('Meetings', () => {
  it('creates, reads, updates, and deletes a meeting within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/meetings').set(authHeader(token)).send({ project_id: 'p1', type: 'chantier', title: 'Réunion de chantier n°1', date: '2026-01-15' });
    expect(created.status).toBe(201);
    const meetingId = created.body.id;

    const got = await request(app).get(`/api/meetings/${meetingId}`).set(authHeader(token));
    expect(got.status).toBe(200);
    expect(got.body.title).toBe('Réunion de chantier n°1');
    expect(got.body.photos).toEqual([]);

    const listed = await request(app).get('/api/meetings').query({ project_id: 'p1' }).set(authHeader(token));
    expect(listed.body.some((m: any) => m.id === meetingId)).toBe(true);

    const updated = await request(app).put(`/api/meetings/${meetingId}`).set(authHeader(token)).send({ title: 'Réunion de chantier n°1 (révisée)', date: '2026-01-16' });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('meetings').find(m => m.id === meetingId)?.title).toBe('Réunion de chantier n°1 (révisée)');

    const deleted = await request(app).delete(`/api/meetings/${meetingId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('meetings').find(m => m.id === meetingId)).toBeUndefined();
  });

  it('never lets a caller read, update, or delete another tenant\'s meeting', async () => {
    const tenantB = makeTenant();
    const meetingId = 'meeting-b';
    fakeSupabaseAdmin.seed('meetings', [{ id: meetingId, tenant_id: tenantB, project_id: 'project-b', type: 'chantier', title: 'SECRET-MEETING-B', date: '2026-01-01' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const got = await request(app).get(`/api/meetings/${meetingId}`).set(authHeader(token));
    expect(got.status).toBe(500); // .single() on a filtered-out row errors, same as pre-extraction behavior

    await request(app).put(`/api/meetings/${meetingId}`).set(authHeader(token)).send({ title: 'Hacked' });
    expect(fakeSupabaseAdmin.getTable('meetings').find(m => m.id === meetingId)?.title).toBe('SECRET-MEETING-B');

    await request(app).delete(`/api/meetings/${meetingId}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('meetings').find(m => m.id === meetingId)).toBeDefined();
  });

  it('updates a meeting photo caption within one tenant only', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('meeting_photos', [{ id: 'photo-1', tenant_id: tenantId, meeting_id: 'm1', file_url: 'https://example.test/photo.jpg', caption: null }]);

    const updated = await request(app).patch('/api/meetings/photos/photo-1/caption').set(authHeader(token)).send({ caption: 'Façade nord' });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('meeting_photos').find(p => p.id === 'photo-1')?.caption).toBe('Façade nord');

    const tenantB = makeTenant();
    const { token: tokenB } = makeUser(tenantB);
    await request(app).patch('/api/meetings/photos/photo-1/caption').set(authHeader(tokenB)).send({ caption: 'Hacked' });
    expect(fakeSupabaseAdmin.getTable('meeting_photos').find(p => p.id === 'photo-1')?.caption).toBe('Façade nord');
  });
});

describe('Meeting Attendees', () => {
  it('adds an existing contact as attendee, updates the role, then removes it', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-1', tenant_id: tenantId, first_name: 'Jean', last_name: 'Dupont' }]);

    const added = await request(app).post('/api/meetings/m1/attendees').set(authHeader(token)).send({ contact_id: 'contact-1', role: 'MOE' });
    expect(added.status).toBe(201);
    const attendeeId = added.body.id;
    expect(added.body.contact.first_name).toBe('Jean');

    const dup = await request(app).post('/api/meetings/m1/attendees').set(authHeader(token)).send({ contact_id: 'contact-1', role: 'MOE' });
    expect(dup.status).toBe(409);

    const listed = await request(app).get('/api/meetings/m1/attendees').set(authHeader(token));
    expect(listed.body.some((a: any) => a.id === attendeeId)).toBe(true);

    const patched = await request(app).patch(`/api/meetings/m1/attendees/${attendeeId}`).set(authHeader(token)).send({ role: 'MOA' });
    expect(patched.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('meeting_attendees').find(a => a.id === attendeeId)?.role).toBe('MOA');

    const removed = await request(app).delete(`/api/meetings/m1/attendees/${attendeeId}`).set(authHeader(token));
    expect(removed.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('meeting_attendees').find(a => a.id === attendeeId)).toBeUndefined();
  });

  it('creates a brand-new contact and adds it as an attendee in one call', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/meetings/m2/attendees/new-contact').set(authHeader(token)).send({ first_name: 'Marie', last_name: 'Martin', role: 'MOA' });
    expect(res.status).toBe(201);
    expect(res.body.contact.first_name).toBe('Marie');
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === res.body.contact_id)?.tenant_id).toBe(tenantId);
    expect(fakeSupabaseAdmin.getTable('meeting_attendees').find(a => a.id === res.body.id)?.tenant_id).toBe(tenantId);
  });

  it('never removes another tenant\'s meeting attendee', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('meeting_attendees', [{ id: 'att-b', tenant_id: tenantB, meeting_id: 'meeting-b', contact_id: 'contact-b', role: 'MOE' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).delete('/api/meetings/meeting-b/attendees/att-b').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('meeting_attendees').find(a => a.id === 'att-b')).toBeDefined();
  });
});
