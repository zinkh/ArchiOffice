// Synchronisation desktop, côté lecture et gestes : arborescence, journal de changements,
// verrous, métadonnées, suppression logique, indice, lecture du contenu.
// Docs : docs/desktop-sync-contract.md.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { connectExternalStorage, fakeSupabaseAdmin, getTestApp } from './testServer';
import {
  makeDriveTenant as makeTenant, API, makeActor, seedChange, seedDocument, seedLockMode, seedProject, type Actor,
} from './desktopSyncSupport';
import { buildExternalRef } from '../server/externalStorage/externalRef';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
  fakeSupabaseAdmin.seed('desktop_sync_state', [{ key: 'floor_seq', value: 0 }]);
});

const get = (actor: Actor, path: string) => request(app).get(`${API}${path}`).set(actor.headers);
const post = (actor: Actor, path: string, body: object = {}) => request(app).post(`${API}${path}`).set(actor.headers).send(body);
const patch = (actor: Actor, path: string, body: object = {}) => request(app).patch(`${API}${path}`).set(actor.headers).send(body);
const del = (actor: Actor, path: string) => request(app).delete(`${API}${path}`).set(actor.headers);

const names = (body: any) => body.nodes.map((n: any) => n.name);

// Le faux Supabase est partagé par tout le fichier et les identifiants (« d1 ») se répètent
// d'un test à l'autre : toute relecture d'une ligne se fait donc DANS le cabinet du test.
const rowOf = (table: string, tenantId: string, id: string) =>
  fakeSupabaseAdmin.getTable(table).find(r => r.id === id && r.tenant_id === tenantId)!;

