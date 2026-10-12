import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { getAgentMissionSettings } from '../server/agentMissionSettings';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

describe('préférences agentiques par cabinet', () => {
  it('n’autorise pas un simple collaborateur à activer la capture de mails', async () => {
    const tenant = makeTenant({ agent_missions_enabled: true, agent_missions_capture_mail: false, agent_missions_capture_mail_review: false });
    const { token } = makeUser(tenant, 'user');
    const response = await request(app).patch('/api/agent-missions/settings')
      .set(authHeader(token)).set('x-user-role', 'admin').send({ capture_mail: true });
    expect(response.status).toBe(403);
    expect((await getAgentMissionSettings(fakeSupabaseAdmin, tenant)).capture_mail).toBe(false);
  });

  it('l’administrateur change uniquement les préférences de son cabinet', async () => {
    const tenant = makeTenant({ agent_missions_enabled: true, agent_missions_capture_mail: false, agent_missions_capture_mail_review: false });
    const other = makeTenant({ agent_missions_enabled: true, agent_missions_capture_mail: false, agent_missions_capture_mail_review: false });
    const { token } = makeUser(tenant, 'admin');
    const response = await request(app).patch('/api/agent-missions/settings')
      .set(authHeader(token)).send({ enabled: false, capture_mail: true });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enabled: false, capture_mail: true, capture_mail_review: false });
    expect((await getAgentMissionSettings(fakeSupabaseAdmin, other)).capture_mail).toBe(false);
    const status = await request(app).get('/api/agent-missions').set(authHeader(token));
    expect(status.status).toBe(200);
    expect(status.body.processing_enabled).toBe(false);
  });

  it('refuse les réglages non booléens ou des clés arbitraires', async () => {
    const tenant = makeTenant({ agent_missions_enabled: true, agent_missions_capture_mail: false, agent_missions_capture_mail_review: false });
    const { token } = makeUser(tenant, 'admin');
    const invalid = await request(app).patch('/api/agent-missions/settings')
      .set(authHeader(token)).send({ enabled: 'true', tenant_id: 'autre' });
    expect(invalid.status).toBe(400);
    expect((await getAgentMissionSettings(fakeSupabaseAdmin, tenant)).enabled).toBe(true);
  });

  it('échoue de manière sécurisée si les préférences ne sont pas disponibles', async () => {
    const tenant = makeTenant();
    expect(await getAgentMissionSettings(fakeSupabaseAdmin, tenant))
      .toEqual({ enabled: false, capture_mail: false, capture_mail_review: false });
  });
});
