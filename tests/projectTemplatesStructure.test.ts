// Modèles de projet : catalogue de démarrage, application à la création d'une
// affaire (lots, jalons, tâches datés depuis le démarrage) et modèle tiré d'une
// affaire existante.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { PROJECT_TEMPLATE_CATALOG } from '../server/projectTemplateCatalog';
import { addDaysIso } from '../src/lib/projectTemplates';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('catalogue de démarrage', () => {
  it('couvre neuf, réhabilitation, extension, maison individuelle et permis seul, en privé et en public', () => {
    const keys = PROJECT_TEMPLATE_CATALOG.map(e => e.catalog_key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ['neuf-prive', 'neuf-public', 'rehabilitation-prive', 'rehabilitation-public', 'extension-prive', 'extension-public', 'maison_individuelle-prive', 'permis_seul-prive']) {
      expect(keys).toContain(k);
    }
  });

  it('ne nomme jamais un jalon comme une mission du contrat MOE (risque de fusion par titre)', () => {
    const titles = PROJECT_TEMPLATE_CATALOG.flatMap(e => (e.default_milestones ?? []).map(m => m.title));
    expect(titles.filter(t => /\((ESQ|APS|APD|PRO|DCE|ACT|DET|AOR)\)/.test(t))).toEqual([]);
  });

  it('ordonne chronologiquement les jalons de chantier et sépare public et privé', () => {
    const neufPrive = PROJECT_TEMPLATE_CATALOG.find(e => e.catalog_key === 'neuf-prive')!;
    const neufPublic = PROJECT_TEMPLATE_CATALOG.find(e => e.catalog_key === 'neuf-public')!;
    const off = (e: typeof neufPrive, title: string) => e.default_milestones!.find(m => m.title.startsWith(title))!.due_date_offset_days;
    expect(off(neufPrive, 'Démarrage du chantier')).toBeGreaterThan(off(neufPrive, 'Décision attendue'));
    expect(off(neufPrive, 'Réception des travaux')).toBeGreaterThan(off(neufPrive, 'Démarrage du chantier'));
    expect(neufPublic.default_milestones!.some(m => m.title === 'Publication de l\'avis de marché')).toBe(true);
    expect(neufPrive.default_milestones!.some(m => m.title === 'Publication de l\'avis de marché')).toBe(false);
    expect(neufPublic.marche_type).toBe('public');
  });

  it('un permis seul ne porte aucun lot', () => {
    const permis = PROJECT_TEMPLATE_CATALOG.find(e => e.catalog_key === 'permis_seul-prive')!;
    expect(permis.default_lots).toEqual([]);
    expect(permis.default_milestones!.length).toBeGreaterThan(0);
  });
});

describe('routes du catalogue', () => {
  it('installe une entrée une seule fois et la marque installée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const first = await request(app).post('/api/project-templates/catalog/install').set(authHeader(token)).send({ keys: ['neuf-prive', 'permis_seul-prive'] });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ installed: 2, skipped: 0 });

    const again = await request(app).post('/api/project-templates/catalog/install').set(authHeader(token)).send({ keys: ['neuf-prive'] });
    expect(again.body).toEqual({ installed: 0, skipped: 1 });

    const rows = fakeSupabaseAdmin.getTable('project_templates').filter(t => t.tenant_id === tenantId);
    expect(rows).toHaveLength(2);

    const catalog = await request(app).get('/api/project-templates/catalog').set(authHeader(token));
    const byKey = Object.fromEntries(catalog.body.map((e: any) => [e.catalog_key, e.installed]));
    expect(byKey['neuf-prive']).toBe(true);
    expect(byKey['neuf-public']).toBe(false);
  });

  it('refuse une clé inconnue', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/project-templates/catalog/install').set(authHeader(token)).send({ keys: ['inconnu'] });
    expect(res.status).toBe(400);
  });

  it('assainit les listes écrites à la main', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/project-templates').set(authHeader(token)).send({
      name: 'Test',
      default_status: 'nimporte',
      default_lots: [{ lot_number: '01', lot_title: 'Gros œuvre' }, { lot_title: '' }, 'x'],
      default_milestones: [{ title: 'Dépôt', due_date_offset_days: '30' }, { title: '' }],
      default_tasks: [{ title: 'Relevé', start_offset_days: 2, duration_days: 0, priority: 'bidon' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.default_status).toBe('Planning');
    expect(res.body.default_lots).toEqual([{ lot_number: '01', lot_title: 'Gros œuvre' }]);
    expect(res.body.default_milestones).toEqual([{ title: 'Dépôt', due_date_offset_days: 30 }]);
    expect(res.body.default_tasks).toEqual([{ title: 'Relevé', start_offset_days: 2, duration_days: 1, priority: 'normal' }]);
  });

  it('exige un nom', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/project-templates').set(authHeader(token)).send({ description: 'sans nom' });
    expect(res.status).toBe(400);
  });
});

