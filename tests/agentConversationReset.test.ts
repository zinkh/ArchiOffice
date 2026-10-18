import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { registerAgentRoutes } from '../packages/archioffice-agents/src/server/routes';

function setup() {
  const db = new FakeSupabaseAdmin();
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { req.user = { id: 'u1' }; next(); });
  registerAgentRoutes(app, db, async () => 't1', async () => ({ plan: 'enterprise', trial_ends_at: null, is_expired: false }));
  db.seed('agent_conversations', [
    { id: 'c1', agent_id: 'a1', user_id: 'u1', tenant_id: 't1', attached_document_ids: ['d1'] },
    { id: 'c2', agent_id: 'a1', user_id: 'u2', tenant_id: 't1', attached_document_ids: ['d2'] },
    { id: 'c3', agent_id: 'a1', user_id: 'u1', tenant_id: 't2', attached_document_ids: ['d3'] },
  ]);
  db.seed('agent_messages', [
    { id: 'm1', conversation_id: 'c1', tenant_id: 't1' },
    { id: 'm2', conversation_id: 'c2', tenant_id: 't1' },
    { id: 'm3', conversation_id: 'c3', tenant_id: 't2' },
  ]);
  return { db, app };
}
afterEach(() => vi.restoreAllMocks());
describe('conversation deletion returns a confirmed result', () => {
  it('clears only the authenticated user conversation in the current practice', async () => {
    const { db, app } = setup();
    expect((await request(app).delete('/api/agents/a1/conversation')).status).toBe(200);
    expect(db.getTable('agent_messages').map(m => m.id)).toEqual(['m2', 'm3']);
    expect(db.getTable('agent_conversations').find(c => c.id === 'c1')?.attached_document_ids).toEqual([]);
    expect(db.getTable('agent_conversations').find(c => c.id === 'c2')?.attached_document_ids).toEqual(['d2']);
  });
  it('treats an already absent conversation as an idempotent success', async () => {
    const { app } = setup();
    expect((await request(app).delete('/api/agents/missing/conversation')).status).toBe(200);
  });
  it.each(['read', 'delete', 'update'] as const)('does not report success when %s fails', async stage => {
    const { db, app } = setup();
    const from = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation((table: string) => {
      const query = from(table);
      if (stage === 'read' && table === 'agent_conversations') {
        vi.spyOn(query, 'maybeSingle').mockResolvedValue({ data: null, error: { message: 'Database unavailable' } } as any);
      }
      if ((stage === 'delete' && table === 'agent_messages') || (stage === 'update' && table === 'agent_conversations')) {
        vi.spyOn(query, stage === 'delete' ? 'delete' : 'update').mockImplementation(() => {
          const failed: any = { eq: () => failed, then: (ok: any, bad: any) => Promise.resolve({ data: null, error: { message: 'Database unavailable' } }).then(ok, bad) };
          return failed;
        });
      }
      return query;
    });
    const response = await request(app).delete('/api/agents/a1/conversation');
    expect(response.status).toBe(500);
    expect(response.body.ok).not.toBe(true);
    if (stage !== 'update') expect(db.getTable('agent_messages')).toHaveLength(3);
  });
});
