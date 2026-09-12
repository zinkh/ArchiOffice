// Phase 7 batch 6: end-to-end Supertest coverage for the domains extracted
// into server/routes/{contactSync,geoProxy}.ts — confirms the extraction
// didn't change behavior.
//
// Contact Sync tests stub global.fetch to simulate the external Google
// People API / CardDAV server response, so the tenant-scoped
// create-vs-update-by-email logic is actually exercised end to end.
//
// Geo Proxy routes are stateless proxies onto live French government APIs
// (IGN, data.gouv.fr, Géoportail de l'Urbanisme, data.culture.gouv.fr) and
// Open-Meteo — this sandbox has no network access to them, so only the
// input-validation branches (which return before any network call) are
// covered here, not the live proxying itself.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import dns from 'dns/promises';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Contact Sync', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  // The CardDAV route validates its URL through the SSRF guard, which resolves
  // the host and rejects private/unresolvable targets. The sandbox has no DNS,
  // so stub the lookup to a public address — the analogue of the fetch stubs
  // below (network calls the test can't actually make).
  const stubDnsPublic = () =>
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

  it('requires an access_token for Google Contacts sync', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({});
    expect(res.status).toBe(400);
  });

  it('imports new Google contacts and updates existing ones by email, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'c-existing', tenant_id: tenantId, email: 'existing@example.com', first_name: 'Old' }]);

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        connections: [
          { names: [{ givenName: 'New', familyName: 'Contact' }], emailAddresses: [{ value: 'new@example.com' }] },
          { names: [{ givenName: 'Updated', familyName: 'Name' }], emailAddresses: [{ value: 'existing@example.com' }] },
        ],
      }),
    })) as any;

    const res = await request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({ access_token: 'tok' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: 1, updated: 1, pushedCreated: 0, pushedUpdated: 0, pulledOnConflict: 0 });
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.email === 'new@example.com')?.tenant_id).toBe(tenantId);
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'c-existing')?.first_name).toBe('Updated');
  });

  it('never dedups against another tenant\'s contact with the same email', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: 'c-b', tenant_id: tenantB, email: 'shared@example.com', first_name: 'Foreign' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ connections: [{ names: [{ givenName: 'Mine' }], emailAddresses: [{ value: 'shared@example.com' }] }] }),
    })) as any;

    const res = await request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({ access_token: 'tok' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: 1, updated: 0, pushedCreated: 0, pushedUpdated: 0, pulledOnConflict: 0 });
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'c-b')?.first_name).toBe('Foreign');
    expect(fakeSupabaseAdmin.getTable('contacts').filter(c => c.email === 'shared@example.com' && c.tenant_id === tenantA)).toHaveLength(1);
  });

  describe('push direction (ArchiOffice → Google Contacts)', () => {
    it('does not push anything when no category is selected in settings', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'c-1', tenant_id: tenantId, email: 'a@example.com', category: 'Client', first_name: 'A', last_name: 'One' }]);
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ connections: [] }) })) as any;

      const res = await request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({ access_token: 'tok' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ imported: 0, updated: 0, pushedCreated: 0, pushedUpdated: 0, pulledOnConflict: 0 });
    });

    it('never pushes a contact marked personal, even in a selected category', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('settings', [{ id: 's-personal', tenant_id: tenantId, google_contacts_sync_categories: ['Client'] }]);
      fakeSupabaseAdmin.seed('contacts', [{
        id: 'c-push-personal', tenant_id: tenantId, email: 'a@example.com', category: 'Client',
        first_name: 'A', last_name: 'One', is_personal: true,
      }]);
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ connections: [] }) })) as any;

      const res = await request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({ access_token: 'tok' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ imported: 0, updated: 0, pushedCreated: 0, pushedUpdated: 0, pulledOnConflict: 0 });
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'c-push-personal')?.google_resource_name).toBeUndefined();
    });

    it('creates a new Google contact for an unlinked contact in a selected category', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('settings', [{ id: 's-1', tenant_id: tenantId, google_contacts_sync_categories: ['Client'] }]);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'c-push-create', tenant_id: tenantId, email: 'a@example.com', category: 'Client', first_name: 'A', last_name: 'One' }]);

      global.fetch = vi.fn(async (url: string, init?: any) => {
        if (String(url).includes('/people/me/connections')) return { ok: true, json: async () => ({ connections: [] }) };
        if (init?.method === 'POST' && String(url).includes('people:createContact')) {
          return { ok: true, json: async () => ({ resourceName: 'people/new123' }) };
        }
        throw new Error(`Unexpected fetch: ${init?.method || 'GET'} ${url}`);
      }) as any;

      const res = await request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({ access_token: 'tok' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ imported: 0, updated: 0, pushedCreated: 1, pushedUpdated: 0, pulledOnConflict: 0 });
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'c-push-create')?.google_resource_name).toBe('people/new123');
    });

    it('links to an existing Google connection by email instead of creating a duplicate', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('settings', [{ id: 's-2', tenant_id: tenantId, google_contacts_sync_categories: ['Client'] }]);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'c-push-link', tenant_id: tenantId, email: 'a@example.com', category: 'Client', first_name: 'A', last_name: 'One' }]);

      global.fetch = vi.fn(async (url: string) => {
        if (String(url).includes('/people/me/connections')) {
          return { ok: true, json: async () => ({ connections: [{ resourceName: 'people/already123', emailAddresses: [{ value: 'a@example.com' }] }] }) };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as any;

      const res = await request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({ access_token: 'tok' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ imported: 0, updated: 1, pushedCreated: 0, pushedUpdated: 1, pulledOnConflict: 0 });
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'c-push-link')?.google_resource_name).toBe('people/already123');
    });

    it('a more recently modified local contact overwrites the linked Google contact', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('settings', [{ id: 's-3', tenant_id: tenantId, google_contacts_sync_categories: ['Client'] }]);
      fakeSupabaseAdmin.seed('contacts', [{
        id: 'c-push-local-wins', tenant_id: tenantId, email: 'a@example.com', category: 'Client', first_name: 'A', last_name: 'One',
        google_resource_name: 'people/linked1', updated_at: '2026-06-01T00:00:00.000Z',
      }]);

      global.fetch = vi.fn(async (url: string, init?: any) => {
        if (String(url).includes('/people/me/connections')) return { ok: true, json: async () => ({ connections: [] }) };
        if (String(url).includes('people/linked1') && (!init || !init.method)) {
          return { ok: true, json: async () => ({ etag: 'etag-1', metadata: { sources: [{ type: 'CONTACT', updateTime: '2026-01-01T00:00:00.000Z' }] } }) };
        }
        if (init?.method === 'PATCH' && String(url).includes('people/linked1:updateContact')) {
          return { ok: true, json: async () => ({}) };
        }
        throw new Error(`Unexpected fetch: ${init?.method || 'GET'} ${url}`);
      }) as any;

      const res = await request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({ access_token: 'tok' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ imported: 0, updated: 0, pushedCreated: 0, pushedUpdated: 1, pulledOnConflict: 0 });
    });

    it('a more recently modified Google contact overwrites the local one instead of being clobbered', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('settings', [{ id: 's-4', tenant_id: tenantId, google_contacts_sync_categories: ['Client'] }]);
      fakeSupabaseAdmin.seed('contacts', [{
        id: 'c-push-google-wins', tenant_id: tenantId, email: 'a@example.com', category: 'Client', first_name: 'A', last_name: 'One',
        google_resource_name: 'people/linked1', updated_at: '2026-01-01T00:00:00.000Z',
      }]);

      global.fetch = vi.fn(async (url: string, init?: any) => {
        if (String(url).includes('/people/me/connections')) return { ok: true, json: async () => ({ connections: [] }) };
        if (String(url).includes('people/linked1') && (!init || !init.method)) {
          return {
            ok: true,
            json: async () => ({
              names: [{ givenName: 'Fresher', familyName: 'FromGoogle' }],
              emailAddresses: [{ value: 'a@example.com' }],
              metadata: { sources: [{ type: 'CONTACT', updateTime: '2026-06-01T00:00:00.000Z' }] },
            }),
          };
        }
        throw new Error(`Unexpected fetch: ${init?.method || 'GET'} ${url}`);
      }) as any;

      const res = await request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({ access_token: 'tok' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ imported: 0, updated: 0, pushedCreated: 0, pushedUpdated: 0, pulledOnConflict: 1 });
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'c-push-google-wins')?.first_name).toBe('Fresher');
    });
  });

  it('requires url and username for CardDAV sync', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/sync/carddav').set(authHeader(token)).send({});
    expect(res.status).toBe(400);
  });

  it('imports CardDAV vCards, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const vcard = 'BEGIN:VCARD\nFN:Jean Dupont\nN:Dupont;Jean\nEMAIL:jean@example.com\nTEL:0600000000\nORG:ArchiCo\nEND:VCARD';
    global.fetch = vi.fn(async () => ({ ok: true, text: async () => vcard })) as any;
    stubDnsPublic();

    const res = await request(app).post('/api/sync/carddav').set(authHeader(token)).send({ url: 'https://carddav.example.com', username: 'u', password: 'p' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: 1, updated: 0 });
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.email === 'jean@example.com')?.tenant_id).toBe(tenantId);
  });

  it('rejects a CardDAV URL that resolves to a private address (SSRF guard)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);

    const res = await request(app).post('/api/sync/carddav').set(authHeader(token))
      .send({ url: 'http://metadata.internal/', username: 'u', password: 'p' });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Geo Proxy input validation', () => {
  it('rejects address-search without q or banId', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/address-search').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects weather without q and date', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/weather').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects urban-planning/documents without insee, grid, or partition', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/urban-planning/documents').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects historical-monuments without lat/lon', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/historical-monuments').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects historical-monuments with non-numeric lat/lon', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/historical-monuments').query({ lat: 'x', lon: 'y' }).set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects cadastre/parcel without lon/lat or bbox', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/cadastre/parcel').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects cadastre/parcel with a malformed bbox', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/cadastre/parcel').query({ bbox: '1,2,3' }).set(authHeader(token));
    expect(res.status).toBe(400);
  });

  // The following five (rnb-buildings, georisques, urbanisme, bdnb-geocode,
  // bdnb) joined geoProxy.ts in a later lot — same module, same sandbox
  // network limitation, so only their validation branches are exercised here.
  it('rejects rnb-buildings without q', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/rnb-buildings').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  // rnb-buildings used a bare, unbounded `fetch()` (unlike every other proxy
  // in this file, which goes through fetchWithTimeout) — a hung upstream
  // could tie up the request indefinitely. Covers both the fix (still calls
  // through and returns data normally) and the AbortError → 504 mapping now
  // shared with the rest of the module.
  describe('rnb-buildings network calls', () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });

    it('proxies a successful RNB API response', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => ([{ rnb_id: 'ABC123' }]) })) as any;

      const res = await request(app).get('/api/rnb-buildings').query({ q: '10 rue de Paris' }).set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ rnb_id: 'ABC123' }]);
    });

    it('maps a timed-out RNB API call to 504', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      global.fetch = vi.fn(async () => { const e: any = new Error('aborted'); e.name = 'AbortError'; throw e; }) as any;

      const res = await request(app).get('/api/rnb-buildings').query({ q: '10 rue de Paris' }).set(authHeader(token));
      expect(res.status).toBe(504);
    });
  });

  it('rejects georisques without latitude/longitude/code_insee', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/georisques').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects urbanisme without geom', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/urbanisme').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects urbanisme with malformed GeoJSON', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/urbanisme').query({ geom: '{not json' }).set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects bdnb-geocode without q', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/bdnb-geocode').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects bdnb without q or banId', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/bdnb').set(authHeader(token));
    expect(res.status).toBe(400);
  });
});
