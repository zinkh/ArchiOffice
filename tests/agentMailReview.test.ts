// Revue matinale des mails (server/agentMailReview.ts) : échéance en heure
// locale, sélection des mails, lecture de la sortie du modèle, et la revue de
// bout en bout contre une boîte simulée — voir CLAUDE.md, « Revue matinale
// des mails par un agent ».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';

const chat = vi.fn();
vi.mock('@zinkh/archioffice-agents/server/llm', () => ({
  resolveLlmProvider: () => ({ id: 'test', model: 'test-model', chat }),
  getPlatformAiConfig: async () => ({}),
  LlmNotConfiguredError: class extends Error {},
}));

import {
  computeNextReviewRun, lookbackHoursFor, selectCandidates, parseReviewJson,
  buildReviewItems, notificationForItem, executeMailReview, runDueMailReviews, type MailReview,
} from '../server/agentMailReview';
import { issueMailRelayToken, resolveMailRelayToken } from '../server/agentMailRelayTokens';

const paris = { hour_local: 8, timezone: 'Europe/Paris', weekdays_only: true };

describe('computeNextReviewRun', () => {
  it('vise 8 h heure de Paris en été (UTC+2)', () => {
    const next = computeNextReviewRun(paris, new Date('2026-07-07T10:00:00Z')); // mardi
    expect(next.toISOString()).toBe('2026-07-08T06:00:00.000Z');
  });

  it('vise 8 h heure de Paris en hiver (UTC+1)', () => {
    const next = computeNextReviewRun(paris, new Date('2026-12-08T10:00:00Z'));
    expect(next.toISOString()).toBe('2026-12-09T07:00:00.000Z');
  });

  it('garde 8 h locale de part et d\'autre du passage à l\'heure d\'été', () => {
    // Vendredi 27 mars 2026 : encore UTC+1 ; lundi 30 : UTC+2.
    expect(computeNextReviewRun({ ...paris, weekdays_only: false }, new Date('2026-03-27T10:00:00Z')).toISOString()).toBe('2026-03-28T07:00:00.000Z');
    expect(computeNextReviewRun({ ...paris, weekdays_only: false }, new Date('2026-03-29T10:00:00Z')).toISOString()).toBe('2026-03-30T06:00:00.000Z');
  });

  it('saute le week-end quand weekdays_only', () => {
    const next = computeNextReviewRun(paris, new Date('2026-10-02T10:00:00Z')); // vendredi 2 octobre
    expect(next.toISOString()).toBe('2026-10-05T06:00:00.000Z'); // lundi
  });

  it('inclut le week-end sans weekdays_only', () => {
    const next = computeNextReviewRun({ ...paris, weekdays_only: false }, new Date('2026-10-02T10:00:00Z'));
    expect(next.toISOString()).toBe('2026-10-03T06:00:00.000Z');
  });

  it('prend le jour même si l\'heure n\'est pas encore passée', () => {
    const next = computeNextReviewRun(paris, new Date('2026-10-06T03:00:00Z')); // mardi 5 h Paris
    expect(next.toISOString()).toBe('2026-10-06T06:00:00.000Z');
  });

  it('retombe sur Europe/Paris si le fuseau est invalide', () => {
    const next = computeNextReviewRun({ ...paris, timezone: 'Nulle/Part' }, new Date('2026-07-07T10:00:00Z'));
    expect(next.toISOString()).toBe('2026-07-08T06:00:00.000Z');
  });
});

describe('lookbackHoursFor', () => {
  const now = new Date('2026-10-05T06:00:00Z');
  it('couvre le week-end le lundi', () => {
    expect(lookbackHoursFor('2026-10-02T06:00:00Z', now)).toBe(72);
  });
  it('ne descend pas sous 20 h', () => {
    expect(lookbackHoursFor('2026-10-05T05:00:00Z', now)).toBe(20);
  });
  it('vaut 24 h sans revue précédente', () => {
    expect(lookbackHoursFor(null, now)).toBe(24);
  });
  it('plafonne à 72 h après une longue panne', () => {
    expect(lookbackHoursFor('2026-08-01T00:00:00Z', now)).toBe(72);
  });
});

