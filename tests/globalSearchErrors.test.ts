import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { registerGlobalSearchRoutes } from '../server/routes/globalSearch';
function setup() {
  const db = new FakeSupabaseAdmin();
  const app = express(); app.use((req: any, _res, next) => { req.user = { id: 'u1' }; next(); });
  registerGlobalSearchRoutes(app, { supabaseAdmin: db, getTenantId: async () => 't1' });
  db.seed('projects', [{ id: 'p1', tenant_id: 't1', name: 'Dupont' }, { id: 'p2', tenant_id: 't2', name: 'Dupont autre cabinet' }]);
  return { db, app };
}
afterEach(() => vi.restoreAllMocks());
describe('global search database failures', () => {
  it('returns actual matches restricted to the current practice', async () => {
    const { app } = setup(); const response = await request(app).get('/api/search?q=Dupont');
    expect(response.status).toBe(200); expect(response.body.projects.map((p: any) => p.id)).toEqual(['p1']);
  });
  it.each(['projects', 'contacts', 'tenders', 'invoices'])('returns an error rather than empty/partial results if %s fails', async table => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, app } = setup(); const from = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation(name => {
      const query = from(name);
      if (name === table) vi.spyOn(query, 'limit').mockReturnValue(Promise.resolve({ data: null, error: { message: 'Database unavailable' } }) as any);
      return query;
    });
    const response = await request(app).get('/api/search?q=Dupont');
    expect(response.status).toBe(500); expect(response.body).toEqual({ error: 'Search failed' });
  });
  it('keeps the short-query response empty without querying tables', async () => {
    const { db, app } = setup(); const from = vi.spyOn(db, 'from');
    expect((await request(app).get('/api/search?q=a')).body.projects).toEqual([]); expect(from).not.toHaveBeenCalled();
  });
});
