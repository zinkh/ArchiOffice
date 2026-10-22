// Assistant IA de la messagerie : la sortie du modèle est une PROPOSITION, jamais
// une source d'identifiants. Seuls le modèle (simulé) et les identifiants du
// cabinet passent par la vraie route ; tout identifiant inventé doit disparaître.
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
import {
  extractAddresses, forwardSubject, parseModelJson, replyAllRecipients, replySubject, sanitizeAssist, type MailAssistContext,
} from '../src/lib/mailAssist';

const CTX: MailAssistContext = {
  projects: [{
    id: 'p1', code: '26014', name: 'Villa Martin',
    lots: [{ id: 'l1', number: '02', title: 'Gros œuvre', company: 'Maçonnerie Durand', contactId: 'c1' }],
  }],
  contacts: { c1: { name: 'Maçonnerie Durand', email: 'durand@ent.test' } },
  team: [{ id: 'u1', name: 'Sophie' }],
};

describe('sanitizeAssist', () => {
  it('garde les identifiants connus et écarte ceux que le modèle invente', () => {
    const out = sanitizeAssist({
      summary: 'Devis reçu', category: 'devis', urgency: 'haute',
      project_id: 'p1', lot_id: 'l1',
      forward: { contact_ids: ['c1', 'inconnu'], body: 'Pour avis' },
      task: { title: 'Relire le devis', due_in_days: 3, priority: 'high', assignee_id: 'u1' },
    }, CTX);
    expect(out.project).toEqual({ id: 'p1', code: '26014', name: 'Villa Martin' });
    expect(out.lot?.label).toBe('02 Gros œuvre');
    expect(out.forward.recipients).toEqual([{ contactId: 'c1', name: 'Maçonnerie Durand', email: 'durand@ent.test' }]);
    expect(out.task).toMatchObject({ dueInDays: 3, priority: 'high', assigneeId: 'u1', assigneeName: 'Sophie' });

    const invented = sanitizeAssist({ project_id: 'fantome', lot_id: 'l1', category: 'nimporte', urgency: 'extreme', task: { assignee_id: 'ghost', priority: 'zzz', due_in_days: -4 } }, CTX);
    expect(invented.project).toBeNull();
    expect(invented.lot).toBeNull();
    expect(invented.category).toBe('autre');
    expect(invented.urgency).toBe('normale');
    expect(invented.task).toMatchObject({ assigneeId: null, priority: 'normal', dueInDays: null });
  });

  it("n'accepte pas un lot d'une autre affaire que celle choisie", () => {
    const ctx: MailAssistContext = { ...CTX, projects: [...CTX.projects, { id: 'p2', code: '26020', name: 'École', lots: [{ id: 'l9', number: '01', title: 'VRD' }] }] };
    expect(sanitizeAssist({ project_id: 'p1', lot_id: 'l9' }, ctx).lot).toBeNull();
  });

  it('survit à une sortie illisible', () => {
    expect(sanitizeAssist(null, CTX).project).toBeNull();
    expect(parseModelJson('pas de json')).toBeNull();
    expect(parseModelJson('```json\n{"summary":"ok"}\n```')).toEqual({ summary: 'ok' });
  });
});

describe('destinataires et objets', () => {
  it('« répondre à tous » écarte soi-même et ne duplique pas l’expéditeur', () => {
    const r = replyAllRecipients(
      { from: 'Paul <paul@ent.test>', to: 'moi@aazs.fr, bet@ent.test', cc: 'Paul <paul@ent.test>, archi@aazs.fr' },
      ['MOI@aazs.fr', 'archi@aazs.fr'],
    );
    expect(r.to).toBe('paul@ent.test');
    expect(r.cc).toBe('bet@ent.test');
  });

  it('ne cumule pas les préfixes Re: et Tr:', () => {
    expect(replySubject('Re: Devis')).toBe('Re: Devis');
    expect(replySubject('Devis')).toBe('Re: Devis');
    expect(forwardSubject('Tr: Devis')).toBe('Tr: Devis');
    expect(forwardSubject('Fwd: Devis')).toBe('Fwd: Devis');
    expect(forwardSubject('Devis')).toBe('Tr: Devis');
  });

  it('extrait les adresses d’un en-tête', () => {
    expect(extractAddresses('Nom <A@b.fr>, c@d.fr; A@b.fr')).toEqual(['a@b.fr', 'c@d.fr']);
  });
});

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { chat.mockReset(); });