describe('selectCandidates', () => {
  const now = new Date('2026-10-05T06:00:00Z');
  const mail = (over: Partial<Parameters<typeof selectCandidates>[0][number]>) => ({
    id: 'm1', subject: 'Question', from: 'Client <client@example.test>', date: '2026-10-05T04:00:00Z', accountEmail: 'moi@aazs.fr', ...over,
  });

  it('écarte ses propres envois, les expéditeurs automatiques et le trop ancien', () => {
    const kept = selectCandidates([
      mail({ id: 'a' }),
      mail({ id: 'b', from: 'Moi <moi@aazs.fr>' }),
      mail({ id: 'c', from: 'noreply@service.test' }),
      mail({ id: 'd', from: 'Newsletter <newsletter@x.test>' }),
      mail({ id: 'e', date: '2026-09-20T04:00:00Z' }),
    ], now, 24);
    expect(kept.map(m => m.id)).toEqual(['a']);
  });

  it('garde un message à date illisible plutôt que de le perdre', () => {
    expect(selectCandidates([mail({ date: 'pas une date' })], now, 24)).toHaveLength(1);
  });

  it('dédoublonne par boîte et plafonne le nombre de candidats', () => {
    const many = Array.from({ length: 40 }, (_, i) => mail({ id: `m${i}` }));
    expect(selectCandidates([...many, ...many], now, 24)).toHaveLength(15);
  });
});

describe('parseReviewJson / buildReviewItems', () => {
  const mails = [
    { id: 'g1', subject: 'Devis', from: 'A <a@x.test>', date: null, accountEmail: null },
    { id: 'g2', subject: 'Merci', from: 'B <b@x.test>', date: null, accountEmail: null },
    { id: 'g3', subject: 'RDV', from: 'C <c@x.test>', date: null, accountEmail: null },
  ];

  it('lit un JSON entouré de texte et de balises de code', () => {
    const raw = parseReviewJson('Voici :\n```json\n{"mails":[{"n":1,"reponse_attendue":true,"proposition":"Bonjour"}]}\n```');
    expect(raw).toHaveLength(1);
  });

  it('rend une liste vide sur une sortie illisible', () => {
    expect(parseReviewJson('désolé, je ne peux pas')).toEqual([]);
    expect(parseReviewJson('{"mails": cassé')).toEqual([]);
  });

  it('rattache par numéro, ignore ce qui n\'attend pas de réponse et trie par urgence', () => {
    const items = buildReviewItems([
      { n: 1, reponse_attendue: true, urgence: 'basse', raison: 'devis', proposition: 'Bonjour, merci.' },
      { n: 2, reponse_attendue: false, proposition: 'inutile' },
      { n: 3, reponse_attendue: true, urgence: 'haute', raison: 'rdv', proposition: 'Je confirme.' },
      { n: 9, reponse_attendue: true, proposition: 'numéro inconnu' },
      { n: 3, reponse_attendue: true, proposition: 'doublon' },
    ], mails, 10);
    expect(items.map(i => i.id)).toEqual(['g3', 'g1']);
    expect(items[0].urgency).toBe('haute');
  });

  it('respecte la limite et refuse une proposition vide', () => {
    const items = buildReviewItems([
      { n: 1, reponse_attendue: true, proposition: 'ok' },
      { n: 2, reponse_attendue: true, proposition: '   ' },
      { n: 3, reponse_attendue: true, proposition: 'ok aussi' },
    ], mails, 1);
    expect(items).toHaveLength(1);
  });
});

