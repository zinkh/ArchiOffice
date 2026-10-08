// Diffusion d'un compte-rendu : un message par destinataire, avec le PDF en pièce
// jointe et SEULEMENT les observations qui le concernent. Seul l'envoi SMTP est
// simulé ; la résolution des destinataires, la validation du PDF et le changement
// de statut passent par la vraie application.
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

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { sendMail.mockReset(); sendMail.mockResolvedValue({ messageId: 'm1' }); });

const PDF = Buffer.from('%PDF-1.4\n%contenu de test\n');

function seedOperation(tenantId: string) {
  const projectId = `p-${tenantId}`;
  const reportId = `r-${tenantId}`;
  fakeSupabaseAdmin.seed('settings', [{
    tenant_id: tenantId, smtp_host: 'smtp.test', smtp_port: '587', smtp_user: 'u', smtp_pass: 'p',
    email: 'cabinet@aazs.test', agency_name: 'AAZS',
  }]);
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Martin', project_code: '26014', address: '1 rue du Test' }]);
  fakeSupabaseAdmin.seed('site_reports', [{ id: reportId, tenant_id: tenantId, project_id: projectId, report_number: 12, date: '2026-03-12', statut: 'brouillon' }]);
  fakeSupabaseAdmin.seed('contacts', [
    { id: `c1-${tenantId}`, tenant_id: tenantId, first_name: 'Paul', last_name: 'Durand', company_name: 'Maçonnerie Durand', email: 'durand@ent.test' },
    { id: `c2-${tenantId}`, tenant_id: tenantId, first_name: 'Anne', last_name: 'BET', company_name: 'BET Structure', email: 'bet@ent.test' },
    { id: `c3-${tenantId}`, tenant_id: tenantId, first_name: 'Sans', last_name: 'Adresse', company_name: 'Plomberie Sud', email: '' },
  ]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: `l1-${tenantId}`, tenant_id: tenantId, project_id: projectId, lot_number: '02', lot_title: 'Gros œuvre', contact_id: `c1-${tenantId}` },
    { id: `l2-${tenantId}`, tenant_id: tenantId, project_id: projectId, lot_number: '05', lot_title: 'Plomberie', contact_id: `c3-${tenantId}` },
  ]);
  fakeSupabaseAdmin.seed('project_stakeholders', [
    { id: `s1-${tenantId}`, tenant_id: tenantId, project_id: projectId, name: 'BET', role: 'BET structure', contact_id: `c2-${tenantId}` },
  ]);
  fakeSupabaseAdmin.seed('observations', [
    { id: `o1-${tenantId}`, tenant_id: tenantId, project_id: projectId, lot_id: `l1-${tenantId}`, texte: 'Reprendre le chaînage', statut: 'À faire', number: 1, type: 'reserve' },
    { id: `o2-${tenantId}`, tenant_id: tenantId, project_id: projectId, contact_id: `c2-${tenantId}`, texte: 'Fournir la note de calcul', statut: 'En cours', number: 2, type: 'observation' },
    { id: `o3-${tenantId}`, tenant_id: tenantId, project_id: projectId, lot_id: `l2-${tenantId}`, texte: 'Reprendre le réseau EU', statut: 'À faire', number: 3, type: 'a_faire' },
  ]);
  fakeSupabaseAdmin.seed('observation_reports', ['o1', 'o2', 'o3'].map(o => ({ observation_id: `${o}-${tenantId}`, report_id: reportId })));
  return { projectId, reportId };
}

const diffuse = (token: string, reportId: string, contactIds: string[], pdf: Buffer | null = PDF) => {
  const req = request(app).post(`/api/reports/${reportId}/diffuse`).set(authHeader(token)).field('contact_ids', JSON.stringify(contactIds));
  return pdf ? req.attach('file', pdf, { filename: 'CR_12.pdf', contentType: 'application/pdf' }) : req;
};

