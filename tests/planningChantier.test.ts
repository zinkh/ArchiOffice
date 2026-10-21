// Planning de chantier : server/routes/planningChantier.ts.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));

vi.mock('@zinkh/archioffice-agents/server/llm', async (orig) => ({
  ...(await orig<any>()),
  resolveLlmProvider: () => ({ id: 'gemini', model: 'gemini-3-flash-preview', chat }),
  getTenantAiConfig: async () => ({}),
}));
vi.mock('@zinkh/archioffice-agents/server', async (orig) => ({
  ...(await orig<any>()),
  extractKnowledgeDocText: vi.fn(async () => 'PLANNING MAÇONNERIE : fondations 3 semaines, élévations 6 semaines.'),
}));

import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => chat.mockReset());

const reply = (text: string) => ({ text, toolCalls: [], usage: { inputTokens: 100, outputTokens: 50 } });

function seed(over: Record<string, any> = {}) {
  const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 5000, agent_billing_mode: 'prepaid', ai_credit_last_refresh: new Date().toISOString(), ...over });
  const { token } = makeUser(tenantId, 'admin');
  const projectId = crypto.randomUUID();
  const lot1 = crypto.randomUUID();
  const lot2 = crypto.randomUUID();
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Salle polyvalente', address: '1 rue du Stade' }]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: lot1, tenant_id: tenantId, project_id: projectId, lot_number: '01', lot_title: 'Gros œuvre', contact_id: null },
    { id: lot2, tenant_id: tenantId, project_id: projectId, lot_number: '02', lot_title: 'Charpente', contact_id: null },
  ]);
  fakeSupabaseAdmin.seed('marches_entreprises', [
    { id: crypto.randomUUID(), tenant_id: tenantId, project_id: projectId, entreprise_nom: 'Maçonnerie Martin', lot_numero: '1', montant_ht: 120000, duree_mois: 3, statut: 'en_cours' },
  ]);
  return { tenantId, token, projectId, lot1, lot2 };
}

describe('lecture et enregistrement', () => {
  it('rend un planning vide pour une affaire sans planning', async () => {
    const { token, projectId } = seed();
    const res = await request(app).get(`/api/projects/${projectId}/planning-chantier`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.planning.taches).toEqual([]);
  });

  it('assainit ce qui est enregistré et le relit', async () => {
    const { token, projectId, lot1 } = seed();
    const put = await request(app).put(`/api/projects/${projectId}/planning-chantier`).set(authHeader(token)).send({
      taches: [
        { id: 'a', lotId: lot1, libelle: 'Fondations', debut: '2026-03-10', fin: '2026-03-02', avancement: 250 },
        { libelle: 'Sans date', debut: 'bientôt' },
      ],
    });
    expect(put.status).toBe(200);
    expect(put.body.planning.taches).toHaveLength(1);
    expect(put.body.planning.taches[0]).toMatchObject({ debut: '2026-03-02', fin: '2026-03-10', avancement: 100 });

    const get = await request(app).get(`/api/projects/${projectId}/planning-chantier`).set(authHeader(token));
    expect(get.body.planning.taches.map((t: any) => t.libelle)).toEqual(['Fondations']);
  });

  it('refuse l’affaire d’un autre cabinet', async () => {
    const { projectId } = seed();
    const { token } = makeUser(makeTenant(), 'admin');
    expect((await request(app).get(`/api/projects/${projectId}/planning-chantier`).set(authHeader(token))).status).toBe(404);
    expect((await request(app).put(`/api/projects/${projectId}/planning-chantier`).set(authHeader(token)).send({ taches: [] })).status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('project_chantier_planning').find(r => r.project_id === projectId)).toBeUndefined();
  });
});

