// Rappels hebdomadaires des réserves non levées (server/reserveReminders.ts) et diffusion par e-mail
// (server/routes/reserveExports.ts). nodemailer est remplacé pour capter les messages.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const sendMail = vi.fn();
vi.mock('nodemailer', async (importOriginal) => {
  const actual: any = await importOriginal();
  const createTransport = () => ({ sendMail });
  return { ...actual, createTransport, default: { ...actual.default, createTransport } };
});

import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { executerRappelsReserves } from '../server/reserveReminders';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { sendMail.mockReset(); sendMail.mockResolvedValue({ messageId: 'm1' }); });

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${++seq}`;

/** Un cabinet, une opération, deux entreprises (l'une avec adresse, l'autre sans) et quatre réserves. */
function cabinet() {
  const tenantId = makeTenant({ plan: 'pro' });
  const { token } = makeUser(tenantId, 'admin');
  fakeSupabaseAdmin.seed('settings', [{
    tenant_id: tenantId, agency_name: 'AAZS', email: 'contact@aazs.test',
    smtp_host: 'smtp.test', smtp_port: '587', smtp_user: 'u', smtp_pass: 'p',
  }]);
  const projectId = uid('proj');
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, project_code: '26014', name: 'Villa Martin' }]);
  const plat = uid('contact'); const peint = uid('contact'); const moe = uid('contact');
  // Adresse propre au cabinet : la base de test est partagée, chaque assertion ne regarde que ses envois.
  const emailPlat = `${plat}@exemple.test`;
  fakeSupabaseAdmin.seed('contacts', [
    { id: plat, tenant_id: tenantId, company_name: 'Plâtres Martin', email: emailPlat },
    { id: peint, tenant_id: tenantId, company_name: 'Peintures Durand' },
    { id: moe, tenant_id: tenantId, company_name: 'Bureau Structure', email: 'bet@exemple.test' },
  ]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: uid('lot'), tenant_id: tenantId, project_id: projectId, lot_number: '02', lot_title: 'PLATRERIE', contact_id: plat, contact_name: 'Plâtres Martin' },
    { id: uid('lot'), tenant_id: tenantId, project_id: projectId, lot_number: '10', lot_title: 'PEINTURE', contact_id: peint, contact_name: 'Peintures Durand' },
  ]);
  fakeSupabaseAdmin.seed('project_stakeholders', [{ id: uid('st'), tenant_id: tenantId, project_id: projectId, name: 'BET', role: 'Bureau d’études', contact_id: moe }]);
  const reserve = (n: number, extra: Record<string, unknown>) => ({
    id: uid('res'), tenant_id: tenantId, project_id: projectId, number: n, title: `Réserve ${n}`, status: 'A faire',
    due_date: '2020-01-01', ...extra,
  });
  const reserves = [
    reserve(1, { lots: '["PLATRERIE"]', entreprises: '["Plâtres Martin"]' }),
    reserve(2, { lots: '["PLATRERIE"]', entreprises: '["Plâtres Martin"]', status: 'Levée' }),
    reserve(3, { lots: '["PEINTURE"]', entreprises: '["Peintures Durand"]' }),
    reserve(4, { lots: '["PEINTURE"]', entreprises: '["Peintures Durand"]' }),
  ];
  fakeSupabaseAdmin.seed('reserves', reserves);
  return { tenantId, token, projectId, reserves, emailPlat };
}

const activer = (c: ReturnType<typeof cabinet>, extra: Record<string, unknown> = {}) => {
  const id = uid('rem');
  fakeSupabaseAdmin.seed('reserve_reminder_settings', [{ id, tenant_id: c.tenantId, project_id: c.projectId, kind: 'opr', enabled: true, interval_days: 7, last_run_at: null, ...extra }]);
  return id;
};
/** Messages partis vers l'entreprise à adresse de ce cabinet. */
const envoisA = (c: ReturnType<typeof cabinet>) => sendMail.mock.calls.filter(([m]) => m.to === c.emailPlat);
const journal = (c: ReturnType<typeof cabinet>) => fakeSupabaseAdmin.getTable('reserve_exports').filter((j: any) => j.project_id === c.projectId);

describe('rappels hebdomadaires', () => {
  it('envoie à chaque entreprise ses réserves non levées, puis consigne le passage', async () => {
    const c = cabinet();
    activer(c);
    const bilan = await executerRappelsReserves(fakeSupabaseAdmin);
    expect(bilan.reglages).toBe(1);
    // Plâtres Martin a une adresse ; Peintures Durand n'en a pas : échec consigné, pas d'envoi.
    expect(envoisA(c)).toHaveLength(1);
    const mail = envoisA(c)[0][0];
    expect(mail.subject).toContain('1 réserve à lever');
    expect(mail.html).toContain('Réserve 1');
    expect(mail.html).not.toContain('Réserve 3');
    const [ligne] = journal(c);
    expect(ligne).toMatchObject({ channel: 'relance', status: 'partiel', kind: 'opr' });
    expect(ligne.sends.map((s: any) => [s.name, s.status])).toEqual(expect.arrayContaining([['Plâtres Martin', 'envoye'], ['Peintures Durand', 'echec']]));
  });

  it('ne renvoie rien tant que l’intervalle n’est pas écoulé, ni deux fois d’affilée', async () => {
    const c = cabinet();
    activer(c);
    await executerRappelsReserves(fakeSupabaseAdmin);
    await executerRappelsReserves(fakeSupabaseAdmin);
    expect(envoisA(c)).toHaveLength(1);
    // Huit jours plus tard : le rappel suivant part.
    await executerRappelsReserves(fakeSupabaseAdmin, new Date(Date.now() + 8 * 86400000));
    expect(envoisA(c)).toHaveLength(2);
  });

  it('n’envoie rien quand toutes les réserves sont levées', async () => {
    const c = cabinet();
    for (const r of c.reserves) await fakeSupabaseAdmin.from('reserves').update({ status: 'Levée' }).eq('id', r.id);
    activer(c);
    await executerRappelsReserves(fakeSupabaseAdmin);
    expect(envoisA(c)).toHaveLength(0);
    expect(journal(c)).toHaveLength(0);
  });

  it('ignore un réglage désactivé et une affaire archivée', async () => {
    const c = cabinet();
    activer(c, { enabled: false });
    const c2 = cabinet();
    await fakeSupabaseAdmin.from('projects').update({ archived_at: '2026-01-01T00:00:00Z' }).eq('id', c2.projectId);
    activer(c2);
    await executerRappelsReserves(fakeSupabaseAdmin);
    expect(envoisA(c)).toHaveLength(0);
    expect(envoisA(c2)).toHaveLength(0);
  });
});

describe('diffusion : destinataires rejoués par le serveur', () => {
  it('liste intervenants (rapport complet) et entreprises (leurs réserves)', async () => {
    const c = cabinet();
    const res = await request(app).get(`/api/projects/${c.projectId}/reserve-exports/recipients?kind=opr`).set(authHeader(c.token));
    expect(res.status).toBe(200);
    expect(res.body.intervenants.map((r: any) => [r.name, r.reserve_count])).toEqual([['Bureau Structure', 4]]);
    const parNom = Object.fromEntries(res.body.entreprises.map((r: any) => [r.name, r]));
    expect(parNom['Plâtres Martin']).toMatchObject({ reserve_count: 2, email: c.emailPlat });
    expect(parNom['Peintures Durand']).toMatchObject({ reserve_count: 2, email: '' });
  });

  it('restreint le périmètre aux lots choisis', async () => {
    const c = cabinet();
    const res = await request(app).get(`/api/projects/${c.projectId}/reserve-exports/recipients`).query({ kind: 'opr', lots: JSON.stringify(['PEINTURE']) }).set(authHeader(c.token));
    expect(res.body.reserve_count).toBe(2);
    expect(res.body.entreprises.map((r: any) => r.name)).toEqual(['Peintures Durand']);
  });

  it('refuse un destinataire étranger à l’opération et n’envoie rien', async () => {
    const c = cabinet();
    const created = await request(app).post(`/api/projects/${c.projectId}/reserve-exports`).set(authHeader(c.token)).send({ kind: 'opr', channel: 'mail', lots: null });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('en_cours');
    const pdf = Buffer.from('%PDF-1.4\n%fake\n');
    const res = await request(app).post(`/api/reserve-exports/${created.body.id}/send`).set(authHeader(c.token))
      .field('key', 'ent:contact-inconnu').attach('file', pdf, 'rapport.pdf');
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('envoie le PDF d’un destinataire et met à jour l’état du journal', async () => {
    const c = cabinet();
    const created = await request(app).post(`/api/projects/${c.projectId}/reserve-exports`).set(authHeader(c.token)).send({ kind: 'opr', channel: 'mail', lots: null });
    const recips = await request(app).get(`/api/projects/${c.projectId}/reserve-exports/recipients?kind=opr`).set(authHeader(c.token));
    const plat = recips.body.entreprises.find((r: any) => r.name === 'Plâtres Martin');
    const pdf = Buffer.from('%PDF-1.4\n%fake\n');
    const res = await request(app).post(`/api/reserve-exports/${created.body.id}/send`).set(authHeader(c.token))
      .field('key', plat.key).attach('file', pdf, 'rapport.pdf');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('envoye');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe(c.emailPlat);
    expect(sendMail.mock.calls[0][0].text).toContain('dont vous avez la charge');
    const [ligne] = journal(c);
    expect(ligne.sends).toHaveLength(1);
    expect(ligne.sends[0]).toMatchObject({ name: 'Plâtres Martin', status: 'envoye', reserve_count: 2 });
  });

  it('consigne un échec quand le destinataire n’a pas d’adresse', async () => {
    const c = cabinet();
    const created = await request(app).post(`/api/projects/${c.projectId}/reserve-exports`).set(authHeader(c.token)).send({ kind: 'opr', channel: 'mail', lots: null });
    const recips = await request(app).get(`/api/projects/${c.projectId}/reserve-exports/recipients?kind=opr`).set(authHeader(c.token));
    const peint = recips.body.entreprises.find((r: any) => r.name === 'Peintures Durand');
    const res = await request(app).post(`/api/reserve-exports/${created.body.id}/send`).set(authHeader(c.token))
      .field('key', peint.key).attach('file', Buffer.from('%PDF-1.4\n'), 'rapport.pdf');
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('echec');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rappels : activation par opération', async () => {
    const c = cabinet();
    const put = await request(app).put(`/api/projects/${c.projectId}/reserve-reminders`).set(authHeader(c.token)).send({ kind: 'opr', enabled: true });
    expect(put.status).toBe(200);
    const get = await request(app).get(`/api/projects/${c.projectId}/reserve-reminders?kind=opr`).set(authHeader(c.token));
    expect(get.body).toMatchObject({ available: true, enabled: true, interval_days: 7 });
    const off = await request(app).put(`/api/projects/${c.projectId}/reserve-reminders`).set(authHeader(c.token)).send({ kind: 'opr', enabled: false });
    expect(off.body.enabled).toBe(false);
  });
});
