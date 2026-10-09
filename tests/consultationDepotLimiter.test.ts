// Le portail public n'est protégé que par son jeton : le limiteur par IP doit
// couper un sondage ou un envoi en rafale.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp } from './testServer';

process.env.DEPOT_READ_LIMIT = '3';
process.env.DEPOT_WRITE_LIMIT = '2';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

describe('limiteurs du portail de dépôt', () => {
  it('coupe les lectures en rafale (sondage de jetons)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await request(app).get(`/api/public/depot/dpt_${'b'.repeat(43)}`)).status);
    expect(codes.slice(0, 3)).toEqual([404, 404, 404]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('coupe les dépôts en rafale', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) codes.push((await request(app).post(`/api/public/depot/dpt_${'c'.repeat(43)}/saisie`).send({})).status);
    expect(codes).toEqual([404, 404, 429, 429]);
  });
});