describe('génération par l’IA', () => {
  const generate = (token: string, projectId: string, body: object) =>
    request(app).post(`/api/projects/${projectId}/planning-chantier/generate`).set(authHeader(token)).send(body);

  it('convertit les semaines en dates, sans rien enregistrer, et écarte un lot inconnu', async () => {
    const { token, projectId, lot1, lot2 } = seed();
    chat.mockResolvedValueOnce(reply(JSON.stringify({
      taches: [
        { lot_numero: '01', libelle: 'Fondations', semaine_debut: 1, duree_semaines: 3 },
        { lot_numero: '2', libelle: 'Levage de la charpente', semaine_debut: 8, duree_semaines: 2 },
        { lot_numero: '99', libelle: 'Lot inventé', semaine_debut: 1, duree_semaines: 1 },
        { lot_numero: 'general', libelle: 'Réception', semaine_debut: 20, jalon: true },
      ],
      hypotheses: ['Démarrage hors congés'],
    })));
    const res = await generate(token, projectId, { date_debut: '2026-03-04' });
    expect(res.status).toBe(200);
    expect(res.body.taches).toHaveLength(3);
    expect(res.body.taches[0]).toMatchObject({ lotId: lot1, debut: '2026-03-02', fin: '2026-03-20', source: 'ia' });
    expect(res.body.taches[1]).toMatchObject({ lotId: lot2, debut: '2026-04-20', fin: '2026-05-01' });
    expect(res.body.taches[2]).toMatchObject({ lotId: '', jalon: true });
    expect(res.body.ecartees).toBe(1);
    expect(res.body.hypotheses).toEqual(['Démarrage hors congés']);
    expect(fakeSupabaseAdmin.getTable('project_chantier_planning').find(r => r.project_id === projectId)).toBeUndefined();
  });

  it('donne au modèle l’entreprise, le montant et la durée du marché', async () => {
    const { token, projectId } = seed();
    chat.mockResolvedValueOnce(reply('{"taches":[{"lot_numero":"01","libelle":"x","semaine_debut":1,"duree_semaines":1}]}'));
    await generate(token, projectId, { date_debut: '2026-03-02', duree_cible_semaines: 30, instructions: 'Pas de travaux en août' });
    const prompt = chat.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Lot 01 : Gros œuvre ; entreprise Maçonnerie Martin ; marché 120000 € HT ; durée de marché 3 mois');
    expect(prompt).toContain('Lot 02 : Charpente ; entreprise à désigner');
    expect(prompt).toContain('environ 30 semaines');
    expect(prompt).toContain('Pas de travaux en août');
  });

  it('part du DPGF et du CCTP de l’opération quand ils existent', async () => {
    const { tenantId, token, projectId, lot1 } = seed();
    fakeSupabaseAdmin.seed('dpgfs', [{
      id: crypto.randomUUID(), tenant_id: tenantId, project_id: projectId,
      data: JSON.stringify({
        multiBatiments: true, batiments: [{ id: 'b1', code: 'A', libelle: 'Bâtiment A' }], lots: [{
          numero: '1', projectLotId: lot1, cctpDescription: 'Cure du béton 7 jours avant chargement.',
          chapitres: [{ numero: '2', titre: 'Fondations', lignes: [{ type: 'ouvrage', designation: 'Fouilles en rigole', unite: 'm3', quantite: 120, prixTotal: 6000 }] }],
        }],
      }),
    }]);
    chat.mockResolvedValueOnce(reply('{"taches":[{"lot_numero":"01","libelle":"Fondations","semaine_debut":1,"duree_semaines":2}]}'));
    const res = await generate(token, projectId, { date_debut: '2026-03-02' });
    expect(res.body.sources).toEqual({ dpgf: true, cctp: true });
    const prompt = chat.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('2 Fondations (6000 € HT) : Fouilles en rigole (120 m3)');
    expect(prompt).toContain('Cure du béton 7 jours');
    expect(prompt).toContain('Bâtiments, dans l\'ordre du document : Bâtiment A');

    chat.mockResolvedValueOnce(reply('{"taches":[{"lot_numero":"01","libelle":"x","semaine_debut":1,"duree_semaines":1}]}'));
    const sans = await generate(token, projectId, { date_debut: '2026-03-02', depuis_dpgf: false });
    expect(sans.body.sources).toEqual({ dpgf: false, cctp: false });
    expect(chat.mock.calls[1][0].messages[0].content).not.toContain('Fouilles en rigole');
  });

  it('se limite aux lots demandés', async () => {
    const { token, projectId, lot2 } = seed();
    chat.mockResolvedValueOnce(reply('{"taches":[{"lot_numero":"02","libelle":"Charpente","semaine_debut":1,"duree_semaines":2}]}'));
    const res = await generate(token, projectId, { date_debut: '2026-03-02', lot_ids: [lot2] });
    expect(res.body.lot_ids).toEqual([lot2]);
    const prompt = chat.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Lot 02');
    expect(prompt).not.toContain('Lot 01');
  });

  it('lit les pièces de l’affaire seulement', async () => {
    const { tenantId, token, projectId } = seed();
    const own = crypto.randomUUID();
    const foreign = crypto.randomUUID();
    fakeSupabaseAdmin.seed('documents', [
      { id: own, tenant_id: tenantId, project_id: projectId, name: 'planning-maconnerie.pdf', file_url: 'x' },
      { id: foreign, tenant_id: tenantId, project_id: 'autre-affaire', name: 'autre.pdf', file_url: 'y' },
    ]);
    chat.mockResolvedValueOnce(reply('{"taches":[{"lot_numero":"01","libelle":"x","semaine_debut":1,"duree_semaines":1}]}'));
    const res = await generate(token, projectId, { date_debut: '2026-03-02', document_ids: [own, foreign] });
    expect(res.body.documents_read).toBe(1);
    const prompt = chat.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('planning-maconnerie.pdf');
    expect(prompt).not.toContain('autre.pdf');
  });

  it('exige une date de démarrage valide', async () => {
    const { token, projectId } = seed();
    expect((await generate(token, projectId, {})).status).toBe(400);
    expect((await generate(token, projectId, { date_debut: '2026-02-30' })).status).toBe(400);
    expect(chat).not.toHaveBeenCalled();
  });

  it('refuse sans lot à planifier', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 5000, agent_billing_mode: 'prepaid', ai_credit_last_refresh: new Date().toISOString() });
    const { token } = makeUser(tenantId, 'admin');
    const projectId = crypto.randomUUID();
    fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Sans lot' }]);
    expect((await generate(token, projectId, { date_debut: '2026-03-02' })).status).toBe(400);
  });

  it('répond 402 sans appeler le modèle quand le crédit IA est épuisé', async () => {
    const { token, projectId } = seed({ ai_credit_balance_eur_cents: 0 });
    const res = await generate(token, projectId, { date_debut: '2026-03-02' });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('NO_TOKENS');
    expect(chat).not.toHaveBeenCalled();
  });

  it('rembourse la réserve quand le modèle échoue', async () => {
    const { tenantId, token, projectId } = seed();
    chat.mockRejectedValueOnce(new Error('timeout'));
    const res = await generate(token, projectId, { date_debut: '2026-03-02' });
    expect(res.status).toBe(500);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.ai_credit_balance_eur_cents).toBe(5000);
  });

  it('répond 502 quand la réponse n’a aucune tâche exploitable', async () => {
    const { token, projectId } = seed();
    chat.mockResolvedValueOnce(reply('désolé, je ne peux pas'));
    expect((await generate(token, projectId, { date_debut: '2026-03-02' })).status).toBe(502);
  });

  it('refuse l’affaire d’un autre cabinet', async () => {
    const { projectId } = seed();
    const { token } = makeUser(makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 5000 }), 'admin');
    expect((await generate(token, projectId, { date_debut: '2026-03-02' })).status).toBe(404);
    expect(chat).not.toHaveBeenCalled();
  });
});
