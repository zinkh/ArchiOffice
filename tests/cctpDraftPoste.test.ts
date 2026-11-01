// Rédaction IA du texte d'UN poste du CCTP : proposition seulement, facturée,
// sans jamais écrire dans le document.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));

vi.mock('@zinkh/archioffice-agents/server/llm', async (orig) => ({
  ...(await orig<any>()),
  resolveLlmProvider: () => ({ id: 'gemini', model: 'gemini-3-flash-preview', chat }),
  getTenantAiConfig: async () => ({}),
}));

import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { construireTachePoste, nettoyerTextePoste } from '../server/routes/cctpGeneration';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const reply = (text: string) => ({ text, toolCalls: [], usage: { inputTokens: 100, outputTokens: 50 } });

describe('nettoyerTextePoste', () => {
  it('convertit le markdown en texte brut avec balises de gras', () => {
    expect(nettoyerTextePoste('## Titre\n**Béton** de classe C25/30\n* Armatures\n* Coffrage'))
      .toBe('Titre\n[b]Béton[/b] de classe C25/30\n- Armatures\n- Coffrage');
  });

  it('retire le bloc de code et la phrase d’introduction', () => {
    expect(nettoyerTextePoste('```text\nVoici le texte :\n\nL’entrepreneur devra…\n```')).toBe('L’entrepreneur devra…');
  });

  it('tronque et rend une chaîne vide pour une réponse vide', () => {
    expect(nettoyerTextePoste('x'.repeat(9000))).toHaveLength(8000);
    expect(nettoyerTextePoste('   ')).toBe('');
  });
});

describe('construireTachePoste', () => {
  const base = {
    kind: 'article' as const, titre: 'Dallage BA', numero: '1.2', lotTitre: 'Gros œuvre', chapitreTitre: 'Fondations',
    unite: 'm²', localisation: '', existant: '', instructions: '', voisins: [],
  };

  it('décrit la position, l’unité et les postes voisins', () => {
    const t = construireTachePoste({ ...base, voisins: ['Longrines', 'Semelles'] });
    expect(t).toContain('« 1.2 Dallage BA »');
    expect(t).toContain('lot « Gros œuvre », chapitre « Fondations »');
    expect(t).toContain('Unité de l\'ouvrage : m².');
    expect(t).toContain('Longrines ; Semelles');
    expect(t).not.toContain('Texte actuel');
  });

  it('cite le texte actuel et les consignes quand ils existent, et change de consigne selon le niveau', () => {
    const t = construireTachePoste({ ...base, kind: 'lot', existant: 'Ancien texte', instructions: 'Insister sur les essais' });
    expect(t).toContain('Ancien texte');
    expect(t).toContain('Insister sur les essais');
    expect(t).toContain('généralités du lot');
  });
});

describe('POST /api/projects/:id/cctp/draft-poste', () => {
  function seed() {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 5000, agent_billing_mode: 'prepaid', ai_credit_last_refresh: new Date().toISOString() });
    const { token } = makeUser(tenantId, 'admin');
    const projectId = crypto.randomUUID();
    fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Salle polyvalente', address: '12 rue des Lilas' }]);
    return { tenantId, token, projectId };
  }
  beforeEach(() => chat.mockReset());

  it('rend une proposition nettoyée, sans pièces ni écriture dans le document', async () => {
    const { token, projectId } = seed();
    chat.mockResolvedValueOnce(reply('**Dallage** en béton armé.\n* Épaisseur [à préciser]'));
    const dpgfsAvant = fakeSupabaseAdmin.getTable('dpgfs').length;
    const res = await request(app).post(`/api/projects/${projectId}/cctp/draft-poste`).set(authHeader(token))
      .send({ kind: 'article', titre: 'Dallage BA', numero: '1.2', lot_titre: 'Gros œuvre', voisins: ['Longrines'] });
    expect(res.status).toBe(200);
    expect(res.body.texte).toBe('[b]Dallage[/b] en béton armé.\n- Épaisseur [à préciser]');
    const appel = chat.mock.calls[0][0];
    expect(appel.cachePrefix).toBeUndefined();
    expect(appel.messages[0].content).toContain('Salle polyvalente (12 rue des Lilas)');
    expect(appel.messages[0].content).toContain('Longrines');
    expect(fakeSupabaseAdmin.getTable('dpgfs')).toHaveLength(dpgfsAvant);
  });

  it('n’envoie le texte actuel que si l’architecte demande à l’améliorer', async () => {
    const { token, projectId } = seed();
    chat.mockResolvedValue(reply('Texte.'));
    await request(app).post(`/api/projects/${projectId}/cctp/draft-poste`).set(authHeader(token))
      .send({ kind: 'chapitre', titre: 'Fondations', texte_existant: 'SECRET-ACTUEL' });
    expect(chat.mock.calls[0][0].messages[0].content).not.toContain('SECRET-ACTUEL');
    await request(app).post(`/api/projects/${projectId}/cctp/draft-poste`).set(authHeader(token))
      .send({ kind: 'chapitre', titre: 'Fondations', texte_existant: 'SECRET-ACTUEL', ameliorer: true });
    expect(chat.mock.calls[1][0].messages[0].content).toContain('SECRET-ACTUEL');
  });

  it('refuse un type inconnu, un poste sans titre et une affaire d’un autre cabinet', async () => {
    const { token, projectId } = seed();
    const sansTitre = await request(app).post(`/api/projects/${projectId}/cctp/draft-poste`).set(authHeader(token)).send({ kind: 'article' });
    expect(sansTitre.status).toBe(400);
    const typeInconnu = await request(app).post(`/api/projects/${projectId}/cctp/draft-poste`).set(authHeader(token)).send({ kind: 'plan', titre: 'X' });
    expect(typeInconnu.status).toBe(400);
    const autre = await request(app).post(`/api/projects/${crypto.randomUUID()}/cctp/draft-poste`).set(authHeader(token)).send({ kind: 'lot', titre: 'X' });
    expect(autre.status).toBe(404);
    expect(chat).not.toHaveBeenCalled();
  });

  it('réponse vide : 502 ; crédit épuisé : 402 sans appel au modèle', async () => {
    const { token, projectId } = seed();
    chat.mockResolvedValueOnce(reply('   '));
    const vide = await request(app).post(`/api/projects/${projectId}/cctp/draft-poste`).set(authHeader(token)).send({ kind: 'lot', titre: 'Gros œuvre' });
    expect(vide.status).toBe(502);

    chat.mockReset();
    const tenants = fakeSupabaseAdmin.getTable('tenants');
    tenants[tenants.length - 1].ai_credit_balance_eur_cents = 0;
    const epuise = await request(app).post(`/api/projects/${projectId}/cctp/draft-poste`).set(authHeader(token)).send({ kind: 'lot', titre: 'Gros œuvre' });
    expect(epuise.status).toBe(402);
    expect(chat).not.toHaveBeenCalled();
  });
});
