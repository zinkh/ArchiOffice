// Numéro d'affaire attribué à la suite du plus grand numéro existant (server/projectCode.ts),
// y compris à la conversion d'une proposition acceptée.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { affaireHead, affaireNumbering, highestSequence, nextProjectCode } from '../server/projectCode';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const NOW = new Date('2026-11-24T10:00:00Z');

describe('highestSequence', () => {
  it('prend le plus grand numéro, pas le nombre d\'affaires', () => {
    expect(highestSequence(['AFF-26-001', 'AFF-26-007', 'AFF-26-003', 'AFF-25-099', null, 'AFF-26-x'], 'AFF-26-')).toBe(7);
    expect(highestSequence([], 'AFF-26-')).toBe(0);
  });
  it('compose le début selon les réglages (tirets et préfixe)', () => {
    expect(affaireHead(affaireNumbering({ num_prefix_affaire: 'AFF' }), '26')).toBe('AFF-26-');
    expect(affaireHead(affaireNumbering({}), '26')).toBe('26');
    expect(affaireHead(affaireNumbering({ num_prefix_affaire: 'PRO', num_affaire_sep_prefix: false, num_affaire_sep_seq: false }), '26')).toBe('PRO26');
  });
});

describe('nextProjectCode', () => {
  it('continue après le dernier numéro de l\'année, même si des affaires ont disparu', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, num_prefix_affaire: 'AFF', num_affaire_digits: 3 }]);
    fakeSupabaseAdmin.seed('projects', [
      { id: crypto.randomUUID(), tenant_id: tenantId, project_code: 'AFF-26-001' },
      { id: crypto.randomUUID(), tenant_id: tenantId, project_code: 'AFF-26-005' },
      { id: crypto.randomUUID(), tenant_id: tenantId, project_code: 'AFF-25-040' },
    ]);
    expect(await nextProjectCode(fakeSupabaseAdmin, tenantId, NOW)).toBe('AFF-26-006');
  });
  it('commence à 001 sans affaire cette année', async () => {
    const tenantId = makeTenant();
    expect(await nextProjectCode(fakeSupabaseAdmin, tenantId, NOW)).toBe('26001');
  });
});

describe('conversion d\'une proposition en affaire', () => {
  it('attribue le numéro suivant, sans reprendre la référence de la proposition', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const year = String(new Date().getFullYear()).slice(-2);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, num_prefix_affaire: 'AFF' }]);
    fakeSupabaseAdmin.seed('projects', [{ id: crypto.randomUUID(), tenant_id: tenantId, project_code: `AFF-${year}-012` }]);
    fakeSupabaseAdmin.seed('proposals', [{ id: 'p-num', tenant_id: tenantId, title: 'Maison', status: 'Draft', amount: 1000 }]);

    const res = await request(app).put('/api/proposals/p-num').set(authHeader(token))
      .send({ title: 'Maison', status: 'Accepted', amount: 1000, project_code: 'DEVIS-2026-023' });
    expect(res.status).toBe(200);
    const project = fakeSupabaseAdmin.getTable('projects').find(p => p.name === 'Maison' && p.tenant_id === tenantId);
    expect(project?.project_code).toBe(`AFF-${year}-013`);
  });
});
