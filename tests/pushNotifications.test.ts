// Notifications poussées : la file notification_outbox et les deux transports
// qu'elle alimente (Web Push pour la PWA, relevé pour le client Electron —
// voir server/push.ts). Les envois Web Push eux-mêmes ne sont pas exercés
// ici : sans clés VAPID, isWebPushConfigured() est faux et seul l'écriture
// dans la file a lieu, ce qui est précisément le comportement à garantir
// (une instance sans clés ne doit rien casser).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { notifyUsers } from '../server/push';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: 'fake-p256dh-key', auth: 'fake-auth-secret' },
});

describe('Abonnements Web Push', () => {
  it('enregistre un abonnement et le rattache au cabinet de la personne', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);

    const res = await request(app).post('/api/push/subscribe').set(authHeader(token))
      .send(subscription('https://fcm.googleapis.com/fcm/send/abc'));
    expect(res.status).toBe(201);

    const rows = fakeSupabaseAdmin.getTable('push_subscriptions')
      .filter(r => r.endpoint === 'https://fcm.googleapis.com/fcm/send/abc');
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(tenantId);
    expect(rows[0].user_id).toBe(userId);
  });

  it("refuse un endpoint qui n'est pas en https", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/push/subscribe').set(authHeader(token))
      .send(subscription('http://exemple.test/push'));
    expect(res.status).toBe(400);
  });

  it("ne laisse pas désabonner l'appareil d'un collègue", async () => {
    const tenantId = makeTenant();
    const owner = makeUser(tenantId);
    const other = makeUser(tenantId);
    const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/xyz';

    await request(app).post('/api/push/subscribe').set(authHeader(owner.token)).send(subscription(endpoint));

    const attempt = await request(app).post('/api/push/unsubscribe').set(authHeader(other.token)).send({ endpoint });
    expect(attempt.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('push_subscriptions').some(r => r.endpoint === endpoint)).toBe(true);

    const own = await request(app).post('/api/push/unsubscribe').set(authHeader(owner.token)).send({ endpoint });
    expect(own.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('push_subscriptions').some(r => r.endpoint === endpoint)).toBe(false);
  });
});

describe('File de notifications', () => {
  it('dépose une ligne par destinataire', async () => {
    const tenantId = makeTenant();
    const first = makeUser(tenantId);
    const second = makeUser(tenantId);

    await notifyUsers(fakeSupabaseAdmin as any, tenantId, [first.userId, second.userId], {
      title: 'Facture échue',
      body: 'La facture F-2026-014 est échue depuis 12 jours.',
      category: 'Factures',
    });

    const rows = fakeSupabaseAdmin.getTable('notification_outbox')
      .filter(r => r.tenant_id === tenantId && r.title === 'Facture échue');
    expect(rows.map(r => r.user_id).sort()).toEqual([first.userId, second.userId].sort());
  });

  it('saute la personne qui a coupé cette catégorie', async () => {
    const tenantId = makeTenant();
    const muted = makeUser(tenantId);
    const listening = makeUser(tenantId);

    const saved = await request(app).put('/api/push/preferences').set(authHeader(muted.token))
      .send({ muted: ['Messages'] });
    expect(saved.status).toBe(200);

    await notifyUsers(fakeSupabaseAdmin as any, tenantId, [muted.userId, listening.userId], {
      title: 'Nouvelle mention',
      category: 'Messages',
    });

    const recipients = fakeSupabaseAdmin.getTable('notification_outbox')
      .filter(r => r.tenant_id === tenantId && r.title === 'Nouvelle mention')
      .map(r => r.user_id);
    expect(recipients).toEqual([listening.userId]);
  });
});

describe('Relevé du client de bureau', () => {
  it('rend une notification une seule fois', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);

    await notifyUsers(fakeSupabaseAdmin as any, tenantId, [userId], {
      title: 'Réserve non levée',
      url: '/notifications',
    });

    const first = await request(app).get('/api/notifications/pending').set(authHeader(token));
    expect(first.status).toBe(200);
    expect(first.body.map((n: any) => n.title)).toContain('Réserve non levée');

    // Marquée livrée par le premier relevé : un second tour de boucle ne doit
    // pas refaire sonner la même alerte.
    const second = await request(app).get('/api/notifications/pending').set(authHeader(token));
    expect(second.body).toHaveLength(0);
  });

  it("ne montre pas la file d'un autre cabinet", async () => {
    const tenantA = makeTenant();
    const alice = makeUser(tenantA);
    const tenantB = makeTenant();
    const bob = makeUser(tenantB);

    await notifyUsers(fakeSupabaseAdmin as any, tenantA, [alice.userId], { title: 'Alerte du cabinet A' });

    const res = await request(app).get('/api/notifications/pending').set(authHeader(bob.token));
    expect(res.status).toBe(200);
    expect(res.body.some((n: any) => n.title === 'Alerte du cabinet A')).toBe(false);
  });
});
