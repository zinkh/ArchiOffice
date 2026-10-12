import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentTools, executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import { capabilitiesFromAgent, AGENT_RESOURCES } from '../packages/archioffice-agents/src/types';

const NO_CAPS = { action_scopes: [] as string[], web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false, geo_enabled: false, docs_read_enabled: false };
const auth = { authorization: 'Bearer x' };
const caps = (scopes: string[]) => capabilitiesFromAgent({ ...NO_CAPS, action_scopes: scopes });

type Handler = (url: string, method: string, body: any) => any;
/** Simule l'API : les routes sont des motifs de fin d'URL, la première qui correspond répond. */
const stub = (routes: Record<string, any | Handler>) => {
  const mock = vi.fn(async (url: string, init?: any) => {
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const key = Object.keys(routes).find(k => { const [m, ...p] = k.split(' '); return m === method && url.includes(p.join(' ')); });
    const r = key ? routes[key] : [];
    const json = typeof r === 'function' ? r(url, method, body) : r;
    return { ok: true, status: 200, json: async () => json };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};
const sent = (m: ReturnType<typeof stub>, method: string, part: string) =>
  m.mock.calls.filter(c => (c[1]?.method || 'GET') === method && c[0].includes(part)).map(c => (typeof c[1]?.body === 'string' ? JSON.parse(c[1].body) : undefined));
const run = (scopes: string[], name: string, args: any) => executeAgentAction('http://localhost', auth, caps(scopes), { name, args }) as Promise<{ response: any }>;

describe('outils d\'opération : lots, cotraitants, équipe, journal, observations, participants', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sont proposés selon le périmètre et exposés au MCP', async () => {
    const names = (s: string[]) => buildAgentTools(caps(s)).map(t => t.name);
    for (const n of ['manage_project_lots', 'manage_project_cotraitants', 'manage_project_members', 'manage_project_journal', 'manage_observations']) {
      expect(names(['projects'])).toContain(n);
      expect(names(['contacts'])).not.toContain(n);
    }
    expect(names(['meetings'])).toContain('manage_meeting_attendees');
    expect(names(['projects'])).not.toContain('manage_meeting_attendees');
    const { MCP_TOOL_NAMES } = await import('../packages/archioffice-agents/src/server/mcp/tools');
    expect(MCP_TOOL_NAMES).toEqual(expect.arrayContaining(['manage_project_lots', 'manage_meeting_attendees']));
  });

  it('refuse un outil hors périmètre', async () => {
    const r = await run(['contacts'], 'manage_project_lots', { project_id: 'p1', action: 'list' });
    expect(r.response.error).toContain('opérations');
  });

  describe('lots', () => {
    const lots = [{ id: 'l1', lot_number: '01', lot_title: 'GROS OEUVRE' }, { id: 'l2', lot_number: '02', lot_title: 'CHARPENTE' }];

    it('ajoute un lot, signale un doublon et un numéro déjà pris', async () => {
      const m = stub({ 'GET /lots': lots, 'POST /lots': { id: 'l3' } });
      const r = await run(['projects'], 'manage_project_lots', { project_id: 'p1', action: 'add', lots: [
        { numero: '03', intitule: 'COUVERTURE' }, { numero: '01', intitule: 'GROS OEUVRE' }, { numero: '02', intitule: 'AUTRE' },
      ] });
      expect(r.response.ajoutes).toEqual([{ id: 'l3', numero: '03', intitule: 'COUVERTURE' }]);
      expect(r.response.deja_presents).toHaveLength(1);
      expect(r.response.non_traites[0].raison).toContain('déjà pris');
      expect(sent(m, 'POST', '/lots')).toEqual([{ lot_number: '03', lot_title: 'COUVERTURE' }]);
    });

    it('retire en deux temps', async () => {
      const m = stub({ 'GET /lots': lots, 'DELETE /api/lots/l2': { success: true } });
      const first = await run(['projects'], 'manage_project_lots', { project_id: 'p1', action: 'remove', lots: [{ numero: '02' }] });
      expect(first.response.needs_confirmation).toBe(true);
      expect(m.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false);
      const second = await run(['projects'], 'manage_project_lots', { project_id: 'p1', action: 'remove', lots: [{ numero: '02' }], confirm: true });
      expect(second.response.retires).toHaveLength(1);
    });

    it('réordonne en complétant avec les lots omis', async () => {
      const m = stub({ 'GET /lots': lots, 'PUT /lots/order': lots });
      await run(['projects'], 'manage_project_lots', { project_id: 'p1', action: 'reorder', ordre: ['02'] });
      expect(sent(m, 'PUT', '/lots/order')).toEqual([{ ids: ['l2', 'l1'] }]);
    });
  });

  it('ajoute un cotraitant en envoyant la seule liste, ids conservés', async () => {
    const m = stub({
      'GET /full': { id: 'p1', cotraitants_list: [{ id: 'ct1', specialty: 'Structure', contact_id: 'c1' }] },
      'GET /api/contacts': [{ id: 'c1', company_name: 'BET STRUCT' }, { id: 'c2', company_name: 'BET FLUIDES' }],
      'PUT /api/projects/p1': { success: true },
    });
    const r = await run(['projects'], 'manage_project_cotraitants', { project_id: 'p1', action: 'add', intervenants: [{ nom: 'BET FLUIDES', specialite: 'Fluides' }, { contact_id: 'c1', specialite: 'structure' }] });
    expect(r.response.ajoutes).toHaveLength(1);
    expect(r.response.deja_presents).toHaveLength(1);
    const [put] = sent(m, 'PUT', '/api/projects/p1');
    expect(Object.keys(put)).toEqual(['cotraitants_list']);
    expect(put.cotraitants_list[0]).toEqual({ id: 'ct1', specialty: 'Structure', contact_id: 'c1' });
    expect(put.cotraitants_list[1]).toMatchObject({ specialty: 'Fluides', contact_id: 'c2' });
  });

  it("affecte un membre de l'équipe désigné par son nom", async () => {
    const m = stub({
      'GET /api/team': [{ id: 'u1', name: 'Christian Zomeno', email: 'c@x.fr' }, { id: 'u2', name: 'Sophie', email: 's@x.fr' }],
      'GET /members': [{ user_id: 'u2', role: 'member' }],
      'POST /members': { id: 'm' },
    });
    const r = await run(['projects'], 'manage_project_members', { project_id: 'p1', action: 'add', membres: [{ nom: 'christian zomeno' }, { nom: 'Sophie' }, { nom: 'Inconnu' }] });
    expect(r.response.ajoutes).toHaveLength(1);
    expect(r.response.deja_presents).toHaveLength(1);
    expect(r.response.non_traites).toHaveLength(1);
    expect(sent(m, 'POST', '/members')).toEqual([{ user_id: 'u1' }]);
  });

  describe('journal', () => {
    it('ajoute une note sur la phase en cours, sans doublon', async () => {
      const m = stub({
        'GET /phase-history': [{ phase: 'ESQ', entered_at: '2026-01-01' }, { phase: 'APS', entered_at: '2026-03-01' }],
        'GET /phase-notes': [{ id: 'n0', phase: 'APS', kind: 'attention', body: 'Déjà là' }],
        'POST /phase-notes': (_u: string, _m: string, b: any) => ({ id: 'n1', ...b, body: b.body, kind: b.kind, phase: b.phase }),
      });
      const added = await run(['projects'], 'manage_project_journal', { project_id: 'p1', action: 'add_note', type: 'decision_moa', texte: 'Le MOA valide le parti' });
      expect(added.response.note).toMatchObject({ phase: 'APS', type: 'decision_moa' });
      expect(sent(m, 'POST', '/phase-notes')[0]).toMatchObject({ phase: 'APS', kind: 'decision_moa' });
      const again = await run(['projects'], 'manage_project_journal', { project_id: 'p1', action: 'add_note', type: 'attention', texte: 'déjà là' });
      expect(again.response.already_exists).toBe(true);
    });

    it('ne change jamais la phase', async () => {
      const names = buildAgentTools(caps(['projects'])).map(t => t.name);
      expect(names).not.toContain('change_project_phase');
      const stubbed = stub({ 'GET /phase-history': [], 'GET /phase-notes': [] });
      const r = await run(['projects'], 'manage_project_journal', { project_id: 'p1', action: 'add_note', texte: 'x' });
      expect(r.response.error).toContain('Aucune phase en cours');
      expect(stubbed.mock.calls.some(c => String(c[0]).endsWith('/phase'))).toBe(false);
    });
  });

  it('ajoute une observation rattachée au lot et lève une autre', async () => {
    const m = stub({
      'GET /observations': [{ id: 'o1', number: 1, texte: 'Reprendre enduit', statut: 'À faire' }],
      'GET /lots': [{ id: 'l2', lot_number: '02', lot_title: 'PLATRERIE' }],
      'POST /observations': { id: 'o2', number: 2 },
      'PUT /api/observations/o1': { success: true },
    });
    const add = await run(['projects'], 'manage_observations', { project_id: 'p1', action: 'add', observations: [{ texte: 'Protéger le sol', lot: '02', urgence: 'urgent' }, { texte: 'reprendre enduit' }] });
    expect(add.response.ajoutees).toHaveLength(1);
    expect(add.response.doublons_ignores).toEqual(['reprendre enduit']);
    expect(sent(m, 'POST', '/observations')[0]).toMatchObject({ lot_id: 'l2', urgence: 'urgent', statut: 'À faire' });
    const upd = await run(['projects'], 'manage_observations', { project_id: 'p1', action: 'update', observations: [{ id: 'o1', statut: 'Levée' }] });
    expect(upd.response.modifiees).toHaveLength(1);
    expect(sent(m, 'PUT', '/api/observations/o1')).toEqual([{ statut: 'Levée' }]);
  });

  it("ajoute un participant de réunion par son nom et refuse un nom ambigu", async () => {
    const m = stub({
      'GET /attendees': [],
      'GET /api/contacts': [{ id: 'c1', first_name: 'Marie', last_name: 'Durand' }, { id: 'c2', company_name: 'DUPONT' }, { id: 'c3', company_name: 'DUPONT' }],
      'POST /attendees': { id: 'a1' },
    });
    const r = await run(['meetings'], 'manage_meeting_attendees', { meeting_id: 'm1', action: 'add', participants: [{ nom: 'Marie Durand', role: 'MOA' }, { nom: 'DUPONT' }] });
    expect(r.response.ajoutes).toHaveLength(1);
    expect(r.response.non_traites[0].candidats).toHaveLength(2);
    expect(sent(m, 'POST', '/attendees')).toEqual([{ contact_id: 'c1', role: 'MOA' }]);
  });
});

