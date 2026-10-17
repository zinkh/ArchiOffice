// Journal des appels téléphoniques : saisie, attribution à un collaborateur
// (avec notification), isolation entre cabinets et création d'une tâche de suivi.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { buildTaskFromCall } from '../server/routes/phoneCalls';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function outboxFor(userId: string) {
  return fakeSupabaseAdmin.getTable('notification_outbox').filter(r => r.user_id === userId);
}

describe('Appels téléphoniques', () => {
  it('saisit un appel avec des valeurs par défaut puis le relit dans la liste', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/phone-calls').set(authHeader(token))
      .send({ subject: 'Devis charpente', caller_name: 'M. Durand' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ direction: 'entrant', status: 'a_traiter', priority: 'normal', assignee_id: null });

    const listed = await request(app).get('/api/phone-calls').set(authHeader(token));
    expect(listed.status).toBe(200);
    expect(listed.body.map((c: any) => c.id)).toContain(created.body.id);
  });

  it('refuse un appel sans objet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/phone-calls').set(authHeader(token)).send({ subject: '   ' });
    expect(res.status).toBe(400);
  });

  it('prévient le collaborateur auquel l\'appel est attribué, mais pas celui qui se l\'attribue', async () => {
    const tenantId = makeTenant();
    const author = makeUser(tenantId);
    const colleague = makeUser(tenantId);

    await request(app).post('/api/phone-calls').set(authHeader(author.token))
      .send({ subject: 'Rappeler le maître d\'ouvrage', assignee_id: colleague.userId });
    const notified = outboxFor(colleague.userId);
    expect(notified).toHaveLength(1);
    expect(notified[0].url).toMatch(/^\/appels\?open=/);

    await request(app).post('/api/phone-calls').set(authHeader(author.token))
      .send({ subject: 'Pour moi', assignee_id: author.userId });
    expect(outboxFor(author.userId)).toHaveLength(0);
  });

  it('ne renotifie qu\'à un changement d\'assigné, pas à un changement de statut', async () => {
    const tenantId = makeTenant();
    const author = makeUser(tenantId);
    const colleague = makeUser(tenantId);
    const other = makeUser(tenantId);

    const created = await request(app).post('/api/phone-calls').set(authHeader(author.token))
      .send({ subject: 'Suivi chantier', assignee_id: colleague.userId });
    const id = created.body.id;
    expect(outboxFor(colleague.userId)).toHaveLength(1);

    await request(app).put(`/api/phone-calls/${id}`).set(authHeader(author.token)).send({ status: 'en_cours' });
    expect(outboxFor(colleague.userId)).toHaveLength(1);

    await request(app).put(`/api/phone-calls/${id}`).set(authHeader(author.token)).send({ assignee_id: other.userId });
    expect(outboxFor(other.userId)).toHaveLength(1);
    expect(fakeSupabaseAdmin.getTable('phone_calls').find(c => c.id === id)?.assignee_id).toBe(other.userId);
  });

  it('refuse un assigné, un projet ou un contact d\'un autre cabinet', async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    const { token } = makeUser(tenantA);
    const foreign = makeUser(tenantB);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-b', tenant_id: tenantB }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-b', tenant_id: tenantB }]);

    for (const body of [
      { assignee_id: foreign.userId },
      { project_id: 'proj-b' },
      { contact_id: 'contact-b' },
    ]) {
      const res = await request(app).post('/api/phone-calls').set(authHeader(token)).send({ subject: 'Appel', ...body });
      expect(res.status).toBe(400);
    }
    expect(fakeSupabaseAdmin.getTable('phone_calls').filter(c => c.tenant_id === tenantA)).toHaveLength(0);
  });

  it('ne laisse jamais un cabinet lire, modifier ni supprimer l\'appel d\'un autre', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('phone_calls', [{ id: 'call-b', tenant_id: tenantB, subject: 'Secret', status: 'a_traiter' }]);
    const tenantA = makeUser(makeTenant());

    const listed = await request(app).get('/api/phone-calls').set(authHeader(tenantA.token));
    expect(listed.body.some((c: any) => c.id === 'call-b')).toBe(false);

    const updated = await request(app).put('/api/phone-calls/call-b').set(authHeader(tenantA.token)).send({ status: 'traite' });
    expect(updated.status).toBe(404);
    await request(app).delete('/api/phone-calls/call-b').set(authHeader(tenantA.token));
    expect(fakeSupabaseAdmin.getTable('phone_calls').find(c => c.id === 'call-b')).toMatchObject({ status: 'a_traiter' });
  });

  it('filtre par assigné et par statut, "none" désignant les appels non attribués', async () => {
    const tenantId = makeTenant();
    const author = makeUser(tenantId);
    const colleague = makeUser(tenantId);
    await request(app).post('/api/phone-calls').set(authHeader(author.token)).send({ subject: 'A', assignee_id: colleague.userId });
    await request(app).post('/api/phone-calls').set(authHeader(author.token)).send({ subject: 'B', status: 'traite' });

    const mine = await request(app).get(`/api/phone-calls?assignee_id=${colleague.userId}`).set(authHeader(author.token));
    expect(mine.body.map((c: any) => c.subject)).toEqual(['A']);
    const unassigned = await request(app).get('/api/phone-calls?assignee_id=none').set(authHeader(author.token));
    expect(unassigned.body.map((c: any) => c.subject)).toEqual(['B']);
    const done = await request(app).get('/api/phone-calls?status=traite').set(authHeader(author.token));
    expect(done.body.map((c: any) => c.subject)).toEqual(['B']);
  });

  it('rejoue une création avec le même identifiant sans la dupliquer (file hors ligne)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const body = { id: 'call-offline-1', subject: 'Saisi sur le chantier' };
    const first = await request(app).post('/api/phone-calls').set(authHeader(token)).send(body);
    const replay = await request(app).post('/api/phone-calls').set(authHeader(token)).send(body);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('phone_calls').filter(c => c.id === 'call-offline-1')).toHaveLength(1);
  });

  it('ignore un tenant_id ou un created_by envoyé dans le corps d\'un PUT', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const created = await request(app).post('/api/phone-calls').set(authHeader(token)).send({ subject: 'Appel' });
    await request(app).put(`/api/phone-calls/${created.body.id}`).set(authHeader(token))
      .send({ notes: 'ok', tenant_id: 'autre', created_by: 'pirate' });
    const row = fakeSupabaseAdmin.getTable('phone_calls').find(c => c.id === created.body.id);
    expect(row?.tenant_id).toBe(tenantId);
    expect(row?.created_by).not.toBe('pirate');
    expect(row?.notes).toBe('ok');
  });
});

