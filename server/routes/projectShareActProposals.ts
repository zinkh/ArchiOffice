// Partage d'une affaire avec un confrère : modification de l'atelier ACT, PAR PROPOSITION.
//
// La consultation (`act_data.consultation`) est un seul bloc JSON, réécrit en entier par l'éditeur de l'ACT, et
// elle porte les offres et les montants des entreprises. Un confrère n'y écrit donc JAMAIS : le droit « modification »
// de l'atelier `act` signifie « proposer ». Le cabinet approuve ou refuse, et approuver est le seul moment où le
// bloc est écrit, avec deux garde-fous (même esprit que server/routes/projectShareProposals.ts) :
//  - la valeur actuelle doit être celle que le confrère a vue (`base_value`), sinon la proposition passe à
//    `outdated` et rien n'est écrit ;
//  - l'écriture est conditionnelle à `act_data.updated_at` lu : un enregistrement concurrent donne 409
//    `PROPOSAL_CONFLICT`, jamais un écrasement.
//
// Champs proposables, LISTE FERMÉE : une offre (montant de base, note technique, conformité, motif de non-conformité)
// et une entreprise consultée (date de relance, « ne répond pas »). Jamais : attributions, marchés, négociations,
// coordonnées, fichiers. Un champ ajouté demain n'est proposable que s'il est ajouté ici ET au CHECK de la base.
//
// Limite connue : l'éditeur de l'ACT garde la consultation en mémoire. Un onglet ACT resté ouvert AVANT l'approbation
// peut la réécrire à son prochain enregistrement : l'écran le dit au cabinet (« rechargez l'onglet ACT »).
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { isProjectArchived } from './projectArchive';
import { makeRequireSharer } from '../projectShares/requireSharer';
import { activeShareFor, allows, type ShareRow } from '../projectShares/access';
import { parseNumberValue } from '../projectShares/documentView';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => any;
}

type Rec = Record<string, any>;
export type ActTarget = 'offre' | 'entreprise';
export type ActField = 'montant_base' | 'note_technique' | 'conforme' | 'motif_nc' | 'relance_le' | 'ne_repond_pas';

/** Chaque champ proposable et l'élément de la consultation qui le porte. */
export const ACT_FIELDS: Record<ActField, ActTarget> = {
  montant_base: 'offre', note_technique: 'offre', conforme: 'offre', motif_nc: 'offre',
  relance_le: 'entreprise', ne_repond_pas: 'entreprise',
};

/** Au plus autant de propositions en attente par confrère : au-delà, le cabinet doit d'abord en traiter. */
export const MAX_PENDING_ACT_PROPOSALS = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE_TECHNIQUE = 100;
const MOTIF_MAX = 500;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** La consultation d'une ligne `act_data` : objet, ou texte JSON. Rend aussi sa forme d'origine, pour la réécrire à l'identique. */
export function parseConsultation(raw: unknown): { value: Rec; wasString: boolean } | null {
  if (isRec(raw)) return { value: raw, wasString: false };
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return isRec(parsed) ? { value: parsed, wasString: true } : null; } catch { return null; }
  }
  return null;
}

/** L'offre ou l'entreprise visée dans la consultation, ou null. */
export function findActNode(consultation: Rec, target: ActTarget, id: string): Rec | null {
  const list = target === 'offre' ? consultation.offres : consultation.entreprises;
  return Array.isArray(list) ? (list.find((n: unknown) => isRec(n) && n.id === id) as Rec | undefined) ?? null : null;
}

/** La valeur actuelle d'un champ, sous forme canonique (chaîne) : celle qui sert de valeur de départ au confrère. */
export function readActField(node: Rec, field: ActField): string {
  switch (field) {
    case 'montant_base': return String(Number.isFinite(Number(node.montant_base)) ? Number(node.montant_base) : 0);
    case 'note_technique': return String(Number.isFinite(Number(node.note_technique)) ? Number(node.note_technique) : 0);
    case 'conforme': return node.conforme === false ? 'false' : 'true';
    case 'ne_repond_pas': return node.ne_repond_pas === true ? 'true' : 'false';
    case 'motif_nc': return typeof node.motif_nc === 'string' ? node.motif_nc : '';
    case 'relance_le': return typeof node.relance_le === 'string' ? node.relance_le : '';
  }
}

