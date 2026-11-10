import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { registerProposalFollowUpRoutes } from '../server/routes/proposalFollowUp';
import { registerSignatureRoutes } from '../server/routes/signatures';
import { registerZohoSignRoutes } from '../server/routes/zohoSign';
import { initOAuthStateStore } from '../server/oauthState';
import { resolveSignatureProvider, normalizeSignatureStatus, sendSignature, firmaWorkspaceKey } from '../server/signatures';
import { decryptSecretMaybe } from '../server/secretsCrypto';
import { proposalReminderDue, proposalArchiveDue, stripProposalTracking } from '../src/lib/proposalFollowUp';
vi.mock('../server/superAdminAuth', () => ({ isSuperAdmin: async (_db: any, user: any) => user?.id === 'super' }));
let db: FakeSupabaseAdmin; let app: express.Express;
const post = (action: string, extra = {}) => request(app).post('/api/proposals/p/follow-up').send({ action, ...extra });
const seed = (extra = {}) => db.seed('proposals', [{ id: 'p', tenant_id: 'a', title: 'Maison', reference: 'P-1', status: 'Sent', sent_at: '2026-08-01T12:00:00Z', ...extra }]);
const pdfBytes = async () => { const pdf = await PDFDocument.create(); pdf.addPage(); return Buffer.from(await pdf.save()); };
beforeEach(() => {
  vi.stubEnv('MAIL_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64')); vi.stubEnv('APP_URL', 'https://app.example.test');
  db = new FakeSupabaseAdmin(); initOAuthStateStore(db); app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { req.user = { id: req.headers['x-user'] || 'admin', email: 'admin@example.test' }; next(); });
  const getTenantId = async (id: string) => id === 'other' ? 'b' : 'a';
  const requireTenantAdmin = async (id: string) => { if (!['admin', 'super'].includes(id)) throw Object.assign(new Error('Forbidden'), { status: 403 }); return 'a'; };
  const deps = { supabaseAdmin: db, getTenantId, requireTenantAdmin, getUserName: async () => 'Architecte', logActivity: vi.fn() };
  registerProposalFollowUpRoutes(app, deps); registerSignatureRoutes(app, deps); registerZohoSignRoutes(app, deps);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('proposal follow-up', () => {
  it('offers reminders and archive only for sent unanswered proposals with known dates', () => {
    const p = { status: 'Sent', sent_at: '2026-08-01T12:00:00Z' }; const now = Date.parse('2026-11-09T12:00:00Z');
    expect(proposalReminderDue(p, now)).toBe(true); expect(proposalArchiveDue(p, now)).toBe(true);
    for (const override of [{ status: 'Draft' }, { status: 'Accepted' }, { archived_at: '2026-10-01' }, { last_response_at: '2026-10-01' }]) {
      expect(proposalReminderDue({ ...p, ...override }, now)).toBe(false); expect(proposalArchiveDue({ ...p, ...override }, now)).toBe(false);
    }
    expect(proposalArchiveDue({ ...p, signature_status: 'inprogress' }, now)).toBe(false);
    expect(proposalReminderDue({ status: 'Sent' }, now)).toBe(false);
  });
  it('archives reversibly without converting silence into rejection', async () => {
    seed(); const archived = await post('archive'); expect(archived.status).toBe(200); expect(archived.body.status).toBe('Sent'); expect(archived.body.archived_at).toBeTruthy();
    const restored = await post('restore'); expect(restored.status).toBe(200); expect(restored.body.archived_at).toBeNull(); expect(restored.body.next_follow_up_at).toBeTruthy();
  });
  it('stops reminders after reply and rejects impossible dates', async () => {
    seed(); expect((await post('schedule', { date: '2026-02-30' })).status).toBe(400);
    expect((await post('reminded')).body.reminder_count).toBe(1);
    expect((await post('responded')).body.next_follow_up_at).toBeNull();
    expect((await post('reminded')).status).toBe(409); expect((await post('archive')).status).toBe(409);
  });
  it('isolates cabinets and strips server-owned lifecycle metadata from form saves', async () => {
    seed(); expect((await request(app).post('/api/proposals/p/follow-up').set('x-user', 'other').send({ action: 'archive' })).status).toBe(404);
    expect(stripProposalTracking({ title: 'Maison', signature_status: 'completed', signature_provider: 'firma', archived_at: 'x' })).toEqual({ title: 'Maison' });
  });
  it('does not schedule reminders for a closed proposal', async () => { seed({ status: 'Accepted' }); expect((await post('sent')).status).toBe(409); expect((await post('schedule', { date: '2027-01-01' })).status).toBe(409); });
});
describe('provider selection and permissions', () => {
  it('prefers Firma only when platform-enabled, otherwise the agency plugin', () => {
    const s = { signature_provider: 'zoho', zoho_sign_refresh_token: 'z', docuseal_api_key: 'd' };
    expect(resolveSignatureProvider(true, s)).toBe('firma'); expect(resolveSignatureProvider(false, s)).toBe('zoho');
    expect(resolveSignatureProvider(false, { docuseal_api_key: 'd' })).toBe('docuseal'); expect(resolveSignatureProvider(false, {})).toBeNull();
    expect(normalizeSignatureStatus('firma', 'finished')).toBe('completed'); expect(normalizeSignatureStatus('docuseal', 'pending')).toBe('inprogress');
  });
  it('restricts platform activation to the superadmin', async () => {
    expect((await request(app).put('/api/admin/signatures').send({ firma_enabled: true })).status).toBe(403); vi.stubEnv('FIRMA_API_KEY', 'firma-test');
    const result = await request(app).put('/api/admin/signatures').set('x-user', 'super').send({ firma_enabled: true });
    expect(result.status).toBe(200); expect(result.body.firma_enabled).toBe(true); expect(JSON.stringify(result.body)).not.toContain('firma-test');
  });
  it('encrypts plugin keys, preserves a blank key and rejects member configuration', async () => {
    db.seed('settings', [{ tenant_id: 'a' }]);
    expect((await request(app).put('/api/signatures/config').set('x-user', 'member').send({ provider: 'docuseal', docuseal_api_key: 'secret' })).status).toBe(403);
    expect((await request(app).put('/api/signatures/config').send({ provider: 'docuseal', docuseal_api_key: 'secret' })).status).toBe(200);
    const value = db.getTable('settings')[0].docuseal_api_key; expect(value).not.toBe('secret'); expect(decryptSecretMaybe(value)).toBe('secret');
    await request(app).put('/api/signatures/config').send({ provider: 'docuseal', docuseal_api_key: '' }); expect(db.getTable('settings')[0].docuseal_api_key).toBe(value);
    const view = await request(app).get('/api/signatures/status'); expect(view.body.docuseal_connected).toBe(true); expect(JSON.stringify(view.body)).not.toContain('secret');
  });
  it('never lets a tenant activate the platform provider', async () => { expect((await request(app).put('/api/signatures/config').send({ provider: 'firma' })).status).toBe(400); });
  it('pins an old request to Zoho after Firma is enabled and stops follow-up on completion', async () => {
    seed({ signature_provider: 'zoho', signature_request_id: '123', signature_status: 'inprogress' });
    db.seed('settings', [{ tenant_id: 'a', zoho_client_id: 'id', zoho_client_secret: 'secret', zoho_sign_refresh_token: 'token', zoho_data_center: 'eu' }]);
    db.seed('platform_settings', [{ key: 'firma_signature', value: { enabled: true } }]);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, status: 'success', requests: { request_status: 'completed' } }), { status: 200 })); vi.stubGlobal('fetch', fetcher);
    const result = await request(app).post('/api/proposals/p/signature/sync'); expect(result.status).toBe(200); expect(result.body.signature_status).toBe('completed');
    expect(result.body.last_response_at).toBeTruthy(); expect(result.body.next_follow_up_at).toBeNull(); expect(fetcher.mock.calls[1][0]).toContain('sign.zoho.eu');
  });
});
describe('safe signature sending', () => {
  it('uses a workspace key and the last page, then blocks a duplicate', async () => {
    seed({ status: 'Draft' }); db.seed('settings', [{ tenant_id: 'a', firma_workspace_api_key: 'workspace-a' }]); db.seed('platform_settings', [{ key: 'firma_signature', value: { enabled: true } }]);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'envelope-a', status: 'sent' }), { status: 201 })); vi.stubGlobal('fetch', fetcher);
    const bytes = await pdfBytes();
    const result = await request(app).post('/api/proposals/p/signature').field('recipient_email', 'client@example.test').field('recipient_name', 'Élise Dubois').attach('file', bytes, 'proposal.pdf');
    expect(result.status).toBe(200); expect(result.body.signature_provider).toBe('firma'); expect(result.body.signature_request_id).toBe('envelope-a');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('workspace-a'); const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.fields[0]).toMatchObject({ page: 2, type: 'signature', required: true });
    expect((await request(app).post('/api/proposals/p/signature').attach('file', bytes, 'proposal.pdf')).status).toBe(409); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('blocks retry after an ambiguous provider timeout', async () => {
    seed({ status: 'Draft' }); db.seed('settings', [{ tenant_id: 'a', docuseal_api_key: 'docuseal-key', docuseal_region: 'eu' }]);
    const fetcher = vi.fn().mockRejectedValue(new Error('timeout')); vi.stubGlobal('fetch', fetcher); const bytes = await pdfBytes();
    expect((await request(app).post('/api/proposals/p/signature').field('recipient_email', 'client@example.test').field('recipient_name', 'Client').attach('file', bytes, 'proposal.pdf')).status).toBe(502);
    expect(db.getTable('proposals')[0].signature_status).toBe('unknown'); expect((await request(app).post('/api/proposals/p/signature').attach('file', bytes, 'proposal.pdf')).status).toBe(409); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-tenant and invalid-PDF requests before calling a provider', async () => {
    seed(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await request(app).post('/api/proposals/p/signature').set('x-user', 'other').field('recipient_name', 'Client')).status).toBe(404);
    expect((await request(app).post('/api/proposals/p/signature').field('recipient_email', 'a@example.test').field('recipient_name', 'Client').attach('file', Buffer.from('not-pdf'), 'x.pdf')).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses DocuSeal only with the agency key and explicit required signature field', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ submission_id: 42 }]), { status: 200 })); vi.stubGlobal('fetch', fetcher);
    const remember = vi.fn(); await sendSignature({ provider: 'docuseal', base: 'https://api.docuseal.eu', key: 'agency-key' }, { bytes: await pdfBytes(), email: 'a@example.test', name: 'Client', title: 'P-1' }, remember);
    expect(remember).toHaveBeenCalledWith('42'); expect(fetcher.mock.calls[0][1].headers['X-Auth-Token']).toBe('agency-key');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).documents[0].fields[0]).toMatchObject({ type: 'signature', required: true, role: 'Client' });
  });
  it('provisions an encrypted isolated workspace once', async () => {
    vi.stubEnv('FIRMA_API_KEY', 'firma_live_master'); db.seed('settings', [{ tenant_id: 'a' }]);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'ws-a', api_key: 'workspace-a' }), { status: 201 })); vi.stubGlobal('fetch', fetcher);
    expect(await firmaWorkspaceKey(db, 'a', db.getTable('settings')[0])).toBe('workspace-a');
    expect(db.getTable('settings')[0].firma_workspace_api_key).not.toBe('workspace-a');
    expect(await firmaWorkspaceKey(db, 'a', db.getTable('settings')[0])).toBe('workspace-a'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe('Zoho OAuth isolation', () => {
  it('issues scoped one-time state and refuses callback replay', async () => {
    db.seed('settings', [{ tenant_id: 'a', zoho_client_id: 'id', zoho_client_secret: 'secret', zoho_data_center: 'eu' }]);
    db.seed('tenant_memberships', [{ tenant_id: 'a', user_id: 'admin', system_role: 'admin' }]); db.seed('tenants', [{ id: 'a' }]);
    const auth = await request(app).get('/api/zoho-sign/auth'); expect(auth.status).toBe(200);
    const url = new URL(auth.body.url); expect(url.searchParams.get('scope')).toContain('ZohoSign.documents.CREATE'); const state = url.searchParams.get('state')!;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ refresh_token: 'sign-only' }), { status: 200 })));
    expect((await request(app).get('/api/zoho-sign/callback').query({ code: 'code', state })).headers.location).toContain('zoho_sign_connected=1');
    expect(decryptSecretMaybe(db.getTable('settings')[0].zoho_sign_refresh_token)).toBe('sign-only');
    expect((await request(app).get('/api/zoho-sign/callback').query({ code: 'code', state })).headers.location).toContain('zoho_sign_error');
  });
});
