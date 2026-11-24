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
import { activeShareFor, allows, allowsDetail, type ShareKind, type ShareRow } from '../projectShares/access';
import { guestActView } from '../projectShares/actView';
import { guestAttendance, guestLotTracking } from '../projectShares/reportDetailView';
import { linkForTenantFile } from '../projectShares/fileAccess';
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
/** Une réserve : jamais les photos (stockage privé), ni la nature des cerfas d'OPR ; la position sur le plan seulement avec le détail. */
const RESERVE_FIELDS = ['id', 'number', 'title', 'batiment', 'local', 'status', 'lots', 'entreprises', 'created_at', 'due_date', 'description', 'reponse'] as const;
const RESERVE_DETAIL_FIELDS = [...RESERVE_FIELDS, 'plan_id', 'x', 'y'] as const;
/** Les plans du cabinet visibles pour placer un repère : ceux de l'AOR, comme le suivi des réserves du cabinet. */
const planIsAor = (p: any) => !p?.category || p.category === 'AOR';
/** Jamais l'adresse du fichier : seulement de quoi choisir le plan et savoir s'il se lit comme un PDF ou comme une image. */
const planView = (p: any) => ({ id: p.id, name: p.name ?? '', pdf: /\.pdf(\?|$)/i.test(String(p.file_url ?? '')) });

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

/** Les champs de position sur le plan : ils ne s'écrivent qu'avec le détail accordé (le plan n'est lisible qu'avec lui). */
const POSITION_KEYS = ['plan_id', 'x', 'y'] as const;
export const hasPositionKeys = (body: any) => POSITION_KEYS.some(k => body?.[k] !== undefined);

/**
 * Champs d'une réserve qu'un confrère peut écrire : le suivi, l'intitulé (issue #687) et, avec le détail, la position
 * sur le plan. Jamais le lot, les entreprises ni les bâtiments : ils restent au cabinet.
 */
