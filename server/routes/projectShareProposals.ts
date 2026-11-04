// Écriture d'un confrère sur les TEXTES du CCTP : par proposition, jamais directement.
//
// Le CCTP est le même document que le DPGF (dpgfs.data), un seul bloc JSON que
// l'autosauvegarde de l'éditeur réécrit en entier. Un invité qui écrirait lui-même
// réécrirait tout le document et pourrait effacer le travail du cabinet : il dépose donc
// une PROPOSITION (un champ d'un chapitre ou d'un article), que le cabinet valide.
//
//  - Côté invité (`/api/shared/projects/:id/proposals`) : proposer, relire les siennes, retirer
//    une proposition en attente. Droit `write` sur le CCTP, lot par lot.
//  - Côté cabinet (`/api/projects/:id/share-proposals`) : lire, approuver, refuser.
//
// Approuver est le seul moment où le document est écrit, et il l'est avec trois garde-fous :
//  1. la valeur actuelle du champ doit être celle que l'invité a VUE (`base_value`), sinon la
//     proposition est « périmée » et rien n'est écrit ;
//  2. un instantané du document est pris AVANT (`dpgf_versions`, restaurable depuis l'historique) ;
//  3. l'écriture est conditionnelle à l'état exact du document lu : si quelqu'un l'a enregistré
//     entre-temps, elle échoue (409) au lieu de l'écraser.
// Un onglet PRO ouvert avant l'approbation garde l'ancien texte en mémoire : l'écran invite à le
// recharger. Voir CLAUDE.md, « Partage d'une affaire avec un confrère ».
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { isProjectArchived } from './projectArchive';
import { makeRequireSharer } from '../projectShares/requireSharer';
import { activeShareFor, allows, type ShareGrant, type ShareRow } from '../projectShares/access';
import {
  PROPOSABLE_FIELDS, REQUIRED_TEXT_FIELDS, findRawNode, guestDocumentView, nodeLabels, parseDocument,
  textField, visibleNodes, type ProposableTarget,
} from '../projectShares/documentView';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => any;
}

export const MAX_PROPOSAL_VALUE = 20000;
export const MAX_PROPOSAL_TITLE = 300;
export const MAX_PENDING_PER_SHARE = 50;
const MAX_NOTE = 1000;
const TARGET_TYPES = Object.keys(PROPOSABLE_FIELDS) as ProposableTarget[];

export interface ProposalInput { lotId: string; targetType: ProposableTarget; targetId: string; field: string; value: string }

/** Valide le corps d'une proposition : élément et champ dans la liste fermée, valeur bornée. */
export function readProposalInput(body: any): { input: ProposalInput } | { error: string } {
  const { lotId, targetType, targetId, field, value } = body ?? {};
  if (typeof lotId !== 'string' || !lotId || lotId.length > 100) return { error: 'Le lot est obligatoire.' };
  if (!TARGET_TYPES.includes(targetType)) return { error: 'On ne propose de modifier qu\'un chapitre ou un article.' };
  if (typeof targetId !== 'string' || !targetId || targetId.length > 100) return { error: 'Élément visé invalide.' };
  if (!(PROPOSABLE_FIELDS[targetType as ProposableTarget] as readonly string[]).includes(field)) {
    return { error: `Ce champ ne peut pas faire l'objet d'une proposition : ${String(field)}.` };
  }
  if (typeof value !== 'string') return { error: 'La valeur proposée doit être un texte.' };
  if (REQUIRED_TEXT_FIELDS.includes(field)) {
    const trimmed = value.trim();
    if (!trimmed) return { error: 'Cet intitulé ne peut pas être vide.' };
    if (trimmed.length > MAX_PROPOSAL_TITLE) return { error: `Intitulé trop long (${MAX_PROPOSAL_TITLE} caractères).` };
    return { input: { lotId, targetType, targetId, field, value: trimmed } };
  }
  if (value.length > MAX_PROPOSAL_VALUE) return { error: `Texte trop long (${MAX_PROPOSAL_VALUE} caractères).` };
  return { input: { lotId, targetType, targetId, field, value } };
}