describe('notificationForItem', () => {
  it('nomme l\'expéditeur, marque l\'urgence et borne la longueur', () => {
    const n = notificationForItem({
      id: 'x', from: 'Marie Dupont <marie@x.test>', subject: 'Plans', urgency: 'haute', reason: '', proposal: 'a'.repeat(900),
    }, 'Sophie');
    expect(n.title).toBe('Urgent · Marie Dupont · Plans');
    expect(n.body.startsWith('Sophie propose : ')).toBe(true);
    expect(n.body.length).toBeLessThanOrEqual(380);
  });
});

describe('jeton de relais multi-usage', () => {
  it('reste à usage unique par défaut', async () => {
    const db = new FakeSupabaseAdmin();
    const token = await issueMailRelayToken(db as any, 't', 'u');
    expect(await resolveMailRelayToken(db as any, token)).not.toBeNull();
    expect(await resolveMailRelayToken(db as any, token)).toBeNull();
  });

  it('sert exactement maxUses fois puis s\'éteint', async () => {
    const db = new FakeSupabaseAdmin();
    const token = await issueMailRelayToken(db as any, 't', 'u', { maxUses: 3 });
    for (let i = 0; i < 3; i++) expect(await resolveMailRelayToken(db as any, token)).toEqual({ tenantId: 't', userId: 'u' });
    expect(await resolveMailRelayToken(db as any, token)).toBeNull();
  });

  it('refuse un jeton multi-usage expiré', async () => {
    const db = new FakeSupabaseAdmin();
    const token = await issueMailRelayToken(db as any, 't', 'u', { maxUses: 3 });
    db.getTable('agent_mail_relay_tokens')[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await resolveMailRelayToken(db as any, token)).toBeNull();
  });
});