describe('ressources ajoutées à AGENT_RESOURCES', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('existent, avec champs obligatoires et vocabulaires', () => {
    for (const key of ['rfis', 'avenants_moe', 'gpa_reserves', 'time_entries', 'tender_pieces', 'tender_competitors', 'tender_partner_solicitations', 'tender_activity_notes']) {
      expect(AGENT_RESOURCES.find(r => r.key === key), key).toBeTruthy();
    }
  });

  it("une modification partielle de RFI renvoie l'enregistrement fusionné, rien n'est écrasé", async () => {
    const m = stub({
      'GET /api/rfis': [{ id: 'r1', project_id: 'p1', question: 'Q ?', asked_by: 'Dupont', due_date: '2026-11-01', status: 'en_attente', tenant_id: 't' }],
      'PUT /api/rfis/r1': { id: 'r1' },
    });
    await run(['rfis'], 'update_record', { resource: 'rfis', id: 'r1', data: { answer: 'Oui', status: 'repondu' } });
    expect(sent(m, 'PUT', '/api/rfis/r1')[0]).toEqual({ project_id: 'p1', question: 'Q ?', asked_by: 'Dupont', due_date: '2026-11-01', status: 'repondu', answer: 'Oui' });
  });

  it("les pièces d'un appel d'offres se lisent par parent_id", async () => {
    const m = stub({ 'GET /api/tender-pieces?tender_id=t1': [{ id: 'p1', label: 'DC1' }, { id: 'p2', label: 'DC2' }] });
    const sans = await run(['tender_pieces'], 'search_records', { resource: 'tender_pieces', query: 'dc' });
    expect(sans.response.error).toContain('parent_id');
    const avec = await run(['tender_pieces'], 'search_records', { resource: 'tender_pieces', query: 'dc1', parent_id: 't1' });
    expect(avec.response.matches).toEqual([{ id: 'p1', identity: 'DC1' }]);
    expect(m.mock.calls[0][0]).toContain('?tender_id=t1');
  });
});