describe('application d\'un modèle à la création d\'une affaire', () => {
  it('crée lots, jalons et tâches datés depuis le démarrage, et pose marché public et type', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    await request(app).post('/api/project-templates/catalog/install').set(authHeader(token)).send({ keys: ['rehabilitation-public'] });
    const template = fakeSupabaseAdmin.getTable('project_templates').find(t => t.tenant_id === tenantId)!;

    const created = await request(app).post('/api/projects').set(authHeader(token)).send({
      name: 'Mairie de Blénod', client: 'Commune', start_date: '2026-10-01', template_id: template.id,
    });
    expect(created.status).toBe(201);
    const projectId = created.body.id;
    expect(created.body.template_applied.failed).toEqual([]);

    const project = fakeSupabaseAdmin.getTable('projects').find(p => p.id === projectId)!;
    expect(project.is_public_client).toBe(true);
    expect(project.type_projet).toBe('Réhabilitation');

    const lots = fakeSupabaseAdmin.getTable('project_lots').filter(l => l.project_id === projectId);
    expect(lots).toHaveLength(template.default_lots.length);
    expect(lots.every(l => l.tenant_id === tenantId)).toBe(true);

    const ms = fakeSupabaseAdmin.getTable('milestones').filter(m => m.project_id === projectId);
    expect(ms).toHaveLength(template.default_milestones.length);
    const publication = ms.find(m => m.title === 'Publication de l\'avis de marché')!;
    const offset = template.default_milestones.find((m: any) => m.title === publication.title).due_date_offset_days;
    expect(publication.due_date).toBe(addDaysIso('2026-10-01', offset));

    const tasks = fakeSupabaseAdmin.getTable('tasks').filter(t => t.project_id === projectId);
    expect(tasks).toHaveLength(template.default_tasks.length);
    expect(tasks.every(t => t.status === 'todo' && t.end_date >= t.start_date)).toBe(true);
  });

  it('refuse le modèle d\'un autre cabinet', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('project_templates', [{ id: 'tpl-b', tenant_id: tenantB, name: 'B', default_lots: [{ lot_number: '01', lot_title: 'Secret' }] }]);
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/projects').set(authHeader(token)).send({ name: 'P', client: 'C', template_id: 'tpl-b' });
    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('project_lots').some(l => l.lot_title === 'Secret')).toBe(false);
  });

  it('sans modèle, la création reste inchangée', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/projects').set(authHeader(token)).send({ name: 'P', client: 'C' });
    expect(res.status).toBe(201);
    expect(res.body.template_applied).toBeUndefined();
  });
});

describe('modèle tiré d\'une affaire', () => {
  it('copie lots, jalons et tâches en décalages depuis le démarrage, sans dates absolues', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-src', tenant_id: tenantId, name: 'Villa Martin', start_date: '2026-01-10', is_public_client: false }]);
    fakeSupabaseAdmin.seed('project_lots', [
      { id: 'l2', tenant_id: tenantId, project_id: 'proj-src', lot_number: '02', lot_title: 'Charpente' },
      { id: 'l1', tenant_id: tenantId, project_id: 'proj-src', lot_number: '01', lot_title: 'Gros œuvre' },
    ]);
    fakeSupabaseAdmin.seed('milestones', [{ id: 'm1', tenant_id: tenantId, project_id: 'proj-src', title: 'Dépôt du PC', due_date: '2026-02-09' }]);
    fakeSupabaseAdmin.seed('tasks', [{ id: 't1', tenant_id: tenantId, project_id: 'proj-src', title: 'Relevé', start_date: '2026-01-12', end_date: '2026-01-19', priority: 'high' }]);

    const res = await request(app).post('/api/project-templates/from-project/proj-src').set(authHeader(token)).send({});
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Villa Martin (modèle)');
    expect(res.body.marche_type).toBe('prive');
    expect(res.body.default_lots.map((l: any) => l.lot_title)).toEqual(['Gros œuvre', 'Charpente']);
    expect(res.body.default_milestones).toEqual([{ title: 'Dépôt du PC', due_date_offset_days: 30 }]);
    expect(res.body.default_tasks).toEqual([{ title: 'Relevé', start_offset_days: 2, duration_days: 7, priority: 'high' }]);
  });

  it('refuse l\'affaire d\'un autre cabinet', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-b', tenant_id: tenantB, name: 'Secret' }]);
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/project-templates/from-project/proj-b').set(authHeader(token)).send({});
    expect(res.status).toBe(404);
  });
});
