// Partage d'une affaire avec un confrère : ateliers de suivi (comptes rendus de chantier, réserves AOR, réserves GPA, ACT).
//
// Quatre ateliers, `reports`, `reserves`, `gpa` et `act`, chacun avec un droit d'atelier (jamais par lot) : lecture,
// et « écriture » là où elle est branchée : directe pour les comptes rendus et les réserves, PAR PROPOSITION pour l'ACT
// (server/routes/projectShareActProposals.ts). Ce fichier ne porte que la lecture de l'ACT. Contrairement au
// CCTP et au DPGF (un seul document JSON que l'éditeur réécrit en bloc, d'où l'écriture par proposition),
// chaque ligne ici est un enregistrement indépendant : « écrire » modifie DIRECTEMENT, mais seulement
// une liste blanche de champs de la ligne visée, et laisse une trace dans le journal d'activité.
//
// Règles communes à toutes les routes (voir server/projectShares/access.ts) :
//  - le partage actif et le droit sont revérifiés à chaque requête, l'affaire non partagée répond 404 ;
//  - une réponse est construite champ par champ (liste blanche) : une colonne ajoutée demain à `site_reports`
//    (présences, pénalités, intervenants), `reserves` (plan, photos) ou aux notes ne fuit jamais vers un tiers ;
//  - la ligne visée doit appartenir à CETTE affaire et à CE cabinet : celle d'une autre affaire est introuvable ;
//  - jamais d'écriture sur une affaire archivée (409 PROJECT_ARCHIVED) ;
//  - le corps de la requête ne choisit ni `tenant_id`, ni `project_id`, ni `report_id`.
import type { Express } from 'express';
import { dispatchWebhookEvent } from '../webhookDispatch';
import { isMissingReponseColumn, normalizeReponse } from '../reservePhotos';
import { activeShareFor, allows, type ShareKind, type ShareRow } from '../projectShares/access';
import { guestActView } from '../projectShares/actView';
import { isProjectArchived } from './projectArchive';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => any;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 5000;
const SHORT_MAX = 200;

/** Ce qu'un confrère lit d'un compte rendu : ni présences, ni suivi des lots (pénalités), ni intervenants, ni décisions. */
const REPORT_FIELDS = ['id', 'report_number', 'date', 'statut', 'meteo', 'temperature', 'effectif_total'] as const;
/** Une rubrique : jamais `photos` (stockage privé), ni les colonnes historiques inutilisées. */
const NOTE_FIELDS = ['id', 'category', 'note_number', 'responsible_company', 'issue_date', 'due_date', 'realization_date', 'status', 'text'] as const;
/** Une réserve : jamais la position sur le plan, ni les photos (stockage privé), ni la nature des cerfas d'OPR. */
const RESERVE_FIELDS = ['id', 'number', 'title', 'batiment', 'local', 'status', 'lots', 'entreprises', 'created_at', 'due_date', 'description', 'reponse'] as const;

/** Même vocabulaire que le suivi des réserves du cabinet (src/components/pro/reserveShared.tsx). */
export const RESERVE_STATUSES = [
  'A faire', 'En cours', 'Levée', "Refusée par l'entreprise", 'Quitus Transmis', 'Levée refusée par le MOE', 'Pour mémoire',
] as const;
const CLOSED_RESERVE_STATUSES = ['Levée', 'Quitus Transmis'];
const NOTE_STATUSES = ['open', 'done', 'A FAIRE', 'EN COURS', 'LEVÉE', 'URGENT'];

function pick(row: any, keys: readonly string[]): Record<string, any> {
  return Object.fromEntries(keys.map(k => [k, row?.[k] ?? null]));
}

const reportView = (row: any) => ({ ...pick(row, REPORT_FIELDS), meetingNotes: row?.meetingnotes ?? null, nextMeeting: row?.nextmeeting ?? null });

/** Chaîne bornée, ou `null` pour effacer ; undefined = champ absent de la requête. */
function readText(body: any, key: string, max: number): { value?: string | null } | { error: string } {
  if (body?.[key] === undefined) return {};
  const v = body[key];
  if (v === null) return { value: null };
  if (typeof v !== 'string' || v.length > max) return { error: `${key} invalide (${max} caractères au plus).` };
  return { value: v.trim() || null };
}

function readDate(body: any, key: string): { value?: string | null } | { error: string } {
  if (body?.[key] === undefined) return {};
  const v = body[key];
  if (v === null || v === '') return { value: null };
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return { error: `${key} doit être au format AAAA-MM-JJ.` };
  return { value: v };
}