export function readReserveFields(body: any, options: { detail?: boolean } = {}): { fields: Record<string, any> } | { error: string } {
  const fields: Record<string, any> = {};
  if (body?.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > SHORT_MAX) return { error: `title invalide (1 à ${SHORT_MAX} caractères).` };
    fields.title = body.title.trim();
  }
  if (hasPositionKeys(body)) {
    if (!options.detail) return { error: 'La position sur le plan n\'est pas modifiable sans le détail du suivi.' };
    if (body.plan_id === null) {
      // Retirer le repère : plan et coordonnées s'effacent ensemble.
      Object.assign(fields, { plan_id: null, x: null, y: null });
    } else {
      const inPlan = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
      if (typeof body.plan_id !== 'string' || !body.plan_id || body.plan_id.length > 100 || !inPlan(body.x) || !inPlan(body.y)) {
        return { error: 'Position invalide : plan_id, x et y (0 à 100 %) sont attendus ensemble.' };
      }
      Object.assign(fields, { plan_id: body.plan_id, x: body.x, y: body.y });
    }
  }
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

  /**
   * Le partage actif de l'appelant, avec le droit demandé sur `kind`, sinon la réponse d'erreur est envoyée et on rend null.
   * `detail: true` exige en plus le DÉTAIL de l'atelier (issue #688) ; sans lui, `req.shareDetail` dit si le cabinet l'a accordé,
   * pour que la route ajoute (ou non) les champs de détail à sa vue.
   */
  async function guard(req: any, res: any, kind: ShareKind, access: 'read' | 'write', options: { detail?: boolean } = {}): Promise<ShareRow | null> {
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
    req.shareDetail = allowsDetail(found.grants, kind);
    if (options.detail && !req.shareDetail) {
      res.status(403).json({ error: 'Le détail de ce suivi n\'est pas partagé avec vous.', code: 'SHARE_DETAIL_FORBIDDEN' });
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

  /**
   * Trace la consultation de données personnelles (coordonnées, RGPD) dans le journal d'activité, au plus une fois par
   * demi-heure et par personne, affaire et type : un écran qui se recharge ne remplit pas le journal. En mémoire du
   * processus, au mieux (comme `alertLimitReached` des propositions).
   */
  const TRACE_WINDOW_MS = 30 * 60 * 1000;
  const lastTrace = new Map<string, number>();
  const auditConsultation = async (share: ShareRow, req: any, action: string, target: string, type: string, category: string) => {
    const key = `${req.user.id}|${share.project_id}|${type}`;
    const now = Date.now();
    if (now - (lastTrace.get(key) ?? 0) < TRACE_WINDOW_MS) return;
    lastTrace.set(key, now);
    if (lastTrace.size > 1000) for (const [k, at] of lastTrace) if (now - at > TRACE_WINDOW_MS) lastTrace.delete(k);
    await audit(share, req, action, target, share.project_id, type, category);
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
      // Détail accordé par le cabinet : présences et suivi par lot (pénalités comprises). Les lots ne sont nommés que par
      // numéro et intitulé, jamais par leur entreprise.
      let labels = new Map<string, string>();
      if (req.shareDetail) {
        const { data: lots } = await supabaseAdmin.from('project_lots').select('id, lot_number, lot_title')
          .eq('project_id', share.project_id).eq('tenant_id', share.tenant_id);
        labels = new Map((lots || []).map((l: any) => [String(l.id), [l.lot_number, l.lot_title].filter(Boolean).join(' ')]));
      }
      const view = (row: any) => (req.shareDetail
        ? { ...reportView(row), attendance: guestAttendance(row?.attendance), lot_tracking: guestLotTracking(row?.lot_tracking, labels) }
        : reportView(row));
      res.json((data || []).map(view).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date))));
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
      // Les photos ne sortent JAMAIS en adresse (le chemin porte l'identifiant du cabinet) : avec le détail, seulement leur nombre,
      // chaque photo se lit par la route de téléchargement ci-dessous.
      const view = (n: any) => (req.shareDetail ? { ...pick(n, NOTE_FIELDS), photoCount: Array.isArray(n?.photos) ? n.photos.length : 0 } : pick(n, NOTE_FIELDS));
      res.json((data || []).map(view).sort((a: any, b: any) => Number(a.note_number) - Number(b.note_number)));
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/reports/:reportId/notes]', e); }
  });

  /** Lien (qui expire) vers UNE photo d'une rubrique : partage, droit de détail et rattachement à l'affaire revérifiés à chaque appel. */
  app.get('/api/shared/projects/:id/reports/:reportId/notes/:noteId/photos/:index', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'reports', 'read', { detail: true });
      if (!share) return;
      if (!(await ownReport(share, req.params.reportId))) return res.status(404).json({ error: 'Compte rendu introuvable.' });
      const { data: note } = await supabaseAdmin.from('site_report_notes').select('id, photos')
        .eq('id', req.params.noteId).eq('report_id', req.params.reportId).eq('tenant_id', share.tenant_id).maybeSingle();
      const index = /^\d{1,3}$/.test(req.params.index) ? Number(req.params.index) : -1;
      const fileUrl = Array.isArray(note?.photos) ? note.photos[index] : undefined;
      if (!note || typeof fileUrl !== 'string') return res.status(404).json({ error: 'Photo introuvable.' });
      const link = await linkForTenantFile(supabaseAdmin, share.tenant_id, fileUrl);
      if (!link.ok) return res.status(link.status).json({ error: link.error });
      res.json({ url: link.url, expiresIn: link.expiresIn });
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/reports/:reportId/notes/:noteId/photos/:index]', e); }
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
      // Les adresses e-mail des entreprises sont des données personnelles : leur consultation laisse une trace au cabinet,
      // posée AVANT la réponse. Un journal en panne ne prive pas le confrère de sa vue (meilleur effort, erreur consignée).
      if (req.shareDetail) {
        try {
          await auditConsultation(share, req, 'Consultation des coordonnées des entreprises de l\'ACT', 'ACT', 'act_contacts', 'ACT');
        } catch (traceError) { console.error('[GET /api/shared/projects/:id/act] trace', traceError); }
      }
      res.json(guestActView(row ?? null, marches || [], { detail: !!req.shareDetail }));
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/act]', e); }
  });

  // ─── Réserves AOR (`reserves`) et GPA (`gpa_reserves`) ────────────────────────

  const RESERVE_SETS: Array<{ path: string; table: string; kind: ShareKind; label: string; type: string; category: string; photoKind: 'opr' | 'gpa' }> = [
    { path: 'reserves', table: 'reserves', kind: 'reserves', label: 'la réserve', type: 'reserve', category: 'Réserves/Observations', photoKind: 'opr' },
    { path: 'gpa-reserves', table: 'gpa_reserves', kind: 'gpa', label: 'la réserve GPA', type: 'gpa_reserve', category: 'Réserves GPA', photoKind: 'gpa' },
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
        // Avec le détail, chaque réserve porte ses photos (identifiant, légende, date), jamais leur adresse : elles se lisent
        // par la route de téléchargement ci-dessous.
        const photosByReserve = new Map<string, any[]>();
        if (req.shareDetail && (data || []).length) {
          const { data: photos, error: photoError } = await supabaseAdmin.from('reserve_photos')
            .select('id, reserve_id, caption, uploaded_at, thumb_url')
            .eq('tenant_id', share.tenant_id).eq('reserve_kind', set.photoKind).in('reserve_id', (data || []).map((r: any) => r.id));
          // Table absente (instance non migrée) : pas de photos, la liste ne dépend pas d'elles.
          if (!photoError) {
            for (const p of photos || []) {
              const list = photosByReserve.get(p.reserve_id) ?? [];
              list.push({ id: p.id, caption: p.caption ?? null, uploaded_at: p.uploaded_at ?? null, has_thumb: !!p.thumb_url });
              photosByReserve.set(p.reserve_id, list);
            }
          }
        }
        const view = (r: any) => (req.shareDetail ? { ...pick(r, RESERVE_DETAIL_FIELDS), photos: photosByReserve.get(r.id) ?? [] } : pick(r, RESERVE_FIELDS));
        res.json((data || []).map(view).sort((a: any, b: any) => Number(a.number) - Number(b.number)));
      } catch (e: any) { fail(res, `[GET /api/shared/projects/:id/${set.path}]`, e); }
    });

    /** Lien (qui expire) vers UNE photo de réserve, ou sa miniature (`?thumb=1`) : partage, détail et rattachement revérifiés. */
    app.get(`/api/shared/projects/:id/${set.path}/:reserveId/photos/:photoId`, async (req: any, res: any) => {
      try {
        const share = await guard(req, res, set.kind, 'read', { detail: true });
        if (!share) return;
        // La réserve doit appartenir à CETTE affaire, la photo à CETTE réserve et à CE cabinet : sinon introuvable.
        const { data: reserve } = await supabaseAdmin.from(set.table).select('id')
          .eq('id', req.params.reserveId).eq('project_id', share.project_id).eq('tenant_id', share.tenant_id).maybeSingle();
        if (!reserve) return res.status(404).json({ error: 'Réserve introuvable.' });
        const { data: photo } = await supabaseAdmin.from('reserve_photos').select('id, file_url, thumb_url')
          .eq('id', req.params.photoId).eq('reserve_id', reserve.id).eq('reserve_kind', set.photoKind).eq('tenant_id', share.tenant_id).maybeSingle();
        if (!photo?.file_url) return res.status(404).json({ error: 'Photo introuvable.' });
        const wantsThumb = req.query.thumb === '1' && !!photo.thumb_url;
        const link = await linkForTenantFile(supabaseAdmin, share.tenant_id, wantsThumb ? photo.thumb_url : photo.file_url);
        if (!link.ok) return res.status(link.status).json({ error: link.error });
        res.json({ url: link.url, expiresIn: link.expiresIn });
      } catch (e: any) { fail(res, `[GET /api/shared/projects/:id/${set.path}/:reserveId/photos/:photoId]`, e); }
    });

    app.put(`/api/shared/projects/:id/${set.path}/:reserveId`, async (req: any, res: any) => {
      try {
        const share = await guard(req, res, set.kind, 'write');
        if (!share) return;
        // Déplacer un repère suppose de voir le plan : sans le détail accordé, c'est un refus net et non une erreur de saisie.
        if (hasPositionKeys(req.body) && !req.shareDetail) {
          return res.status(403).json({ error: 'Le détail de ce suivi n\'est pas partagé avec vous.', code: 'SHARE_DETAIL_FORBIDDEN' });
        }
        const parsed = readReserveFields(req.body, { detail: req.shareDetail });
        if ('error' in parsed) return res.status(400).json({ error: parsed.error });
        if (!Object.keys(parsed.fields).length) return res.status(400).json({ error: 'Aucune modification.' });
        // Le plan visé doit être un plan AOR de CETTE affaire et de CE cabinet : celui d'une autre affaire est introuvable.
        if (parsed.fields.plan_id) {
          const { data: plan } = await supabaseAdmin.from('plans').select('id, category')
            .eq('id', parsed.fields.plan_id).eq('project_id', share.project_id).eq('tenant_id', share.tenant_id).maybeSingle();
          if (!plan || !planIsAor(plan)) return res.status(404).json({ error: 'Plan introuvable.' });
        }
        // La réserve doit appartenir à CETTE affaire partagée : celle d'une autre affaire du cabinet est introuvable.
        const { data: reserve } = await supabaseAdmin.from(set.table).select('id, number, title, status')
          .eq('id', req.params.reserveId).eq('project_id', share.project_id).eq('tenant_id', share.tenant_id).maybeSingle();
        if (!reserve) return res.status(404).json({ error: 'Réserve introuvable.' });
        const { data, error } = await supabaseAdmin.from(set.table).update(parsed.fields)
          .eq('id', reserve.id).eq('tenant_id', share.tenant_id).select('*').single();
        if (isMissingReponseColumn(error)) return res.status(503).json({ error: 'Le suivi des réserves n\'est pas disponible : migration à appliquer.' });
        if (error) throw error;
        const renamed = parsed.fields.title && parsed.fields.title !== reserve.title ? ` (nouvel intitulé : "${parsed.fields.title}")` : '';
        const moved = 'plan_id' in parsed.fields ? (parsed.fields.plan_id ? ' (repère déplacé sur le plan)' : ' (repère retiré du plan)') : '';
        await audit(share, req, `Modification de ${set.label} N° ${reserve.number} "${reserve.title || ''}"${renamed}${moved}`, reserve.title || '', reserve.id, set.type, set.category);
        // Comme le PUT du cabinet : lever une réserve d'OPR prévient les webhooks du cabinet.
        const status = parsed.fields.status;
        if (set.kind === 'reserves' && status && CLOSED_RESERVE_STATUSES.includes(status) && !CLOSED_RESERVE_STATUSES.includes(reserve.status)) {
          dispatchWebhookEvent(supabaseAdmin, share.tenant_id, 'reserve.resolved', {
            id: reserve.id, title: reserve.title, status, project_id: share.project_id, number: reserve.number ?? null,
          });
        }
        res.json(pick(data, req.shareDetail ? RESERVE_DETAIL_FIELDS : RESERVE_FIELDS));
      } catch (e: any) { fail(res, `[PUT /api/shared/projects/:id/${set.path}/:reserveId]`, e); }
    });

    /** Les plans où poser un repère (identifiant et nom seulement) : exige le détail, sans lequel le plan n'est pas montré. */
    app.get(`/api/shared/projects/:id/${set.path}/plans`, async (req: any, res: any) => {
      try {
        const share = await guard(req, res, set.kind, 'read', { detail: true });
        if (!share) return;
        const { data, error } = await supabaseAdmin.from('plans').select('id, name, category, file_url')
          .eq('project_id', share.project_id).eq('tenant_id', share.tenant_id);
        if (error) throw error;
        res.json((data || []).filter(planIsAor).map(planView));
      } catch (e: any) { fail(res, `[GET /api/shared/projects/:id/${set.path}/plans]`, e); }
    });

    /** Lien (qui expire) vers le fichier d'UN plan AOR de l'affaire : partage, détail et rattachement revérifiés. */
    app.get(`/api/shared/projects/:id/${set.path}/plans/:planId/file`, async (req: any, res: any) => {
      try {
        const share = await guard(req, res, set.kind, 'read', { detail: true });
        if (!share) return;
        const { data: plan } = await supabaseAdmin.from('plans').select('id, file_url, category')
          .eq('id', req.params.planId).eq('project_id', share.project_id).eq('tenant_id', share.tenant_id).maybeSingle();
        if (!plan?.file_url || !planIsAor(plan)) return res.status(404).json({ error: 'Plan introuvable.' });
        const link = await linkForTenantFile(supabaseAdmin, share.tenant_id, plan.file_url);
        if (!link.ok) return res.status(link.status).json({ error: link.error });
        res.json({ url: link.url, expiresIn: link.expiresIn });
      } catch (e: any) { fail(res, `[GET /api/shared/projects/:id/${set.path}/plans/:planId/file]`, e); }
    });
  }
}