/** Une proposition telle que le rend l'API ; les champs du cabinet ne sont ajoutés que pour lui. */
export function proposalView(row: any, extra?: Record<string, unknown>) {
  return {
    id: row.id,
    lotId: row.project_lot_id,
    targetType: row.target_type,
    targetId: row.target_id,
    field: row.field,
    baseValue: row.base_value,
    proposedValue: row.proposed_value,
    status: row.status,
    decisionNote: row.decision_note ?? null,
    createdAt: row.created_at ?? null,
    decidedAt: row.decided_at ?? null,
    ...(extra ?? {}),
  };
}

export function registerProjectShareProposalRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  const requireSharer = makeRequireSharer(supabaseAdmin, getTenantId);

  const fail = (res: any, label: string, e: any) => {
    if (e?.status) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error(label, e);
    return res.status(500).json({ error: 'Opération impossible, réessayez.' });
  };

  async function guestShare(req: any, res: any): Promise<{ share: ShareRow; grants: ShareGrant[] } | null> {
    const found = await activeShareFor(supabaseAdmin, req.user.id, req.params.id);
    if (!found) { res.status(404).json({ error: 'Affaire introuvable ou non partagée avec vous.' }); return null; }
    return found;
  }

  /** La ligne `dpgfs` brute (identifiant et texte JSON tel qu'enregistré), pour lire ET écrire sans réinterpréter. */
  async function loadRow(tenantId: string, projectId: string) {
    const { data, error } = await supabaseAdmin.from('dpgfs').select('id, data')
      .eq('project_id', projectId).eq('tenant_id', tenantId).maybeSingle();
    if (error || !data) return null;
    const doc = parseDocument(data.data);
    return doc ? { id: data.id as string, raw: data.data, doc } : null;
  }

  // ─── Côté invité ────────────────────────────────────────────────────────────

  app.post('/api/shared/projects/:id/proposals', async (req: any, res: any) => {
    try {
      const found = await guestShare(req, res);
      if (!found) return;
      const { share, grants } = found;
      const parsed = readProposalInput(req.body);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      const { lotId, targetType, targetId, field, value } = parsed.input;
      if (!allows(grants, 'cctp', 'write', lotId)) {
        return res.status(403).json({ error: 'Vous n\'avez pas le droit de proposer des modifications sur ce lot.', code: 'SHARE_FORBIDDEN' });
      }
      if (await isProjectArchived(supabaseAdmin, share.tenant_id, share.project_id)) {
        return res.status(409).json({ error: 'Affaire archivée : lecture seule.', code: 'PROJECT_ARCHIVED' });
      }

      const row = await loadRow(share.tenant_id, share.project_id);
      if (!row) return res.status(404).json({ error: 'Document introuvable.' });
      // On ne propose de modifier que ce qu'on VOIT, comme pour les commentaires.
      const view = guestDocumentView(row.doc, 'cctp', new Set([lotId]));
      if (!view.lots.length || !visibleNodes(view.lots[0])[targetType].has(targetId)) {
        return res.status(404).json({ error: 'Élément introuvable dans ce lot.' });
      }
      const node = findRawNode(row.doc, lotId, targetType, targetId);
      if (!node) return res.status(404).json({ error: 'Élément introuvable dans ce lot.' });
      const current = textField(node, field);
      if (value === current) return res.status(400).json({ error: 'Aucun changement par rapport au texte actuel.' });

      // Une nouvelle proposition sur le même champ remplace la précédente en attente (retirée, jamais perdue).
      const { data: pending } = await supabaseAdmin.from('project_share_proposals').select('id, target_type, target_id, field')
        .eq('share_id', share.id).eq('status', 'pending');
      const mine = (pending || []) as any[];
      const superseded = mine.filter(p => p.target_type === targetType && p.target_id === targetId && p.field === field);
      if (mine.length - superseded.length >= MAX_PENDING_PER_SHARE) {
        return res.status(409).json({ error: `Trop de propositions en attente (${MAX_PENDING_PER_SHARE}) : attendez la décision du cabinet.`, code: 'PROPOSAL_LIMIT' });
      }
      for (const p of superseded) {
        await supabaseAdmin.from('project_share_proposals').update({ status: 'withdrawn', decided_at: new Date().toISOString() }).eq('id', p.id);
      }

      const created = {
        id: crypto.randomUUID(), tenant_id: share.tenant_id, project_id: share.project_id, share_id: share.id,
        author_id: req.user.id, project_lot_id: lotId, target_type: targetType, target_id: targetId, field,
        base_value: current, proposed_value: value, status: 'pending', decided_by: null, decided_at: null,
        decision_note: null, created_at: new Date().toISOString(),
      };
      const { error } = await supabaseAdmin.from('project_share_proposals').insert(created);
      if (error) throw error;
      const userName = await getUserName(share.tenant_id, req.user.id, req.user.email);
      logActivity(share.tenant_id, req.user.id, userName, 'Proposition de modification du CCTP (confrère externe)', share.email, created.id, 'project', 'Affaires');
      res.status(201).json(proposalView(created));
    } catch (e: any) { fail(res, '[POST /api/shared/projects/:id/proposals]', e); }
  });

  app.get('/api/shared/projects/:id/proposals', async (req: any, res: any) => {
    try {
      const found = await guestShare(req, res);
      if (!found) return;
      const { data } = await supabaseAdmin.from('project_share_proposals').select('*')
        .eq('share_id', found.share.id).eq('tenant_id', found.share.tenant_id);
      // Un droit de lecture retiré masque aussi les propositions du lot.
      const rows = (data || []).filter((p: any) => allows(found.grants, 'cctp', 'read', p.project_lot_id));
      res.json(rows
        .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((p: any) => proposalView(p)));
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/proposals]', e); }
  });

  app.delete('/api/shared/projects/:id/proposals/:proposalId', async (req: any, res: any) => {
    try {
      const found = await guestShare(req, res);
      if (!found) return;
      const { data: row } = await supabaseAdmin.from('project_share_proposals').select('*')
        .eq('id', req.params.proposalId).eq('share_id', found.share.id).maybeSingle();
      if (!row) return res.status(404).json({ error: 'Proposition introuvable.' });
      if (row.status !== 'pending') return res.status(409).json({ error: 'Cette proposition a déjà été traitée.', code: 'PROPOSAL_NOT_PENDING' });
      const { data, error } = await supabaseAdmin.from('project_share_proposals')
        .update({ status: 'withdrawn', decided_at: new Date().toISOString() }).eq('id', row.id).select().single();
      if (error) throw error;
      res.json(proposalView(data));
    } catch (e: any) { fail(res, '[DELETE /api/shared/projects/:id/proposals/:proposalId]', e); }
  });

  // ─── Côté cabinet ───────────────────────────────────────────────────────────

  app.get('/api/projects/:id/share-proposals', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', req.params.id, tenantId))) {
        return res.status(404).json({ error: 'Affaire introuvable.' });
      }
      const { data } = await supabaseAdmin.from('project_share_proposals').select('*')
        .eq('project_id', req.params.id).eq('tenant_id', tenantId);
      const rows = (data || []) as any[];
      if (!rows.length) return res.json([]);
      const { data: shares } = await supabaseAdmin.from('project_shares').select('id, email')
        .eq('project_id', req.params.id).eq('tenant_id', tenantId);
      const emails = new Map<string, string>((shares || []).map((s: any) => [s.id, s.email]));
      const doc = (await loadRow(tenantId, req.params.id))?.doc ?? null;
      const labels = doc ? nodeLabels(doc) : new Map<string, string>();
      res.json(rows
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map(p => {
          const node = doc ? findRawNode(doc, p.project_lot_id, p.target_type, p.target_id) : null;
          const currentValue = node ? textField(node, p.field) : null;
          return proposalView(p, {
            guestEmail: emails.get(p.share_id) ?? null,
            targetLabel: labels.get(p.target_id) ?? null,
            currentValue,
            // En attente mais le champ a changé depuis : l'approuver sera refusé.
            outdated: p.status === 'pending' && (currentValue === null || currentValue !== p.base_value),
          });
        }));
    } catch (e: any) { fail(res, '[GET /api/projects/:id/share-proposals]', e); }
  });

  async function loadPending(tenantId: string, projectId: string, proposalId: string, res: any) {
    const { data: row } = await supabaseAdmin.from('project_share_proposals').select('*')
      .eq('id', proposalId).eq('project_id', projectId).eq('tenant_id', tenantId).maybeSingle();
    if (!row) { res.status(404).json({ error: 'Proposition introuvable.' }); return null; }
    if (row.status !== 'pending') {
      res.status(409).json({ error: 'Cette proposition a déjà été traitée.', code: 'PROPOSAL_NOT_PENDING' });
      return null;
    }
    return row;
  }

  const markOutdated = (row: any, userId: string, tenantId: string) => supabaseAdmin.from('project_share_proposals')
    .update({ status: 'outdated', decided_by: userId, decided_at: new Date().toISOString() })
    .eq('id', row.id).eq('tenant_id', tenantId);

  app.post('/api/projects/:id/share-proposals/:proposalId/approve', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      const proposal = await loadPending(tenantId, req.params.id, req.params.proposalId, res);
      if (!proposal) return;
      if (await isProjectArchived(supabaseAdmin, tenantId, proposal.project_id)) {
        return res.status(409).json({ error: 'Affaire archivée : rouvrez-la pour appliquer la proposition.', code: 'PROJECT_ARCHIVED' });
      }
      const row = await loadRow(tenantId, proposal.project_id);
      if (!row) return res.status(404).json({ error: 'Document introuvable.' });

      const node = findRawNode(row.doc, proposal.project_lot_id, proposal.target_type, proposal.target_id);
      // Garde-fou 1 : le champ doit toujours valoir ce que l'invité a vu.
      if (!node || textField(node, proposal.field) !== proposal.base_value) {
        await markOutdated(proposal, req.user.id, tenantId);
        return res.status(409).json({
          error: 'Le texte a changé depuis cette proposition (ou l\'élément n\'existe plus) : elle est périmée. Demandez au confrère de la refaire.',
          code: 'PROPOSAL_OUTDATED',
        });
      }

      // Garde-fou 2 : un instantané du document AVANT toute écriture, restaurable depuis l'historique du DPGF.
      const snapshotId = crypto.randomUUID();
      const { data: shareRow } = await supabaseAdmin.from('project_shares').select('email').eq('id', proposal.share_id).maybeSingle();
      const email = shareRow?.email ?? 'un confrère';
      const before = parseDocument(row.raw);
      const { error: snapError } = await supabaseAdmin.from('dpgf_versions').insert({
        id: snapshotId, tenant_id: tenantId, project_id: proposal.project_id, dpgf_id: row.id,
        label: `Avant la proposition de ${email}`, phase: null, version: (before as any)?.version ?? null,
        document: before, created_by: req.user.id, created_at: new Date().toISOString(),
      });
      if (snapError) throw snapError;

      // Garde-fou 3 : écriture conditionnelle à l'état exact du document lu.
      (node as any)[proposal.field] = proposal.proposed_value;
      let update = supabaseAdmin.from('dpgfs').update({ data: JSON.stringify(row.doc) })
        .eq('id', row.id).eq('tenant_id', tenantId);
      if (typeof row.raw === 'string') update = update.eq('data', row.raw);
      const { data: written, error: writeError } = await update.select('id');
      if (writeError) throw writeError;
      if (!written?.length) {
        await supabaseAdmin.from('dpgf_versions').delete().eq('id', snapshotId).eq('tenant_id', tenantId);
        return res.status(409).json({
          error: 'Le document a été modifié pendant l\'application : rien n\'a été écrit, réessayez.',
          code: 'PROPOSAL_CONFLICT',
        });
      }

      const decidedAt = new Date().toISOString();
      const { data: updated, error } = await supabaseAdmin.from('project_share_proposals')
        .update({ status: 'applied', decided_by: req.user.id, decided_at: decidedAt })
        .eq('id', proposal.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Proposition de ${email} appliquée au CCTP`, email, proposal.id, 'project', 'Affaires');
      res.json(proposalView(updated, { applied: true }));
    } catch (e: any) { fail(res, '[POST /api/projects/:id/share-proposals/:proposalId/approve]', e); }
  });

  app.post('/api/projects/:id/share-proposals/:proposalId/reject', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      const note = req.body?.note;
      if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > MAX_NOTE)) {
        return res.status(400).json({ error: `Motif trop long (${MAX_NOTE} caractères).` });
      }
      const proposal = await loadPending(tenantId, req.params.id, req.params.proposalId, res);
      if (!proposal) return;
      const { data, error } = await supabaseAdmin.from('project_share_proposals')
        .update({ status: 'rejected', decided_by: req.user.id, decided_at: new Date().toISOString(), decision_note: typeof note === 'string' && note.trim() ? note.trim() : null })
        .eq('id', proposal.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(proposalView(data));
    } catch (e: any) { fail(res, '[POST /api/projects/:id/share-proposals/:proposalId/reject]', e); }
  });
}
