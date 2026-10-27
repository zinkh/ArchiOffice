// Suivi de relation d'un contact (statut, rappel, société de rattachement) : validation côté serveur.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed() {
  const tenantId = makeTenant();
  const user = makeUser(tenantId, 'admin');
  const other = makeTenant();
  fakeSupabaseAdmin.seed('contacts', [
    { id: `${tenantId}-soc`, tenant_id: tenantId, first_name: '', last_name: '', company_name: 'Selia' },
    { id: `${tenantId}-soc2`, tenant_id: tenantId, first_name: '', last_name: '', company_name: 'Filiale', company_contact_id: `${tenantId}-soc` },
    { id: `${tenantId}-p`, tenant_id: tenantId, first_name: 'Claire', last_name: 'Aubry' },
    { id: `${other}-x`, tenant_id: other, first_name: '', last_name: '', company_name: 'Autre cabinet' },
  ]);
  return { tenantId, user, other, soc: `${tenantId}-soc`, soc2: `${tenantId}-soc2`, p: `${tenantId}-p`, foreign: `${other}-x` };
}

const put = (token: string, id: string, body: object) => request(app).put(`/api/contacts/${id}`).set(authHeader(token)).send(body);

describe('suivi de relation des contacts', () => {
  it('enregistre statut, rappel et société de rattachement', async () => {
    const { tenantId, user, p, soc } = seed();
    const res = await put(user.token, p, { relation_status: 'prospect', relation_reminder_on: '2026-11-15', relation_reminder_note: ' Rappeler pour le devis ', company_contact_id: soc });
    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('contacts').find((c: any) => c.id === p && c.tenant_id === tenantId);
    expect(row).toMatchObject({ relation_status: 'prospect', relation_reminder_on: '2026-11-15', relation_reminder_note: 'Rappeler pour le devis', company_contact_id: soc });
  });

  it('efface avec des valeurs vides', async () => {
    const { tenantId, user, p, soc } = seed();
    await put(user.token, p, { relation_status: 'client', company_contact_id: soc });
    expect((await put(user.token, p, { relation_status: '', company_contact_id: null, relation_reminder_on: '' })).status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('contacts').find((c: any) => c.id === p && c.tenant_id === tenantId);
    expect(row).toMatchObject({ relation_status: null, company_contact_id: null, relation_reminder_on: null });
  });

  it('refuse un statut inconnu, une date invalide, soi-même, un autre cabinet et une chaîne de sociétés', async () => {
    const { user, p, soc, soc2, foreign } = seed();
    expect((await put(user.token, p, { relation_status: 'vip' })).status).toBe(400);
    expect((await put(user.token, p, { relation_reminder_on: '15/11/2026' })).status).toBe(400);
    expect((await put(user.token, p, { company_contact_id: p })).status).toBe(400);
    expect((await put(user.token, p, { company_contact_id: foreign })).status).toBe(400);
    expect((await put(user.token, p, { company_contact_id: soc2 })).status).toBe(400); // soc2 est déjà rattachée à soc
    expect((await put(user.token, p, { company_contact_id: soc })).status).toBe(200);
  });
});

describe('alerte de relance échue', () => {
  it('signale un rappel dépassé, ignore le futur et les contacts personnels', async () => {
    const { ALERT_RULES_BY_CODE } = await import('../server/agentAlerts');
    const regle = ALERT_RULES_BY_CODE.get('contact_relance_echue')!;
    const snapshot = {
      tenantId: 't', now: new Date('2026-11-20T08:00:00.000Z'),
      contactReminders: [
        { id: 'a', company_name: 'Selia', relation_reminder_on: '2026-11-15', relation_reminder_note: 'Devis' },
        { id: 'b', first_name: 'Claire', last_name: 'Aubry', relation_reminder_on: '2026-12-01' },
        { id: 'c', company_name: 'Privé', relation_reminder_on: '2026-01-01', is_personal: true },
        { id: 'd', company_name: 'Sans date', relation_reminder_on: null },
      ],
    };
    const alertes = regle.evaluate(snapshot as any, 0);
    expect(alertes.map(a => a.dedupKey)).toEqual(['contact_relance_echue:a']);
    expect(alertes[0].message).toContain('Devis');
  });
});
