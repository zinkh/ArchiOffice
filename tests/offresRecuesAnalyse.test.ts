// Lecture des montants d'une pièce d'offre reçue HORS plateforme : réservée au plan Pro et supérieur, limitée aux
// documents de l'affaire rangés en catégorie « offres reçues », octets revérifiés avant lecture.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage } from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';
import { buildExternalRef } from '../server/externalStorage/externalRef';
import { CATEGORIE_OFFRES_RECUES } from '../src/lib/offresRecues';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { memoryDrive.reset(); });

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${++seq}`;

async function devisPdf(): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF();
  pdf.text('DEVIS 2026-118', 10, 10);
  pdf.text('Carrelage sols souples      12 320,00 EUR', 10, 20);
  pdf.text('Total HT                    18 200,00 EUR', 10, 30);
  pdf.text('TVA 20 %                     3 640,00 EUR', 10, 40);
  pdf.text('Total TTC                   21 840,00 EUR', 10, 50);
  return Buffer.from(pdf.output('arraybuffer'));
}

interface Cabinet { tenantId: string; token: string; projectId: string; connectionId: string }

function cabinet(plan: string): Cabinet {
  const tenantId = makeTenant({ plan });
  const { token } = makeUser(tenantId, 'admin');
  const connectionId = connectExternalStorage(tenantId);
  const projectId = uid('proj');
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, project_code: '2419', name: 'Selia' }]);
  return { tenantId, token, projectId, connectionId };
}

/** Pose un fichier sur le drive en mémoire et le document de l'affaire qui le référence. */
function deposer(c: Cabinet, nom: string, buffer: Buffer, extra: Record<string, any> = {}): string {
  const externalId = uid('file');
  memoryDrive.files.set(externalId, { id: externalId, parentId: 'root', name: nom, buffer, mimeType: 'application/octet-stream', trashed: false });
  const id = uid('doc');
  fakeSupabaseAdmin.seed('documents', [{
    id, tenant_id: c.tenantId, project_id: c.projectId, name: nom, category: CATEGORIE_OFFRES_RECUES,
    file_url: buildExternalRef({ provider: 'webdav', connectionId: c.connectionId, externalId, fileName: nom }),
    uploaded_at: new Date().toISOString(), ...extra,
  }]);
  return id;
}

const analyser = (c: Cabinet, documentId: string, projectId = c.projectId) =>
  request(app).post(`/api/projects/${projectId}/offres-recues/${documentId}/analyser`).set(authHeader(c.token));

describe('lecture des montants d\'une offre reçue hors plateforme', () => {
  it('lit un devis PDF et propose le total HT en premier, au plan Pro', async () => {
    const c = cabinet('pro');
    const id = deposer(c, 'SARL Dupont - devis.pdf', await devisPdf());
    const r = await analyser(c, id);
    expect(r.status).toBe(200);
    expect(r.body.texte_lu).toBe(true);
    expect(r.body.candidats[0]).toMatchObject({ montant: 18200, nature: 'total_ht' });
    expect(r.body.candidats.find((x: any) => x.montant === 3640)).toBeUndefined();
  });

  it('est ouverte aux plans Pro et Enterprise, fermée aux plans inférieurs', async () => {
    const pdf = await devisPdf();
    for (const [plan, statut] of [['enterprise', 200], ['pro', 200], ['starter', 403], ['trial', 403]] as const) {
      const c = cabinet(plan);
      const r = await analyser(c, deposer(c, 'devis.pdf', pdf));
      expect(r.status, plan).toBe(statut);
      if (statut === 403) expect(r.body.code).toBe('plan_requis');
    }
  });

  it('refuse un abonnement expiré', async () => {
    const c = cabinet('trial');
    fakeSupabaseAdmin.getTable('tenants').find(t => t.id === c.tenantId)!.trial_ends_at = new Date(Date.now() - 86400_000).toISOString();
    const r = await analyser(c, deposer(c, 'devis.pdf', await devisPdf()));
    expect(r.status).toBe(403);
  });

  it('ne lit que les documents de la catégorie des offres reçues, de cette affaire et de ce cabinet', async () => {
    const c = cabinet('pro');
    const pdf = await devisPdf();
    const autreCategorie = deposer(c, 'cctp.pdf', pdf, { category: 'CCTP' });
    expect((await analyser(c, autreCategorie)).status).toBe(404);

    const bon = deposer(c, 'devis.pdf', pdf);
    expect((await analyser(c, bon, 'autre-affaire')).status).toBe(404);

    const autre = cabinet('pro');
    const documentEtranger = deposer(autre, 'devis.pdf', pdf);
    expect((await analyser(c, documentEtranger, autre.projectId)).status).toBe(404);
  });

  it('refuse un format qui ne se lit pas automatiquement', async () => {
    const c = cabinet('pro');
    const r = await analyser(c, deposer(c, 'bordereau.csv', Buffer.from('a;b\n1;2')));
    expect(r.status).toBe(400);
  });

  it('revérifie les octets : un PDF qui lance une action à l\'ouverture n\'est pas lu', async () => {
    const c = cabinet('pro');
    const r = await analyser(c, deposer(c, 'devis.pdf', Buffer.from('%PDF-1.7\n/OpenAction<</S/Launch /F(cmd.exe)>>')));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/refusée/);
  });

  it('dit honnêtement qu\'un PDF sans texte est illisible', async () => {
    const { jsPDF } = await import('jspdf');
    const c = cabinet('pro');
    const r = await analyser(c, deposer(c, 'scan.pdf', Buffer.from(new jsPDF().output('arraybuffer'))));
    expect(r.body).toMatchObject({ texte_lu: false, candidats: [] });
    expect(r.body.note).toMatch(/scanné/);
  });

  it('rend 404 quand le fichier n\'est plus sur l\'espace de stockage', async () => {
    const c = cabinet('pro');
    const id = deposer(c, 'devis.pdf', await devisPdf());
    memoryDrive.files.clear();
    expect((await analyser(c, id)).status).toBe(404);
  });
});