describe('documents dans le chat des agents', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const docsCaps = () => capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['projects'], docs_read_enabled: true });

  it('list_documents et read_document exigent la lecture des pièces, sans doublon côté MCP', async () => {
    expect(buildAgentTools(docsCaps()).map(t => t.name)).toEqual(expect.arrayContaining(['list_documents', 'read_document']));
    expect(buildAgentTools(caps(['projects'])).map(t => t.name)).not.toContain('list_documents');
    const { MCP_TOOL_NAMES } = await import('../packages/archioffice-agents/src/server/mcp/tools');
    expect(MCP_TOOL_NAMES.filter(n => n === 'list_documents')).toHaveLength(1);
    const refused = await executeAgentAction('http://localhost', auth, caps(['projects']), { name: 'list_documents', args: { resource: 'projects', resource_id: 'p1' } });
    expect(refused.response.error).toContain("pas activée");
  });

  it("liste les pièces d'une fiche", async () => {
    stub({ 'GET /api/documents': [{ id: 'd1', name: 'CERFA.pdf', mime_type: 'application/pdf', category: 'CERFA', size_bytes: 10, uploaded_at: '2026-10-01' }] });
    const r = await executeAgentAction('http://localhost', auth, docsCaps(), { name: 'list_documents', args: { resource: 'projects', resource_id: 'p1' } });
    expect(r.response).toMatchObject({ count: 1, documents: [{ id: 'd1', file_name: 'CERFA.pdf' }] });
  });

  it("ne range un fichier généré que sur une fiche que l'agent peut modifier", async () => {
    const { attachArtifactToRecord } = await import('../packages/archioffice-agents/src/server/documentTools');
    const artifact = { filename: 'courrier.pdf', data: Buffer.from('%PDF-1.4').toString('base64'), mimeType: 'application/pdf' };
    const m = stub({ 'POST /api/documents': { id: 'd2', uploaded_at: '2026-10-12' } });
    const refused = await attachArtifactToRecord('http://localhost', auth, ['contacts'], artifact, { resource: 'projects', resource_id: 'p1' }, null);
    expect(refused.ok).toBe(false);
    expect(m.mock.calls).toHaveLength(0);
    const done = await attachArtifactToRecord('http://localhost', auth, ['projects'], artifact, { resource: 'projects', resource_id: 'p1', category: 'Courrier' }, '/projects/p1');
    expect(done.note).not.toContain('⚠️'); expect(done).toMatchObject({ ok: true });
    expect(done.note).toContain('[ouvrir la fiche](/projects/p1)');
    expect(m.mock.calls).toHaveLength(1);
  });
});

