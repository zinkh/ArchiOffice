// Modèles de projet : répartition des missions MOE, reprise par un contrat et
// convertie en répartition d'honoraires pour une proposition.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { PROJECT_TEMPLATE_CATALOG } from '../server/projectTemplateCatalog';
import { contratDefaultsFromTemplate, feeDistributionFromTemplate, summarizeTemplate } from '../src/lib/projectTemplates';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('missions du catalogue', () => {
  it('chaque modèle répartit exactement 100 % sur ses missions incluses', () => {
    for (const entry of PROJECT_TEMPLATE_CATALOG) {
      const total = (entry.default_missions ?? []).filter(m => m.incluse).reduce((s, m) => s + (m.pct ?? 0), 0);
      expect(total, entry.catalog_key).toBeCloseTo(100, 6);
    }
  });

  it('garde les identifiants de mission que la fiche projet sait relier à une phase', () => {
    const known = new Set(['esquisse', 'aps', 'apd', 'pro', 'act', 'visa', 'det', 'aor', 'opc', 'diag', 'pc']);
    for (const entry of PROJECT_TEMPLATE_CATALOG) {
      for (const m of entry.default_missions ?? []) expect(known.has(m.id), `${entry.catalog_key}:${m.id}`).toBe(true);
    }
  });

  it('une réhabilitation prend une mission de diagnostic, un permis seul s\'arrête au dossier de permis', () => {
    const rehab = PROJECT_TEMPLATE_CATALOG.find(e => e.catalog_key === 'rehabilitation-prive')!;
    expect(rehab.default_missions!.find(m => m.id === 'diag')).toMatchObject({ incluse: true, category: 'base' });
    const permis = PROJECT_TEMPLATE_CATALOG.find(e => e.catalog_key === 'permis_seul-prive')!;
    expect(permis.default_missions!.map(m => m.id)).toEqual(['esquisse', 'aps', 'pc']);
  });
});

describe('contrat MOE depuis un modèle', () => {
  it('reprend le type de contrat, le type de maître d\'ouvrage et une copie des missions', () => {
    const rehabPublic = PROJECT_TEMPLATE_CATALOG.find(e => e.catalog_key === 'rehabilitation-public')!;
    const defaults = contratDefaultsFromTemplate(rehabPublic);
    expect(defaults.type_contrat).toBe('rehabilitation');
    expect(defaults.type_moa).toBe('public');
    expect(defaults.missions_list).toEqual(rehabPublic.default_missions);
    expect(defaults.missions_list![0]).not.toBe(rehabPublic.default_missions![0]);
  });

  it('une extension ou une maison individuelle est une construction neuve au contrat', () => {
    for (const key of ['extension-prive', 'maison_individuelle-prive', 'permis_seul-prive']) {
      const e = PROJECT_TEMPLATE_CATALOG.find(x => x.catalog_key === key)!;
      expect(contratDefaultsFromTemplate(e).type_contrat).toBe('construction_neuve');
    }
  });

  it('un modèle sans missions ne touche pas à celles du formulaire', () => {
    expect(contratDefaultsFromTemplate({ operation_type: 'neuf', marche_type: 'prive', default_missions: [] })).not.toHaveProperty('missions_list');
  });
});

describe('proposition depuis un modèle', () => {
  it('convertit les missions à pourcentage en « Mission base » chiffrées sur le total', () => {
    const neuf = PROJECT_TEMPLATE_CATALOG.find(e => e.catalog_key === 'neuf-prive')!;
    const data = JSON.parse(feeDistributionFromTemplate(neuf.default_missions, 10000)!);
    const byId = Object.fromEntries(data.missions.map((m: any) => [m.id, m]));
    expect(byId.projet).toMatchObject({ name: 'Projet', category: 'Mission base', default_pct: 18, amount: 1800 });
    expect(byId.pro).toBeUndefined();
    expect(byId.det).toMatchObject({ name: 'D.E.T.', category: 'Mission base', amount: 2500 });
    // Missions non incluses (OPC, diagnostic en option) absentes.
    expect(byId.opc).toBeUndefined();
    const total = data.missions.reduce((s: number, m: any) => s + m.amount, 0);
    expect(total).toBeCloseTo(10000, 2);
  });

  it('garde une mission complémentaire à part, sans montant imposé', () => {
    const data = JSON.parse(feeDistributionFromTemplate([
      { id: 'opc', name: 'OPC', pct: 3, incluse: true, category: 'complementaire' },
    ], 5000)!);
    expect(data.missions[0]).toMatchObject({ category: 'Missions complémentaires', amount: 0 });
  });

  it('rend undefined sans mission incluse', () => {
    expect(feeDistributionFromTemplate([], 1000)).toBeUndefined();
    expect(feeDistributionFromTemplate([{ id: 'x', name: 'X', pct: 0, incluse: false }], 1000)).toBeUndefined();
  });

  it('le résumé compte les missions incluses', () => {
    expect(summarizeTemplate({ default_missions: [{ id: 'a', name: 'A', incluse: true }, { id: 'b', name: 'B', incluse: false }] })).toBe('1 mission');
  });
});

describe('routes : missions d\'un modèle', () => {
  it('assainit les missions écrites à la main', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/project-templates').set(authHeader(token)).send({
      name: 'Test missions',
      default_missions: [
        { id: 'esquisse', name: 'Esquisse', pct: 150, incluse: true, category: 'inconnue' },
        { name: '' },
        { name: 'Sans id', pct: '12.5', incluse: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const [a, b] = res.body.default_missions;
    expect(res.body.default_missions).toHaveLength(2);
    expect(a).toEqual({ id: 'esquisse', name: 'Esquisse', pct: 100, incluse: true, category: 'base' });
    expect(b.id).toBeTruthy();
    expect(b).toMatchObject({ name: 'Sans id', pct: 12.5, incluse: true, category: 'base' });
  });

  it('un modèle tiré d\'une affaire reprend les missions de son contrat MOE', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-m', tenant_id: tenantId, name: 'Mairie', start_date: '2026-03-01' }]);
    fakeSupabaseAdmin.seed('contrats_moe', [{
      id: 'c-m', tenant_id: tenantId, project_id: 'proj-m', created_at: '2026-03-02T00:00:00Z',
      missions_list: [{ id: 'esquisse', name: 'Esquisse (ESQ)', pct: 40, incluse: true, category: 'base' }, { id: 'det', name: 'DET', pct: 60, incluse: true, category: 'exe' }],
    }]);
    const res = await request(app).post('/api/project-templates/from-project/proj-m').set(authHeader(token)).send({});
    expect(res.status).toBe(201);
    expect(res.body.default_missions.map((m: any) => [m.id, m.pct, m.category])).toEqual([['esquisse', 40, 'base'], ['det', 60, 'exe']]);
  });
});
