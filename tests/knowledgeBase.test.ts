// « Base de données » du cabinet : server/routes/knowledgeBase.ts (pages, bases, propriétés, vues, corbeille).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function setup(role: 'admin' | 'manager' | 'pm' | 'user' = 'user') {
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId, role);
  const api = {
    get: (url: string) => request(app).get(url).set(authHeader(token)),
    post: (url: string, body: object = {}) => request(app).post(url).set(authHeader(token)).send(body),
    put: (url: string, body: object = {}) => request(app).put(url).set(authHeader(token)).send(body),
    patch: (url: string, body: object = {}) => request(app).patch(url).set(authHeader(token)).send(body),
    del: (url: string) => request(app).delete(url).set(authHeader(token)),
  };
  return { tenantId, token, ...api };
}

describe('Pages de la base de données', () => {
  it('crée une page, la relit et enregistre son contenu avec le texte brut', async () => {
    const t = setup();
    const created = await t.post('/api/kb/pages', { title: 'Planchers en bois anciens' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'page', title: 'Planchers en bois anciens', parent_id: null });

    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bestrema, solivage' }] }] };
    const saved = await t.put(`/api/kb/pages/${created.body.id}`, { content });
    expect(saved.status).toBe(200);
    expect(saved.body.content_text).toContain('Bestrema');

    const read = await t.get(`/api/kb/pages/${created.body.id}`);
    expect(read.body.content).toEqual(content);
    const tree = await t.get('/api/kb/tree');
    expect(tree.body.map((p: any) => p.title)).toEqual(['Planchers en bois anciens']);
  });

  it('range les sous-pages, refuse un parent d\'un autre cabinet et un cycle', async () => {
    const t = setup();
    const other = setup();
    const foreign = (await other.post('/api/kb/pages', { title: 'Autre cabinet' })).body;
    expect((await t.post('/api/kb/pages', { title: 'X', parent_id: foreign.id })).status).toBe(400);

    const a = (await t.post('/api/kb/pages', { title: 'A' })).body;
    const b = (await t.post('/api/kb/pages', { title: 'B', parent_id: a.id })).body;
    const cycle = await t.patch(`/api/kb/pages/${a.id}/move`, { parent_id: b.id });
    expect(cycle.status).toBe(400);
    expect((await t.patch(`/api/kb/pages/${b.id}/move`, { parent_id: null })).status).toBe(200);
  });

  it('ne lit ni ne modifie la page d\'un autre cabinet', async () => {
    const mine = setup();
    const other = setup();
    const page = (await other.post('/api/kb/pages', { title: 'Privée' })).body;
    expect((await mine.get(`/api/kb/pages/${page.id}`)).status).toBe(404);
    expect((await mine.put(`/api/kb/pages/${page.id}`, { title: 'Piratée' })).status).toBe(404);
    expect((await mine.del(`/api/kb/pages/${page.id}`)).status).toBe(404);
    expect((await mine.get('/api/kb/tree')).body).toEqual([]);
  });

  it('refuse une affaire d\'un autre cabinet', async () => {
    const mine = setup();
    const other = setup();
    fakeSupabaseAdmin.seed('projects', [{ id: 'kb-proj-autre', tenant_id: other.tenantId, name: 'Villa', client: 'X', status: 'Planning' }]);
    const res = await mine.post('/api/kb/pages', { title: 'Fiche', project_id: 'kb-proj-autre' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Affaire introuvable/);
  });

  it('met en corbeille avec les sous-pages, restaure, et réserve la suppression définitive', async () => {
    const admin = setup('admin');
    const parent = (await admin.post('/api/kb/pages', { title: 'Parent' })).body;
    const child = (await admin.post('/api/kb/pages', { title: 'Enfant', parent_id: parent.id })).body;

    expect((await admin.del(`/api/kb/pages/${parent.id}`)).status).toBe(200);
    const trashed = (await admin.get('/api/kb/tree')).body;
    expect(trashed.every((p: any) => p.trashed_at)).toBe(true);

    expect((await admin.post(`/api/kb/pages/${parent.id}/restore`)).status).toBe(200);
    expect((await admin.get('/api/kb/tree')).body.every((p: any) => !p.trashed_at)).toBe(true);

    // Suppression définitive : seulement depuis la corbeille.
    expect((await admin.del(`/api/kb/pages/${child.id}/permanent`)).status).toBe(409);
    await admin.del(`/api/kb/pages/${child.id}`);
    expect((await admin.del(`/api/kb/pages/${child.id}/permanent`)).status).toBe(200);
  });

  it('refuse la suppression définitive à un simple membre', async () => {
    const user = setup('user');
    const page = (await user.post('/api/kb/pages', { title: 'Note' })).body;
    await user.del(`/api/kb/pages/${page.id}`);
    expect((await user.del(`/api/kb/pages/${page.id}/permanent`)).status).toBe(403);
  });

  it('cherche dans le titre et le contenu, sans la corbeille', async () => {
    const t = setup();
    const a = (await t.post('/api/kb/pages', { title: 'Isolation', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'laine de bois' }] }] } })).body;
    const b = (await t.post('/api/kb/pages', { title: 'Menuiseries' })).body;
    await t.del(`/api/kb/pages/${b.id}`);
    expect((await t.get('/api/kb/search?q=laine')).body.map((p: any) => p.id)).toEqual([a.id]);
    expect((await t.get('/api/kb/search?q=Menuiseries')).body).toEqual([]);
    expect((await t.get('/api/kb/search?q=a')).body).toEqual([]);
  });
});