describe('POST /api/reports/:reportId/diffuse', () => {
  it('envoie à chacun le PDF et SES observations, puis passe le compte-rendu en « diffusé »', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const { reportId } = seedOperation(tenantId);

    const res = await diffuse(token, reportId, [`c1-${tenantId}`, `c2-${tenantId}`]);
    expect(res.status).toBe(200);
    expect(res.body.sent.map((s: any) => s.email).sort()).toEqual(['bet@ent.test', 'durand@ent.test']);
    expect(res.body.statut).toBe('diffuse');
    expect(fakeSupabaseAdmin.getTable('site_reports').find((r: any) => r.id === reportId)?.statut).toBe('diffuse');

    expect(sendMail).toHaveBeenCalledTimes(2);
    const mails = Object.fromEntries(sendMail.mock.calls.map(([m]) => [m.to, m]));
    expect(mails['durand@ent.test'].text).toContain('Reprendre le chaînage');
    expect(mails['durand@ent.test'].text).not.toContain('note de calcul');
    expect(mails['durand@ent.test'].text).not.toContain('réseau EU');
    expect(mails['bet@ent.test'].text).toContain('Fournir la note de calcul');
    expect(mails['bet@ent.test'].text).not.toContain('chaînage');
    for (const m of Object.values(mails) as any[]) {
      expect(m.attachments[0].filename).toBe('CR_12.pdf');
      expect(Buffer.isBuffer(m.attachments[0].content)).toBe(true);
      expect(m.subject).toContain('n° 12');
    }
  });

  it("n'écrit jamais à une adresse que le client n'a pas à choisir : un contact étranger à l'opération est ignoré", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const { reportId } = seedOperation(tenantId);
    const otherTenant = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: 'etranger', tenant_id: otherTenant, first_name: 'X', last_name: 'Y', email: 'pirate@ailleurs.test' }]);

    const res = await diffuse(token, reportId, ['etranger']);
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
    expect(fakeSupabaseAdmin.getTable('site_reports').find((r: any) => r.id === reportId)?.statut).toBe('brouillon');
  });

  it('signale un destinataire sans adresse sans bloquer les autres', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const { reportId } = seedOperation(tenantId);

    const res = await diffuse(token, reportId, [`c1-${tenantId}`, `c3-${tenantId}`]);
    expect(res.status).toBe(200);
    expect(res.body.sent).toHaveLength(1);
    expect(res.body.skipped.map((s: any) => s.name)).toEqual(['Plomberie Sud']);
  });

  it('laisse le statut inchangé et répond 502 quand aucun message ne part', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const { reportId } = seedOperation(tenantId);
    sendMail.mockRejectedValue(new Error('SMTP indisponible'));

    const res = await diffuse(token, reportId, [`c1-${tenantId}`]);
    expect(res.status).toBe(502);
    expect(res.body.failed[0].error).toContain('SMTP indisponible');
    expect(fakeSupabaseAdmin.getTable('site_reports').find((r: any) => r.id === reportId)?.statut).toBe('brouillon');
  });

  it("garde le statut « diffusé » et rapporte l'échec quand seule une partie des messages part", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const { reportId } = seedOperation(tenantId);
    sendMail.mockImplementation(async (m: any) => { if (m.to === 'bet@ent.test') throw new Error('Boîte pleine'); return { messageId: 'ok' }; });

    const res = await diffuse(token, reportId, [`c1-${tenantId}`, `c2-${tenantId}`]);
    expect(res.status).toBe(200);
    expect(res.body.sent).toHaveLength(1);
    expect(res.body.failed.map((f: any) => f.email)).toEqual(['bet@ent.test']);
    expect(res.body.statut).toBe('diffuse');
  });

  it('refuse un fichier qui n\'est pas un PDF, ou l\'absence de PDF', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const { reportId } = seedOperation(tenantId);

    expect((await diffuse(token, reportId, [`c1-${tenantId}`], Buffer.from('MZ pas un pdf'))).status).toBe(400);
    expect((await diffuse(token, reportId, [`c1-${tenantId}`], null)).status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("refuse le compte-rendu d'un autre cabinet", async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    const { token } = makeUser(tenantA);
    const { reportId } = seedOperation(tenantB);

    const res = await diffuse(token, reportId, [`c1-${tenantB}`]);
    expect(res.status).toBe(404);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
