// Serveur MCP : champs d'affaire écrivables, lecture complète d'un contact,
// liste d'affaires allégée et paginée, dépôt de fichier sans base64
// (file_url, URL signée), et mise à jour partielle de PUT /api/projects/:id.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { AGENT_RESOURCES } from '../packages/archioffice-agents/src/types';
import { prepareRecord, slimRecord } from '../packages/archioffice-agents/src/server/tools';
import { MCP_TOOL_NAMES, executeMcpTool } from '../packages/archioffice-agents/src/server/mcp/tools';
import { setMcpUploadUrlIssuer } from '../packages/archioffice-agents/src/server/mcp/uploadUrl';
import { signMcpUploadTicket, verifyMcpUploadTicket } from '../server/mcpUploadTicket';

afterEach(() => { vi.unstubAllGlobals(); setMcpUploadUrlIssuer(null); });

const AUTH = { authorization: 'Bearer t' };
const BIG_IMAGE = `data:image/png;base64,${'A'.repeat(300_000)}`;
const projects = AGENT_RESOURCES.find(r => r.key === 'projects')!;
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe('ressource projects : champs écrivables', () => {
  const FIELDS = ['adresse_terrain', 'cp_ville_terrain', 'ban_id_terrain', 'city_code_terrain', 'surface_parcelle', 'surface_plancher', 'surface_plancher_ext',
    'zone_plu', 'programme', 'type_projet', 'categorie_projet', 'adresse_client', 'cp_client', 'ville_client', 'telephone', 'portable', 'email_client',
    'num_permis_construire', 'date_depot_pc', 'secteur_abf'];

  it('accepte tous les champs demandés sans les écarter', () => {
    const input = Object.fromEntries(FIELDS.map(f => [f, 'x']));
    const prepared = prepareRecord(projects, input, { applyDefaults: false });
    expect(prepared.ignoredFields).toEqual([]);
    expect(Object.keys(prepared.data)).toEqual(expect.arrayContaining(FIELDS));
  });

  it('redirige client_email vers email_client, sans écraser le champ réel', () => {
    expect(prepareRecord(projects, { client_email: 'a@b.fr' }, { applyDefaults: false }).data).toEqual({ email_client: 'a@b.fr' });
    const both = prepareRecord(projects, { client_email: 'alias@b.fr', email_client: 'reel@b.fr' }, { applyDefaults: false });
    expect(both.data.email_client).toBe('reel@b.fr');
    expect(both.ignoredFields).toEqual(['client_email']);
  });
});

describe('slimRecord', () => {
  it('omet les data-URI et tronque les très longs textes', () => {
    const out = slimRecord({ id: '1', image_url: BIG_IMAGE, notes: 'n'.repeat(10_000), name: 'ok' });
    expect(out.image_url).toBe('[image omise]');
    expect(String(out.notes).length).toBeLessThan(4100);
    expect(out.name).toBe('ok');
  });
  it('ne garde que fields (plus id) quand ils sont demandés', () => {
    expect(slimRecord({ id: '1', email: 'e', phone: 'p', notes: 'n' }, ['email'])).toEqual({ id: '1', email: 'e' });
  });
});

describe('outils MCP de lecture', () => {
  it('expose get_record et create_upload_url', () => {
    expect(MCP_TOOL_NAMES).toEqual(expect.arrayContaining(['get_record', 'create_upload_url']));
  });

  it('search_records avec fields et get_record rendent le contact complet', async () => {
    const contact = { id: 'c1', first_name: 'Mohammed', last_name: 'EL GHAZILI', email: 'm@x.fr', phone: '0600000000', address: '1 rue A', city: 'Nancy', zip: '54000' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [contact] })));
    const found = parse(await executeMcpTool('http://local', AUTH, 'search_records', { resource: 'contacts', query: 'ghazili', fields: ['email', 'phone'] }));
    expect(found.matches[0]).toMatchObject({ id: 'c1', fields: { id: 'c1', email: 'm@x.fr', phone: '0600000000' } });
    expect(found.matches[0].fields.address).toBeUndefined();

    const full = parse(await executeMcpTool('http://local', AUTH, 'get_record', { resource: 'contacts', id: 'c1' }));
    expect(full.record).toMatchObject({ email: 'm@x.fr', address: '1 rue A', zip: '54000' });
    const missing = await executeMcpTool('http://local', AUTH, 'get_record', { resource: 'contacts', id: 'nope' });
    expect(parse(missing).error).toMatch(/Aucun enregistrement/);
  });

  it('list_projects ne renvoie ni image_url ni champ superflu, et pagine', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `p${5 - i}`, name: `Affaire ${i}`, project_code: `26-00${i}`, address: `${i} rue`, status: 'Planning', client: 'C', image_url: BIG_IMAGE, budget: 10 }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: rows, nextCursor: 'curseur-suivant' }) })));
    const result = await executeMcpTool('http://local', AUTH, 'list_projects', { limit: 2 });
    const body = parse(result);
    expect(result.content[0].text.length).toBeLessThan(2000);
    expect(body.projects).toHaveLength(2);
    expect(Object.keys(body.projects[0]).sort()).toEqual(['adresse', 'client', 'code', 'id', 'name', 'statut']);
    expect(body.next_cursor).toBe(Buffer.from('p4', 'utf8').toString('base64url'));
  });

  it('get_project omet l\'image de l\'affaire', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ project: { id: 'p1', name: 'MM IMOB', image_url: BIG_IMAGE }, milestones: [] }) })));
    const result = await executeMcpTool('http://local', AUTH, 'get_project', { project_id: 'p1' });
    expect(parse(result).project.image_url).toBe('[image omise]');
  });
});