describe('Bases de données', () => {
  async function newDatabase(t: ReturnType<typeof setup>) {
    const db = (await t.post('/api/kb/pages', { kind: 'database', title: 'Fabricants' })).body;
    const props = (await t.get(`/api/kb/databases/${db.id}/properties`)).body;
    return { db, titleProp: props[0] };
  }

  it('crée une base avec sa colonne titre et une vue tableau', async () => {
    const t = setup();
    const { db, titleProp } = await newDatabase(t);
    expect(titleProp).toMatchObject({ name: 'Nom', type: 'title' });
    const views = await t.get(`/api/kb/databases/${db.id}/views`);
    expect(views.body).toHaveLength(1);
    expect(views.body[0]).toMatchObject({ type: 'table', name: 'Tableau' });
  });

  it('ajoute des propriétés typées, refuse un doublon, un type inconnu et la suppression du titre', async () => {
    const t = setup();
    const { db, titleProp } = await newDatabase(t);
    const url = `/api/kb/databases/${db.id}/properties`;
    const produits = await t.post(url, { name: 'Produits', type: 'multi_select', options: [{ label: 'Construction vitrée', color: 'bleu' }, { label: 'Pavés de verre', color: 'brique' }] });
    expect(produits.status).toBe(201);
    expect(produits.body.options.map((o: any) => o.label)).toEqual(['Construction vitrée', 'Pavés de verre']);
    expect((await t.post(url, { name: 'produits', type: 'text' })).status).toBe(409);
    expect((await t.post(url, { name: 'Autre', type: 'formule' })).status).toBe(400);
    expect((await t.post(url, { name: 'Titre bis', type: 'title' })).status).toBe(400);
    expect((await t.del(`${url}/${titleProp.id}`)).status).toBe(400);
  });

  it('valide les valeurs d\'une ligne selon le type de propriété et fusionne les mises à jour', async () => {
    const t = setup();
    const { db } = await newDatabase(t);
    const url = `/api/kb/databases/${db.id}/properties`;
    const produits = (await t.post(url, { name: 'Produits', type: 'multi_select', options: [{ label: 'Pavés de verre', color: 'brique' }] })).body;
    const texte = (await t.post(url, { name: 'Texte', type: 'text' })).body;

    const row = await t.post('/api/kb/pages', { parent_id: db.id, title: 'La Rochère', properties: { [produits.id]: [produits.options[0].id], [texte.id]: 'Localisation : 123 rue' } });
    expect(row.status).toBe(201);

    // Option inconnue, propriété inconnue, mauvais type : refus.
    expect((await t.put(`/api/kb/pages/${row.body.id}`, { properties: { [produits.id]: ['inconnue'] } })).status).toBe(400);
    expect((await t.put(`/api/kb/pages/${row.body.id}`, { properties: { fantome: 'x' } })).status).toBe(400);
    expect((await t.put(`/api/kb/pages/${row.body.id}`, { properties: { [texte.id]: 12 } })).status).toBe(400);

    // Fusion : modifier une clé garde les autres.
    const merged = await t.put(`/api/kb/pages/${row.body.id}`, { properties: { [texte.id]: 'Nouvelle adresse' } });
    expect(merged.status).toBe(200);
    expect(merged.body.properties[texte.id]).toBe('Nouvelle adresse');
    expect(merged.body.properties[produits.id]).toEqual([produits.options[0].id]);
  });

  it('refuse des valeurs de propriétés sur une page qui n\'est pas une ligne', async () => {
    const t = setup();
    const page = (await t.post('/api/kb/pages', { title: 'Page libre' })).body;
    expect((await t.put(`/api/kb/pages/${page.id}`, { properties: { x: 'y' } })).status).toBe(400);
  });

  it('enregistre la configuration d\'une vue', async () => {
    const t = setup();
    const { db } = await newDatabase(t);
    const view = (await t.get(`/api/kb/databases/${db.id}/views`)).body[0];
    const config = { filters: [{ property_id: 'p1', op: 'contains', value: 'verre' }], sorts: [{ property_id: 'p1', direction: 'asc' }] };
    const saved = await t.put(`/api/kb/databases/${db.id}/views/${view.id}`, { config });
    expect(saved.status).toBe(200);
    expect(saved.body.config).toEqual(config);
    expect((await t.put(`/api/kb/databases/${db.id}/views/${view.id}`, { config: [] })).status).toBe(400);
  });

  it('ne laisse pas un autre cabinet lire les propriétés d\'une base', async () => {
    const mine = setup();
    const other = setup();
    const { db } = await newDatabase(other);
    expect((await mine.get(`/api/kb/databases/${db.id}/properties`)).status).toBe(404);
  });
});
