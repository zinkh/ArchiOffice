// CCTP et DPGF partagés avec un confrère : lecture par lot, et commentaires.
//
// Côté invité (`/api/shared/projects/:id/cctp|dpgf|comments`) : le cabinet vient du
// partage, jamais de la requête. Le document est un seul bloc (dpgfs.data) filtré lot
// par lot par server/projectShares/documentView.ts : les lots non accordés, leurs
// prix et les champs internes ne sont jamais construits dans la réponse.
//
// Côté cabinet (`/api/projects/:id/share-comments`) : lire les commentaires de tous les
// confrères, y répondre, les marquer comme traités. Administrateurs et managers.
//
// Un fil de commentaires appartient à UN partage : un confrère ne lit jamais ceux d'un
// autre. Retirer un droit de lecture masque aussi les commentaires du lot concerné.
// Voir CLAUDE.md, « Partage d'une affaire avec un confrère ».
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { withProjectLotTitles } from '../proLotTitles';
import { isProjectArchived } from './projectArchive';
import { makeRequireSharer } from '../projectShares/requireSharer';
import {
  COMMENTABLE_KINDS, activeShareFor, allows, grantedLotIds,
  type ShareGrant, type ShareKind, type ShareRow,
} from '../projectShares/access';
import { guestDocumentView, nodeLabels, parseDocument, visibleNodes, type DocumentMode, type NodeType } from '../projectShares/documentView';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => any;
}

const MODES: readonly DocumentMode[] = ['cctp', 'dpgf'];
const NODE_TYPES: readonly NodeType[] = ['lot', 'chapitre', 'ligne'];
const MAX_BODY = 2000;

/** Un commentaire tel que le rend l'API : jamais les identifiants internes de stockage ni d'autres partages. */
export function commentView(row: any, names: Map<string, string>, shareEmails?: Map<string, string>, labels?: Map<string, string>) {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    resourceKind: row.resource_kind,
    lotId: row.project_lot_id,
    targetType: row.target_type,
    targetId: row.target_id,
    body: row.body,
    authorKind: row.author_kind,
    authorName: names.get(row.author_id) ?? null,
    createdAt: row.created_at ?? null,
    resolvedAt: row.resolved_at ?? null,
    ...(shareEmails ? { shareId: row.share_id, guestEmail: shareEmails.get(row.share_id) ?? null } : {}),
    ...(labels ? { targetLabel: labels.get(row.target_id) ?? null } : {}),
  };
}

export function readCommentBody(value: unknown): { body: string } | { error: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: 'Le commentaire est vide.' };
  if (value.length > MAX_BODY) return { error: `Commentaire trop long (${MAX_BODY} caractères).` };
  return { body: value.trim() };
}

