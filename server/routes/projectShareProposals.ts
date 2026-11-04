// Écriture d'un confrère sur le CCTP et le DPGF : par proposition, jamais directement.
//
// Le CCTP est le même document que le DPGF (dpgfs.data), un seul bloc JSON que
// l'autosauvegarde de l'éditeur réécrit en entier. Un invité qui écrirait lui-même
// réécrirait tout le document et pourrait effacer le travail du cabinet : il dépose donc
// une PROPOSITION (un champ d'un lot, d'un chapitre ou d'un article), que le cabinet valide.
//
//  - Côté invité (`/api/shared/projects/:id/proposals`) : proposer, relire les siennes, retirer
//    une proposition en attente. Droit `write` lot par lot : sur le CCTP pour les textes et les
//    titres, sur le DPGF pour les quantités, les prix et les unités.
//  - Côté cabinet (`/api/projects/:id/share-proposals`) : lire, approuver, refuser.
//
// Aucune perte de donnée possible, par construction :
//  - AUCUNE ligne de proposition n'est jamais supprimée : remplacée, retirée, refusée ou périmée,
//    elle garde sa valeur de départ et sa valeur proposée ;
//  - approuver est le seul moment où le document est écrit, avec trois garde-fous :
//     1. la valeur actuelle du champ doit être celle que l'invité a VUE (`base_value`), sinon la
//        proposition est « périmée » et rien n'est écrit ;
//     2. un instantané du document est pris AVANT (`dpgf_versions`, restaurable depuis
//        l'historique), et conservé même si l'écriture échoue ;
//     3. l'écriture est conditionnelle à l'état exact lu : si quelqu'un a enregistré entre-temps,
//        elle échoue (409) au lieu de l'écraser ;
//  - une quantité ou un prix recalcule le montant de l'article, le sous-total du lot et les totaux
//    avec la fonction même de l'éditeur : aucun total ne contredit ses lignes ;
//  - le titre d'un lot vit dans `project_lots` : même écriture conditionnelle, et l'ancien titre
//    reste dans la proposition ;
//  - atteindre la limite de propositions en attente n'en perd aucune : la demande est refusée avec
//    une alerte (à l'invité, et au cabinet par notification), son texte reste dans le formulaire ;
//  - une proposition appliquée dont le champ a changé depuis est signalée au cabinet (`drifted`) :
//    un onglet PRO ouvert avant l'approbation garde l'ancien texte en mémoire, et sa prochaine
//    frappe pourrait le remettre. L'écran invite à recharger l'onglet PRO.
// Voir CLAUDE.md, « Partage d'une affaire avec un confrère ».
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { isProjectArchived } from './projectArchive';
import { makeRequireSharer } from '../projectShares/requireSharer';
import { activeShareFor, allows, type ShareGrant, type ShareRow } from '../projectShares/access';
import { tenantMembershipsByUser } from '../tenantMemberships';
import { notifyUsers } from '../push';
import {
  FIELD_KIND, NUMERIC_FIELDS, PROPOSABLE_FIELDS, RECOMPUTE_FIELDS, REQUIRED_TEXT_FIELDS, applyFieldToNode, blockedEdit, findRawNode,
  guestDocumentView, nodeLabels, parseDocument, parseMetreValue, parseNumberValue, readField, recomputeAfterNumericChange,
  sameFieldValue, visibleNodes, type ProposableField, type ProposableTarget,
} from '../projectShares/documentView';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => any;
}

export const MAX_PROPOSAL_VALUE = 20000;
export const MAX_PROPOSAL_TITLE = 300;
export const MAX_PROPOSAL_UNIT = 20;
export const MAX_PENDING_PER_SHARE = 50;
const MAX_NOTE = 1000;
const LIMIT_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const TARGET_TYPES = Object.keys(PROPOSABLE_FIELDS) as ProposableTarget[];

export interface ProposalInput { lotId: string; targetType: ProposableTarget; targetId: string; field: ProposableField; value: string }

