// Covers two fixes from the security audit:
//  - CORS used to reflect any Origin verbatim with credentials:true (any site
//    could get a CORS grant to an authenticated caller's browser).
//  - The HTTP→HTTPS redirect and apex→www canonicalization built their target
//    straight from the client/proxy-controlled Host header, so a spoofed Host
//    (paired with X-Forwarded-Proto: http) could redirect to an arbitrary domain.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('CORS allow-list', () => {
  it('does not grant CORS to an arbitrary origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('grants CORS to a known ArchiOffice tenant subdomain', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://aacz.archioffice.fr');
    expect(res.headers['access-control-allow-origin']).toBe('https://aacz.archioffice.fr');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects a plain-http origin even for an otherwise-known hostname', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://archioffice.fr');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Baseline security headers (helmet)', () => {
  it('sets clickjacking, MIME-sniffing, and transport-security headers on every response', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    // Intentionally NOT set: a full default-src CSP or cross-origin-embedder
    // policy would break the app's own map-tile/Storage-image loading from
    // external hosts — see the comment above helmet(...) in server.ts.
    expect(res.headers['cross-origin-embedder-policy']).toBeUndefined();
  });
});

describe('Host-header redirect hardening', () => {
  it('rejects a request carrying an unknown Host', async () => {
    const res = await request(app).get('/api/health').set('Host', 'attacker-controlled.test');
    expect(res.status).toBe(400);
  });

  it('does not redirect to an attacker-supplied Host even with a spoofed X-Forwarded-Proto', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Host', 'attacker-controlled.test')
      .set('X-Forwarded-Proto', 'http');
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});