describe('upload_document sans base64', () => {
  const PDF = new Uint8Array(650 * 1024).fill(37);

  it('télécharge file_url côté serveur puis dépose le fichier', async () => {
    let posted: FormData | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      if (u.startsWith('https://93.184.216.34/')) {
        return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) } });
      }
      if (u.endsWith('/api/documents') && opts?.method === 'POST') {
        posted = opts.body as FormData;
        return { ok: true, json: async () => ({ id: 'doc-1', size_bytes: PDF.length, uploaded_at: '2026-10-07T00:00:00Z' }) };
      }
      throw new Error('fetch inattendu : ' + u);
    }));
    const result = await executeMcpTool('http://local', AUTH, 'upload_document', {
      resource: 'projects', resource_id: 'p1789385615196-eac25c71', file_url: 'https://93.184.216.34/plans/plan%20RDC.pdf', category: 'plan',
    });
    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({ id: 'doc-1', file_name: 'plan RDC.pdf', mime_type: 'application/pdf', size: PDF.length });
    expect(posted?.get('category')).toBe('plan');
    expect(posted?.get('resource_id')).toBe('p1789385615196-eac25c71');
  });

  it('refuse une adresse interne et un fichier trop gros', async () => {
    const internal = await executeMcpTool('http://local', AUTH, 'upload_document', { resource: 'projects', resource_id: 'p1', file_url: 'http://169.254.169.254/latest' });
    expect(internal.isError).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': String(30 * 1024 * 1024) } })));
    const big = await executeMcpTool('http://local', AUTH, 'upload_document', { resource: 'projects', resource_id: 'p1', file_url: 'https://93.184.216.34/gros.pdf' });
    expect(parse(big).error).toMatch(/trop volumineux/);
  });

  it('refuse file_url et file_content ensemble, et l\'absence des deux', async () => {
    const both = await executeMcpTool('http://local', AUTH, 'upload_document', { resource: 'projects', resource_id: 'p1', file_url: 'https://93.184.216.34/a.pdf', file_content: 'AAAA' });
    expect(both.isError).toBe(true);
    const none = await executeMcpTool('http://local', AUTH, 'upload_document', { resource: 'projects', resource_id: 'p1' });
    expect(none.isError).toBe(true);
  });

  it('create_upload_url passe par l\'émetteur, ou indique le repli file_url', async () => {
    const unavailable = await executeMcpTool('http://local', AUTH, 'create_upload_url', { resource: 'projects', resource_id: 'p1', file_name: 'plan.pdf' });
    expect(parse(unavailable).error).toMatch(/file_url/);

    let seen: any;
    setMcpUploadUrlIssuer(async (request) => { seen = request; return { url: 'https://app.test/mcp-upload/abc', expiresInSeconds: 900, maxBytes: 25 * 1024 * 1024 }; });
    const ok = parse(await executeMcpTool('http://local', AUTH, 'create_upload_url', { resource: 'projects', resource_id: 'p1', file_name: 'plan.pdf', category: 'plan' }));
    expect(ok).toMatchObject({ upload_url: 'https://app.test/mcp-upload/abc', method: 'PUT', max_size_mb: 25 });
    expect(seen).toMatchObject({ mimeType: 'application/pdf', category: 'plan', authorization: 'Bearer t' });
  });
});

describe('jeton d\'envoi signé', () => {
  const base = { t: 'tenant', u: 'user', r: 'projects', i: 'p1', n: 'plan.pdf', m: 'application/pdf' };
  it('se vérifie, et refuse un jeton altéré ou expiré', () => {
    process.env.MAIL_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
    const ticket = signMcpUploadTicket(base);
    expect(verifyMcpUploadTicket(ticket)).toMatchObject(base);
    expect(verifyMcpUploadTicket(ticket.slice(0, -2) + 'AA')).toBeNull();
    expect(verifyMcpUploadTicket(signMcpUploadTicket(base, -10))).toBeNull();
    expect(verifyMcpUploadTicket('nimporte.quoi')).toBeNull();
  });
});

describe('PUT /mcp-upload/:ticket', () => {
  let app: Express;
  beforeAll(async () => { app = await getTestApp(); });

  it('refuse un jeton invalide', async () => {
    const res = await request(app).put('/mcp-upload/faux.jeton').set('Content-Type', 'application/pdf').send(Buffer.from('%PDF'));
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/projects/:id : mise à jour partielle', () => {
  let app: Express;
  beforeAll(async () => { app = await getTestApp(); });

  it('ne remet pas à zéro les booléens et le SIRET absents du corps', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{
      id: 'pm1', tenant_id: tenantId, name: 'MM IMOB', client: 'M. M', status: 'Planning',
      is_complete_mission: true, is_chantier: true, is_public_client: true, is_entreprise: true, client_siret: '12345678900011', zone_plu: 'U',
    }]);
    const res = await request(app).put('/api/projects/pm1').set(authHeader(token))
      .send({ zone_plu: 'UAb', num_permis_construire: 'PC 054 000 26 00001', date_depot_pc: '2026-09-01', client_email: 'moa@x.fr' });
    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('projects').find(p => p.id === 'pm1')!;
    expect(row).toMatchObject({
      zone_plu: 'UAb', num_permis_construire: 'PC 054 000 26 00001', date_depot_pc: '2026-09-01', client_email: 'moa@x.fr',
      is_complete_mission: true, is_chantier: true, is_public_client: true, is_entreprise: true, client_siret: '12345678900011', name: 'MM IMOB',
    });
  });
});
