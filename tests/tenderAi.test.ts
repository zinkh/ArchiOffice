// Assistance IA du dossier de candidature (server/routes/tenderAi.ts) :
// gating au plan Enterprise, réservation/règlement atomique du crédit IA
// (même patron que le chat des agents, packages/archioffice-agents/src/
// server/routes.ts), et l'extraction de texte des documents DCE
// (extractKnowledgeDocText, mockée ici — son propre comportement est déjà
// couvert par les tests de la bibliothèque de connaissances des agents).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
    constructor(public opts: any) {}
  },
}));

const { extractKnowledgeDocText } = vi.hoisted(() => ({ extractKnowledgeDocText: vi.fn() }));
vi.mock('@zinkh/archioffice-agents/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../packages/archioffice-agents/src/server/index')>();
  return { ...actual, extractKnowledgeDocText };
});

import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
const savedEnv = { ...process.env };

function mockChatJson(json: any) {
  generateContent.mockResolvedValue({
    text: JSON.stringify(json),
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
  });
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  app = await getTestApp();
});

beforeEach(() => {
  generateContent.mockReset();
  extractKnowledgeDocText.mockReset();
  extractKnowledgeDocText.mockResolvedValue('Règlement de consultation : DC1, DC2 et attestations exigés.');
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
});

afterEach(() => {
  for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_PROVIDER', 'AI_MODEL']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterAll(() => { vi.restoreAllMocks(); });

describe('POST /api/tenders/:id/analyze-dce', () => {
  it('refuses a tenant not on the Enterprise plan', async () => {
    const tenantId = makeTenant({ plan: 'pro', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ai-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const res = await request(app).post(`/api/tenders/${tenderId}/analyze-dce`).set(authHeader(token));
    expect(res.status).toBe(403);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('refuses when no DCE document is attached', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ai-2';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const res = await request(app).post(`/api/tenders/${tenderId}/analyze-dce`).set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('extracts detected pieces from the DCE and inserts them with status detectee_ia', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ai-3';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('documents', [{
      id: 'doc-1', tenant_id: tenantId, resource_type: 'tenders', resource_id: tenderId,
      name: 'reglement.pdf', file_url: 'archioffice://documents/reglement.pdf',
    }]);
    mockChatJson({ pieces: [
      { section: 'candidature', label: 'DC1 — lettre de candidature', obligatoire: true, source_hint: 'RC p.5' },
      { section: 'offre_technique', label: 'Mémoire technique', obligatoire: true, quantity_required: 3 },
    ] });

    const res = await request(app).post(`/api/tenders/${tenderId}/analyze-dce`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);

    const pieces = fakeSupabaseAdmin.getTable('tender_pieces').filter((p: any) => p.tender_id === tenderId);
    expect(pieces).toHaveLength(2);
    expect(pieces.every((p: any) => p.status === 'detectee_ia')).toBe(true);
    expect(pieces.find((p: any) => p.label.includes('Mémoire'))?.quantity_required).toBe(3);
  });

  it('does not duplicate a piece already detected in a previous analysis', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ai-4';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc-2', tenant_id: tenantId, resource_type: 'tenders', resource_id: tenderId, name: 'rc.pdf', file_url: 'x' }]);
    fakeSupabaseAdmin.seed('tender_pieces', [{ id: 'piece-existing', tenant_id: tenantId, tender_id: tenderId, section: 'candidature', label: 'DC1', status: 'fournie' }]);
    mockChatJson({ pieces: [{ section: 'candidature', label: 'DC1' }] });

    const res = await request(app).post(`/api/tenders/${tenderId}/analyze-dce`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(0);
  });

  it('returns 402 without calling the model when the AI credit balance is exhausted', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 0 });
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ai-5';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc-3', tenant_id: tenantId, resource_type: 'tenders', resource_id: tenderId, name: 'rc.pdf', file_url: 'x' }]);

    const res = await request(app).post(`/api/tenders/${tenderId}/analyze-dce`).set(authHeader(token));
    expect(res.status).toBe(402);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('POST /api/tenders/:id/methodology/:noteId/draft-ai', () => {
  it('drafts the section content and marks it as redige', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ai-6';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client', description: 'Réhabilitation.' }]);
    fakeSupabaseAdmin.seed('tender_methodology_notes', [{ id: 'note-1', tenant_id: tenantId, tender_id: tenderId, title: 'Enjeux du site', content: '', status: 'a_rediger' }]);
    generateContent.mockResolvedValue({ text: 'Le projet s\'inscrit dans un site sensible...', usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 200 } });

    const res = await request(app).post(`/api/tenders/${tenderId}/methodology/note-1/draft-ai`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('site sensible');

    const note = fakeSupabaseAdmin.getTable('tender_methodology_notes').find((n: any) => n.id === 'note-1');
    expect(note?.status).toBe('redige');
  });

  it('refuses a tenant not on the Enterprise plan', async () => {
    const tenantId = makeTenant({ plan: 'trial', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ai-7';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('tender_methodology_notes', [{ id: 'note-2', tenant_id: tenantId, tender_id: tenderId, title: 'X', content: '', status: 'a_rediger' }]);

    const res = await request(app).post(`/api/tenders/${tenderId}/methodology/note-2/draft-ai`).set(authHeader(token));
    expect(res.status).toBe(403);
  });
});
