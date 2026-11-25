import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { handleSingleSitePhotoUpload, MAX_CONCURRENT_SITE_PHOTO_UPLOADS, SITE_PHOTO_RETRY_AFTER_SECONDS } from '../server/imageUpload';

// Une photo de chantier décodée en JavaScript sature le processeur : au-delà de
// MAX_CONCURRENT_SITE_PHOTO_UPLOADS envois simultanés, le serveur répond 429 + Retry-After
// avant de lire le fichier, et le client (src/lib/offlineQueue.ts) garde la photo et réessaie.
describe('plafond d\'envois simultanés de photos de chantier', () => {
  const buildApp = () => {
    const app = express();
    app.post('/photo', handleSingleSitePhotoUpload('file'), async (_req, res) => {
      await new Promise(resolve => setTimeout(resolve, 150));
      res.status(201).json({ ok: true });
    });
    return app;
  };
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const send = (app: express.Express) => request(app).post('/photo').attach('file', png, { filename: 'p.png', contentType: 'image/png' });

  it('refuse l\'excédent avec un 429 et un Retry-After, puis accepte de nouveau', async () => {
    const app = buildApp();
    const total = MAX_CONCURRENT_SITE_PHOTO_UPLOADS + 2;
    const responses = await Promise.all(Array.from({ length: total }, () => send(app)));

    const accepted = responses.filter(r => r.status === 201);
    const refused = responses.filter(r => r.status === 429);
    expect(accepted).toHaveLength(MAX_CONCURRENT_SITE_PHOTO_UPLOADS);
    expect(refused).toHaveLength(2);
    expect(refused[0].headers['retry-after']).toBe(String(SITE_PHOTO_RETRY_AFTER_SECONDS));
    expect(refused[0].body.error).toContain('Serveur occupé');

    // Le compteur est bien relâché à la fin des requêtes : un envoi suivant passe.
    const after = await send(app);
    expect(after.status).toBe(201);
  });
});
