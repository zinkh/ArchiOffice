// Numérotation atomique des devis, notes d'honoraires et factures (voir
// server/documentSequence.ts et supabase/migrate_atomic_document_numbering.sql).
// Avant : « nombre de lignes + 1 », donc deux créations simultanées d'un même
// cabinet recevaient le même numéro. Le SQL lui-même est couvert, contre un vrai
// Postgres, par tests/documentSequences.pg.test.ts (CI).
import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { getNextDocNumber } from '../server/getNextDocNumber';
import { getNextAffaireInvoiceNumber } from '../server/getNextAffaireInvoiceNumber';
import { nextDocumentSequence } from '../server/documentSequence';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { fakeSupabaseAdmin.documentSequencesUnavailable = false; });
afterEach(() => { fakeSupabaseAdmin.documentSequencesUnavailable = false; fakeSupabaseAdmin.writeLatencyMs = 0; });

const year = new Date().getFullYear();
const seqOf = (numero: string) => parseInt(numero.slice(numero.lastIndexOf('-') + 1), 10);

describe('POST /api/invoices : numéros distincts sous concurrence', () => {
  it('20 créations simultanées pour un même cabinet donnent 20 numéros distincts et consécutifs', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, num_prefix_facture: 'FAC' }]);
    // Une base réelle met du temps à écrire : c'est cette fenêtre entre « lire le numéro » et
    // « insérer la facture » qui faisait recevoir le même numéro à deux créations.
    fakeSupabaseAdmin.writeLatencyMs = 15;

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => request(app).post('/api/invoices').set(authHeader(token)).send({ amount: 100 })),
    );

    expect(responses.every(r => r.status === 201)).toBe(true);
    const numeros = responses.map(r => r.body.invoice_number as string);
    expect(new Set(numeros).size).toBe(20);
    const sequence = numeros.map(seqOf).sort((a, b) => a - b);
    expect(sequence).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(numeros.every(n => n.startsWith(`FAC-${year}-`))).toBe(true);
  });

  it('deux cabinets gardent chacun leur propre suite', async () => {
    const a = makeTenant();
    const b = makeTenant();
    const tokenA = makeUser(a, 'admin').token;
    const tokenB = makeUser(b, 'admin').token;
    const [ra, rb] = await Promise.all([
      request(app).post('/api/invoices').set(authHeader(tokenA)).send({ amount: 1 }),
      request(app).post('/api/invoices').set(authHeader(tokenB)).send({ amount: 1 }),
    ]);
    expect(seqOf(ra.body.invoice_number)).toBe(1);
    expect(seqOf(rb.body.invoice_number)).toBe(1);
  });
});