describe('Tâche créée depuis un appel', () => {
  it('crée la tâche attribuée au même collaborateur, lie l\'appel et le passe en cours', async () => {
    const tenantId = makeTenant();
    const author = makeUser(tenantId);
    const colleague = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-1', tenant_id: tenantId }]);
    const call = await request(app).post('/api/phone-calls').set(authHeader(author.token)).send({
      subject: 'Reprise des réserves', caller_name: 'Mme Petit', caller_phone: '0600000000',
      project_id: 'proj-1', assignee_id: colleague.userId, priority: 'high', callback_due: '2099-01-15', notes: 'Rappeler avant midi',
    });

    const res = await request(app).post(`/api/phone-calls/${call.body.id}/task`).set(authHeader(author.token));
    expect(res.status).toBe(201);
    expect(res.body.task).toMatchObject({
      title: 'Suite à l\'appel : Reprise des réserves', assignee_id: colleague.userId,
      project_id: 'proj-1', priority: 'high', due_date: '2099-01-15', status: 'todo',
    });
    expect(res.body.task.description).toContain('Mme Petit');
    expect(res.body.task.description).toContain('Rappeler avant midi');
    expect(res.body.call).toMatchObject({ task_id: res.body.task.id, status: 'en_cours' });
  });

  it('ne crée pas une seconde tâche quand l\'appel a déjà la sienne', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const call = await request(app).post('/api/phone-calls').set(authHeader(token)).send({ subject: 'Un seul suivi' });
    const first = await request(app).post(`/api/phone-calls/${call.body.id}/task`).set(authHeader(token));
    const second = await request(app).post(`/api/phone-calls/${call.body.id}/task`).set(authHeader(token));
    expect(second.status).toBe(200);
    expect(second.body.already_exists).toBe(true);
    expect(second.body.task.id).toBe(first.body.task.id);
    expect(fakeSupabaseAdmin.getTable('tasks').filter(t => t.tenant_id === tenantId)).toHaveLength(1);
  });

  it('répond 404 pour un appel d\'un autre cabinet', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('phone_calls', [{ id: 'call-b2', tenant_id: tenantB, subject: 'Secret' }]);
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/phone-calls/call-b2/task').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('borne les dates de la tâche : une échéance passée ou absente donne une tâche du jour', () => {
    const today = '2026-10-17';
    expect(buildTaskFromCall({ subject: 'X', callback_due: '2026-10-01' }, today)).toMatchObject({ start_date: today, end_date: today, due_date: '2026-10-01' });
    expect(buildTaskFromCall({ subject: 'X' }, today)).toMatchObject({ end_date: today, due_date: null, description: null });
    expect(buildTaskFromCall({ subject: 'X', callback_due: '2026-10-30' }, today)).toMatchObject({ end_date: '2026-10-30' });
  });
});
