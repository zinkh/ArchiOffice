// « Base de données » du cabinet : server/routes/knowledgeBase.ts (pages, bases, propriétés, vues, corbeille).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

describe('Pages pour les agents IA : liste et texte brut', () => {
  const paragraphs = (doc: any) => (doc.content || []).map((p: any) => (p.content || []).map((c: any) => c.text).join(''));

  it('liste les pages hors corbeille avec leur texte, sans le JSON Tiptap, pour le cabinet seul', async () => {
    const t = setup();
    const other = setup();
    await other.post('/api/kb/pages', { title: 'Autre cabinet', texte: 'secret' });
    const a = (await t.post('/api/kb/pages', { title: 'Détails constructifs', texte: 'Plancher bois' })).body;
    const b = (await t.post('/api/kb/pages', { title: 'Brouillon' })).body;
    await t.del(`/api/kb/pages/${b.id}`);

    const list = await t.get('/api/kb/pages');
    expect(list.status).toBe(200);
    expect(list.body.map((p: any) => p.id)).toEqual([a.id]);
    expect(list.body[0]).toMatchObject({ title: 'Détails constructifs', texte: 'Plancher bois' });
    expect(list.body[0]).not.toHaveProperty('content');
    expect(list.body[0]).not.toHaveProperty('content_text');
  });

  it('coupe un texte très long dans la liste et le signale, la page entière restant lisible', async () => {
    const t = setup();
    const long = 'x'.repeat(5000);
    const page = (await t.post('/api/kb/pages', { title: 'Long', texte: long })).body;
    const list = (await t.get('/api/kb/pages')).body;
    expect(list[0].texte).toHaveLength(4000);
    expect(list[0].texte_tronque).toBe(true);
    const full = (await t.get(`/api/kb/pages/${page.id}`)).body;
    expect(full.content_text.length).toBe(5000);
  });

  it('crée une page à partir de `texte` : un paragraphe par ligne, texte brut indexé pour la recherche', async () => {
    const t = setup();
    const created = await t.post('/api/kb/pages', { title: 'Fiche SOTTAS', texte: 'Adresse : Rue de la Gare 12\r\n\r\n1003 Lausanne' });
    expect(created.status).toBe(201);
    expect(paragraphs(created.body.content)).toEqual(['Adresse : Rue de la Gare 12', '', '1003 Lausanne']);
    expect(created.body.content_text).toContain('Lausanne');
    expect((await t.get('/api/kb/search?q=Lausanne')).body.map((p: any) => p.id)).toEqual([created.body.id]);
  });

  it('`content` (écran) l\'emporte sur `texte`', async () => {
    const t = setup();
    const content = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Titre' }] }] };
    const created = await t.post('/api/kb/pages', { title: 'Les deux', content, texte: 'ignoré' });
    expect(created.body.content).toEqual(content);
  });

  it('réécrit une page en texte brut quand elle n\'a pas de blocs enrichis', async () => {
    const t = setup();
    const page = (await t.post('/api/kb/pages', { title: 'Note', texte: 'ancien' })).body;
    const saved = await t.put(`/api/kb/pages/${page.id}`, { texte: 'nouveau\nsuite' });
    expect(saved.status).toBe(200);
    expect(paragraphs(saved.body.content)).toEqual(['nouveau', 'suite']);
    expect(saved.body.content_text).toContain('suite');
    // Une page vide aussi.
    const empty = (await t.post('/api/kb/pages', { title: 'Vide' })).body;
    expect((await t.put(`/api/kb/pages/${empty.id}`, { texte: 'rempli' })).status).toBe(200);
  });

  it('refuse de réduire en texte brut une page qui porte des blocs enrichis', async () => {
    const t = setup();
    const content = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Titre' }] }] };
    const page = (await t.post('/api/kb/pages', { title: 'Riche', content })).body;
    const refused = await t.put(`/api/kb/pages/${page.id}`, { texte: 'écrase tout' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('KB_RICH_CONTENT');
    expect((await t.get(`/api/kb/pages/${page.id}`)).body.content).toEqual(content);
  });

  it('crée une fiche de base avec `texte`', async () => {
    const t = setup();
    const db = (await t.post('/api/kb/pages', { kind: 'database', title: 'Fabricants' })).body;
    const row = await t.post('/api/kb/pages', { parent_id: db.id, title: 'La Rochère', texte: 'Localisation : Ville' });
    expect(row.status).toBe(201);
    expect(row.body.content_text).toContain('Ville');
    expect((await t.get('/api/kb/pages')).body.map((p: any) => p.title).sort()).toEqual(['Fabricants', 'La Rochère']);
  });
});

describe('Import en lot dans une base', () => {
  afterEach(() => vi.restoreAllMocks());

  const columns = [{ name: 'Produits', type: 'multi_select' }, { name: 'Texte', type: 'text' }];
  const rows = [
    { title: 'La Rochère', cells: { Produits: ['Construction vitrée', 'Pavés de verre'], Texte: '123 Rue de La Rochère' } },
    { title: 'SOTTAS', cells: { Produits: ['Construction vitrée', 'Structure métallique'], Texte: 'Rue de la Gare 12' } },
  ];
  async function newDatabase(t: ReturnType<typeof setup>) {
    return (await t.post('/api/kb/pages', { kind: 'database', title: 'Fabricants' })).body;
  }

  it('crée les colonnes, les étiquettes et les fiches, puis les relit avec leurs valeurs', async () => {
    const t = setup();
    const db = await newDatabase(t);
    const res = await t.post(`/api/kb/databases/${db.id}/import`, { columns, rows });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 2, properties_created: ['Produits', 'Texte'], options_created: 3, errors: [] });

    const props = (await t.get(`/api/kb/databases/${db.id}/properties`)).body;
    expect(props.map((p: any) => p.name)).toEqual(['Nom', 'Produits', 'Texte']);
    const produits = props.find((p: any) => p.name === 'Produits');
    const texte = props.find((p: any) => p.name === 'Texte');
    expect(produits.options.map((o: any) => o.label)).toEqual(['Construction vitrée', 'Pavés de verre', 'Structure métallique']);

    const list = (await t.get(`/api/kb/databases/${db.id}/rows`)).body;
    expect(list.map((r: any) => r.title)).toEqual(['La Rochère', 'SOTTAS']);
    expect(list[0].properties[texte.id]).toBe('123 Rue de La Rochère');
    expect(list[0].properties[produits.id]).toEqual([produits.options[0].id, produits.options[1].id]);
  });

  it('reprend les colonnes et les étiquettes existantes au deuxième envoi, sans doublon', async () => {
    const t = setup();
    const db = await newDatabase(t);
    await t.post(`/api/kb/databases/${db.id}/import`, { columns, rows });
    const second = await t.post(`/api/kb/databases/${db.id}/import`, {
      columns, rows: [{ title: 'FPEE', cells: { produits: ['pavés de verre', 'Menuiseries extérieures'] } }],
    });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ created: 1, properties_created: [], options_created: 1 });
    const props = (await t.get(`/api/kb/databases/${db.id}/properties`)).body;
    expect(props).toHaveLength(3);
    expect(props.find((p: any) => p.name === 'Produits').options).toHaveLength(4);
    expect((await t.get(`/api/kb/databases/${db.id}/rows`)).body.map((r: any) => r.title)).toEqual(['La Rochère', 'SOTTAS', 'FPEE']);
  });

  it('importe le contenu des pages et l\'indexe pour la recherche', async () => {
    const t = setup();
    const db = await newDatabase(t);
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isolation répartie en laine de bois' }] }] };
    const res = await t.post(`/api/kb/databases/${db.id}/import`, { columns: [], rows: [{ title: 'Fiche', cells: {}, content }] });
    expect(res.status).toBe(201);
    expect((await t.get('/api/kb/search?q=laine')).body.map((p: any) => p.title)).toEqual(['Fiche']);
  });

  it('l\'aperçu (dry_run) rapporte sans rien écrire', async () => {
    const t = setup();
    const db = await newDatabase(t);
    const res = await t.post(`/api/kb/databases/${db.id}/import`, { columns, rows, dry_run: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, would_create: 2, properties_created: ['Produits', 'Texte'], options_created: 3 });
    expect((await t.get(`/api/kb/databases/${db.id}/properties`)).body).toHaveLength(1);
    expect((await t.get(`/api/kb/databases/${db.id}/rows`)).body).toEqual([]);
  });

  it('tout ou rien : une ligne refusée empêche tout l\'import, colonnes comprises', async () => {
    const t = setup();
    const db = await newDatabase(t);
    const bad = [{ title: 'OK', cells: { Prix: 12 } }, { title: 'Mauvais', cells: { Prix: 'abc' } }];
    const res = await t.post(`/api/kb/databases/${db.id}/import`, { columns: [{ name: 'Prix', type: 'number' }], rows: bad });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'KB_IMPORT_REFUSED', created: 0, errors: [{ row: 2, column: 'Prix' }] });
    expect((await t.get(`/api/kb/databases/${db.id}/properties`)).body).toHaveLength(1);
    expect((await t.get(`/api/kb/databases/${db.id}/rows`)).body).toEqual([]);
    const preview = await t.post(`/api/kb/databases/${db.id}/import`, { columns: [{ name: 'Prix', type: 'number' }], rows: bad, dry_run: true });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ would_create: 0, errors: [{ row: 2 }] });
  });

  it('refuse un corps mal formé, trop de lignes ou une colonne incohérente (400)', async () => {
    const t = setup();
    const db = await newDatabase(t);
    const url = `/api/kb/databases/${db.id}/import`;
    expect((await t.post(url, {})).status).toBe(400);
    expect((await t.post(url, { columns: [], rows: [] })).status).toBe(400);
    expect((await t.post(url, { columns: [], rows: Array.from({ length: 501 }, () => ({ title: 'x', cells: {} })) })).status).toBe(400);
    expect((await t.post(url, { columns: [{ name: 'nom', type: 'text' }], rows: [{ title: 'x', cells: {} }] })).status).toBe(400);
    expect((await t.post(url, { columns: [{ name: 'A', type: 'relation' }], rows: [{ title: 'x', cells: {} }] })).status).toBe(400);
  });

  it('ne laisse pas importer dans la base d\'un autre cabinet ni dans une page ordinaire', async () => {
    const mine = setup();
    const other = setup();
    const foreign = await newDatabase(other);
    const payload = { columns: [], rows: [{ title: 'x', cells: {} }] };
    expect((await mine.post(`/api/kb/databases/${foreign.id}/import`, payload)).status).toBe(404);
    const page = (await mine.post('/api/kb/pages', { title: 'Page libre' })).body;
    expect((await mine.post(`/api/kb/databases/${page.id}/import`, payload)).status).toBe(404);
    expect((await other.get(`/api/kb/databases/${foreign.id}/rows`)).body).toEqual([]);
  });

  it('défait les colonnes et étiquettes créées si l\'insertion des fiches échoue', async () => {
    const t = setup();
    const db = await newDatabase(t);
    const props = (await t.get(`/api/kb/databases/${db.id}/properties`)).body;
    await t.post(`/api/kb/databases/${db.id}/properties`, { name: 'Produits', type: 'multi_select', options: [{ label: 'Construction vitrée', color: 'bleu' }] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const from = fakeSupabaseAdmin.from.bind(fakeSupabaseAdmin);
    vi.spyOn(fakeSupabaseAdmin, 'from').mockImplementation((name: string) => {
      const query: any = from(name);
      if (name === 'kb_pages') query.insert = () => Promise.resolve({ data: null, error: { message: 'Database unavailable' } });
      return query;
    });

    const res = await t.post(`/api/kb/databases/${db.id}/import`, { columns, rows });
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
    const after = (await t.get(`/api/kb/databases/${db.id}/properties`)).body;
    expect(after.map((p: any) => p.name)).toEqual([props[0].name, 'Produits']);
    expect(after[1].options.map((o: any) => o.label)).toEqual(['Construction vitrée']);
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

  it('liste les lignes d\'une base avec leurs valeurs, sans la corbeille ni les pages d\'ailleurs', async () => {
    const t = setup();
    const { db } = await newDatabase(t);
    const texte = (await t.post(`/api/kb/databases/${db.id}/properties`, { name: 'Texte', type: 'text' })).body;
    const a = (await t.post('/api/kb/pages', { parent_id: db.id, title: 'La Rochère', properties: { [texte.id]: 'Nancy' } })).body;
    const b = (await t.post('/api/kb/pages', { parent_id: db.id, title: 'SOTTAS' })).body;
    await t.post('/api/kb/pages', { title: 'Hors base' });
    await t.del(`/api/kb/pages/${b.id}`);

    const rows = await t.get(`/api/kb/databases/${db.id}/rows`);
    expect(rows.status).toBe(200);
    expect(rows.body.map((r: any) => r.title)).toEqual(['La Rochère']);
    expect(rows.body[0].properties[texte.id]).toBe('Nancy');
    expect(rows.body[0].id).toBe(a.id);
  });

  it('ne laisse pas un autre cabinet lire les lignes ni les propriétés d\'une base', async () => {
    const mine = setup();
    const other = setup();
    const { db } = await newDatabase(other);
    expect((await mine.get(`/api/kb/databases/${db.id}/properties`)).status).toBe(404);
    expect((await mine.get(`/api/kb/databases/${db.id}/rows`)).status).toBe(404);
  });
});