/** Champs d'une rubrique de compte rendu qu'un confrère peut écrire, validés. */
export function readNoteFields(body: any, mode: 'create' | 'update'): { fields: Record<string, any> } | { error: string } {
  const fields: Record<string, any> = {};
  for (const [key, max] of [['text', TEXT_MAX], ['responsible_company', SHORT_MAX], ['category', 120]] as const) {
    const r = readText(body, key, max);
    if ('error' in r) return r;
    if (r.value !== undefined) fields[key] = r.value;
  }
  for (const key of ['due_date', 'realization_date'] as const) {
    const r = readDate(body, key);
    if ('error' in r) return r;
    if (r.value !== undefined) fields[key] = r.value;
  }
  if (body?.status !== undefined) {
    if (!NOTE_STATUSES.includes(body.status)) return { error: 'Statut inconnu.' };
    fields.status = body.status;
  }
  if (mode === 'create' && !fields.category) return { error: 'La rubrique est obligatoire.' };
  // Renommer une rubrique est un geste du cabinet : une rubrique existante garde son nom.
  if (mode === 'update') delete fields.category;
  return { fields };
}

/** Champs d'en-tête d'un compte rendu qu'un confrère peut écrire. */
export function readReportFields(body: any): { fields: Record<string, any> } | { error: string } {
  const fields: Record<string, any> = {};
  // Colonnes historiques : `meetingnotes` et `nextmeeting` sont en minuscules dans la base (voir PUT /api/reports/:id).
  for (const [key, column, max] of [['meetingNotes', 'meetingnotes', TEXT_MAX], ['nextMeeting', 'nextmeeting', SHORT_MAX], ['meteo', 'meteo', 60], ['temperature', 'temperature', 30]] as const) {
    const r = readText(body, key, max);
    if ('error' in r) return r;
    if (r.value !== undefined) fields[column] = r.value;
  }
  return { fields };
}

/** Champs d'une réserve qu'un confrère peut écrire : le suivi, jamais l'identité de la réserve (intitulé, lot, plan). */
export function readReserveFields(body: any): { fields: Record<string, any> } | { error: string } {
  const fields: Record<string, any> = {};
  if (body?.status !== undefined) {
    if (!(RESERVE_STATUSES as readonly string[]).includes(body.status)) return { error: 'Statut inconnu.' };
    fields.status = body.status;
  }
  const description = readText(body, 'description', TEXT_MAX);
  if ('error' in description) return description;
  if (description.value !== undefined) fields.description = description.value;
  if (body?.reponse !== undefined) {
    if (body.reponse !== null && typeof body.reponse !== 'string') return { error: 'reponse invalide.' };
    fields.reponse = normalizeReponse(body.reponse);
  }
  const due = readDate(body, 'due_date');
  if ('error' in due) return due;
  if (due.value !== undefined) fields.due_date = due.value;
  return { fields };
}