describe('Arborescence', () => {
  it('descend du cabinet jusqu\'au fichier avec les chemins du stockage externe', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId, 'admin');
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', phase: 'APD', name: 'Plan RDC.pdf' });
    seedDocument(tenantId, { id: 'd2', project_id: 'p1', phase: 'ESQ', name: 'Esquisse.pdf' });
    seedDocument(tenantId, { id: 'd3', project_id: 'p1', phase: null, name: 'Note.pdf' });
    seedDocument(tenantId, { id: 'd4', project_id: null, phase: null, name: 'Vrac.pdf' });

    const root = await get(actor, `/nodes/tenant:${tenantId}/children`);
    expect(root.status).toBe(200);
    // « À classer » d'abord, puis les affaires.
    expect(names(root.body)).toEqual(['À classer', '26014 - Villa Martin']);

    const phases = await get(actor, '/nodes/prj:p1/children');
    expect(names(phases.body)).toEqual(['ESQ', 'APD', 'Général']);
    expect(phases.body.nodes[1]).toMatchObject({ id: 'phase:p1:APD', parentId: 'prj:p1', kind: 'folder' });

    const files = await get(actor, '/nodes/phase:p1:APD/children');
    expect(files.body.nextCursor).toBeNull();
    expect(files.body.nodes).toHaveLength(1);
    expect(files.body.nodes[0]).toMatchObject({
      id: 'doc:d1', kind: 'file', parentId: 'phase:p1:APD', name: 'Plan RDC.pdf',
      path: '26014 - Villa Martin/APD/Plan RDC.pdf', version: 1, indice: 'A', etag: 'v1',
      readOnlyReason: null, permissions: { read: true, write: true, delete: true },
    });

    // Un document sans phase est rangé sous « Général ».
    const general = await get(actor, '/nodes/phase:p1:Général/children');
    expect(names(general.body)).toEqual(['Note.pdf']);

    const inbox = await get(actor, `/nodes/inbox:${tenantId}/children`);
    expect(names(inbox.body)).toEqual(['Vrac.pdf']);
    expect(inbox.body.nodes[0].path).toBe('À classer/Vrac.pdf');
    expect(inbox.body.nodes[0].parentId).toBe(`inbox:${tenantId}`);
  });

  it('suffixe les homonymes d\'un même dossier et rend des noms valides pour Windows et macOS', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'a1', project_id: 'p1', name: 'Plan.pdf' });
    seedDocument(tenantId, { id: 'a2', project_id: 'p1', name: 'plan.PDF' });
    seedDocument(tenantId, { id: 'a3', project_id: 'p1', name: 'Coupe: A/B?.dwg' });

    const files = await get(actor, '/nodes/phase:p1:APD/children');
    expect(names(files.body).sort()).toEqual(['Coupe_ A_B_.dwg', 'Plan.pdf', 'plan (2).PDF'].sort());
    // Le nom suffixé est aussi celui que rend la lecture d'un seul nœud.
    const second = await get(actor, '/nodes/doc:a2');
    expect(second.body.name).toBe('plan (2).PDF');
  });

  it('masque les documents supprimés, ceux d\'un autre cabinet et les pièces jointes d\'autres fiches', async () => {
    const tenantId = makeTenant();
    const other = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedProject(other, 'p-other');
    seedDocument(tenantId, { id: 'ok', project_id: 'p1', name: 'Visible.pdf' });
    seedDocument(tenantId, { id: 'gone', project_id: 'p1', name: 'Supprime.pdf', deleted_at: new Date().toISOString() });
    seedDocument(tenantId, { id: 'devis', project_id: 'p1', name: 'Devis.pdf', resource_type: 'proposals' });
    seedDocument(other, { id: 'foreign', project_id: 'p-other', name: 'Autre.pdf' });

    const files = await get(actor, '/nodes/phase:p1:APD/children');
    expect(names(files.body)).toEqual(['Visible.pdf']);
    expect((await get(actor, '/nodes/doc:gone')).status).toBe(404);
    expect((await get(actor, '/nodes/doc:devis')).status).toBe(404);
    expect((await get(actor, '/nodes/doc:foreign')).status).toBe(404);
    expect((await get(actor, '/nodes/prj:p-other')).status).toBe(404);
    expect((await get(actor, `/nodes/tenant:${other}`)).status).toBe(404);
  });

  it('pagine par curseur, sans jamais rendre deux fois le même fichier', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    for (let i = 1; i <= 5; i += 1) seedDocument(tenantId, { id: `f${i}`, project_id: 'p1', name: `Piece ${i}.pdf` });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: any = await get(actor, `/nodes/phase:p1:APD/children?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...names(res.body));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(['Piece 1.pdf', 'Piece 2.pdf', 'Piece 3.pdf', 'Piece 4.pdf', 'Piece 5.pdf']);

    const bad = await get(actor, '/nodes/phase:p1:APD/children?cursor=%25%25');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_CURSOR');
  });

  it('met en lecture seule les fichiers d\'une affaire archivée', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1', { archived_at: new Date().toISOString() });
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });

    const file = await get(actor, '/nodes/doc:d1');
    expect(file.body.readOnlyReason).toBe('archived');
    expect(file.body.permissions).toEqual({ read: true, write: false, delete: false });
    const folder = await get(actor, '/nodes/prj:p1');
    expect(folder.body).toMatchObject({ readOnlyReason: 'archived', permissions: { read: true, write: false } });
  });

  it('met en lecture seule un document approuvé, et n\'accorde la suppression qu\'aux rôles autorisés', async () => {
    const tenantId = makeTenant();
    const admin = await makeActor(app, tenantId, 'admin');
    const member = await makeActor(app, tenantId, 'user');
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'ok', project_id: 'p1', name: 'Libre.pdf' });
    seedDocument(tenantId, { id: 'appr', project_id: 'p1', name: 'Approuve.pdf', doc_statut: 'approuve' });

    expect((await get(admin, '/nodes/doc:ok')).body.permissions).toEqual({ read: true, write: true, delete: true });
    expect((await get(member, '/nodes/doc:ok')).body.permissions).toEqual({ read: true, write: true, delete: false });
    const approved = await get(admin, '/nodes/doc:appr');
    expect(approved.body).toMatchObject({ readOnlyReason: 'approved', status: 'approuve' });
    expect(approved.body.permissions.write).toBe(false);
  });

  it('rend les versions, de la plus récente à la plus ancienne', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', version: 2 });
    fakeSupabaseAdmin.seed('document_versions', [
      { id: 'v1', tenant_id: tenantId, document_id: 'd1', version: 1, file_url: 'x', uploaded_by: 'Sophie', uploaded_at: '2026-01-01T00:00:00Z', size_bytes: 5 },
      { id: 'v2', tenant_id: tenantId, document_id: 'd1', version: 2, file_url: 'y', uploaded_by: 'Khaldoun', uploaded_at: '2026-02-01T00:00:00Z', size_bytes: 8 },
    ]);
    const res = await get(actor, '/nodes/doc:d1/versions');
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.version)).toEqual([2, 1]);
    expect(res.body[0]).toMatchObject({ uploadedBy: 'Khaldoun', size: 8 });
    // Un dossier n'a pas de versions.
    expect((await get(actor, '/nodes/prj:p1/versions')).status).toBe(400);
  });
});

describe('Journal de changements', () => {
  it('le premier appel rend le curseur courant et demande une synchronisation complète', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const last = seedChange(tenantId, 'upsert', 'doc:inconnu');
    const res = await get(actor, '/changes');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ resync: true, events: [], hasMore: false });
    expect(Number(res.body.cursor)).toBeGreaterThanOrEqual(last);
  });

  it('traduit les lignes du journal en événements d\'état, propres au cabinet', async () => {
    const tenantId = makeTenant();
    const other = makeTenant();
    const actor = await makeActor(app, tenantId);
    const colleague = await makeActor(app, tenantId, 'user');
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'live', project_id: 'p1', name: 'Vivant.pdf' });
    seedDocument(tenantId, { id: 'locked', project_id: 'p1', name: 'Verrouille.pdf' });
    fakeSupabaseAdmin.seed('document_locks', [{
      document_id: 'locked', tenant_id: tenantId, user_id: colleague.userId, user_name: 'Sophie',
      locked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }]);

    const cursor = String(seedChange(other, 'upsert', 'doc:other') - 1);
    seedChange(other, 'upsert', 'doc:live'); // autre cabinet : jamais rendu
    seedChange(tenantId, 'upsert', 'doc:live', 'p1');
    seedChange(tenantId, 'upsert', 'doc:supprime', 'p1');
    seedChange(tenantId, 'delete', 'doc:efface', 'p1');
    seedChange(tenantId, 'lock', 'doc:locked', 'p1');
    seedChange(tenantId, 'unlock', 'doc:libre');
    seedChange(tenantId, 'scope', 'prj:p1', 'p1');

    const res = await get(actor, `/changes?cursor=${cursor}`);
    expect(res.status).toBe(200);
    const byType = (type: string) => res.body.events.filter((e: any) => e.type === type);
    expect(byType('upsert')).toHaveLength(1);
    expect(byType('upsert')[0].node).toMatchObject({ id: 'doc:live', name: 'Vivant.pdf' });
    // Un document qui n'existe plus est rendu comme supprimé : l'événement porte l'ÉTAT courant.
    expect(byType('delete').map((e: any) => e.id).sort()).toEqual(['doc:efface', 'doc:supprime']);
    expect(byType('lock')[0]).toMatchObject({ id: 'doc:locked', lock: { by: { name: 'Sophie' }, mine: false } });
    expect(byType('unlock')[0].id).toBe('doc:libre');
    expect(byType('scope')[0]).toMatchObject({ id: 'prj:p1', projectId: 'p1' });
    expect(res.body.events.some((e: any) => e.node?.id === 'doc:other' || e.id === 'doc:other')).toBe(false);
    // Les événements sont ordonnés par seq.
    const seqs = res.body.events.map((e: any) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a: number, b: number) => a - b));
  });

  it('rend un verrou expiré comme une libération', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });
    fakeSupabaseAdmin.seed('document_locks', [{
      document_id: 'd1', tenant_id: tenantId, user_id: 'u-old', user_name: 'Ancien',
      locked_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-01T08:00:00Z',
    }]);
    const cursor = String(seedChange(tenantId, 'lock', 'doc:d1') - 1);
    const res = await get(actor, `/changes?cursor=${cursor}`);
    expect(res.body.events).toEqual([expect.objectContaining({ type: 'unlock', id: 'doc:d1' })]);
  });

  it('ne garde que le dernier événement de chaque nœud et de chaque nature', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });
    const cursor = String(seedChange(tenantId, 'upsert', 'doc:d1', 'p1') - 1);
    seedChange(tenantId, 'upsert', 'doc:d1', 'p1');
    seedChange(tenantId, 'upsert', 'doc:d1', 'p1');
    seedChange(tenantId, 'lock', 'doc:d1', 'p1');
    const res = await get(actor, `/changes?cursor=${cursor}`);
    // Un verrou posé après un dépôt ne masque pas le dépôt : natures distinctes.
    expect(res.body.events.map((e: any) => e.type).sort()).toEqual(['unlock', 'upsert']);
  });

  it('pagine : le curseur suivant est celui du dernier événement lu', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const start = seedChange(tenantId, 'delete', 'doc:a');
    seedChange(tenantId, 'delete', 'doc:b');
    const last = seedChange(tenantId, 'delete', 'doc:c');

    const first = await get(actor, `/changes?cursor=${start - 1}&limit=2`);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.events.map((e: any) => e.id)).toEqual(['doc:a', 'doc:b']);
    const second = await get(actor, `/changes?cursor=${first.body.nextCursor}&limit=2`);
    expect(second.body.hasMore).toBe(false);
    expect(second.body.events.map((e: any) => e.id)).toEqual(['doc:c']);
    expect(second.body.nextCursor).toBe(String(last));

    // Rien de nouveau : le curseur ne bouge pas.
    const idle = await get(actor, `/changes?cursor=${last}`);
    expect(idle.body).toMatchObject({ events: [], nextCursor: String(last), hasMore: false });
  });

  it('refuse un curseur mal formé, et un curseur plus ancien que le plancher', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    expect((await get(actor, '/changes?cursor=abc')).status).toBe(400);
    expect((await get(actor, '/changes?cursor=-1')).status).toBe(400);

    const floorRow = fakeSupabaseAdmin.getTable('desktop_sync_state').find(r => r.key === 'floor_seq')!;
    floorRow.value = 500000;
    try {
      const expired = await get(actor, '/changes?cursor=10');
      expect(expired.status).toBe(410);
      expect(expired.body.code).toBe('CURSOR_EXPIRED');
      // Un curseur au plancher reste servable.
      expect((await get(actor, '/changes?cursor=500000')).status).toBe(200);
    } finally {
      floorRow.value = 0;
    }
  });
});

describe('Verrous', () => {
  it('pose, renouvelle et libère un verrou ; un autre poste voit qui le détient', async () => {
    const tenantId = makeTenant();
    const owner = await makeActor(app, tenantId, 'user');
    const colleague = await makeActor(app, tenantId, 'user');
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });

    const taken = await post(owner, '/nodes/doc:d1/lock');
    expect(taken.status).toBe(200);
    expect(taken.body.lock).toMatchObject({ mine: true });

    const refused = await post(colleague, '/nodes/doc:d1/lock');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ALREADY_LOCKED');
    expect(refused.body.holder).toMatchObject({ mine: false });

    // Le nœud porte le verrou, vu de chacun.
    expect((await get(owner, '/nodes/doc:d1')).body.lock.mine).toBe(true);
    expect((await get(colleague, '/nodes/doc:d1')).body.lock.mine).toBe(false);

    expect((await post(owner, '/nodes/doc:d1/lock/renew')).status).toBe(200);
    expect((await post(colleague, '/nodes/doc:d1/lock/renew')).status).toBe(404);

    const notOwner = await del(colleague, '/nodes/doc:d1/lock');
    expect(notOwner.status).toBe(403);
    expect(notOwner.body.code).toBe('NOT_LOCK_OWNER');

    expect((await del(owner, '/nodes/doc:d1/lock')).status).toBe(200);
    expect((await get(colleague, '/nodes/doc:d1')).body.lock).toBeNull();
    // Libérer l'absence de verrou réussit : un client peut rejouer.
    expect((await del(owner, '/nodes/doc:d1/lock')).status).toBe(200);
    expect((await post(colleague, '/nodes/doc:d1/lock')).status).toBe(200);
  });

  it('reprend un verrou expiré', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId, 'user');
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });
    fakeSupabaseAdmin.seed('document_locks', [{
      document_id: 'd1', tenant_id: tenantId, user_id: 'u-old', user_name: 'Ancien',
      locked_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-01T08:00:00Z',
    }]);
    const res = await post(actor, '/nodes/doc:d1/lock');
    expect(res.status).toBe(200);
    expect(res.body.lock.mine).toBe(true);
    const lockRows = fakeSupabaseAdmin.getTable('document_locks').filter(l => l.document_id === 'd1' && l.tenant_id === tenantId);
    expect(lockRows, JSON.stringify(lockRows)).toHaveLength(1);
  });

  it('seul un administrateur ou un manager rompt le verrou d\'un autre', async () => {
    const tenantId = makeTenant();
    const owner = await makeActor(app, tenantId, 'user');
    const member = await makeActor(app, tenantId, 'user');
    const manager = await makeActor(app, tenantId, 'manager');
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });
    await post(owner, '/nodes/doc:d1/lock');

    const refused = await del(member, '/nodes/doc:d1/lock?force=true');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FORBIDDEN');
    expect((await get(owner, '/nodes/doc:d1')).body.lock.mine).toBe(true);

    expect((await del(manager, '/nodes/doc:d1/lock?force=true')).status).toBe(200);
    expect((await get(owner, '/nodes/doc:d1')).body.lock).toBeNull();
    // La rupture est journalisée : un administrateur doit pouvoir dire qui a repris la main.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fakeSupabaseAdmin.getTable('activities').some(a => a.tenant_id === tenantId && /Rupture du verrou/.test(a.action ?? ''))).toBe(true);
  });

  it('refuse de verrouiller dans une affaire archivée, quand les verrous sont désactivés, ou hors cabinet', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId, 'user');
    seedProject(tenantId, 'arch', { archived_at: new Date().toISOString() });
    seedDocument(tenantId, { id: 'd-arch', project_id: 'arch' });
    const archived = await post(actor, '/nodes/doc:d-arch/lock');
    expect(archived.status).toBe(409);
    expect(archived.body.code).toBe('PROJECT_ARCHIVED');

    const foreignTenant = makeTenant();
    seedDocument(foreignTenant, { id: 'd-foreign', project_id: null });
    expect((await post(actor, '/nodes/doc:d-foreign/lock')).status).toBe(404);

    const offTenant = makeTenant();
    seedLockMode(offTenant, 'off');
    const offActor = await makeActor(app, offTenant, 'user');
    seedDocument(offTenant, { id: 'd-off', project_id: null });
    const off = await post(offActor, '/nodes/doc:d-off/lock');
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('LOCKS_DISABLED');
  });

  it('en mode obligatoire, le verrou d\'un autre bloque la modification ; en mode indicatif, il la signale seulement', async () => {
    const strict = makeTenant();
    seedLockMode(strict, 'enforced');
    const a = await makeActor(app, strict, 'user');
    const b = await makeActor(app, strict, 'user');
    seedProject(strict, 'p1');
    seedDocument(strict, { id: 'd1', project_id: 'p1', name: 'Plan.pdf' });
    await post(a, '/nodes/doc:d1/lock');

    const node = await get(b, '/nodes/doc:d1');
    expect(node.body.readOnlyReason).toBe('locked');
    expect(node.body.permissions.write).toBe(false);
    const blocked = await patch(b, '/nodes/doc:d1', { name: 'Autre.pdf' });
    expect(blocked.status).toBe(423);
    expect(blocked.body.code).toBe('LOCKED');
    expect((await patch(a, '/nodes/doc:d1', { name: 'Renomme.pdf' })).status).toBe(200);

    const lenient = makeTenant();
    seedLockMode(lenient, 'advisory');
    const c = await makeActor(app, lenient, 'user');
    const d = await makeActor(app, lenient, 'user');
    seedProject(lenient, 'p2');
    seedDocument(lenient, { id: 'd2', project_id: 'p2', name: 'Plan.pdf' });
    await post(c, '/nodes/doc:d2/lock');
    const seen = await get(d, '/nodes/doc:d2');
    expect(seen.body.readOnlyReason).toBeNull();
    expect(seen.body.lock).toMatchObject({ mine: false });
    expect((await patch(d, '/nodes/doc:d2', { name: 'Autre.pdf' })).status).toBe(200);
  });
});

describe('Métadonnées', () => {
  it('renomme, change de phase et rend le nœud à jour', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', name: 'Plan.pdf', phase: 'APD' });

    const renamed = await patch(actor, '/nodes/doc:d1', { name: 'Plan RDC indice B.pdf', parentId: 'phase:p1:PRO' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Plan RDC indice B.pdf', parentId: 'phase:p1:PRO', path: '26014 - Villa Martin/PRO/Plan RDC indice B.pdf' });
    expect(rowOf('documents', tenantId, 'd1').phase).toBe('PRO');

    // « Général » se range comme une phase vide.
    await patch(actor, '/nodes/doc:d1', { parentId: 'phase:p1:Général' });
    expect(rowOf('documents', tenantId, 'd1').phase).toBeNull();
  });

  it('refuse un nom temporaire, un type dangereux, un nom vide ou une demande sans changement', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });
    expect((await patch(actor, '/nodes/doc:d1', { name: '~$Plan.docx' })).body.code).toBe('NAME_IGNORED');
    expect((await patch(actor, '/nodes/doc:d1', { name: 'setup.exe' })).body.code).toBe('FILE_TYPE_REFUSED');
    expect((await patch(actor, '/nodes/doc:d1', { name: '   ' })).body.code).toBe('INVALID_NAME');
    expect((await patch(actor, '/nodes/doc:d1', {})).body.code).toBe('NOTHING_TO_UPDATE');
    expect((await patch(actor, '/nodes/doc:d1', { status: 'brouillon' })).body.code).toBe('INVALID_STATUS');
  });

  it('ne fait pas passer en CAO un fichier hébergé dans Supabase', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', name: 'Plan.pdf' });
    const res = await patch(actor, '/nodes/doc:d1', { name: 'Plan.dwg' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXTERNAL_STORAGE_REQUIRED');
    // Un fichier déjà sur l'espace du cabinet peut, lui, être renommé.
    seedDocument(tenantId, { id: 'd2', project_id: 'p1', name: 'Autre.pdf', storage_backend: 'external' });
    expect((await patch(actor, '/nodes/doc:d2', { name: 'Autre.dwg' })).status).toBe(200);
  });

  it('refuse de déplacer un document vers une autre affaire, mais classe un document de « À classer »', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedProject(tenantId, 'p2', { project_code: '26015', name: 'Ecole' });
    seedDocument(tenantId, { id: 'in-p1', project_id: 'p1' });
    seedDocument(tenantId, { id: 'vrac', project_id: null, phase: null, name: 'Vrac.pdf' });

    const across = await patch(actor, '/nodes/doc:in-p1', { parentId: 'phase:p2:APD' });
    expect(across.status).toBe(400);
    expect(across.body.code).toBe('MOVE_ACROSS_PROJECTS');
    expect((await patch(actor, '/nodes/doc:in-p1', { parentId: `inbox:${tenantId}` })).body.code).toBe('MOVE_ACROSS_PROJECTS');

    const filed = await patch(actor, '/nodes/doc:vrac', { parentId: 'phase:p2:DCE' });
    expect(filed.status).toBe(200);
    expect(filed.body).toMatchObject({ parentId: 'phase:p2:DCE', path: '26015 - Ecole/DCE/Vrac.pdf' });
    expect(rowOf('documents', tenantId, 'vrac')).toMatchObject({ project_id: 'p2', resource_id: 'p2', phase: 'DCE' });
  });

  it('refuse un classement vers l\'affaire d\'un autre cabinet ou une affaire archivée', async () => {
    const tenantId = makeTenant();
    const other = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(other, 'p-other');
    seedProject(tenantId, 'p-arch', { archived_at: new Date().toISOString() });
    seedDocument(tenantId, { id: 'vrac', project_id: null, phase: null });
    expect((await patch(actor, '/nodes/doc:vrac', { parentId: 'phase:p-other:APD' })).status).toBe(404);
    const archived = await patch(actor, '/nodes/doc:vrac', { parentId: 'phase:p-arch:APD' });
    expect(archived.body.code).toBe('PROJECT_ARCHIVED');
  });

  it('exige la version de base courante quand elle est fournie', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', version: 3 });
    const stale = await request(app).patch(`${API}/nodes/doc:d1`).set(actor.headers).set('If-Match', '"v2"').send({ name: 'Autre.pdf' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 3 });
    expect(stale.body.currentNode.id).toBe('doc:d1');
    const fresh = await request(app).patch(`${API}/nodes/doc:d1`).set(actor.headers).set('If-Match', '"v3"').send({ name: 'Autre.pdf' });
    expect(fresh.status).toBe(200);
  });

  it('un document approuvé ne se modifie plus, sauf son statut', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', doc_statut: 'approuve' });
    expect((await patch(actor, '/nodes/doc:d1', { name: 'Autre.pdf' })).body.code).toBe('DOCUMENT_APPROVED');
    const reopened = await patch(actor, '/nodes/doc:d1', { status: 'en_cours' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe('en_cours');

    const approved = await patch(actor, '/nodes/doc:d1', { status: 'approuve' });
    expect(approved.status).toBe(200);
    expect(rowOf('documents', tenantId, 'd1').date_approbation).toBeTruthy();
  });

  it('refuse toute modification dans une affaire archivée', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1', { archived_at: new Date().toISOString() });
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });
    const res = await patch(actor, '/nodes/doc:d1', { name: 'Autre.pdf' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
  });
});

describe('Suppression logique et indice', () => {
  it('met à la corbeille sans rien détruire, puis restaure', async () => {
    const tenantId = makeTenant();
    const admin = await makeActor(app, tenantId, 'admin');
    const member = await makeActor(app, tenantId, 'user');
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });

    const forbidden = await del(member, '/nodes/doc:d1');
    expect(forbidden.status).toBe(403);

    expect((await del(admin, '/nodes/doc:d1')).status).toBe(200);
    const row = rowOf('documents', tenantId, 'd1');
    expect(row.deleted_at).toBeTruthy();
    // Aucune suppression définitive : la ligne, ses versions et son objet sont intacts.
    expect(row.file_url).toBeTruthy();
    expect((await get(admin, '/nodes/doc:d1')).status).toBe(404);
    expect(names(await get(admin, '/nodes/phase:p1:APD/children').then(r => r.body))).toEqual([]);

    expect((await post(member, '/nodes/doc:d1/restore')).status).toBe(403);
    const restored = await post(admin, '/nodes/doc:d1/restore');
    expect(restored.status).toBe(200);
    expect(restored.body.id).toBe('doc:d1');
    expect((await post(admin, '/nodes/doc:d1/restore')).body.code).toBe('NOT_DELETED');
  });

  it('refuse de supprimer un dossier, un document approuvé ou celui d\'une affaire archivée', async () => {
    const tenantId = makeTenant();
    const admin = await makeActor(app, tenantId, 'admin');
    seedProject(tenantId, 'p1');
    seedProject(tenantId, 'arch', { archived_at: new Date().toISOString() });
    seedDocument(tenantId, { id: 'appr', project_id: 'p1', doc_statut: 'approuve' });
    seedDocument(tenantId, { id: 'old', project_id: 'arch' });
    const folder = await del(admin, '/nodes/prj:p1');
    expect(folder.status).toBe(409);
    expect(folder.body.code).toBe('FOLDER_NOT_SUPPORTED');
    expect((await del(admin, '/nodes/doc:appr')).body.code).toBe('DOCUMENT_APPROVED');
    expect((await del(admin, '/nodes/doc:old')).body.code).toBe('PROJECT_ARCHIVED');
  });

  it('fait avancer l\'indice de diffusion un cran à la fois, et jamais au-delà de Z', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', indice: 'A' });
    seedDocument(tenantId, { id: 'dz', project_id: 'p1', indice: 'Z', name: 'Fin.pdf' });

    const bumped = await post(actor, '/nodes/doc:d1/bump-indice');
    expect(bumped.status).toBe(200);
    expect(bumped.body.indice).toBe('B');
    // La version technique, elle, n'a pas bougé.
    expect(bumped.body.version).toBe(1);
    const limit = await post(actor, '/nodes/doc:dz/bump-indice');
    expect(limit.status).toBe(409);
    expect(limit.body.code).toBe('INDICE_LIMIT');
  });

  it('rend un lien profond sans accès par lui-même', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });
    const res = await post(actor, '/nodes/doc:d1/link');
    expect(res.body).toEqual({ deepLink: 'archioffice://document/d1', nodeId: 'doc:d1' });
    seedDocument(makeTenant(), { id: 'foreign', project_id: null });
    expect((await post(actor, '/nodes/doc:foreign/link')).status).toBe(404);
  });
});

describe('Lecture du contenu', () => {
  it('redirige vers une URL signée pour un fichier Supabase, avec version et empreinte', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', name: 'Plan.pdf', content_sha256: 'a'.repeat(64), version: 2 });

    const res = await get(actor, '/nodes/doc:d1/content');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/object\/sign\/documents\//);
    expect(res.headers.etag).toBe('"v2"');
    expect(res.headers['x-content-sha256']).toBe('a'.repeat(64));
  });

  it('lit une version précise, sans l\'empreinte de la version courante', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', version: 2, content_sha256: 'b'.repeat(64) });
    const oldPath = `${tenantId}/p1/d1/v1-Plan.pdf`;
    fakeSupabaseAdmin.putObject('documents', oldPath, 'ancien');
    fakeSupabaseAdmin.seed('document_versions', [{
      id: 'ver1', tenant_id: tenantId, document_id: 'd1', version: 1,
      file_url: `https://fake.supabase.test/storage/v1/object/public/documents/${oldPath}`,
    }]);
    const res = await get(actor, '/nodes/doc:d1/content?version=1');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('v1-Plan.pdf');
    expect(res.headers['x-content-sha256']).toBeUndefined();
    expect((await get(actor, '/nodes/doc:d1/content?version=9')).body.code).toBe('VERSION_NOT_FOUND');
    expect((await get(actor, '/nodes/doc:d1/content?version=abc')).body.code).toBe('INVALID_VERSION');
  });

  it('passe par un jeton propre à notre origine pour l\'espace du cabinet, sans lien public', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    const connectionId = connectExternalStorage(tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, {
      id: 'd1', project_id: 'p1', storage_backend: 'external',
      file_url: buildExternalRef({ provider: 'webdav', connectionId, externalId: 'ArchiOffice/26014/APD/Plan.pdf', fileName: 'Plan.pdf' }),
    });
    const res = await get(actor, '/nodes/doc:d1/content');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/api\/storage\/external\//);
  });

  it('refuse un fichier dont la connexion de stockage n\'appartient pas au cabinet', async () => {
    const tenantId = makeTenant();
    const other = makeTenant();
    const actor = await makeActor(app, tenantId);
    const foreignConnection = connectExternalStorage(other);
    seedDocument(tenantId, {
      id: 'd1', project_id: null, storage_backend: 'external',
      file_url: buildExternalRef({ provider: 'webdav', connectionId: foreignConnection, externalId: 'x/y.pdf', fileName: 'y.pdf' }),
    });
    const res = await get(actor, '/nodes/doc:d1/content');
    expect(res.status).toBe(403);
  });

  it('refuse un fichier Supabase hors du préfixe du cabinet', async () => {
    const tenantId = makeTenant();
    const other = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedDocument(tenantId, {
      id: 'd1', project_id: null,
      file_url: `https://fake.supabase.test/storage/v1/object/public/documents/${other}/p/d/secret.pdf`,
    });
    expect((await get(actor, '/nodes/doc:d1/content')).status).toBe(403);
  });
});

describe('Instance non migrée', () => {
  afterEach(() => {
    fakeSupabaseAdmin.unbreakTable('desktop_sync_state');
    fakeSupabaseAdmin.unbreakTable('document_locks');
  });

  it('répond 503 sur le journal et sur les verrous sans toucher au reste de l\'API', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId, 'user');
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });

    fakeSupabaseAdmin.breakTable('desktop_sync_state');
    const changes = await get(actor, '/changes?cursor=5');
    expect(changes.status).toBe(503);
    expect(changes.body.code).toBe('DESKTOP_SYNC_UNAVAILABLE');

    fakeSupabaseAdmin.breakTable('document_locks');
    const lock = await post(actor, '/nodes/doc:d1/lock');
    expect(lock.status).toBe(503);
    expect(lock.body.code).toBe('DESKTOP_SYNC_UNAVAILABLE');

    // La lecture de l'arborescence, elle, ne dépend pas de ces tables.
    expect((await get(actor, '/nodes/doc:d1')).status).toBe(200);
  });
});