/** Valide le corps d'une proposition : élément et champ dans la liste fermée, valeur typée et bornée. */
export function readProposalInput(body: any): { input: ProposalInput } | { error: string } {
  const { lotId, targetType, targetId, field, value } = body ?? {};
  if (typeof lotId !== 'string' || !lotId || lotId.length > 100) return { error: 'Le lot est obligatoire.' };
  if (!TARGET_TYPES.includes(targetType)) return { error: 'On ne propose de modifier qu\'un lot, un chapitre ou un article.' };
  if (typeof targetId !== 'string' || !targetId || targetId.length > 100) return { error: 'Élément visé invalide.' };
  if (!(PROPOSABLE_FIELDS[targetType as ProposableTarget] as readonly string[]).includes(field)) {
    return { error: `Ce champ ne peut pas faire l'objet d'une proposition : ${String(field)}.` };
  }
  const base = { lotId, targetType: targetType as ProposableTarget, targetId, field: field as ProposableField };
  if (NUMERIC_FIELDS.includes(field)) {
    const parsed = parseNumberValue(value, field === 'quantite' ? 'Quantité' : 'Prix unitaire');
    if ('error' in parsed) return { error: parsed.error };
    return { input: { ...base, value: String(parsed.number) } };
  }
  if (field === 'metre') {
    // Une liste de lignes { libelle, expression } : chaque calcul valide, total positif ou nul, forme canonique.
    const parsed = parseMetreValue(value);
    if ('error' in parsed) return { error: parsed.error };
    if (parsed.value.length > MAX_PROPOSAL_VALUE) return { error: 'Métré trop long.' };
    return { input: { ...base, value: parsed.value } };
  }
  if (typeof value !== 'string') return { error: 'La valeur proposée doit être un texte.' };
  if (REQUIRED_TEXT_FIELDS.includes(field)) {
    const trimmed = value.trim();
    const max = field === 'unite' ? MAX_PROPOSAL_UNIT : MAX_PROPOSAL_TITLE;
    if (!trimmed) return { error: 'Cet intitulé ne peut pas être vide.' };
    if (trimmed.length > max) return { error: `Trop long (${max} caractères au plus).` };
    return { input: { ...base, value: trimmed } };
  }
  if (value.length > MAX_PROPOSAL_VALUE) return { error: `Texte trop long (${MAX_PROPOSAL_VALUE} caractères).` };
  return { input: { ...base, value } };
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
  const lastLimitAlert = new Map<string, number>();

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
    const { data, error } = await supabaseAdmin.from('dpgfs').select('id, data, revision')
      .eq('project_id', projectId).eq('tenant_id', tenantId).maybeSingle();
    if (error || !data) return null;
    const doc = parseDocument(data.data);
    return doc ? { id: data.id as string, raw: data.data, revision: Number(data.revision ?? 0), doc } : null;
  }

  /** Le titre d'un lot vient de `project_lots`, jamais du document (qui le reçoit de là à chaque lecture). */
  async function loadLotTitle(tenantId: string, projectId: string, lotId: string): Promise<string | null> {
    const { data } = await supabaseAdmin.from('project_lots').select('id, lot_title')
      .eq('id', lotId).eq('tenant_id', tenantId).eq('project_id', projectId).maybeSingle();
    return data ? String(data.lot_title ?? '') : null;
  }

  /**
   * Alerte le cabinet (administrateurs et managers) qu'un confrère a atteint la limite de
   * propositions en attente : par notification système et dans le journal d'activité. Au plus une
   * alerte par heure et par partage, pour ne pas inonder le cabinet si le confrère insiste.
   */
  async function alertLimitReached(share: ShareRow, pending: number) {
    const now = Date.now();
    if ((lastLimitAlert.get(share.id) ?? 0) > now - LIMIT_ALERT_COOLDOWN_MS) return;
    lastLimitAlert.set(share.id, now);
    try {
      const members = await tenantMembershipsByUser(supabaseAdmin, share.tenant_id);
      const recipients = [...members].filter(([, m]) => m.systemRole === 'admin' || m.systemRole === 'manager').map(([id]) => id);
      const { data: project } = await supabaseAdmin.from('projects').select('name').eq('id', share.project_id).maybeSingle();
      await notifyUsers(supabaseAdmin, share.tenant_id, recipients, {
        title: 'Limite de propositions atteinte',
        body: `${share.email} a ${pending} propositions en attente sur « ${project?.name ?? 'une affaire'} ». Traitez-les pour qu'il puisse en déposer d'autres.`,
        url: `/projects/${share.project_id}`,
        category: 'Affaires',
        tag: `share-limit:${share.id}`,
      });
      logActivity(share.tenant_id, share.user_id, share.email, `Limite de ${MAX_PENDING_PER_SHARE} propositions en attente atteinte (confrère externe)`, share.email, share.id, 'project', 'Affaires');
    } catch (e) {
      console.error('[alertLimitReached]', e);
    }
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
      const kind = FIELD_KIND[field];
      if (!allows(grants, kind, 'write', lotId)) {
        return res.status(403).json({ error: 'Vous n\'avez pas le droit de proposer cette modification sur ce lot.', code: 'SHARE_FORBIDDEN' });
      }
      if (await isProjectArchived(supabaseAdmin, share.tenant_id, share.project_id)) {
        return res.status(409).json({ error: 'Affaire archivée : lecture seule.', code: 'PROJECT_ARCHIVED' });
      }

      const row = await loadRow(share.tenant_id, share.project_id);
      if (!row) return res.status(404).json({ error: 'Document introuvable.' });
      // On ne propose de modifier que ce qu'on VOIT, dans la vue qui correspond au champ (une ligne
      // réservée au CCTP n'a ni quantité ni prix : elle n'existe pas dans la vue DPGF).
      const view = guestDocumentView(row.doc, kind, new Set([lotId]));
      if (!view.lots.length || !visibleNodes(view.lots[0])[targetType].has(targetId)) {
        return res.status(404).json({ error: 'Élément introuvable dans ce lot.' });
      }
      const node = findRawNode(row.doc, lotId, targetType, targetId);
      if (!node) return res.status(404).json({ error: 'Élément introuvable dans ce lot.' });
      if (targetType === 'ligne') {
        const blocked = blockedEdit(node, field);
        if (blocked) return res.status(400).json({ error: blocked, code: 'PROPOSAL_NOT_ALLOWED' });
      }
      let current: string;
      if (targetType === 'lot') {
        const title = await loadLotTitle(share.tenant_id, share.project_id, lotId);
        if (title === null) return res.status(404).json({ error: 'Lot introuvable.' });
        current = title;
      } else {
        current = readField(node, field);
      }
      if (sameFieldValue(field, value, current)) return res.status(400).json({ error: 'Aucun changement par rapport à la valeur actuelle.' });

      // Une nouvelle proposition sur le même champ remplace la précédente en attente (retirée, jamais perdue).
      const { data: pending } = await supabaseAdmin.from('project_share_proposals').select('id, target_type, target_id, field')
        .eq('share_id', share.id).eq('status', 'pending');
      const mine = (pending || []) as any[];
      const superseded = mine.filter(p => p.target_type === targetType && p.target_id === targetId && p.field === field);
      if (mine.length - superseded.length >= MAX_PENDING_PER_SHARE) {
        // La limite protège le cabinet d'un afflux, jamais au prix d'une perte : rien n'est supprimé, la
        // demande est refusée avec une alerte, et le cabinet est prévenu.
        await alertLimitReached(share, mine.length);
        return res.status(409).json({
          error: `Limite atteinte : vous avez déjà ${mine.length} propositions en attente (${MAX_PENDING_PER_SHARE} au plus). Le cabinet en a été informé ; vous pourrez en déposer d'autres dès qu'il aura traité les vôtres. Votre texte n'est pas perdu : il reste dans le formulaire.`,
          code: 'PROPOSAL_LIMIT', pending: mine.length, limit: MAX_PENDING_PER_SHARE,
        });
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
      logActivity(share.tenant_id, req.user.id, userName, 'Proposition de modification du CCTP ou du DPGF (confrère externe)', share.email, created.id, 'project', 'Affaires');
      res.status(201).json(proposalView(created, { pending: mine.length - superseded.length + 1, limit: MAX_PENDING_PER_SHARE }));
    } catch (e: any) { fail(res, '[POST /api/shared/projects/:id/proposals]', e); }
  });

  app.get('/api/shared/projects/:id/proposals', async (req: any, res: any) => {
    try {
      const found = await guestShare(req, res);
      if (!found) return;
      const { data } = await supabaseAdmin.from('project_share_proposals').select('*')
        .eq('share_id', found.share.id).eq('tenant_id', found.share.tenant_id);
      // Un droit de lecture retiré masque aussi les propositions du lot (elles restent en base).
      const rows = (data || []).filter((p: any) => allows(found.grants, FIELD_KIND[p.field as ProposableField] ?? 'cctp', 'read', p.project_lot_id));
      const pending = rows.filter((p: any) => p.status === 'pending').length;
      res.json(rows
        .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((p: any) => proposalView(p, { pending, limit: MAX_PENDING_PER_SHARE })));
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
      // « Retirer » ne supprime pas la ligne : elle passe à `withdrawn` et garde ses valeurs.
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
      const { data: lots } = await supabaseAdmin.from('project_lots').select('id, lot_title')
        .eq('project_id', req.params.id).eq('tenant_id', tenantId);
      const lotTitles = new Map<string, string>((lots || []).map((l: any) => [l.id, String(l.lot_title ?? '')]));
      const doc = (await loadRow(tenantId, req.params.id))?.doc ?? null;
      const labels = doc ? nodeLabels(doc) : new Map<string, string>();
      const pendingByShare = new Map<string, number>();
      rows.filter(p => p.status === 'pending').forEach(p => pendingByShare.set(p.share_id, (pendingByShare.get(p.share_id) ?? 0) + 1));
      res.json(rows
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map(p => {
          let currentValue: string | null;
          if (p.target_type === 'lot') currentValue = lotTitles.get(p.project_lot_id) ?? null;
          else {
            const node = doc ? findRawNode(doc, p.project_lot_id, p.target_type, p.target_id) : null;
            currentValue = node ? readField(node, p.field) : null;
          }
          const pendingOfShare = pendingByShare.get(p.share_id) ?? 0;
          // Un prix proposé sur un article « pour mémoire » le chiffre : il quittera « pour mémoire » et
          // entrera dans le total du lot. Le cabinet doit le voir AVANT d'approuver, pas après.
          const node = p.target_type === 'ligne' && doc ? findRawNode(doc, p.project_lot_id, p.target_type, p.target_id) : null;
          const leavesPourMemoire = p.status === 'pending' && p.field === 'prixUnitaire' && !!node?.pourMemoire && Number(p.proposed_value) > 0;
          return proposalView(p, {
            leavesPourMemoire,
            guestEmail: emails.get(p.share_id) ?? null,
            targetLabel: labels.get(p.target_id) ?? null,
            currentValue,
            // En attente mais le champ a changé depuis : l'approuver sera refusé.
            outdated: p.status === 'pending' && (currentValue === null || !sameFieldValue(p.field, currentValue, p.base_value)),
            // Appliquée, mais le champ ne vaut plus la valeur proposée : un onglet PRO périmé a pu la remettre.
            drifted: p.status === 'applied' && currentValue !== null && !sameFieldValue(p.field, currentValue, p.proposed_value),
            pendingOfShare,
            maxPending: MAX_PENDING_PER_SHARE,
            limitReached: pendingOfShare >= MAX_PENDING_PER_SHARE,
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

  const OUTDATED = {
    error: 'La valeur a changé depuis cette proposition (ou l\'élément n\'existe plus) : elle est périmée, rien n\'a été écrit. Demandez au confrère de la refaire.',
    code: 'PROPOSAL_OUTDATED',
  };
  const CONFLICT = {
    error: 'Le document a été modifié pendant l\'application : rien n\'a été écrit, réessayez.',
    code: 'PROPOSAL_CONFLICT',
  };

  app.post('/api/projects/:id/share-proposals/:proposalId/approve', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      const proposal = await loadPending(tenantId, req.params.id, req.params.proposalId, res);
      if (!proposal) return;
      if (await isProjectArchived(supabaseAdmin, tenantId, proposal.project_id)) {
        return res.status(409).json({ error: 'Affaire archivée : rouvrez-la pour appliquer la proposition.', code: 'PROJECT_ARCHIVED' });
      }
      const { data: shareRow } = await supabaseAdmin.from('project_shares').select('email').eq('id', proposal.share_id).maybeSingle();
      const email = shareRow?.email ?? 'un confrère';
      let summary: string;
      let leftPourMemoire = false;

      if (proposal.target_type === 'lot') {
        // Le titre d'un lot est dans `project_lots` : écriture conditionnelle à l'ancien titre, que la
        // proposition conserve (valeur de départ) : rien n'est perdu.
        const title = await loadLotTitle(tenantId, proposal.project_id, proposal.project_lot_id);
        if (title === null || title !== proposal.base_value) {
          await markOutdated(proposal, req.user.id, tenantId);
          return res.status(409).json(OUTDATED);
        }
        const { data: written, error: writeError } = await supabaseAdmin.from('project_lots')
          .update({ lot_title: proposal.proposed_value })
          .eq('id', proposal.project_lot_id).eq('tenant_id', tenantId).eq('lot_title', proposal.base_value).select('id');
        if (writeError) throw writeError;
        if (!written?.length) return res.status(409).json(CONFLICT);
        summary = `Titre du lot « ${proposal.base_value} » remplacé par « ${proposal.proposed_value} »`;
      } else {
        const row = await loadRow(tenantId, proposal.project_id);
        if (!row) return res.status(404).json({ error: 'Document introuvable.' });
        const node = findRawNode(row.doc, proposal.project_lot_id, proposal.target_type, proposal.target_id);
        // Garde-fou 1 : le champ doit toujours valoir ce que l'invité a vu, et l'article rester modifiable
        // (il a pu recevoir des sous-articles, passer pour mémoire ou être réparti par bâtiment entre-temps).
        if (!node || !sameFieldValue(proposal.field, readField(node, proposal.field), proposal.base_value)
          || (proposal.target_type === 'ligne' && blockedEdit(node, proposal.field))) {
          await markOutdated(proposal, req.user.id, tenantId);
          return res.status(409).json(OUTDATED);
        }

        // Garde-fou 2 : un instantané du document AVANT toute écriture, restaurable depuis l'historique du DPGF.
        const before = parseDocument(row.raw);
        const { error: snapError } = await supabaseAdmin.from('dpgf_versions').insert({
          id: crypto.randomUUID(), tenant_id: tenantId, project_id: proposal.project_id, dpgf_id: row.id,
          label: `Avant la proposition de ${email}`, phase: null, version: (before as any)?.version ?? null,
          document: before, created_by: req.user.id, created_at: new Date().toISOString(),
        });
        if (snapError) throw snapError;

        // Garde-fou 3 : écriture conditionnelle à l'état exact du document lu. L'instantané reste, même
        // en cas d'échec : on ne supprime rien.
        leftPourMemoire = applyFieldToNode(node, proposal.field, proposal.proposed_value).leftPourMemoire;
        if (RECOMPUTE_FIELDS.includes(proposal.field)) recomputeAfterNumericChange(row.doc, proposal.project_lot_id);
        // Conditionnelle à la RÉVISION lue (dpgfs.revision, incrémentée par un déclencheur SQL à chaque
        // changement du document), pas au texte du document : il pèse plusieurs centaines de Ko et un
        // filtre PostgREST passe dans l'URL.
        const { data: written, error: writeError } = await supabaseAdmin.from('dpgfs')
          .update({ data: JSON.stringify(row.doc) })
          .eq('id', row.id).eq('tenant_id', tenantId).eq('revision', row.revision).select('id');
        if (writeError) throw writeError;
        if (!written?.length) return res.status(409).json(CONFLICT);
        summary = `Proposition de ${email} appliquée (${proposal.field})${leftPourMemoire ? ' : l\'article quitte « pour mémoire » et entre dans le total' : ''}`;
      }

      const { data: updated, error } = await supabaseAdmin.from('project_share_proposals')
        .update({ status: 'applied', decided_by: req.user.id, decided_at: new Date().toISOString() })
        .eq('id', proposal.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `${summary} (proposition de ${email}, appliquée)`, email, proposal.id, 'project', 'Affaires');
      res.json(proposalView(updated, { applied: true, leftPourMemoire }));
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