export function registerProjectShareDocumentRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
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

  /** Le document de l'affaire avec les titres de lot à jour, ou null s'il n'existe pas ou est illisible. */
  async function loadDocument(tenantId: string, projectId: string) {
    const { data, error } = await supabaseAdmin.from('dpgfs').select('data')
      .eq('project_id', projectId).eq('tenant_id', tenantId).maybeSingle();
    if (error || !data) return null;
    const doc = parseDocument(data.data);
    return doc ? withProjectLotTitles(supabaseAdmin, tenantId, projectId, doc) : null;
  }

  async function namesOf(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const unique = [...new Set(ids)];
    if (!unique.length) return names;
    const { data } = await supabaseAdmin.from('profiles').select('id, name').in('id', unique);
    (data || []).forEach((p: any) => names.set(p.id, p.name));
    return names;
  }

  // ─── Côté invité : lecture par lot ──────────────────────────────────────────

  for (const mode of MODES) {
    app.get(`/api/shared/projects/:id/${mode}`, async (req: any, res: any) => {
      try {
        const found = await guestShare(req, res);
        if (!found) return;
        const lotIds = grantedLotIds(found.grants, mode, 'read');
        if (!lotIds.size) {
          return res.status(403).json({ error: 'Ce document n\'est pas partagé avec vous.', code: 'SHARE_FORBIDDEN' });
        }
        const doc = await loadDocument(found.share.tenant_id, found.share.project_id);
        if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
        // CCTP : la quantité n'est ajoutée que sur les lots où il a AUSSI le droit DPGF (il y voit déjà
        // cette quantité), pour la proposer depuis le CCTP. Jamais un prix.
        const quantityLotIds = mode === 'cctp' ? grantedLotIds(found.grants, 'dpgf', 'read') : new Set<string>();
        res.json(guestDocumentView(doc, mode, lotIds, quantityLotIds));
      } catch (e: any) { fail(res, `[GET /api/shared/projects/:id/${mode}]`, e); }
    });
  }

  // ─── Côté invité : commentaires ─────────────────────────────────────────────

  app.get('/api/shared/projects/:id/comments', async (req: any, res: any) => {
    try {
      const found = await guestShare(req, res);
      if (!found) return;
      const { data } = await supabaseAdmin.from('project_share_comments').select('*')
        .eq('share_id', found.share.id).eq('tenant_id', found.share.tenant_id);
      // Un droit retiré masque aussi les commentaires du lot : on ne relit que ce qu'on peut encore lire.
      const rows = (data || []).filter((c: any) => allows(found.grants, c.resource_kind as ShareKind, 'read', c.project_lot_id));
      const names = await namesOf(rows.map((c: any) => c.author_id));
      res.json(rows
        .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((c: any) => commentView(c, names)));
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/comments]', e); }
  });

  app.post('/api/shared/projects/:id/comments', async (req: any, res: any) => {
    try {
      const found = await guestShare(req, res);
      if (!found) return;
      const { share, grants } = found;
      const { resourceKind, lotId, targetType, targetId, parentId } = req.body ?? {};
      if (!COMMENTABLE_KINDS.includes(resourceKind)) return res.status(400).json({ error: 'Type de document non commentable.' });
      if (typeof lotId !== 'string' || !lotId) return res.status(400).json({ error: 'Le lot est obligatoire.' });
      if (!NODE_TYPES.includes(targetType) || typeof targetId !== 'string' || !targetId || targetId.length > 100) {
        return res.status(400).json({ error: 'Élément visé invalide.' });
      }
      const parsed = readCommentBody(req.body?.body);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      if (!allows(grants, resourceKind, 'comment', lotId)) {
        return res.status(403).json({ error: 'Vous n\'avez pas le droit de commenter ce lot.', code: 'SHARE_FORBIDDEN' });
      }
      if (await isProjectArchived(supabaseAdmin, share.tenant_id, share.project_id)) {
        return res.status(409).json({ error: 'Affaire archivée : lecture seule.', code: 'PROJECT_ARCHIVED' });
      }

      // On ne commente que ce qu'on VOIT : l'élément doit exister dans la vue de CE lot pour CE type de
      // document (une ligne réservée au CCTP n'existe pas dans la vue DPGF), sans quoi un identifiant
      // deviné servirait à sonder le document.
      const doc = await loadDocument(share.tenant_id, share.project_id);
      if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
      const view = guestDocumentView(doc, resourceKind as DocumentMode, new Set([lotId]));
      if (!view.lots.length || !visibleNodes(view.lots[0])[targetType as NodeType].has(targetId)) {
        return res.status(404).json({ error: 'Élément introuvable dans ce lot.' });
      }

      if (parentId !== undefined && parentId !== null) {
        const { data: parent } = await supabaseAdmin.from('project_share_comments').select('id, share_id, resource_kind, project_lot_id, target_type, target_id')
          .eq('id', String(parentId)).eq('share_id', share.id).maybeSingle();
        // Une réponse reste dans le fil de SON partage, sur le même élément.
        if (!parent || parent.resource_kind !== resourceKind || parent.project_lot_id !== lotId
          || parent.target_type !== targetType || parent.target_id !== targetId) {
          return res.status(404).json({ error: 'Commentaire d\'origine introuvable.' });
        }
      }

      const row = {
        id: crypto.randomUUID(), tenant_id: share.tenant_id, project_id: share.project_id, share_id: share.id,
        parent_id: parentId ?? null, author_id: req.user.id, author_kind: 'guest',
        resource_kind: resourceKind, project_lot_id: lotId, target_type: targetType, target_id: targetId,
        body: parsed.body, created_at: new Date().toISOString(), resolved_at: null, resolved_by: null,
      };
      const { error } = await supabaseAdmin.from('project_share_comments').insert(row);
      if (error) throw error;
      const userName = await getUserName(share.tenant_id, req.user.id, req.user.email);
      logActivity(share.tenant_id, req.user.id, userName, `Commentaire sur le ${resourceKind.toUpperCase()} (confrère externe)`, share.email, row.id, 'project', 'Affaires');
      res.status(201).json(commentView(row, await namesOf([req.user.id])));
    } catch (e: any) { fail(res, '[POST /api/shared/projects/:id/comments]', e); }
  });

  // ─── Côté cabinet : lire, répondre, marquer comme traité ────────────────────

  app.get('/api/projects/:id/share-comments', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', req.params.id, tenantId))) {
        return res.status(404).json({ error: 'Affaire introuvable.' });
      }
      const { data } = await supabaseAdmin.from('project_share_comments').select('*')
        .eq('project_id', req.params.id).eq('tenant_id', tenantId);
      const rows = data || [];
      const { data: shares } = await supabaseAdmin.from('project_shares').select('id, email')
        .eq('project_id', req.params.id).eq('tenant_id', tenantId);
      const emails = new Map<string, string>((shares || []).map((s: any) => [s.id, s.email]));
      const names = await namesOf(rows.map((c: any) => c.author_id));
      // Le cabinet voit tout le document : le commentaire dit sur quoi il porte (numéro et désignation).
      const doc = rows.length ? await loadDocument(tenantId, req.params.id) : null;
      const labels = doc ? nodeLabels(doc) : new Map<string, string>();
      res.json(rows
        .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((c: any) => commentView(c, names, emails, labels)));
    } catch (e: any) { fail(res, '[GET /api/projects/:id/share-comments]', e); }
  });

  app.post('/api/projects/:id/share-comments/:commentId/reply', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      const parsed = readCommentBody(req.body?.body);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      const { data: origin } = await supabaseAdmin.from('project_share_comments').select('*')
        .eq('id', req.params.commentId).eq('project_id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      if (!origin) return res.status(404).json({ error: 'Commentaire introuvable.' });
      const row = {
        id: crypto.randomUUID(), tenant_id: tenantId, project_id: origin.project_id, share_id: origin.share_id,
        parent_id: origin.id, author_id: req.user.id, author_kind: 'cabinet',
        resource_kind: origin.resource_kind, project_lot_id: origin.project_lot_id,
        target_type: origin.target_type, target_id: origin.target_id,
        body: parsed.body, created_at: new Date().toISOString(), resolved_at: null, resolved_by: null,
      };
      const { error } = await supabaseAdmin.from('project_share_comments').insert(row);
      if (error) throw error;
      res.status(201).json(commentView(row, await namesOf([req.user.id])));
    } catch (e: any) { fail(res, '[POST /api/projects/:id/share-comments/:commentId/reply]', e); }
  });

  app.put('/api/projects/:id/share-comments/:commentId', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      if (typeof req.body?.resolved !== 'boolean') return res.status(400).json({ error: '« resolved » doit être vrai ou faux.' });
      const { data: origin } = await supabaseAdmin.from('project_share_comments').select('id')
        .eq('id', req.params.commentId).eq('project_id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      if (!origin) return res.status(404).json({ error: 'Commentaire introuvable.' });
      const patch = req.body.resolved
        ? { resolved_at: new Date().toISOString(), resolved_by: req.user.id }
        : { resolved_at: null, resolved_by: null };
      const { data, error } = await supabaseAdmin.from('project_share_comments').update(patch)
        .eq('id', origin.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(commentView(data, await namesOf([data.author_id])));
    } catch (e: any) { fail(res, '[PUT /api/projects/:id/share-comments/:commentId]', e); }
  });
}
