import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { registerProjectPhaseHistoryRoutes } from '../server/routes/projectPhaseHistory';
import { defaultPhaseControls } from '../server/phaseControls';

vi.mock('../server/webhookDispatch', () => ({ dispatchWebhookEvent: vi.fn() }));
function setup(role = 'pm') {
  const db = new FakeSupabaseAdmin();
  const config = structuredClone(defaultPhaseControls); config.phaseDeadlines.ESQ = '2026-01-01';
  db.seed('projects', [{ id: 'p', tenant_id: 'a', name: 'Villa', phase_control_config: config }, { id: 'other', tenant_id: 'b', name: 'Secret' }]);
  db.seed('profiles', [{ id: 'u', tenant_id: 'a', system_role: role }]);
  const app = express(); app.use(express.json()); app.use((req: any, _res, next) => { req.user = { id: 'u' }; next(); });
  registerProjectPhaseHistoryRoutes(app, { supabaseAdmin: db, getTenantId: async () => 'a', getUserName: async () => 'User', logActivity: async () => {} });
  const preview = () => request(app).get('/api/projects/p/phase-controls?to=APS');
  const submit = async (patch = {}) => {
    const { body } = await preview();
    return request(app).post('/api/projects/p/phase').send({ phase: 'APS', expectedCurrentId: body.expectedCurrentId, revision: body.revision, answers: [], createTasks: true, ...patch });
  };
  return { app, db, config, preview, submit };
}
describe('phase checklist API', () => {
  it('prevents bypassing the checklist', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/projects/p/phase').send({ phase: 'APS' })).status).toBe(400);
    expect((await request(app).post('/api/projects/p/phase').send({ phase: 'unknown' })).status).toBe(400);
  });
  it('creates dated tasks and audit once; retry does not duplicate them', async () => {
    const { db, submit } = setup();
    const first = await submit(); expect(first.status).toBe(201);
    expect(db.getTable('tasks')).toHaveLength(4);
    expect(db.getTable('tasks')[0]).toMatchObject({ due_date: '2026-01-01', tenant_id: 'a', project_id: 'p', status: 'todo' });
    expect(first.body.control_audit.task_ids).toHaveLength(4);
    await submit(); expect(db.getTable('tasks')).toHaveLength(4);
  });
  it('does not create tasks or advance when a control is blocking', async () => {
    const { db, config, submit } = setup(); config.rules.find(r => r.id === 'geotechnique')!.severity = 'blocking';
    db.getTable('projects')[0].phase_control_config = config;
    expect((await submit()).status).toBe(422);
    expect(db.getTable('tasks')).toHaveLength(0); expect(db.getTable('project_phase_history')).toHaveLength(0);
  });
  it('requires justification and a planned deadline; rejects duplicate answers', async () => {
    const { db, config, submit } = setup();
    const answer = { ruleId: 'geotechnique', status: 'not_required', justification: '' };
    expect((await submit({ answers: [answer] })).status).toBe(400);
    expect((await submit({ answers: [answer, answer] })).status).toBe(400);
    config.phaseDeadlines = {}; db.getTable('projects')[0].phase_control_config = config;
    expect((await submit()).status).toBe(422); expect(db.getTable('tasks')).toHaveLength(0);
  });
  it('accepts justified exemptions without a task', async () => {
    const { db, preview, submit } = setup(); const { body } = await preview();
    const result = await submit({ answers: body.controls.map((c: any) => ({ ...c.answer, status: 'not_required', justification: 'Mission sans travaux de sol' })), createTasks: false });
    expect(result.status).toBe(201); expect(db.getTable('tasks')).toHaveLength(0);
  });
  it('rejects another project document or cabinet assignee', async () => {
    const { db, submit } = setup();
    db.seed('documents', [{ id: 'foreign', project_id: 'other', tenant_id: 'a', name: 'Sol' }]);
    expect((await submit({ answers: [{ ruleId: 'geotechnique', status: 'done', documentId: 'foreign' }] })).status).toBe(400);
    expect((await submit({ answers: [{ ruleId: 'geotechnique', status: 'todo', assigneeId: 'foreign' }] })).status).toBe(400);
  });
  it('scopes previews, configuration and changes to the cabinet', async () => {
    const { app, config } = setup();
    expect((await request(app).get('/api/projects/other/phase-controls?to=APS')).status).toBe(404);
    expect((await request(app).put('/api/projects/other/phase-controls/config').send(config)).status).toBe(404);
    expect((await request(app).post('/api/projects/other/phase').send({ phase: 'ESQ' })).status).toBe(404);
    const viewer = setup('user');
    expect((await request(viewer.app).put('/api/projects/p/phase-controls/config').send(config)).status).toBe(403);
  });
  it('invalidates a preview after configuration changes', async () => {
    const { app, preview, config } = setup(); const { body } = await preview();
    config.context.erp = true;
    expect((await request(app).put('/api/projects/p/phase-controls/config').send(config)).status).toBe(200);
    expect((await request(app).post('/api/projects/p/phase').send({ phase: 'APS', expectedCurrentId: null, revision: body.revision, answers: [], createTasks: true })).status).toBe(409);
  });
  it('propagates storage failure without reporting success', async () => {
    const { db, submit } = setup(); vi.spyOn(db, 'rpc').mockResolvedValueOnce({ data: null, error: { message: 'disk full' } });
    expect((await submit()).status).toBe(500); expect(db.getTable('tasks')).toHaveLength(0);
  });
  it('reuses an unambiguous phase milestone and reads documents beyond the first page', async () => {
    const { db, config, preview } = setup(); config.phaseDeadlines = {};
    db.getTable('projects')[0].phase_control_config = config;
    db.seed('milestones', [{ id: 'm', tenant_id: 'a', project_id: 'p', title: 'Fin ESQ', due_date: '2026-03-15' }]);
    db.seed('documents', Array.from({ length: 1001 }, (_, i) => ({ id: `d${String(i).padStart(4, '0')}`, tenant_id: 'a', project_id: 'p', name: i === 1000 ? 'Étude géotechnique' : 'Autre' })));
    const { body } = await preview();
    expect(body.controls[0].dueDate).toBe('2026-03-15');
    expect(body.controls[0].candidates[0].id).toBe('d1000');
  });
});