const MODEL_ANSWER = {
  summary: 'Le maçon demande validation de son devis.', actions: ['Valider le devis'], category: 'devis', urgency: 'normale',
  project_id: 'p-en-cours', lot_id: 'l-go', reasoning: 'Objet cite la villa Martin.',
  reply: { subject: 'Re: Devis', body: 'Bonjour, nous revenons vers vous.' },
  forward: { contact_ids: ['c-go', 'c-etranger'], body: 'Pour information.' },
  task: { title: 'Valider le devis', description: 'Devis gros œuvre', due_in_days: 2, priority: 'high', assignee_id: 'inconnu' },
};

function seed(plan: string) {
  const tenantId = makeTenant({ plan, ai_credit_balance_eur_cents: 5000, agent_billing_mode: 'prepaid', ai_credit_last_refresh: new Date().toISOString() });
  fakeSupabaseAdmin.seed('projects', [
    { id: 'p-en-cours', tenant_id: tenantId, name: 'Villa Martin', project_code: '26014', client: 'M. Martin', status: 'En cours' },
    { id: 'p-fini', tenant_id: tenantId, name: 'Ancien chantier', project_code: '24001', status: 'Terminé' },
  ]);
  fakeSupabaseAdmin.seed('project_lots', [{ id: 'l-go', tenant_id: tenantId, project_id: 'p-en-cours', lot_number: '02', lot_title: 'Gros œuvre', contact_id: 'c-go' }]);
  fakeSupabaseAdmin.seed('contacts', [{ id: 'c-go', tenant_id: tenantId, company_name: 'Maçonnerie Durand', email: 'durand@ent.test' }]);
  return { tenantId, ...makeUser(tenantId) };
}

const assist = (token: string, body: Record<string, unknown> = {}) =>
  request(app).post('/api/mail/ai/assist').set(authHeader(token)).send({
    subject: 'Devis gros œuvre', from: 'Paul <durand@ent.test>', to: 'moi@aazs.fr', cc: '', date: '2026-10-20T08:00:00Z',
    body: 'Bonjour, voici le devis pour la villa Martin.', attachments: ['devis.pdf'], ...body,
  });

describe('POST /api/mail/ai/assist', () => {
  it('réserve le plan Enterprise', async () => {
    const { token } = seed('pro');
    const res = await assist(token);
    expect(res.status).toBe(403);
    expect(chat).not.toHaveBeenCalled();
  });

  it('rend une proposition débarrassée des identifiants inventés, sans affaire terminée dans le prompt', async () => {
    const { token } = seed('enterprise');
    chat.mockResolvedValue({ text: JSON.stringify(MODEL_ANSWER), usage: { inputTokens: 500, outputTokens: 200 } });

    const res = await assist(token);
    expect(res.status).toBe(200);
    const s = res.body.suggestion;
    expect(s.project).toMatchObject({ id: 'p-en-cours', name: 'Villa Martin' });
    expect(s.lot.label).toBe('02 Gros œuvre');
    expect(s.forward.recipients.map((r: any) => r.email)).toEqual(['durand@ent.test']);
    expect(s.task.assigneeId).toBeNull();
    expect(s.reply.body).toContain('nous revenons');

    const prompt: string = chat.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('voici le devis pour la villa Martin');
    expect(prompt).toContain('Villa Martin');
    expect(prompt).not.toContain('Ancien chantier');
  });

  it('répond 502 quand la sortie du modèle est illisible', async () => {
    const { token } = seed('enterprise');
    chat.mockResolvedValue({ text: 'désolé, je ne peux pas', usage: { inputTokens: 10, outputTokens: 5 } });
    expect((await assist(token)).status).toBe(502);
  });

  it('refuse un message vide', async () => {
    const { token } = seed('enterprise');
    expect((await assist(token, { subject: '', body: '' })).status).toBe(400);
    expect(chat).not.toHaveBeenCalled();
  });
});
