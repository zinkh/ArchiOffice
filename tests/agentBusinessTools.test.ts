import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentTools, executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import { capabilitiesFromAgent } from '../packages/archioffice-agents/src/types';

const NO_CAPS = { action_scopes: [] as string[], web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false, geo_enabled: false, docs_read_enabled: false };
const auth = { authorization: 'Bearer x' };
const caps = (scopes: string[]) => capabilitiesFromAgent({ ...NO_CAPS, action_scopes: scopes });
type Handler = (url: string, method: string, body: any) => any;

const stub = (routes: Record<string, any | Handler>) => {
  const mock = vi.fn(async (url: string, init?: any) => {
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const key = Object.keys(routes).find(k => { const [m, ...p] = k.split(' '); return m === method && url.includes(p.join(' ')); });
    const r = key ? routes[key] : [];
    return { ok: true, status: 200, json: async () => (typeof r === 'function' ? r(url, method, body) : r) };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};
const sent = (m: ReturnType<typeof stub>, method: string, part: string) =>
  m.mock.calls.filter(c => (c[1]?.method || 'GET') === method && c[0].includes(part)).map(c => (typeof c[1]?.body === 'string' ? JSON.parse(c[1].body) : undefined));
const run = (scopes: string[], name: string, args: any) => executeAgentAction('http://localhost', auth, caps(scopes), { name, args }) as Promise<{ response: any }>;

describe('outils métier : situations, notices, consultation, facture, agenda', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sont proposés selon le périmètre', () => {
    const names = (s: string[]) => buildAgentTools(caps(s)).map(t => t.name);
    expect(names(['marches_entreprises'])).toContain('manage_situations');
    expect(names(['projects'])).toEqual(expect.arrayContaining(['manage_project_notices', 'manage_consultation']));
    expect(names(['invoices'])).toContain('create_invoice_from_note');
    expect(names(['meetings'])).toContain('manage_calendar');
    expect(names(['contacts'])).not.toEqual(expect.arrayContaining(['manage_situations']));
  });

  describe('situations', () => {
    const marches = [{ id: 'mk1', entreprise_nom: 'SARL Martin', lot_numero: '02', lot_titre: 'GROS OEUVRE', montant_ht: 100000 }];
    const situations = [{ id: 's1', marche_id: 'mk1', numero_situation: 1, etat: 'Validée', montant_presente_ht: 30000, montant_admis_ht: 28000, mode_saisie: 'simple' }];

    it('liste le cumul admis et la période', async () => {
      stub({ 'GET /api/marches-entreprises/p1': marches, 'GET /api/situations/p1': [...situations, { id: 's2', marche_id: 'mk1', numero_situation: 2, etat: 'Brouillon', montant_presente_ht: 50000 }] });
      const r = await run(['marches_entreprises'], 'manage_situations', { project_id: 'p1', action: 'list' });
      const rows = r.response.marches[0].situations;
      expect(rows[0]).toMatchObject({ cumul_admis_ht: 28000, periode_ht: 28000, etat: 'Certificat établi' });
      expect(rows[1]).toMatchObject({ cumul_admis_ht: 50000, periode_ht: 22000 });
    });

    it('ajoute une situation par le nom de l\'entreprise et refuse un cumul qui recule', async () => {
      const m = stub({ 'GET /api/marches-entreprises/p1': marches, 'GET /api/situations/p1': situations, 'POST /api/situations': { id: 's2', numero_situation: 2 } });
      const low = await run(['marches_entreprises'], 'manage_situations', { project_id: 'p1', action: 'add', marche: 'sarl martin', montant_presente_ht: 20000 });
      expect(low.response.error).toContain('inférieur');
      const ok = await run(['marches_entreprises'], 'manage_situations', { project_id: 'p1', action: 'add', marche: 'sarl martin', montant_presente_ht: '45 000,50', reference_entreprise: 'SIT-2' });
      expect(ok.response.success).toBe(true);
      expect(sent(m, 'POST', '/api/situations')).toEqual([{ project_id: 'p1', marche_id: 'mk1', montant_presente_ht: 45000.5, reference_entreprise: 'SIT-2' }]);
    });

    it('verrouille une situation certifiée, la certifie et la rouvre en deux temps', async () => {
      const m = stub({ 'GET /api/marches-entreprises/p1': marches, 'GET /api/situations/p1': [situations[0], { id: 's2', marche_id: 'mk1', numero_situation: 2, etat: 'Brouillon', montant_presente_ht: 50000 }], 'PUT /api/situations/': { id: 'x' } });
      const locked = await run(['marches_entreprises'], 'manage_situations', { project_id: 'p1', action: 'update', id: 's1', montant_admis_ht: 1 });
      expect(locked.response.error).toContain('verrouillés');
      const cert = await run(['marches_entreprises'], 'manage_situations', { project_id: 'p1', action: 'certify', marche: 'SARL Martin', numero: 2, date_certificat: '2026-10-12' });
      expect(cert.response.success).toBe(true);
      expect(sent(m, 'PUT', '/api/situations/s2')).toEqual([{ etat: 'Validée', date_certificat: '2026-10-12' }]);
      const first = await run(['marches_entreprises'], 'manage_situations', { project_id: 'p1', action: 'reopen', id: 's1' });
      expect(first.response.needs_confirmation).toBe(true);
      await run(['marches_entreprises'], 'manage_situations', { project_id: 'p1', action: 'reopen', id: 's1', confirm: true });
      expect(sent(m, 'PUT', '/api/situations/s1')).toEqual([{ etat: 'Brouillon', date_certificat: null }]);
    });

    it('ne calcule ni n\'émet de certificat de paiement', () => {
      const t = buildAgentTools(caps(['marches_entreprises'])).find(x => x.name === 'manage_situations')!;
      expect(t.description).toContain('ne les calcule pas');
    });
  });

  describe('notices', () => {
    it('lit puis remplace une notice seulement après confirmation', async () => {
      const m = stub({
        'GET /notices': [{ kind: 'security', phase: 'PC', status: 'redige', content: 'Ancien', instructions: '' }],
        'PUT /notices/security/PC': (_u: string, _m: string, b: any) => ({ kind: 'security', phase: 'PC', status: 'redige', content: b.content }),
      });
      const read = await run(['projects'], 'manage_project_notices', { project_id: 'p1', action: 'read', kind: 'security', phase: 'PC' });
      expect(read.response.contenu).toBe('Ancien');
      expect(read.response.note).toContain('à vérifier');
      const first = await run(['projects'], 'manage_project_notices', { project_id: 'p1', action: 'write', kind: 'security', phase: 'PC', content: 'Nouveau' });
      expect(first.response.needs_confirmation).toBe(true);
      expect(m.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(false);
      await run(['projects'], 'manage_project_notices', { project_id: 'p1', action: 'write', kind: 'security', phase: 'PC', content: 'Nouveau', confirm: true });
      expect(sent(m, 'PUT', '/notices/security/PC')[0]).toMatchObject({ content: 'Nouveau' });
    });

    it('valide le type et la phase', async () => {
      stub({ 'GET /notices': [] });
      expect((await run(['projects'], 'manage_project_notices', { project_id: 'p1', action: 'read', kind: 'x', phase: 'PC' })).response.error).toContain('kind');
      expect((await run(['projects'], 'manage_project_notices', { project_id: 'p1', action: 'read', kind: 'security', phase: 'ZZ' })).response.error).toContain('phase');
    });
  });

  describe('consultation ACT', () => {
    const lots = [{ id: 'l1', lot_number: '01', lot_title: 'GO' }, { id: 'l2', lot_number: '02', lot_title: 'CHARPENTE' }];
    const act = { consultation: { entreprises: [{ id: 'e1', nom: 'Dupont SARL', contact_id: 'c1', lots_ids: ['l1'], envoyer_dce: true }], offres: [{ id: 'o1' }] } };

    it('ajoute une entreprise, complète les lots d\'une déjà consultée et garde le reste de la consultation', async () => {
      const m = stub({
        'GET /api/projects/p1/act': act, 'GET /api/projects/p1/lots': lots,
        'GET /api/contacts': [{ id: 'c1', company_name: 'Dupont SARL' }, { id: 'c2', company_name: 'Martin Charpente', email: 'm@x.fr' }],
        'PUT /api/projects/p1/act': { id: 'a' },
      });
      const r = await run(['projects'], 'manage_consultation', { project_id: 'p1', action: 'add', entreprises: [{ nom: 'Martin Charpente', lots: ['02'] }, { contact_id: 'c1', lots: ['02'] }] });
      expect(r.response.ajoutees).toHaveLength(2);
      const [put] = sent(m, 'PUT', '/act');
      expect(put.consultation.offres).toEqual([{ id: 'o1' }]);
      expect(put.consultation.entreprises[0].lots_ids).toEqual(['l1', 'l2']);
      expect(put.consultation.entreprises[1]).toMatchObject({ nom: 'Martin Charpente', contact_id: 'c2', lots_ids: ['l2'], envoyer_dce: true });
      expect(r.response.couverture_par_lot.every((c: any) => c.a_etoffer)).toBe(true);
    });

    it('enregistre une relance et déduit le statut, refuse un lot inconnu', async () => {
      const m = stub({ 'GET /api/projects/p1/act': act, 'GET /api/projects/p1/lots': lots, 'PUT /api/projects/p1/act': { id: 'a' } });
      const bad = await run(['projects'], 'manage_consultation', { project_id: 'p1', action: 'update', entreprises: [{ entreprise: 'Dupont SARL', lots: ['99'] }] });
      expect(bad.response.error).toBeDefined();
      const r = await run(['projects'], 'manage_consultation', { project_id: 'p1', action: 'update', entreprises: [{ entreprise: 'dupont sarl', dce_transmis_le: '2026-10-01', relance_le: '2026-10-05' }] });
      expect(r.response.entreprises[0].statut).toBe('À relancer');
      expect(sent(m, 'PUT', '/act')[0].consultation.entreprises[0]).toMatchObject({ dce_transmis_le: '2026-10-01', relance_le: '2026-10-05' });
    });

    it('retire en deux temps', async () => {
      const m = stub({ 'GET /api/projects/p1/act': act, 'GET /api/projects/p1/lots': lots, 'PUT /api/projects/p1/act': { id: 'a' } });
      const first = await run(['projects'], 'manage_consultation', { project_id: 'p1', action: 'remove', entreprises: [{ entreprise: 'Dupont SARL' }] });
      expect(first.response.needs_confirmation).toBe(true);
      expect(m.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(false);
      await run(['projects'], 'manage_consultation', { project_id: 'p1', action: 'remove', entreprises: [{ entreprise: 'Dupont SARL' }], confirm: true });
      expect(sent(m, 'PUT', '/act')[0].consultation.entreprises).toEqual([]);
    });
  });

  describe('facturation', () => {
    const note = { id: 'n1', numero: 'NH-1', objet: 'ESQ', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 };

    it("présente les montants avant de générer la facture d'une note", async () => {
      const m = stub({ 'GET /api/notes_honoraires': [note], 'POST /api/notes_honoraires/n1/facture': { invoice: { id: 'i1', invoice_number: 'FAC-1', status: 'Draft', amount: 1000, total_amount: 1200 } } });
      const first = await run(['invoices'], 'create_invoice_from_note', { note_id: 'n1' });
      expect(first.response.needs_confirmation).toBe(true);
      expect(first.response.concerne).toMatchObject({ montant_ht: 1000, montant_ttc: 1200 });
      expect(m.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
      const done = await run(['invoices'], 'create_invoice_from_note', { note_id: 'n1', confirm: true });
      expect(done.response.invoice).toMatchObject({ id: 'i1', statut: 'Draft' });
    });

    it('rend la facture existante sans redemander de confirmation', async () => {
      stub({ 'GET /api/notes_honoraires': [{ ...note, invoice_id: 'i1' }], 'POST /api/notes_honoraires/n1/facture': { invoice: { id: 'i1', status: 'Sent' }, already_existed: true } });
      const r = await run(['invoices'], 'create_invoice_from_note', { note_id: 'n1' });
      expect(r.response.already_existed).toBe(true);
    });

    it("la ressource factures accepte les lignes et ignore un numéro de facture", async () => {
      const m = stub({ 'GET /api/invoices': [], 'POST /api/invoices': { id: 'i2' } });
      const r = await run(['invoices'], 'create_record', { resource: 'invoices', data: { project_id: 'p1', items: [{ description: 'Honoraires', quantity: 1, unit_price: 1000, vat_rate: 20 }], invoice_number: 'FAC-999' } });
      expect(r.response.champs_ignores).toEqual(['invoice_number']);
      expect(sent(m, 'POST', '/api/invoices')[0].items).toHaveLength(1);
    });
  });

  describe('agenda', () => {
    it("agrège Google, réunions, jalons et tâches de la période", async () => {
      stub({
        'GET /api/google-calendar/events': [{ id: 'google-c-e1', title: 'Visite', date: '2026-10-14', start: '2026-10-14T09:00:00+02:00' }],
        'GET /api/meetings': [{ id: 'm1', title: 'Réunion', date: '2026-10-13', project_id: 'p1' }, { id: 'm2', title: 'Hors période', date: '2026-12-01' }],
        'GET /api/milestones': [{ id: 'j1', title: 'Dépôt PC', due_date: '2026-10-15', completed: false }, { id: 'j2', title: 'Fait', due_date: '2026-10-15', completed: true }],
        'GET /api/tasks': [{ id: 't1', title: 'Relancer', due_date: '2026-10-12', status: 'todo' }, { id: 't2', title: 'Finie', due_date: '2026-10-12', status: 'done' }],
      });
      const r = await run(['meetings'], 'manage_calendar', { action: 'agenda', start: '2026-10-12', end: '2026-10-16' });
      expect(r.response.evenements.map((e: any) => e.titre)).toEqual(['Relancer', 'Réunion', 'Visite', 'Dépôt PC']);
      expect(r.response.periode).toEqual({ start: '2026-10-12', end: '2026-10-16' });
      expect((await run(['meetings'], 'manage_calendar', { action: 'agenda', start: '2026-01-01', end: '2026-12-31' })).response.error).toContain('92');
    });

    it('crée, déplace et supprime (en deux temps) un événement Google', async () => {
      const m = stub({ 'POST /api/google-calendar/events': { id: 'google-c-e9', title: 'RDV', link: 'https://g/e9' }, 'PATCH /api/google-calendar/events/': { success: true }, 'DELETE /api/google-calendar/events/': { success: true } });
      const c = await run(['meetings'], 'manage_calendar', { action: 'create_event', title: 'RDV', date: '2026-10-20', start_time: '10:00' });
      expect(c.response.id).toBe('google-c-e9');
      expect(sent(m, 'POST', '/api/google-calendar/events')[0]).toMatchObject({ title: 'RDV', date: '2026-10-20', start_time: '10:00' });
      await run(['meetings'], 'manage_calendar', { action: 'update_event', id: 'google-c-e9', date: '2026-10-21' });
      expect(m.mock.calls.some(c2 => c2[1]?.method === 'PATCH')).toBe(true);
      const first = await run(['meetings'], 'manage_calendar', { action: 'delete_event', id: 'google-c-e9' });
      expect(first.response.needs_confirmation).toBe(true);
      expect(m.mock.calls.some(c2 => c2[1]?.method === 'DELETE')).toBe(false);
      await run(['meetings'], 'manage_calendar', { action: 'delete_event', id: 'google-c-e9', confirm: true });
      expect(m.mock.calls.some(c2 => c2[1]?.method === 'DELETE')).toBe(true);
      expect((await run(['meetings'], 'manage_calendar', { action: 'update_event', id: 'meeting-1', title: 'x' })).response.error).toContain('google-');
    });
  });
});
