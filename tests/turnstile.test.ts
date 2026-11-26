// Vérification Cloudflare Turnstile sur les routes publiques d'inscription et
// de réinitialisation de mot de passe (server/turnstile.ts).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const originalFetch = global.fetch;
const originalSecret = process.env.TURNSTILE_SECRET_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = originalSecret;
});

function mockSiteverify(success: boolean) {
  const fn = vi.fn(async () => ({ ok: true, json: async () => ({ success }) }));
  global.fetch = fn as any;
  return fn;
}

describe('Turnstile sur /api/public/forgot-password', () => {
  it('ne vérifie rien quand TURNSTILE_SECRET_KEY est absente', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const siteverify = mockSiteverify(false);
    const res = await request(app).post('/api/public/forgot-password').send({ email: 'a@example.test' });
    expect(res.status).toBe(200);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('refuse une requête sans jeton quand la clé secrète est définie', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const siteverify = mockSiteverify(true);
    const res = await request(app).post('/api/public/forgot-password').send({ email: 'a@example.test' });
    expect(res.status).toBe(400);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('refuse un jeton rejeté par Cloudflare', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    mockSiteverify(false);
    const res = await request(app).post('/api/public/forgot-password').send({ email: 'a@example.test', captchaToken: 'bad' });
    expect(res.status).toBe(400);
  });

  it('accepte un jeton validé par Cloudflare', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const siteverify = mockSiteverify(true);
    const res = await request(app).post('/api/public/forgot-password').send({ email: 'a@example.test', captchaToken: 'good' });
    expect(res.status).toBe(200);
    expect(siteverify).toHaveBeenCalledTimes(1);
  });

  it('répond 503 quand Cloudflare est injoignable (échec fermé)', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    global.fetch = vi.fn(async () => { throw new Error('network'); }) as any;
    const res = await request(app).post('/api/public/forgot-password').send({ email: 'a@example.test', captchaToken: 'x' });
    expect(res.status).toBe(503);
  });
});

describe('Turnstile sur /api/public/resend-confirmation', () => {
  it('ne vérifie rien quand TURNSTILE_SECRET_KEY est absente', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const siteverify = mockSiteverify(false);
    const res = await request(app).post('/api/public/resend-confirmation').send({ email: 'a@example.test' });
    expect(res.status).toBe(200);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('refuse une requête sans jeton quand la clé secrète est définie', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    mockSiteverify(true);
    const res = await request(app).post('/api/public/resend-confirmation').send({ email: 'a@example.test' });
    expect(res.status).toBe(400);
  });

  it('accepte un jeton validé par Cloudflare', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    mockSiteverify(true);
    const res = await request(app).post('/api/public/resend-confirmation').send({ email: 'a@example.test', captchaToken: 'good' });
    expect(res.status).toBe(200);
  });
});

describe('Turnstile sur /api/public/register', () => {
  it('refuse une inscription sans jeton quand la clé secrète est définie', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    mockSiteverify(true);
    const res = await request(app).post('/api/public/register').send({
      cabinet_name: 'Cabinet', slug: `cab-${Date.now()}`, admin_name: 'Admin', email: 'x@example.test', password: 'longenough', consent: true,
    });
    expect(res.status).toBe(400);
  });
});