describe('revue de bout en bout', () => {
  const NOW = new Date('2026-10-05T06:00:00Z');
  let db: FakeSupabaseAdmin;
  let review: MailReview;

  beforeEach(() => {
    chat.mockReset();
    db = new FakeSupabaseAdmin();
    db.seed('agents', [{ id: 'sophie', tenant_id: 't1', name: 'Sophie', is_active: true, mail_enabled: true, context_scopes: [] }]);
    db.seed('tenants', [{ id: 't1', ai_credit_balance_eur_cents: 500, agent_billing_mode: 'prepaid' }]);
    review = {
      id: 'r1', tenant_id: 't1', user_id: 'u1', agent_id: 'sophie', enabled: true,
      hour_local: 8, timezone: 'Europe/Paris', weekdays_only: true, max_mails: 5,
      last_run_at: null, next_run_at: '2026-10-05T05:59:00Z',
    };
    db.seed('agent_mail_reviews', [review]);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const json = (body: unknown) => ({ ok: true, json: async () => body });
      if (url.endsWith('/api/mail/accounts')) return json([{ id: 'acc1', provider: 'google', email: 'moi@aazs.fr', isDefault: true }]);
      if (url.includes('/api/gmail/messages?')) return json({ messages: [
        { id: 'g1', subject: 'Devis toiture', from: 'Paul <paul@x.test>', date: '2026-10-05T04:30:00Z' },
        { id: 'g2', subject: 'Merci', from: 'Lea <lea@x.test>', date: '2026-10-05T04:00:00Z' },
        { id: 'g3', subject: 'Promo', from: 'noreply@shop.test', date: '2026-10-05T03:00:00Z' },
      ] });
      if (url.includes('/api/gmail/messages/')) return json({ subject: 'Devis toiture', from: 'Paul', content: 'Pouvez-vous me confirmer le devis ?', bodyText: 'Pouvez-vous me confirmer le devis ?' });
      return { ok: false, json: async () => ({}) };
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lit la boîte, propose une réponse par mail attendu et notifie', async () => {
    chat.mockResolvedValue({
      text: '{"mails":[{"n":1,"reponse_attendue":true,"urgence":"normale","raison":"devis à confirmer","proposition":"Bonjour Paul, je confirme le devis."},{"n":2,"reponse_attendue":false}]}',
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    const deductAiCredit = vi.fn().mockResolvedValue({ newBalance: 490, costCents: 10 });

    const outcome = await executeMailReview(db as any, review, { baseUrl: 'http://local', deductAiCredit }, { scheduled: true, now: NOW });

    expect(outcome.status).toBe('ok');
    expect(outcome.reviewed).toBe(2); // l'expéditeur automatique est écarté avant le modèle
    expect(outcome.items).toHaveLength(1);
    expect(deductAiCredit).toHaveBeenCalledOnce();

    // Le modèle n'a reçu aucun outil et un contenu numéroté.
    const call = chat.mock.calls[0][0];
    expect(call.tools).toEqual([]);
    expect(call.messages[0].content).toContain('--- MAIL 1 ---');
    expect(call.messages[0].content).not.toContain('noreply@shop.test');

    const pushes = db.getTable('notification_outbox');
    expect(pushes).toHaveLength(1); // une seule proposition : pas de notification de synthèse
    expect(pushes[0]).toMatchObject({ user_id: 'u1', category: 'Alertes IA', url: '/mailbox' });
    expect(pushes[0].body).toContain('je confirme le devis');

    const saved = db.getTable('agent_mail_reviews')[0];
    expect(saved).toMatchObject({ last_status: 'ok', last_count: 1 });
    expect(saved.next_run_at).toBe('2026-10-06T06:00:00.000Z');
  });

  it('ajoute une notification de synthèse quand plusieurs mails attendent', async () => {
    chat.mockResolvedValue({
      text: '{"mails":[{"n":1,"reponse_attendue":true,"proposition":"A"},{"n":2,"reponse_attendue":true,"proposition":"B"}]}',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await executeMailReview(db as any, review, { baseUrl: 'http://local' }, { scheduled: true, now: NOW });
    const titles = db.getTable('notification_outbox').map(n => n.title);
    expect(titles).toHaveLength(3);
    expect(titles[0]).toContain('2 mails attendent');
  });

  it('n\'envoie rien quand aucun mail n\'attend de réponse', async () => {
    chat.mockResolvedValue({ text: '{"mails":[]}', usage: { inputTokens: 1, outputTokens: 1 } });
    const outcome = await executeMailReview(db as any, review, { baseUrl: 'http://local' }, { scheduled: true, now: NOW });
    expect(outcome.status).toBe('ok');
    expect(db.getTable('notification_outbox')).toHaveLength(0);
  });

  it('saute la revue sans crédit IA, sans appeler le modèle', async () => {
    db.getTable('tenants')[0].ai_credit_balance_eur_cents = 0;
    const outcome = await executeMailReview(db as any, review, { baseUrl: 'http://local' }, { scheduled: true, now: NOW });
    expect(outcome.status).toBe('skipped');
    expect(chat).not.toHaveBeenCalled();
  });

  it('saute la revue si l\'agent n\'a pas accès à la messagerie', async () => {
    db.getTable('agents')[0].mail_enabled = false;
    const outcome = await executeMailReview(db as any, review, { baseUrl: 'http://local' }, { scheduled: true, now: NOW });
    expect(outcome.status).toBe('skipped');
    expect(outcome.error).toMatch(/messagerie/);
  });

  it('une revue manuelle ne déplace pas l\'échéance du matin', async () => {
    chat.mockResolvedValue({ text: '{"mails":[]}', usage: { inputTokens: 1, outputTokens: 1 } });
    await executeMailReview(db as any, review, { baseUrl: 'http://local' }, { scheduled: false, now: NOW });
    expect(db.getTable('agent_mail_reviews')[0].next_run_at).toBe('2026-10-05T05:59:00Z');
  });

  it('runDueMailReviews réserve l\'échéance et ne rejoue pas la revue au tick suivant', async () => {
    chat.mockResolvedValue({ text: '{"mails":[]}', usage: { inputTokens: 1, outputTokens: 1 } });
    expect(await runDueMailReviews(db as any, { baseUrl: 'http://local' }, NOW)).toBe(1);
    expect(await runDueMailReviews(db as any, { baseUrl: 'http://local' }, NOW)).toBe(0);
  });
});
