// Coverage for the multi-calendriers support (server/calendarAccounts.ts,
// server/routes/calendarAccounts.ts) — a Google Calendar *account* can now
// expose several calendars, one of which is the push target
// (POST /api/google-calendar/sync), independently of which ones are shown
// in the read-only pull (GET /api/google-calendar/events).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

process.env.MAIL_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.VITE_GOOGLE_CLIENT_ID ||= 'fake-client-id.apps.googleusercontent.com';

let app: Express;
beforeAll(async () => {
  app = await getTestApp();
});

// Ids are suffixed with userId — fakeSupabaseAdmin's tables persist across
// tests in this file (no reset between them), so a literal id reused across
// two `it()` blocks would collide in getTable() lookups by id.
function seedConnection(tenantId: string, userId: string, email: string) {
  const id = `conn-${userId}`;
  fakeSupabaseAdmin.seed('calendar_connections', [{
    id, tenant_id: tenantId, user_id: userId, provider: 'google',
    refresh_token: 'refresh-abc', access_token: 'access-abc', external_account_email: email,
  }]);
  return id;
}

function seedCalendar(tenantId: string, userId: string, connectionId: string, opts: { externalCalendarId: string; isDefault?: boolean; syncEnabled?: boolean; color?: string }) {
  const id = `cal-${userId}-${opts.externalCalendarId}`;
  fakeSupabaseAdmin.seed('calendar_calendars', [{
    id, tenant_id: tenantId, user_id: userId, connection_id: connectionId,
    external_calendar_id: opts.externalCalendarId, display_name: opts.externalCalendarId,
    color: opts.color || null, is_default: !!opts.isDefault, sync_enabled: opts.syncEnabled ?? true,
  }]);
  return id;
}

describe('GET /api/calendar/accounts', () => {
  it('lists connections with their calendars, defaults included', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    const connId = seedConnection(tenantId, userId, 'contact@aazs.fr');
    seedCalendar(tenantId, userId, connId, { externalCalendarId: 'primary', isDefault: true });
    seedCalendar(tenantId, userId, connId, { externalCalendarId: 'chantiers@group', color: '#2fb344' });

    const res = await request(app).get('/api/calendar/accounts').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].calendars).toHaveLength(2);
    expect(res.body[0].calendars.find((c: any) => c.externalCalendarId === 'primary').isDefault).toBe(true);
  });
});

describe('POST /api/calendar/calendars/:id/default', () => {
  it('moves the write target from one calendar to another and turns sync on for it', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    const connId = seedConnection(tenantId, userId, 'contact@aazs.fr');
    const cal1 = seedCalendar(tenantId, userId, connId, { externalCalendarId: 'primary', isDefault: true });
    const cal2 = seedCalendar(tenantId, userId, connId, { externalCalendarId: 'chantiers@group', syncEnabled: false });

    const res = await request(app).post(`/api/calendar/calendars/${cal2}/default`).set(authHeader(token));
    expect(res.status).toBe(200);

    const rows = fakeSupabaseAdmin.getTable('calendar_calendars');
    expect(rows.find(r => r.id === cal1)?.is_default).toBe(false);
    const newDefault = rows.find(r => r.id === cal2);
    expect(newDefault?.is_default).toBe(true);
    expect(newDefault?.sync_enabled).toBe(true);
  });
});

describe('PUT /api/calendar/calendars/:id (syncEnabled)', () => {
  it('refuses to hide the calendar currently used as the write target', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    const connId = seedConnection(tenantId, userId, 'contact@aazs.fr');
    const cal1 = seedCalendar(tenantId, userId, connId, { externalCalendarId: 'primary', isDefault: true });

    const res = await request(app).put(`/api/calendar/calendars/${cal1}`).set(authHeader(token)).send({ syncEnabled: false });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/google-calendar/events', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('only pulls from calendars marked sync_enabled, tagging each event with its calendar', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    const connId = seedConnection(tenantId, userId, 'contact@aazs.fr');
    const visibleCal = seedCalendar(tenantId, userId, connId, { externalCalendarId: 'primary', isDefault: true, syncEnabled: true, color: '#206bc4' });
    seedCalendar(tenantId, userId, connId, { externalCalendarId: 'hidden@group', syncEnabled: false });

    const calledCalendarIds: string[] = [];
    global.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.includes('/calendars/')) {
        const match = u.match(/calendars\/([^/]+)\/events/);
        calledCalendarIds.push(decodeURIComponent(match![1]));
        return { ok: true, json: async () => ({ items: [{ id: 'ev1', summary: 'RDV', status: 'confirmed', start: { date: '2026-09-10' } }] }) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    const res = await request(app).get('/api/google-calendar/events?start=2026-09-01&end=2026-09-30').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(calledCalendarIds).toEqual(['primary']);
    expect(res.body[0].calendarId).toBe(visibleCal);
    expect(res.body[0].color).toBe('#206bc4');
  });
});

describe('POST /api/google-calendar/sync', () => {
  it('400s with a clear message when no calendar is designated as the write target', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    // Aucune connexion du tout : sync doit refuser proprement, pas planter.
    const res = await request(app).post('/api/google-calendar/sync').set(authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/calendrier par défaut/i);
  });
});
