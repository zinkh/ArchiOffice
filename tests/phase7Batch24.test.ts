// Phase 7 batch 24: end-to-end Supertest coverage for the domains extracted
// into server/routes/{tasks,sendEmail,siteReports}.ts, plus the CCTP/DPGF
// "initial creation" routes (GET/POST /api/projects/:projectId/{cctp,dpgf})
// that joined cctps.ts/dpgf.ts this same lot — a different route shape (one
// JSON blob per project, upserted wholesale) than those modules' existing
// per-field CRUD on the same tables.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

// `settings` rows are raw select('*') results — snake_case DB columns, not
// the camelCase shape GET /api/settings maps them to for the frontend.
// sendEmail.ts used to read settings.smtpHost/smtpPass/senderOption (always
// undefined on a raw row), so it silently fell through to the platform env
// vars — or failed outright with them unset — regardless of what a tenant
// had actually configured. Stub sendMail so the "settings resolved
// correctly" tests below can assert on what was actually handed to
// nodemailer, not just the HTTP status.
const sendMailMock = vi.fn(async (_opts: Record<string, unknown>) => ({}));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Tasks', () => {
  it('creates, updates, and deletes a task', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/tasks').set(authHeader(token)).send({ project_id: 'p1', title: 'Terrassement', start_date: '2026-01-01', end_date: '2026-01-05' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const listed = await request(app).get('/api/tasks').set(authHeader(token));
    expect(listed.body.some((t: any) => t.id === id)).toBe(true);

    const updated = await request(app).put(`/api/tasks/${id}`).set(authHeader(token)).send({ title: 'Terrassement fini', progress: 100 });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tasks').find(t => t.id === id)?.progress).toBe(100);

    const deleted = await request(app).delete(`/api/tasks/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tasks').find(t => t.id === id)).toBeUndefined();
  });

  it('never lets a caller update another tenant\'s task', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('tasks', [{ id: 'task-b', tenant_id: tenantB, title: 'Secret', progress: 0 }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put('/api/tasks/task-b').set(authHeader(token)).send({ progress: 100 });
    expect(fakeSupabaseAdmin.getTable('tasks').find(t => t.id === 'task-b')?.progress).toBe(0);
  });
});

describe('Send email', () => {
  it('fails with a clear error when SMTP is not configured', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId }]);

    const res = await request(app).post('/api/send-email').set(authHeader(token)).send({ to: 'x@example.test', subject: 'Test', text: 'Hello' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/SMTP/);
  });

  it('fails when the tenant has no settings row at all', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/send-email').set(authHeader(token)).send({ to: 'x@example.test', subject: 'Test', text: 'Hello' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Settings/);
  });

  it('sends using the tenant\'s own configured SMTP settings, from the agency address by default', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{
      tenant_id: tenantId, email: 'agence@example.test', sender_option: 'agency',
      smtp_host: 'smtp.tenant.test', smtp_port: '587', smtp_user: 'tenant-user', smtp_pass: 'tenant-pass',
    }]);
    sendMailMock.mockClear();

    const res = await request(app).post('/api/send-email').set(authHeader(token)).send({ to: 'x@example.test', subject: 'Test', text: 'Hello' });
    expect(res.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ from: 'agence@example.test', cc: undefined, to: 'x@example.test' });
  });

  it('sends from the caller\'s own address, cc\'ing the agency, when senderOption is personal', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{
      tenant_id: tenantId, email: 'agence@example.test', sender_option: 'personal',
      smtp_host: 'smtp.tenant.test', smtp_port: '587', smtp_user: 'tenant-user', smtp_pass: 'tenant-pass',
    }]);
    sendMailMock.mockClear();

    const res = await request(app).post('/api/send-email').set(authHeader(token))
      .send({ to: 'x@example.test', subject: 'Test', text: 'Hello', userEmail: 'perso@example.test' });
    expect(res.status).toBe(200);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ from: 'perso@example.test', cc: 'agence@example.test' });
  });

  it('rejects a subject containing CR/LF (header injection)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, smtp_host: 'h', smtp_user: 'u', smtp_pass: 'p' }]);
    sendMailMock.mockClear();

    const res = await request(app).post('/api/send-email').set(authHeader(token))
      .send({ to: 'x@example.test', subject: 'Test\r\nBcc: attacker@evil.test', text: 'Hello' });
    expect(res.status).toBe(400);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe('Site reports (comptes-rendus de chantier)', () => {
  it('creates a report, carrying open notes over from the previous report', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId, name: 'Villa' }]);
    fakeSupabaseAdmin.seed('site_reports', [{ id: 'prev', tenant_id: tenantId, project_id: 'p1', date: '2026-01-01', report_number: 1 }]);
    fakeSupabaseAdmin.seed('site_report_notes', [
      { id: 'n-open', tenant_id: tenantId, report_id: 'prev', category: 'Sécurité', note_number: 1, status: 'open' },
      { id: 'n-closed', tenant_id: tenantId, report_id: 'prev', category: 'Autre', note_number: 2, status: 'closed' },
    ]);

    const res = await request(app).post('/api/projects/p1/reports').set(authHeader(token)).send({ date: '2026-01-08', report_number: 2 });
    expect(res.status).toBe(201);
    const carriedNotes = fakeSupabaseAdmin.getTable('site_report_notes').filter(n => n.report_id === res.body.id);
    expect(carriedNotes.length).toBe(1);
    expect(carriedNotes[0].category).toBe('Sécurité');
  });

  it('lists a project\'s reports, parsing stakeholders/companies JSON', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('site_reports', [{ id: 'r1', tenant_id: tenantId, project_id: 'p2', date: '2026-01-01', stakeholders: JSON.stringify(['MOE']), companies: JSON.stringify(['Entreprise X']) }]);

    const res = await request(app).get('/api/projects/p2/reports').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body[0].stakeholders).toEqual(['MOE']);
    expect(res.body[0].companies).toEqual(['Entreprise X']);
  });

  it('adds a note to a report', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('site_reports', [{ id: 'r2', tenant_id: tenantId, project_id: 'p3' }]);

    const created = await request(app).post('/api/reports/r2/notes').set(authHeader(token)).send({ category: 'Qualité', note_number: 1, responsible_company: 'Entreprise Y' });
    expect(created.status).toBe(201);

    const listed = await request(app).get('/api/reports/r2/notes').set(authHeader(token));
    expect(listed.body.some((n: any) => n.id === created.body.id)).toBe(true);
  });

  it('updates report metadata (page format, stakeholders, meeting notes)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('site_reports', [{ id: 'r3', tenant_id: tenantId, project_id: 'p4' }]);

    const res = await request(app).put('/api/reports/r3').set(authHeader(token)).send({ pageFormat: 'A4', meetingNotes: 'RAS', stakeholders: ['MOE'] });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('site_reports').find(r => r.id === 'r3')?.meetingNotes).toBe('RAS');
  });

  it('updates and deletes a site report note', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('site_report_notes', [{ id: 'note1', tenant_id: tenantId, report_id: 'r5', category: 'Sécurité', note_number: 1, status: 'open' }]);

    const updated = await request(app).put('/api/notes/note1').set(authHeader(token)).send({ status: 'closed', realization_date: '2026-01-10' });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('site_report_notes').find(n => n.id === 'note1')?.status).toBe('closed');

    const deleted = await request(app).delete('/api/notes/note1').set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('site_report_notes').find(n => n.id === 'note1')).toBeUndefined();
  });

  it('never lets a caller update another tenant\'s report', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('site_reports', [{ id: 'report-b', tenant_id: tenantB, meetingNotes: 'Secret' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put('/api/reports/report-b').set(authHeader(token)).send({ meetingNotes: 'Hacked' });
    expect(fakeSupabaseAdmin.getTable('site_reports').find(r => r.id === 'report-b')?.meetingNotes).toBe('Secret');
  });
});

describe('CCTP / DPGF initial creation (project-scoped JSON blob)', () => {
  it('404s when no CCTP exists yet for a project', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/projects/p5/cctp').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('creates then updates a project\'s CCTP blob', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/projects/p6/cctp').set(authHeader(token)).send({ id: 'new', title: 'CCTP v1' });
    expect(created.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('cctps').filter(c => c.project_id === 'p6').length).toBe(1);

    const updated = await request(app).post('/api/projects/p6/cctp').set(authHeader(token)).send({ id: created.body.id, title: 'CCTP v2' });
    expect(updated.status).toBe(200);
    // Same project → upsert, not a second row.
    expect(fakeSupabaseAdmin.getTable('cctps').filter(c => c.project_id === 'p6').length).toBe(1);

    const fetched = await request(app).get('/api/projects/p6/cctp').set(authHeader(token));
    expect(fetched.status).toBe(200);
    expect(fetched.body.title).toBe('CCTP v2');
  });

  it('creates a project\'s DPGF blob, logging activity only on first creation', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p7', tenant_id: tenantId, name: 'Extension' }]);

    const created = await request(app).post('/api/projects/p7/dpgf').set(authHeader(token)).send({ id: 'new', title: 'DPGF v1' });
    expect(created.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('activities').some(a => a.target_type === 'dpgf' && a.tenant_id === tenantId)).toBe(true);

    const fetched = await request(app).get('/api/projects/p7/dpgf').set(authHeader(token));
    expect(fetched.status).toBe(200);
    expect(fetched.body.title).toBe('DPGF v1');
  });
});