describe('getNextDocNumber : amorçage sur l\'existant', () => {
  it('continue après les numéros déjà émis', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, num_prefix_devis: 'DEVIS' }]);
    fakeSupabaseAdmin.seed('proposals', [1, 2, 3].map(n => ({ id: `p${n}-${tenantId}`, tenant_id: tenantId, reference: `DEVIS-${year}-00${n}` })));
    expect(await getNextDocNumber(fakeSupabaseAdmin, tenantId, 'num_prefix_devis', 'proposals', 'DEVIS')).toBe(`DEVIS-${year}-004`);
  });

  it('ne réutilise pas un numéro quand des lignes ont été supprimées', async () => {
    const tenantId = makeTenant();
    // 2 lignes restantes mais la plus haute porte le 007 : compter donnerait 003.
    fakeSupabaseAdmin.seed('invoices', [
      { id: `i1-${tenantId}`, tenant_id: tenantId, invoice_number: `FAC-${year}-002` },
      { id: `i2-${tenantId}`, tenant_id: tenantId, invoice_number: `FAC-${year}-007` },
    ]);
    expect(await getNextDocNumber(fakeSupabaseAdmin, tenantId, 'num_prefix_facture', 'invoices', 'FAC')).toBe(`FAC-${year}-008`);
  });

  it('ignore une référence saisie à la main au lieu de la prendre pour une séquence', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('proposals', [
      { id: `p1-${tenantId}`, tenant_id: tenantId, reference: '2626 ' },
      { id: `p2-${tenantId}`, tenant_id: tenantId, reference: '2626 ' },
    ]);
    expect(await getNextDocNumber(fakeSupabaseAdmin, tenantId, 'num_prefix_devis', 'proposals', 'DEVIS')).toBe(`DEVIS-${year}-001`);
  });

  it('repart de 001 chaque année : les numéros d\'une autre année ne comptent pas', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('invoices', [
      { id: `i1-${tenantId}`, tenant_id: tenantId, invoice_number: `FAC-${year - 1}-041` },
      { id: `i2-${tenantId}`, tenant_id: tenantId, invoice_number: `FAC-${year - 1}-042` },
    ]);
    expect(await getNextDocNumber(fakeSupabaseAdmin, tenantId, 'num_prefix_facture', 'invoices', 'FAC')).toBe(`FAC-${year}-001`);
  });

  it('la suite d\'une année est indépendante de celle de l\'année précédente', async () => {
    const tenantId = makeTenant();
    const a = await nextDocumentSequence(fakeSupabaseAdmin, tenantId, 'invoice', year - 1, async () => 0);
    const b = await nextDocumentSequence(fakeSupabaseAdmin, tenantId, 'invoice', year - 1, async () => 0);
    const c = await nextDocumentSequence(fakeSupabaseAdmin, tenantId, 'invoice', year, async () => 0);
    expect([a, b, c]).toEqual([1, 2, 1]);
  });

  it('numérote séparément devis, factures et notes d\'honoraires', async () => {
    const tenantId = makeTenant();
    const devis = await getNextDocNumber(fakeSupabaseAdmin, tenantId, 'num_prefix_devis', 'proposals', 'DEVIS');
    const facture = await getNextDocNumber(fakeSupabaseAdmin, tenantId, 'num_prefix_facture', 'invoices', 'FAC');
    const note = await getNextDocNumber(fakeSupabaseAdmin, tenantId, 'num_prefix_honoraires', 'notes_honoraires', 'NH');
    expect([devis, facture, note]).toEqual([`DEVIS-${year}-001`, `FAC-${year}-001`, `NH-${year}-001`]);
  });
});

describe('getNextAffaireInvoiceNumber : référence d\'acompte par affaire', () => {
  it('20 appels simultanés pour une même affaire donnent 20 références distinctes', async () => {
    const tenantId = makeTenant();
    const projectId = `proj-${tenantId}`;
    fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, project_code: '26014' }]);
    const refs = await Promise.all(Array.from({ length: 20 }, () => getNextAffaireInvoiceNumber(fakeSupabaseAdmin, tenantId, projectId)));
    expect(new Set(refs).size).toBe(20);
    expect(refs.every(r => /^26014-ACO-\d{2}$/.test(r))).toBe(true);
  });
});

describe('repli et erreurs', () => {
  it('sans la migration, retombe sur l\'ancien calcul au lieu d\'échouer', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('invoices', [{ id: `i1-${tenantId}`, tenant_id: tenantId, invoice_number: 'x' }]);
    fakeSupabaseAdmin.documentSequencesUnavailable = true;
    expect(await getNextDocNumber(fakeSupabaseAdmin, tenantId, 'num_prefix_facture', 'invoices', 'FAC')).toBe(`FAC-${year}-002`);
  });

  it('toute autre erreur de base est remontée, jamais remplacée par un numéro approximatif', async () => {
    const broken = { rpc: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) };
    await expect(nextDocumentSequence(broken, 'tenant-1', 'invoice', 2026, async () => 5)).rejects.toThrow(/statement timeout/);
  });

  it('refuse une valeur de séquence inattendue', async () => {
    const odd = { rpc: async () => ({ data: 'abc', error: null }) };
    await expect(nextDocumentSequence(odd, 'tenant-1', 'invoice', 2026, async () => 5)).rejects.toThrow(/valeur inattendue/);
  });
});