describe('modification partielle : les colonnes non fournies ne sont pas remises à zéro', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("une réunion dont on ne change que le titre garde ses notes", async () => {
    const m = stub({
      'GET /api/meetings': [{ id: 'm1', title: 'Ancien', date: '2026-10-20', notes: 'Notes importantes', project_id: 'p1', tenant_id: 't', created_at: 'x' }],
      'PUT /api/meetings/m1': { success: true },
    });
    await run(['meetings'], 'update_record', { resource: 'meetings', id: 'm1', data: { title: 'Nouveau' } });
    expect(sent(m, 'PUT', '/api/meetings/m1')[0]).toEqual({ title: 'Nouveau', date: '2026-10-20', notes: 'Notes importantes', project_id: 'p1' });
  });

  it("un appel d'offres dont on change le statut garde sa valeur, sa surface et son archivage", async () => {
    const m = stub({
      'GET /api/tenders': [{ id: 't1', title: 'AO', client: 'Ville', submission_deadline: '2026-12-01', status: 'Draft', value: 120000, surface: 800, archived: true, mandatory_visit: true }],
      'PUT /api/tenders/t1': { success: true },
    });
    await run(['tenders'], 'update_record', { resource: 'tenders', id: 't1', data: { status: 'Submitted' } });
    expect(sent(m, 'PUT', '/api/tenders/t1')[0]).toMatchObject({ status: 'Submitted', value: 120000, surface: 800, archived: true, mandatory_visit: true });
  });

  it('refuse de modifier un enregistrement introuvable plutôt que de tout écraser', async () => {
    stub({ 'GET /api/meetings': [] });
    const r = await run(['meetings'], 'update_record', { resource: 'meetings', id: 'absent', data: { title: 'x' } });
    expect(r.response.error).toContain('Aucun enregistrement');
  });
});
