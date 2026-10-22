// Changement d'agence depuis le connecteur MCP (list_agencies, get_active_agency,
// switch_agency) : sélection propre à chaque connexion, appartenance revérifiée à
// chaque appel, isolation des identifiants, curseurs et confirmations par agence.
//
// Données entièrement fictives (faux Supabase en mémoire) : aucune donnée réelle.
// Les outils rappellent l'API en boucle locale (baseUrl 127.0.0.1:PORT) : le test
// fait donc écouter l'application sur un port libre avant de la créer.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import net from 'net';
import type { Server } from 'http';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, addMembership } from './testServer';
import { createConnection, resolveAccessToken } from '../packages/archioffice-agents/src/server/mcp/store';
import { executeMcpToolForConnection } from '../packages/archioffice-agents/src/server/mcp/dispatch';
import { executeAgencyTool } from '../packages/archioffice-agents/src/server/mcp/agencyTools';

const realFetch = globalThis.fetch;
let base = '';
let server: Server;

async function freePort(): Promise<number> {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
}

beforeAll(async () => {
  const port = await freePort();
  process.env.PORT = String(port);
  const app = await getTestApp();
  server = await new Promise<Server>(resolve => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${port}`;
}, 120_000);
afterAll(() => { server?.close(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** Appel JSON-RPC tools/call sur le vrai endpoint /mcp ; renvoie le résultat de l'outil. */
async function mcp(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await realFetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  if (res.status === 401) return { status: 401, body: null as any, result: null as any };
  const line = text.split('\n').find(l => l.startsWith('data: '));
  const rpc = JSON.parse(line ? line.slice(6) : text);
  const result = rpc.result;
  const body = result?.content?.[0]?.text ? JSON.parse(result.content[0].text) : null;
  return { status: res.status, body, result };
}

async function newConnection(userId: string, tenantId: string | null) {
  const { accessToken } = await createConnection(fakeSupabaseAdmin, { clientId: 'mcp_client_test', tenantId: tenantId as string, userId, scope: '' });
  return accessToken;
}

/** Deux agences, une troisième dont l'utilisateur n'est PAS membre. */
function world() {
  const aazs = makeTenant({ name: "Atelier d'Architecture Zomeno Sektaoui", slug: `aazs-${Math.random().toString(36).slice(2, 7)}` });
  const aacz = makeTenant({ name: 'Atelier AACZ', slug: `aacz-${Math.random().toString(36).slice(2, 7)}` });
  const other = makeTenant({ name: 'Cabinet étranger', slug: `autre-${Math.random().toString(36).slice(2, 7)}` });
  const { userId } = makeUser(aazs, 'admin');
  addMembership(userId, aacz, 'user');
  fakeSupabaseAdmin.seed('projects', [
    { id: `pA1-${aazs}`, tenant_id: aazs, name: 'Villa AAZS 1' },
    { id: `pA2-${aazs}`, tenant_id: aazs, name: 'Villa AAZS 2' },
    { id: `pB1-${aacz}`, tenant_id: aacz, name: 'Ecole AACZ' },
    { id: `pO1-${other}`, tenant_id: other, name: 'Projet étranger' },
  ]);
  return { aazs, aacz, other, userId, pA1: `pA1-${aazs}`, pB1: `pB1-${aacz}`, pO1: `pO1-${other}` };
}

describe('list_agencies', () => {
  it("ne liste que les agences auxquelles la personne appartient, avec son rôle", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    const { body } = await mcp(token, 'list_agencies');
    expect(body.agencies.map((a: any) => a.id).sort()).toEqual([w.aazs, w.aacz].sort());
    expect(body.agencies.map((a: any) => a.id)).not.toContain(w.other);
    expect(body.agencies.find((a: any) => a.id === w.aazs)).toMatchObject({ role: 'admin', active: true });
    expect(body.agencies.find((a: any) => a.id === w.aacz)).toMatchObject({ role: 'user', active: false });
    expect(body.active_agency_id).toBe(w.aazs);
  });

  it("une autre personne ne voit que ses propres agences", async () => {
    const w = world();
    const { userId } = makeUser(w.aazs, 'user');
    const { body } = await mcp(await newConnection(userId, w.aazs), 'list_agencies');
    expect(body.agencies.map((a: any) => a.id)).toEqual([w.aazs]);
  });
});

describe('switch_agency', () => {
  it('bascule AAZS → AACZ puis AACZ → AAZS, confirmé et persistant', async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    expect((await mcp(token, 'get_active_agency')).body).toMatchObject({ active_agency: { id: w.aazs }, selection_source: 'consent' });

    const toB = await mcp(token, 'switch_agency', { query: 'AACZ' });
    expect(toB.body).toMatchObject({ switched: true, changed: true, agency: { id: w.aacz }, previous_agency: { id: w.aazs }, role: 'user' });
    expect(toB.result._meta.agency.id).toBe(w.aacz);
    expect((await mcp(token, 'get_active_agency')).body).toMatchObject({ active_agency: { id: w.aacz }, selection_source: 'switch' });

    const toA = await mcp(token, 'switch_agency', { query: 'AAZS' }); // sigle du nom
    expect(toA.body).toMatchObject({ switched: true, agency: { id: w.aazs }, previous_agency: { id: w.aacz } });
    expect((await mcp(token, 'get_active_agency')).body.active_agency.id).toBe(w.aazs);
  });

  it("la sélection survit au renouvellement du jeton d'accès (pas de reconnexion)", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    await mcp(token, 'switch_agency', { agency_id: w.aacz });
    const row = fakeSupabaseAdmin.getTable('mcp_connections').find(r => r.user_id === w.userId && r.active_tenant_id === w.aacz)!;
    expect(row.tenant_id).toBe(w.aazs); // le consentement initial n'est pas modifié
    expect((await resolveAccessToken(fakeSupabaseAdmin, token))!.tenantId).toBe(w.aacz);
  });

  it('refuse une agence non autorisée sans changer la sélection', async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    const denied = await mcp(token, 'switch_agency', { agency_id: w.other });
    expect(denied.result.isError).toBe(true);
    expect(denied.body.code).toBe('AGENCY_ACCESS_DENIED');
    const unknown = await mcp(token, 'switch_agency', { agency_id: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.body.code).toBe('AGENCY_UNKNOWN');
    const byName = await mcp(token, 'switch_agency', { query: 'Cabinet étranger' });
    expect(byName.body.code).toBe('AGENCY_UNKNOWN'); // jamais cherché hors des agences autorisées
    expect((await mcp(token, 'get_active_agency')).body.active_agency.id).toBe(w.aazs);
  });

  it("demande une précision quand plusieurs agences correspondent, sans rien changer", async () => {
    const nancy = makeTenant({ name: 'Atelier ACME Nancy', slug: 'acme-nancy-t' });
    const metz = makeTenant({ name: 'Atelier ACME Metz', slug: 'acme-metz-t' });
    const { userId } = makeUser(nancy, 'admin');
    addMembership(userId, metz, 'admin');
    const token = await newConnection(userId, nancy);
    const { body, result } = await mcp(token, 'switch_agency', { query: 'acme' });
    expect(result.isError).toBeFalsy();
    expect(body.needs_clarification).toBe(true);
    expect(body.candidates.map((c: any) => c.id).sort()).toEqual([nancy, metz].sort());
    expect(body.switched).toBeUndefined();
    expect((await mcp(token, 'get_active_agency')).body.active_agency.id).toBe(nancy);
  });
});

describe('lecture et écriture dans l\'agence sélectionnée', () => {
  it('lit et crée dans l\'agence active, et rien ne fuit vers l\'autre', async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    const namesIn = async () => (await mcp(token, 'list_projects')).body.projects.map((p: any) => p.name).sort();
    expect(await namesIn()).toEqual(['Villa AAZS 1', 'Villa AAZS 2']);

    await mcp(token, 'switch_agency', { agency_id: w.aacz });
    expect(await namesIn()).toEqual(['Ecole AACZ']);
    const created = await mcp(token, 'create_task', { title: 'Tâche AACZ' });
    expect(created.result.isError).toBeFalsy();
    expect(fakeSupabaseAdmin.getTable('tasks').find(t => t.title === 'Tâche AACZ')!.tenant_id).toBe(w.aacz);

    const tasksB = (await mcp(token, 'list_tasks')).body;
    expect(JSON.stringify(tasksB)).toContain('Tâche AACZ');
    await mcp(token, 'switch_agency', { agency_id: w.aazs });
    expect(JSON.stringify((await mcp(token, 'list_tasks')).body)).not.toContain('Tâche AACZ');
  });

  it("refuse un identifiant de ressource issu de l'autre agence, et d'une agence étrangère", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    expect((await mcp(token, 'get_project', { project_id: w.pA1 })).result.isError).toBeFalsy();
    await mcp(token, 'switch_agency', { agency_id: w.aacz });
    const crossed = await mcp(token, 'get_project', { project_id: w.pA1 });
    expect(crossed.result.isError).toBe(true);
    expect(JSON.stringify(crossed.body)).not.toContain('Villa AAZS');
    expect((await mcp(token, 'get_project', { project_id: w.pO1 })).result.isError).toBe(true);
  });

  it("un curseur de pagination obtenu dans une agence est refusé dans l'autre", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    const first = (await mcp(token, 'list_projects', { limit: 1 })).body;
    expect(first.projects).toHaveLength(1);
    expect(first.next_cursor).toMatch(new RegExp(`^${w.aazs}~`));
    const same = await mcp(token, 'list_projects', { limit: 1, cursor: first.next_cursor });
    expect(same.result.isError).toBeFalsy();
    await mcp(token, 'switch_agency', { agency_id: w.aacz });
    const crossed = await mcp(token, 'list_projects', { limit: 1, cursor: first.next_cursor });
    expect(crossed.body.code).toBe('AGENCY_MISMATCH');
  });

  it("indique l'agence utilisée dans chaque réponse, sans changer la forme du premier bloc", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    const obj = await mcp(token, 'list_projects');
    expect(obj.body.agency).toMatchObject({ id: w.aazs });
    expect(obj.body.projects).toHaveLength(2);
    expect(obj.result._meta.agency.id).toBe(w.aazs);
    const arr = await mcp(token, 'list_tasks'); // liste JSON : second bloc, premier bloc intact
    expect(Array.isArray(JSON.parse(arr.result.content[0].text))).toBe(true);
    expect(JSON.parse(arr.result.content[1].text).agency.id).toBe(w.aazs);
  });
});

describe('droits revérifiés à chaque appel', () => {
  const revoke = (userId: string, tenantId: string) =>
    fakeSupabaseAdmin.from('tenant_memberships').delete().eq('user_id', userId).eq('tenant_id', tenantId);

  it("une appartenance révoquée ferme l'agence tout de suite, y compris pour l'API, et on peut en sortir", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    await mcp(token, 'switch_agency', { agency_id: w.aacz });
    expect((await mcp(token, 'list_projects')).result.isError).toBeFalsy();

    await revoke(w.userId, w.aacz);
    const lost = await mcp(token, 'list_projects');
    expect(lost.result.isError).toBe(true);
    expect(lost.body.code).toBe('AGENCY_ACCESS_DENIED');
    expect(JSON.stringify(lost.body)).not.toContain('Ecole AACZ');
    expect((await mcp(token, 'get_active_agency')).body.code).toBe('AGENCY_ACCESS_DENIED');
    // L'API elle-même refuse le jeton pour cette agence.
    const direct = await realFetch(`${base}/api/projects`, { headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': w.aacz } });
    expect(direct.status).toBe(403);
    expect((await realFetch(`${base}/api/projects`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403);

    const listed = (await mcp(token, 'list_agencies')).body;
    expect(listed.agencies.map((a: any) => a.id)).toEqual([w.aazs]);
    expect(listed.active_agency_id).toBeNull();
    // Retour sur une agence autorisée, sans reconnexion.
    expect((await mcp(token, 'switch_agency', { agency_id: w.aazs })).body.switched).toBe(true);
    expect((await mcp(token, 'list_projects')).result.isError).toBeFalsy();
    // Et une agence révoquée ne peut plus être choisie : l'agence existe, l'accès est refusé.
    expect((await mcp(token, 'switch_agency', { agency_id: w.aacz })).body.code).toBe('AGENCY_ACCESS_DENIED');
  });

  it("sans agence sélectionnée, les outils de données refusent et les outils d'agence restent utilisables", async () => {
    const w = world();
    const token = await newConnection(w.userId, null);
    const data = await mcp(token, 'list_projects');
    expect(data.body.code).toBe('AGENCY_NOT_SELECTED');
    expect((await mcp(token, 'get_active_agency')).body.code).toBe('AGENCY_NOT_SELECTED');
    expect((await mcp(token, 'list_agencies')).body.count).toBe(2);
    expect((await mcp(token, 'switch_agency', { agency_id: w.aacz })).body.switched).toBe(true);
  });

  it("un jeton révoqué n'authentifie plus rien", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    await fakeSupabaseAdmin.from('mcp_connections').update({ revoked_at: new Date().toISOString() }).eq('user_id', w.userId);
    expect((await mcp(token, 'list_agencies')).status).toBe(401);
  });
});

describe('indépendance des connexions et du navigateur', () => {
  it("deux connexions de la même personne ont chacune leur agence", async () => {
    const w = world();
    const t1 = await newConnection(w.userId, w.aazs);
    const t2 = await newConnection(w.userId, w.aazs);
    await mcp(t1, 'switch_agency', { agency_id: w.aacz });
    expect((await mcp(t1, 'get_active_agency')).body.active_agency.id).toBe(w.aacz);
    expect((await mcp(t2, 'get_active_agency')).body.active_agency.id).toBe(w.aazs);
  });

  it("un changement de cabinet dans le navigateur ne modifie pas la connexion MCP, et inversement", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    // Ce que fait POST /api/tenants/switch : le cabinet par défaut du profil change.
    await fakeSupabaseAdmin.from('profiles').update({ tenant_id: w.aacz }).eq('id', w.userId);
    await fakeSupabaseAdmin.from('tenant_memberships').update({ is_default: false }).eq('user_id', w.userId);
    await fakeSupabaseAdmin.from('tenant_memberships').update({ is_default: true }).eq('user_id', w.userId).eq('tenant_id', w.aacz);
    expect((await mcp(token, 'get_active_agency')).body.active_agency.id).toBe(w.aazs);

    await mcp(token, 'switch_agency', { agency_id: w.aacz });
    await fakeSupabaseAdmin.from('profiles').update({ tenant_id: w.aazs }).eq('id', w.userId);
    expect((await mcp(token, 'get_active_agency')).body.active_agency.id).toBe(w.aacz);
  });

  it("deux personnes n'influencent pas leurs connexions respectives", async () => {
    const w = world();
    const { userId: other } = makeUser(w.aazs, 'user');
    addMembership(other, w.aacz, 'user');
    const mine = await newConnection(w.userId, w.aazs);
    const theirs = await newConnection(other, w.aazs);
    await mcp(mine, 'switch_agency', { agency_id: w.aacz });
    expect((await mcp(theirs, 'get_active_agency')).body.active_agency.id).toBe(w.aazs);
  });
});

describe('opérations concurrentes et confirmations', () => {
  it("un appel déjà démarré garde son agence malgré un switch_agency survenu pendant son exécution", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    const snapshot = (await resolveAccessToken(fakeSupabaseAdmin, token))!; // instantané pris au début de l'appel
    expect(snapshot.tenantId).toBe(w.aazs);

    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let reached!: () => void;
    const inFlight = new Promise<void>(r => { reached = r; });
    vi.stubGlobal('fetch', async (url: any, init: any) => {
      if (String(url).includes('/api/projects?')) { reached(); await gate; }
      return realFetch(url, init);
    });

    const call = executeMcpToolForConnection({
      supabaseAdmin: fakeSupabaseAdmin, baseUrl: base, authorization: `Bearer ${token}`, resolved: snapshot, name: 'list_projects', args: {},
    });
    await inFlight;
    await mcp(token, 'switch_agency', { agency_id: w.aacz }); // pendant l'appel
    release();
    const result = await call;
    const body = JSON.parse(result.content[0].text);
    expect(body.projects.map((p: any) => p.name).sort()).toEqual(['Villa AAZS 1', 'Villa AAZS 2']);
    expect(body.agency.id).toBe(w.aazs);

    vi.unstubAllGlobals();
    expect((await mcp(token, 'list_projects')).body.projects.map((p: any) => p.name)).toEqual(['Ecole AACZ']); // l'appel suivant suit le switch
  });

  it("des appels simultanés pendant des changements restent chacun cohérents avec l'agence annoncée", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    const names: Record<string, string[]> = { [w.aazs]: ['Villa AAZS 1', 'Villa AAZS 2'], [w.aacz]: ['Ecole AACZ'] };
    const calls = [
      mcp(token, 'list_projects'), mcp(token, 'switch_agency', { agency_id: w.aacz }), mcp(token, 'list_projects'),
      mcp(token, 'switch_agency', { agency_id: w.aazs }), mcp(token, 'list_projects'), mcp(token, 'list_projects'),
    ];
    const results = await Promise.all(calls);
    for (const r of results.filter((_, i) => [0, 2, 4, 5].includes(i))) {
      expect(r.result.isError).toBeFalsy();
      expect(r.body.projects.map((p: any) => p.name).sort()).toEqual(names[r.body.agency.id]);
    }
  });

  it("une confirmation demandée avant un changement d'agence n'est jamais exécutée dans l'autre", async () => {
    const w = world();
    const docId = `doc-${w.aazs}`;
    fakeSupabaseAdmin.seed('documents', [{ id: docId, tenant_id: w.aazs, project_id: w.pA1, resource_type: 'projects', resource_id: w.pA1, name: 'plan.pdf', category: 'Plan' }]);
    const token = await newConnection(w.userId, w.aazs);
    const ask = await mcp(token, 'delete_document', { resource: 'projects', resource_id: w.pA1, document_id: docId });
    expect(ask.body.needs_confirmation).toBe(true);
    expect(ask.body.agency.id).toBe(w.aazs); // la demande de confirmation nomme son agence

    await mcp(token, 'switch_agency', { agency_id: w.aacz });
    const bare = await mcp(token, 'delete_document', { resource: 'projects', resource_id: w.pA1, document_id: docId, confirm: true });
    expect(bare.body.code).toBe('AGENCY_CONFIRMATION_REQUIRED');
    const stale = await mcp(token, 'delete_document', { resource: 'projects', resource_id: w.pA1, document_id: docId, confirm: true, agency_id: w.aazs });
    expect(stale.body.code).toBe('AGENCY_MISMATCH');
    expect(fakeSupabaseAdmin.getTable('documents').some(d => d.id === docId)).toBe(true);
  });

  it("une connexion qui n'a jamais changé d'agence garde le comportement d'avant pour confirm", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    const r = await mcp(token, 'delete_document', { resource: 'projects', resource_id: w.pA1, document_id: 'absent', confirm: true });
    expect(r.body.code).toBeUndefined(); // atteint l'outil (document introuvable), pas bloqué par le garde-fou d'agence
  });

  it("agency_id fourni sur un outil de lecture est un garde-fou, jamais une autorisation", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    expect((await mcp(token, 'list_projects', { agency_id: w.aazs })).result.isError).toBeFalsy();
    expect((await mcp(token, 'list_projects', { agency_id: w.aacz })).body.code).toBe('AGENCY_MISMATCH');
    // Une agence étrangère ne devient pas accessible parce qu'on la nomme.
    expect((await mcp(token, 'list_projects', { agency_id: w.other })).body.code).toBe('AGENCY_MISMATCH');
  });
});

describe('pas de déplacement de données ni de droits', () => {
  it("switch_agency n'écrit que la sélection de la connexion", async () => {
    const w = world();
    const token = await newConnection(w.userId, w.aazs);
    const snap = () => JSON.stringify(['projects', 'tasks', 'contacts', 'documents', 'email_connections', 'tenant_memberships'].map(t => fakeSupabaseAdmin.getTable(t)));
    const before = snap();
    await mcp(token, 'switch_agency', { agency_id: w.aacz });
    expect(snap()).toBe(before);
  });

  it("migration non appliquée : le changement échoue proprement et la sélection reste inchangée", async () => {
    const w = world();
    const resolved = (await resolveAccessToken(fakeSupabaseAdmin, await newConnection(w.userId, w.aazs)))!;
    const failing = { from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ is: async () => ({ error: { message: 'column "active_tenant_id" does not exist' } }) }) }) }) }) };
    const res = await executeAgencyTool(failing, resolved, 'switch_agency', { agency_id: w.aacz });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).code).toBe('AGENCY_SWITCH_NOT_CONFIRMED');
  });
});
