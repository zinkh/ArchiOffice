// Étude de faisabilité d'une proposition (server/routes/proposalFeasibility.ts
// et proposalFeasibilityAi.ts) : rubriques, cloisonnement entre cabinets,
// préremplissage sans IA ouvert à tous les plans, rédaction IA réservée au plan
// Enterprise avec réserve → exécute → règle. Les services publics du terrain
// (server/feasibilitySiteData.ts) et l'extraction de texte sont mockés.
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

const { loadFeasibilitySiteData } = vi.hoisted(() => ({ loadFeasibilitySiteData: vi.fn() }));
vi.mock('../server/feasibilitySiteData', () => ({ loadFeasibilitySiteData }));

import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { DEFAULT_FEASIBILITY_TITLES } from '../src/lib/feasibilityBlocks';

let app: Express;
const savedEnv = { ...process.env };
let seq = 0;

const SITE = {
  address: { label: '12 rue des Lilas 54000 Nancy', lat: 48.69, lon: 6.18, citycode: '54395', city: 'Nancy' },
  plu: { libelle: 'UB', libelong: 'Zone urbaine mixte', typezone: 'U', destdomi: null, urlfic: null, datappro: null, document: null },
  risques: { url: 'https://georisques.gouv.fr', risques_naturels: ['Retrait-gonflement des argiles'], risques_technologiques: [] },
  monuments: [],
};

function seedProposal(tenantId: string, extra: Record<string, unknown> = {}) {
  const id = `prop-feas-${++seq}`;
  fakeSupabaseAdmin.seed('proposals', [{
    id, tenant_id: tenantId, title: 'Maison Martin', status: 'Draft',
    adresse_terrain: '12 rue des Lilas', cp_ville_terrain: '54000 Nancy', ref_cadastrale: 'AB 123', ...extra,
  }]);
  return id;
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  app = await getTestApp();
});

beforeEach(() => {
  generateContent.mockReset();
  extractKnowledgeDocText.mockReset();
  extractKnowledgeDocText.mockResolvedValue('Programme : deux logements, jardin conservé.');
  loadFeasibilitySiteData.mockReset();
  loadFeasibilitySiteData.mockResolvedValue(SITE);
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

describe('proposal feasibility sections', () => {
  it('creates a section as "a_rediger", saves content and illustrations, then lists it as "redige"', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const proposalId = seedProposal(tenantId);

    const create = await request(app).post(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token))
      .send({ title: 'Situation et site' });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('a_rediger');

    const update = await request(app).put(`/api/proposals/${proposalId}/feasibility/${create.body.id}`).set(authHeader(token))
      .send({
        content: 'Le terrain est situé...',
        illustrations: [{ document_id: 'doc-1', file_url: 'archioffice://documents/x.png', layer: 'ortho', scale: 1500, caption: 'Vue aérienne' }, { bad: true }],
      });
    expect(update.status).toBe(200);

    const list = await request(app).get(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].status).toBe('redige');
    expect(list.body[0].illustrations).toHaveLength(1);
    expect(list.body[0].illustrations[0].caption).toBe('Vue aérienne');
  });

  it("refuses to create a section on another cabinet's proposal", async () => {
    const ownTenant = makeTenant();
    const otherTenant = makeTenant();
    const { token } = makeUser(ownTenant);
    const foreignProposal = seedProposal(otherTenant);

    const res = await request(app).post(`/api/proposals/${foreignProposal}/feasibility`).set(authHeader(token)).send({ title: 'X' });
    expect(res.status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('proposal_feasibility_sections').some((s: any) => s.proposal_id === foreignProposal)).toBe(false);
  });

  it('reorders sections and ignores ids that belong to another proposal', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const proposalId = seedProposal(tenantId);
    const a = (await request(app).post(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token)).send({ title: 'A' })).body;
    const b = (await request(app).post(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token)).send({ title: 'B' })).body;

    const res = await request(app).put(`/api/proposals/${proposalId}/feasibility/order`).set(authHeader(token)).send({ ids: [b.id, 'foreign', a.id] });
    expect(res.status).toBe(200);
    const list = await request(app).get(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token));
    expect(list.body.map((s: any) => s.title)).toEqual(['B', 'A']);
  });
});