export function registerProjectShareChantierRoutes(app: Express, { supabaseAdmin, getUserName, logActivity }: RouteDeps) {
  const fail = (res: any, label: string, e: any) => {
    console.error(label, e);
    return res.status(500).json({ error: 'Opération impossible, réessayez.' });
  };

  /** Le partage actif de l'appelant, avec le droit demandé sur `kind`, sinon la réponse d'erreur est envoyée et on rend null. */
  async function guard(req: any, res: any, kind: ShareKind, access: 'read' | 'write'): Promise<ShareRow | null> {
    const found = await activeShareFor(supabaseAdmin, req.user.id, req.params.id);
    // 404 et non 403 : on ne révèle pas l'existence d'une affaire non partagée.
    if (!found) { res.status(404).json({ error: 'Affaire introuvable ou non partagée avec vous.' }); return null; }
    if (!allows(found.grants, kind, access)) {
      res.status(403).json({
        error: access === 'write' ? 'Vous n\'avez pas le droit de modifier ce suivi de chantier.' : 'Ce suivi de chantier n\'est pas partagé avec vous.',
        code: 'SHARE_FORBIDDEN',
      });
      return null;
    }
    if (access === 'write' && await isProjectArchived(supabaseAdmin, found.share.tenant_id, found.share.project_id)) {
      res.status(409).json({ error: 'Affaire archivée : lecture seule.', code: 'PROJECT_ARCHIVED' });
      return null;
    }
    return found.share;
  }

  const audit = async (share: ShareRow, req: any, action: string, target: string, id: string, type: string, category: string) => {
    const userName = await getUserName(share.tenant_id, req.user.id, req.user.email);
    logActivity(share.tenant_id, req.user.id, userName, `${action} (confrère externe)`, target, id, type, category);
  };

  // ─── Comptes rendus de chantier ──────────────────────────────────────────────

  async function ownReport(share: ShareRow, reportId: string): Promise<any | null> {
    const { data } = await supabaseAdmin.from('site_reports').select('*')
      .eq('id', reportId).eq('project_id', share.project_id).eq('tenant_id', share.tenant_id).maybeSingle();
    return data ?? null;
  }

  /** Un compte rendu diffusé est parti chez les entreprises : il ne se réécrit plus depuis l'extérieur. */
  const locked = (report: any) => report?.statut === 'diffuse';
  const LOCKED = { error: 'Ce compte rendu a été diffusé : il n\'est plus modifiable.', code: 'REPORT_LOCKED' };

  app.get('/api/shared/projects/:id/reports', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'reports', 'read');
      if (!share) return;
      const { data, error } = await supabaseAdmin.from('site_reports').select('*')
        .eq('project_id', share.project_id).eq('tenant_id', share.tenant_id);
      if (error) throw error;
      res.json((data || []).map(reportView).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date))));
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/reports]', e); }
  });

  app.get('/api/shared/projects/:id/reports/:reportId/notes', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'reports', 'read');
      if (!share) return;
      if (!(await ownReport(share, req.params.reportId))) return res.status(404).json({ error: 'Compte rendu introuvable.' });
      const { data, error } = await supabaseAdmin.from('site_report_notes').select('*')
        .eq('report_id', req.params.reportId).eq('tenant_id', share.tenant_id);
      if (error) throw error;
      res.json((data || []).map((n: any) => pick(n, NOTE_FIELDS)).sort((a: any, b: any) => Number(a.note_number) - Number(b.note_number)));
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/reports/:reportId/notes]', e); }
  });

  app.put('/api/shared/projects/:id/reports/:reportId', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'reports', 'write');
      if (!share) return;
      const parsed = readReportFields(req.body);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      if (!Object.keys(parsed.fields).length) return res.status(400).json({ error: 'Aucune modification.' });
      const report = await ownReport(share, req.params.reportId);
      if (!report) return res.status(404).json({ error: 'Compte rendu introuvable.' });
      if (locked(report)) return res.status(409).json(LOCKED);
      const { data, error } = await supabaseAdmin.from('site_reports').update(parsed.fields)
        .eq('id', report.id).eq('tenant_id', share.tenant_id).select('*').single();
      if (error) throw error;
      await audit(share, req, `Modification du compte-rendu de chantier N° ${report.report_number}`, String(report.report_number), report.id, 'site_report', 'Notes de site');
      res.json(reportView(data));
    } catch (e: any) { fail(res, '[PUT /api/shared/projects/:id/reports/:reportId]', e); }
  });

  app.post('/api/shared/projects/:id/reports/:reportId/notes', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'reports', 'write');
      if (!share) return;
      const parsed = readNoteFields(req.body, 'create');
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      const report = await ownReport(share, req.params.reportId);
      if (!report) return res.status(404).json({ error: 'Compte rendu introuvable.' });
      if (locked(report)) return res.status(409).json(LOCKED);
      const { data: siblings } = await supabaseAdmin.from('site_report_notes').select('note_number')
        .eq('report_id', report.id).eq('tenant_id', share.tenant_id);
      const noteNumber = Math.max(0, ...(siblings || []).map((n: any) => Number(n.note_number) || 0)) + 1;
      const id = crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('site_report_notes').insert({
        id, tenant_id: share.tenant_id, report_id: report.id, note_number: noteNumber,
        issue_date: report.date, status: 'open', ...parsed.fields,
      }).select('*').single();
      if (error) throw error;
      await audit(share, req, `Ajout de la note de chantier N° ${noteNumber}`, parsed.fields.category || '', id, 'site_report_note', 'Notes de site');
      res.status(201).json(pick(data, NOTE_FIELDS));
    } catch (e: any) { fail(res, '[POST /api/shared/projects/:id/reports/:reportId/notes]', e); }
  });

  app.put('/api/shared/projects/:id/reports/:reportId/notes/:noteId', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'reports', 'write');
      if (!share) return;
      const parsed = readNoteFields(req.body, 'update');
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      if (!Object.keys(parsed.fields).length) return res.status(400).json({ error: 'Aucune modification.' });
      const report = await ownReport(share, req.params.reportId);
      if (!report) return res.status(404).json({ error: 'Compte rendu introuvable.' });
      if (locked(report)) return res.status(409).json(LOCKED);
      const { data: note } = await supabaseAdmin.from('site_report_notes').select('id, note_number')
        .eq('id', req.params.noteId).eq('report_id', report.id).eq('tenant_id', share.tenant_id).maybeSingle();
      if (!note) return res.status(404).json({ error: 'Note introuvable.' });
      const { data, error } = await supabaseAdmin.from('site_report_notes').update(parsed.fields)
        .eq('id', note.id).eq('tenant_id', share.tenant_id).select('*').single();
      if (error) throw error;
      await audit(share, req, `Modification de la note de chantier N° ${note.note_number}`, String(note.note_number), note.id, 'site_report_note', 'Notes de site');
      res.json(pick(data, NOTE_FIELDS));
    } catch (e: any) { fail(res, '[PUT /api/shared/projects/:id/reports/:reportId/notes/:noteId]', e); }
  });

  // ─── ACT : consultation, offres, marchés (lecture seule) ────────────────────────

  app.get('/api/shared/projects/:id/act', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'act', 'read');
      if (!share) return;
      const [{ data: row }, { data: marches }] = await Promise.all([
        supabaseAdmin.from('act_data').select('*').eq('project_id', share.project_id).eq('tenant_id', share.tenant_id).maybeSingle(),
        supabaseAdmin.from('marches_entreprises').select('*').eq('project_id', share.project_id).eq('tenant_id', share.tenant_id),
      ]);
      res.json(guestActView(row ?? null, marches || []));
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/act]', e); }
  });

  // ─── Réserves AOR (`reserves`) et GPA (`gpa_reserves`) ────────────────────────

  const RESERVE_SETS: Array<{ path: string; table: string; kind: ShareKind; label: string; type: string; category: string }> = [
    { path: 'reserves', table: 'reserves', kind: 'reserves', label: 'la réserve', type: 'reserve', category: 'Réserves/Observations' },
    { path: 'gpa-reserves', table: 'gpa_reserves', kind: 'gpa', label: 'la réserve GPA', type: 'gpa_reserve', category: 'Réserves GPA' },
  ];

  for (const set of RESERVE_SETS) {
    app.get(`/api/shared/projects/:id/${set.path}`, async (req: any, res: any) => {
      try {
        const share = await guard(req, res, set.kind, 'read');
        if (!share) return;
        const { data, error } = await supabaseAdmin.from(set.table).select('*')
          .eq('project_id', share.project_id).eq('tenant_id', share.tenant_id);
        if (error) {
          if ((error as any).code === '42P01') return res.json([]); // table absente : instance non migrée
          throw error;
        }
        res.json((data || []).map((r: any) => pick(r, RESERVE_FIELDS)).sort((a: any, b: any) => Number(a.number) - Number(b.number)));
      } catch (e: any) { fail(res, `[GET /api/shared/projects/:id/${set.path}]`, e); }
    });

    app.put(`/api/shared/projects/:id/${set.path}/:reserveId`, async (req: any, res: any) => {
      try {
        const share = await guard(req, res, set.kind, 'write');
        if (!share) return;
        const parsed = readReserveFields(req.body);
        if ('error' in parsed) return res.status(400).json({ error: parsed.error });
        if (!Object.keys(parsed.fields).length) return res.status(400).json({ error: 'Aucune modification.' });
        // La réserve doit appartenir à CETTE affaire partagée : celle d'une autre affaire du cabinet est introuvable.
        const { data: reserve } = await supabaseAdmin.from(set.table).select('id, number, title, status')
          .eq('id', req.params.reserveId).eq('project_id', share.project_id).eq('tenant_id', share.tenant_id).maybeSingle();
        if (!reserve) return res.status(404).json({ error: 'Réserve introuvable.' });
        const { data, error } = await supabaseAdmin.from(set.table).update(parsed.fields)
          .eq('id', reserve.id).eq('tenant_id', share.tenant_id).select('*').single();
        if (isMissingReponseColumn(error)) return res.status(503).json({ error: 'Le suivi des réserves n\'est pas disponible : migration à appliquer.' });
        if (error) throw error;
        await audit(share, req, `Modification de ${set.label} N° ${reserve.number} "${reserve.title || ''}"`, reserve.title || '', reserve.id, set.type, set.category);
        // Comme le PUT du cabinet : lever une réserve d'OPR prévient les webhooks du cabinet.
        const status = parsed.fields.status;
        if (set.kind === 'reserves' && status && CLOSED_RESERVE_STATUSES.includes(status) && !CLOSED_RESERVE_STATUSES.includes(reserve.status)) {
          dispatchWebhookEvent(supabaseAdmin, share.tenant_id, 'reserve.resolved', {
            id: reserve.id, title: reserve.title, status, project_id: share.project_id, number: reserve.number ?? null,
          });
        }
        res.json(pick(data, RESERVE_FIELDS));
      } catch (e: any) { fail(res, `[PUT /api/shared/projects/:id/${set.path}/:reserveId]`, e); }
    });
  }
}