/** Valide la valeur proposée et la rend sous forme canonique, ou le message d'erreur. */
export function parseActValue(field: ActField, raw: unknown): { value: string } | { error: string } {
  switch (field) {
    case 'montant_base': {
      const n = parseNumberValue(raw, 'Le montant');
      return 'error' in n ? n : { value: String(n.number) };
    }
    case 'note_technique': {
      const n = parseNumberValue(raw, 'La note');
      if ('error' in n) return n;
      return n.number > MAX_NOTE_TECHNIQUE ? { error: `La note ne peut pas dépasser ${MAX_NOTE_TECHNIQUE}.` } : { value: String(n.number) };
    }
    case 'conforme':
    case 'ne_repond_pas': {
      if (raw === true || raw === 'true') return { value: 'true' };
      if (raw === false || raw === 'false') return { value: 'false' };
      return { error: 'Valeur attendue : oui ou non.' };
    }
    case 'motif_nc': {
      if (typeof raw !== 'string' || raw.length > MOTIF_MAX) return { error: `Motif invalide (${MOTIF_MAX} caractères au plus).` };
      return { value: raw.trim() };
    }
    case 'relance_le': {
      if (raw === null || raw === '') return { value: '' };
      if (typeof raw !== 'string' || !DATE_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return { error: 'La date doit être au format AAAA-MM-JJ.' };
      return { value: raw };
    }
  }
}

/** Pourquoi un champ ne peut pas être proposé sur cet élément, ou null. */
export function blockedActEdit(node: Rec, field: ActField): string | null {
  // Offre saisie poste par poste : son montant est DÉDUIT des prix unitaires, il n'est jamais saisi.
  if (field === 'montant_base' && node.mode_saisie === 'postes') {
    return 'Le montant de cette offre est calculé poste par poste : il ne se propose pas directement.';
  }
  return null;
}

/** Applique la valeur validée à une COPIE de l'élément (jamais en place). */
export function applyActField(node: Rec, field: ActField, value: string): Rec {
  const next: Rec = { ...node };
  switch (field) {
    case 'montant_base':
    case 'note_technique': next[field] = Number(value); break;
    case 'conforme': next.conforme = value === 'true'; break;
    case 'ne_repond_pas': next.ne_repond_pas = value === 'true'; break;
    case 'motif_nc': next.motif_nc = value; break;
    case 'relance_le': if (value) next.relance_le = value; else delete next.relance_le; break;
  }
  return next;
}

/** La consultation avec l'élément remplacé, sans toucher au reste. */
export function replaceActNode(consultation: Rec, target: ActTarget, id: string, node: Rec): Rec {
  const key = target === 'offre' ? 'offres' : 'entreprises';
  const list: unknown[] = Array.isArray(consultation[key]) ? consultation[key] : [];
  return { ...consultation, [key]: list.map(n => (isRec(n) && n.id === id ? node : n)) };
}

export function registerProjectShareActProposalRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  const requireSharer = makeRequireSharer(supabaseAdmin, getTenantId);

  const fail = (res: any, label: string, e: any) => {
    if (e?.status) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error(label, e);
    return res.status(500).json({ error: 'Opération impossible, réessayez.' });
  };

  /** La ligne `act_data` brute (pour lire ET écrire sans réinterpréter), avec sa consultation lue, ou null. */
  async function loadAct(tenantId: string, projectId: string) {
    const { data, error } = await supabaseAdmin.from('act_data').select('*')
      .eq('project_id', projectId).eq('tenant_id', tenantId).maybeSingle();
    if (error || !data) return null;
    const consultation = parseConsultation(data.consultation);
    return consultation ? { row: data, consultation } : null;
  }

  const view = (p: any) => ({
    id: p.id, targetType: p.target_type, targetId: p.target_id, field: p.field,
    baseValue: p.base_value, proposedValue: p.proposed_value, status: p.status,
    decisionNote: p.decision_note ?? null, createdAt: p.created_at ?? null,
  });

  // ─── Côté confrère ──────────────────────────────────────────────────────────

  async function guard(req: any, res: any, access: 'read' | 'write'): Promise<ShareRow | null> {
    const found = await activeShareFor(supabaseAdmin, req.user.id, req.params.id);
    if (!found) { res.status(404).json({ error: 'Affaire introuvable ou non partagée avec vous.' }); return null; }
    if (!allows(found.grants, 'act', access)) {
      res.status(403).json({ error: 'Vous n\'avez pas le droit de proposer une modification dans l\'ACT.', code: 'SHARE_FORBIDDEN' });
      return null;
    }
    if (access === 'write' && await isProjectArchived(supabaseAdmin, found.share.tenant_id, found.share.project_id)) {
      res.status(409).json({ error: 'Affaire archivée : lecture seule.', code: 'PROJECT_ARCHIVED' });
      return null;
    }
    return found.share;
  }

  app.get('/api/shared/projects/:id/act-proposals', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'read');
      if (!share) return;
      const { data } = await supabaseAdmin.from('project_share_act_proposals').select('*')
        .eq('share_id', share.id).eq('tenant_id', share.tenant_id);
      res.json((data || []).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).map(view));
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/act-proposals]', e); }
  });

  app.post('/api/shared/projects/:id/act-proposals', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'write');
      if (!share) return;
      const { targetType, targetId, field } = req.body ?? {};
      if (typeof field !== 'string' || !(field in ACT_FIELDS)) return res.status(400).json({ error: 'Champ non modifiable.' });
      if (ACT_FIELDS[field as ActField] !== targetType) return res.status(400).json({ error: 'Ce champ ne s\'applique pas à cet élément.' });
      if (typeof targetId !== 'string' || !targetId || targetId.length > 100) return res.status(400).json({ error: 'Élément visé invalide.' });
      const parsed = parseActValue(field as ActField, req.body?.value);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });

      const act = await loadAct(share.tenant_id, share.project_id);
      if (!act) return res.status(404).json({ error: 'Consultation introuvable.' });
      // On ne propose de modifier que ce qu'on VOIT : l'élément doit exister dans la consultation de CETTE affaire.
      const node = findActNode(act.consultation.value, targetType, targetId);
      if (!node) return res.status(404).json({ error: 'Élément introuvable dans la consultation.' });
      const blocked = blockedActEdit(node, field as ActField);
      if (blocked) return res.status(400).json({ error: blocked });
      const base = readActField(node, field as ActField);
      if (parsed.value === base) return res.status(400).json({ error: 'Aucun changement : la valeur proposée est la valeur actuelle.' });

      const { data: mine } = await supabaseAdmin.from('project_share_act_proposals').select('id, target_type, target_id, field')
        .eq('share_id', share.id).eq('tenant_id', share.tenant_id).eq('status', 'pending');
      const pending: any[] = mine || [];
      const previous = pending.find(p => p.target_type === targetType && p.target_id === targetId && p.field === field);
      // Remplacer une proposition sur le même champ libère sa propre place.
      if (!previous && pending.length >= MAX_PENDING_ACT_PROPOSALS) {
        return res.status(409).json({ error: `Limite atteinte : ${MAX_PENDING_ACT_PROPOSALS} propositions en attente. Le cabinet doit en traiter avant que vous en déposiez d'autres.`, code: 'PROPOSAL_LIMIT' });
      }
      if (previous) {
        await supabaseAdmin.from('project_share_act_proposals').update({ status: 'withdrawn' }).eq('id', previous.id).eq('tenant_id', share.tenant_id);
      }
      const id = crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('project_share_act_proposals').insert({
        id, tenant_id: share.tenant_id, project_id: share.project_id, share_id: share.id, author_id: req.user.id,
        target_type: targetType, target_id: targetId, field, base_value: base, proposed_value: parsed.value, status: 'pending',
      }).select('*').single();
      if (error) throw error;
      const userName = await getUserName(share.tenant_id, req.user.id, req.user.email);
      logActivity(share.tenant_id, req.user.id, userName, `Proposition de modification dans l'ACT (confrère externe) : ${field}`, String(targetId), id, 'act', 'ACT');
      res.status(201).json(view(data));
    } catch (e: any) { fail(res, '[POST /api/shared/projects/:id/act-proposals]', e); }
  });

  app.delete('/api/shared/projects/:id/act-proposals/:proposalId', async (req: any, res: any) => {
    try {
      const share = await guard(req, res, 'write');
      if (!share) return;
      // Une proposition appartient à UN partage : un confrère ne retire jamais celle d'un autre.
      const { data: row } = await supabaseAdmin.from('project_share_act_proposals').select('*')
        .eq('id', req.params.proposalId).eq('share_id', share.id).eq('tenant_id', share.tenant_id).maybeSingle();
      if (!row) return res.status(404).json({ error: 'Proposition introuvable.' });
      if (row.status !== 'pending') return res.status(409).json({ error: 'Cette proposition a déjà été traitée.', code: 'PROPOSAL_DECIDED' });
      const { data, error } = await supabaseAdmin.from('project_share_act_proposals').update({ status: 'withdrawn' })
        .eq('id', row.id).eq('tenant_id', share.tenant_id).select('*').single();
      if (error) throw error;
      res.json(view(data));
    } catch (e: any) { fail(res, '[DELETE /api/shared/projects/:id/act-proposals/:proposalId]', e); }
  });

  // ─── Côté cabinet ───────────────────────────────────────────────────────────

  /** Libellé de l'élément visé : le nom de l'entreprise, ou « entreprise · lot » pour une offre. */
  function labelOf(consultation: Rec, lots: unknown, p: any): string | null {
    const node = findActNode(consultation, p.target_type, p.target_id);
    if (!node) return null;
    if (p.target_type === 'entreprise') return typeof node.nom === 'string' ? node.nom : null;
    const company = findActNode(consultation, 'entreprise', node.entreprise_id);
    const lot = Array.isArray(lots) ? lots.find((l: any) => isRec(l) && l.id === node.lot_id) : null;
    return [company?.nom, lot?.name ?? node.lot_id].filter(Boolean).join(' · ') || null;
  }

  app.get('/api/projects/:id/share-act-proposals', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', req.params.id, tenantId))) return res.status(404).json({ error: 'Affaire introuvable.' });
      const [{ data: rows }, { data: shares }, act] = await Promise.all([
        supabaseAdmin.from('project_share_act_proposals').select('*').eq('project_id', req.params.id).eq('tenant_id', tenantId),
        supabaseAdmin.from('project_shares').select('id, email').eq('project_id', req.params.id).eq('tenant_id', tenantId),
        loadAct(tenantId, req.params.id),
      ]);
      const emailOf = new Map<string, string>((shares || []).map((s: any) => [s.id, s.email]));
      res.json((rows || [])
        .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((p: any) => {
          const node = act ? findActNode(act.consultation.value, p.target_type, p.target_id) : null;
          const current = node ? readActField(node, p.field) : null;
          return {
            ...view(p), guestEmail: emailOf.get(p.share_id) ?? null,
            targetLabel: act ? labelOf(act.consultation.value, act.row.lots, p) : null, currentValue: current,
            // Le contenu a changé depuis ce que le confrère a vu : l'approbation sera refusée.
            outdated: p.status === 'pending' && current !== null && current !== p.base_value,
          };
        }));
    } catch (e: any) { fail(res, '[GET /api/projects/:id/share-act-proposals]', e); }
  });

  async function proposalOf(tenantId: string, projectId: string, id: string) {
    const { data } = await supabaseAdmin.from('project_share_act_proposals').select('*')
      .eq('id', id).eq('project_id', projectId).eq('tenant_id', tenantId).maybeSingle();
    return data ?? null;
  }

  app.post('/api/projects/:id/share-act-proposals/:proposalId/approve', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      const proposal = await proposalOf(tenantId, req.params.id, req.params.proposalId);
      if (!proposal) return res.status(404).json({ error: 'Proposition introuvable.' });
      if (proposal.status !== 'pending') return res.status(409).json({ error: 'Cette proposition a déjà été traitée.', code: 'PROPOSAL_DECIDED' });

      const act = await loadAct(tenantId, req.params.id);
      if (!act) return res.status(404).json({ error: 'Consultation introuvable.' });
      const node = findActNode(act.consultation.value, proposal.target_type, proposal.target_id);
      if (!node) return res.status(409).json({ error: 'L\'élément visé n\'existe plus dans la consultation.', code: 'PROPOSAL_OUTDATED' });
      const decide = (patch: Rec) => supabaseAdmin.from('project_share_act_proposals')
        .update({ ...patch, decided_by: req.user.id, decided_at: new Date().toISOString() }).eq('id', proposal.id).eq('tenant_id', tenantId);

      // 1. La valeur actuelle doit être celle que le confrère a vue : sinon rien n'est écrit.
      if (readActField(node, proposal.field) !== proposal.base_value) {
        await decide({ status: 'outdated' });
        return res.status(409).json({ error: 'Le contenu a changé depuis la proposition : elle est périmée, rien n\'a été écrit.', code: 'PROPOSAL_OUTDATED' });
      }
      const blocked = blockedActEdit(node, proposal.field);
      if (blocked) {
        await decide({ status: 'outdated' });
        return res.status(409).json({ error: blocked, code: 'PROPOSAL_OUTDATED' });
      }

      // 2. L'écriture est conditionnelle à `updated_at` : un enregistrement concurrent donne un conflit, jamais un écrasement.
      const next = replaceActNode(act.consultation.value, proposal.target_type, proposal.target_id, applyActField(node, proposal.field, proposal.proposed_value));
      const update = supabaseAdmin.from('act_data')
        .update({ consultation: act.consultation.wasString ? JSON.stringify(next) : next, updated_at: new Date().toISOString() })
        .eq('id', act.row.id).eq('tenant_id', tenantId);
      const { data: written, error } = await (act.row.updated_at ? update.eq('updated_at', act.row.updated_at) : update).select('id');
      if (error) throw error;
      if (!written || written.length === 0) {
        return res.status(409).json({ error: 'La consultation a été modifiée entre-temps : relisez-la puis réessayez. Rien n\'a été écrit.', code: 'PROPOSAL_CONFLICT' });
      }
      await decide({ status: 'applied' });
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      const label = labelOf(next, act.row.lots, proposal) || proposal.target_id;
      logActivity(tenantId, req.user.id, userName, `Proposition d'un confrère appliquée dans l'ACT : ${label} (${proposal.field})`, label, proposal.id, 'act', 'ACT');
      res.json({ ...view({ ...proposal, status: 'applied' }) });
    } catch (e: any) { fail(res, '[POST /api/projects/:id/share-act-proposals/:proposalId/approve]', e); }
  });

  app.post('/api/projects/:id/share-act-proposals/:proposalId/reject', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      const proposal = await proposalOf(tenantId, req.params.id, req.params.proposalId);
      if (!proposal) return res.status(404).json({ error: 'Proposition introuvable.' });
      if (proposal.status !== 'pending') return res.status(409).json({ error: 'Cette proposition a déjà été traitée.', code: 'PROPOSAL_DECIDED' });
      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
      const { data, error } = await supabaseAdmin.from('project_share_act_proposals')
        .update({ status: 'rejected', decided_by: req.user.id, decided_at: new Date().toISOString(), decision_note: note || null })
        .eq('id', proposal.id).eq('tenant_id', tenantId).select('*').single();
      if (error) throw error;
      res.json(view(data));
    } catch (e: any) { fail(res, '[POST /api/projects/:id/share-act-proposals/:proposalId/reject]', e); }
  });
}