describe('POST /api/proposals/:id/feasibility/prefill-sections', () => {
  it('lays the default outline without calling the model on a non-Enterprise plan, without duplicates', async () => {
    const tenantId = makeTenant({ plan: 'pro', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const proposalId = seedProposal(tenantId);
    fakeSupabaseAdmin.seed('documents', [{ id: `doc-${seq}`, tenant_id: tenantId, resource_type: 'proposals', resource_id: proposalId, name: 'programme.pdf', file_url: 'x' }]);
    await request(app).post(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token)).send({ title: 'situation et site' });

    const res = await request(app).post(`/api/proposals/${proposalId}/feasibility/prefill-sections`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('default');
    expect(res.body.sections).toHaveLength(DEFAULT_FEASIBILITY_TITLES.length - 1);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('adapts the outline from the attached programme on the Enterprise plan', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const proposalId = seedProposal(tenantId);
    fakeSupabaseAdmin.seed('documents', [{ id: `doc-${seq}`, tenant_id: tenantId, resource_type: 'proposals', resource_id: proposalId, name: 'programme.pdf', file_url: 'x' }]);
    generateContent.mockResolvedValue({ text: JSON.stringify({ titles: ['Contexte', 'Programme des logements'] }), usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30 } });

    const res = await request(app).post(`/api/proposals/${proposalId}/feasibility/prefill-sections`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('documents');
    expect(res.body.sections.map((s: any) => s.title)).toEqual(['Contexte', 'Programme des logements']);
  });
});

describe('POST /api/proposals/:id/feasibility/:sectionId/draft-ai', () => {
  it('drafts the section from the proposal and site data, and marks it "redige"', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const proposalId = seedProposal(tenantId);
    const section = (await request(app).post(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token))
      .send({ title: 'Analyse urbanistique (PLU)', instructions: 'Insister sur la zone UB.' })).body;
    generateContent.mockResolvedValue({ text: 'Le terrain est classé en zone UB...', usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 200 } });

    const res = await request(app).post(`/api/proposals/${proposalId}/feasibility/${section.id}/draft-ai`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('zone UB');
    expect(loadFeasibilitySiteData).toHaveBeenCalledWith('12 rue des Lilas, 54000 Nancy');

    const prompt = JSON.stringify(generateContent.mock.calls[0][0]);
    expect(prompt).toContain('AB 123');
    expect(prompt).toContain('Retrait-gonflement des argiles');
    expect(prompt).toContain('Insister sur la zone UB.');

    const saved = fakeSupabaseAdmin.getTable('proposal_feasibility_sections').find((s: any) => s.id === section.id);
    expect(saved?.status).toBe('redige');
  });

  it('refuses a tenant not on the Enterprise plan', async () => {
    const tenantId = makeTenant({ plan: 'pro', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const proposalId = seedProposal(tenantId);
    const section = (await request(app).post(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token)).send({ title: 'X' })).body;

    const res = await request(app).post(`/api/proposals/${proposalId}/feasibility/${section.id}/draft-ai`).set(authHeader(token));
    expect(res.status).toBe(403);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('returns 402 without calling the model when the AI credit balance is exhausted', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 0 });
    const { token } = makeUser(tenantId);
    const proposalId = seedProposal(tenantId);
    const section = (await request(app).post(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token)).send({ title: 'X' })).body;

    const res = await request(app).post(`/api/proposals/${proposalId}/feasibility/${section.id}/draft-ai`).set(authHeader(token));
    expect(res.status).toBe(402);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('refunds the reservation when the model call fails', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 10000 });
    const { token } = makeUser(tenantId);
    const proposalId = seedProposal(tenantId);
    const section = (await request(app).post(`/api/proposals/${proposalId}/feasibility`).set(authHeader(token)).send({ title: 'X' })).body;
    generateContent.mockRejectedValue(new Error('upstream down'));

    const res = await request(app).post(`/api/proposals/${proposalId}/feasibility/${section.id}/draft-ai`).set(authHeader(token));
    expect(res.status).toBe(500);
    const tenant = fakeSupabaseAdmin.getTable('tenants').find((t: any) => t.id === tenantId);
    expect(tenant?.ai_credit_balance_eur_cents).toBe(10000);
  });
});

describe('GET /api/feasibility/map-tile', () => {
  it('only relays whitelisted layers within the tile matrix', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const unknown = await request(app).get('/api/feasibility/map-tile?layer=scan25&z=10&x=1&y=1').set(authHeader(token));
    expect(unknown.status).toBe(400);
    const outOfRange = await request(app).get('/api/feasibility/map-tile?layer=ortho&z=2&x=4&y=0').set(authHeader(token));
    expect(outOfRange.status).toBe(400);
    const tooDeep = await request(app).get('/api/feasibility/map-tile?layer=plan&z=22&x=0&y=0').set(authHeader(token));
    expect(tooDeep.status).toBe(400);
  });
});
