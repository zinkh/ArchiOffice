// Partage d'une affaire avec un confrère (collaborateur externe).
//
// Deux familles de routes :
//  - côté cabinet (`/api/projects/:id/shares`) : inviter, régler les droits,
//    retirer. Réservé aux administrateurs et managers ;
//  - côté invité (`/api/shared/...`) : lire et, si le droit est accordé,
//    écrire sur l'affaire partagée. Ces routes ne dépendent PAS du cabinet
//    actif (X-Tenant-Id) : le cabinet vient du partage lui-même, ce qui
//    sert aussi bien un invité sans cabinet qu'un architecte qui a le sien.
//
// Chaque route d'invité revérifie le droit sur le serveur, à chaque requête
// (voir server/projectShares/access.ts) ; l'écran ne fait que masquer.
// Voir CLAUDE.md, « Partage d'une affaire avec un confrère ».
import type { Express } from 'express';
import { isValidEmail } from '../../src/lib/crDiffusion';
import { assertTenantEntity } from '../assertTenantEntity';
import { sendPlatformMail } from '../mailer';
import { invalidateGuestRoleCache } from '../guestAccessGuard';
import { isProjectArchived } from './projectArchive';
import {
  addMembership, getMemberRole, listMemberships, removeMembership,
} from '../tenantMemberships';
import {
  GUEST_ROLE_LABEL, GUEST_SYSTEM_ROLE, SHARE_KINDS, SHARE_LIMITS, WRITABLE_KINDS,
  activeShareFor, activeSharesOfTenant, allows, checkShareLimits, loadGrants,
  normalizeGrants, replaceGrants,
  type ShareGrant, type ShareRow,
} from '../projectShares/access';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => any;
}

const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'];
const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ce qu'un invité peut lire, champ par champ. On construit la réponse à partir
// de ces listes plutôt que de rendre la ligne lue : une colonne ajoutée demain
// à `tasks` ou `project_lots` (assignee_id, contact_id, tenant_id...) ne doit
// jamais fuiter vers un tiers par simple oubli.
const PROJECT_FIELDS = ['id', 'name', 'project_code', 'address'] as const;
const LOT_FIELDS = ['id', 'lot_number', 'lot_title'] as const;
const TASK_FIELDS = ['id', 'title', 'start_date', 'end_date', 'progress', 'status', 'due_date', 'description', 'priority'] as const;
const TASK_SELECT = TASK_FIELDS.join(', ');

function pick(row: any, keys: readonly string[]): Record<string, any> {
  return Object.fromEntries(keys.map(k => [k, row?.[k] ?? null]));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Champs d'une tâche qu'un confrère peut écrire, validés. Les autres champs de la requête sont ignorés. */
export function readTaskFields(body: any, mode: 'create' | 'update'): { fields: Record<string, any> } | { error: string } {
  const fields: Record<string, any> = {};
  const has = (k: string) => body && body[k] !== undefined;

  if (has('title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) return { error: 'Titre invalide (1 à 200 caractères).' };
    fields.title = body.title.trim();
  } else if (mode === 'create') return { error: 'Le titre est obligatoire.' };

  for (const key of ['start_date', 'end_date'] as const) {
    if (has(key)) {
      if (typeof body[key] !== 'string' || !DATE_RE.test(body[key])) return { error: `${key} doit être au format AAAA-MM-JJ.` };
      fields[key] = body[key];
    } else if (mode === 'create') return { error: 'Les dates de début et de fin sont obligatoires.' };
  }
  if (fields.start_date && fields.end_date && fields.end_date < fields.start_date) {
    return { error: 'La date de fin précède la date de début.' };
  }
  if (has('due_date')) {
    if (body.due_date !== null && (typeof body.due_date !== 'string' || !DATE_RE.test(body.due_date))) return { error: 'due_date doit être au format AAAA-MM-JJ.' };
    fields.due_date = body.due_date;
  }
  if (has('progress')) {
    if (!Number.isInteger(body.progress) || body.progress < 0 || body.progress > 100) return { error: 'Avancement entre 0 et 100.' };
    fields.progress = body.progress;
  }
  if (has('status')) {
    if (!TASK_STATUSES.includes(body.status)) return { error: 'Statut inconnu.' };
    fields.status = body.status;
  }
  if (has('priority')) {
    if (!TASK_PRIORITIES.includes(body.priority)) return { error: 'Priorité inconnue.' };
    fields.priority = body.priority;
  }
  if (has('description')) {
    if (body.description !== null && (typeof body.description !== 'string' || body.description.length > 5000)) return { error: 'Description trop longue (5000 caractères).' };
    fields.description = body.description;
  }
  return { fields };
}

export function registerProjectShareRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  /** Cabinet de l'appelant, à condition qu'il y soit administrateur ou manager : on n'ouvre pas ses données à un tiers sans en avoir le pouvoir. */
  async function requireSharer(userId: string): Promise<string> {
    const tenantId = await getTenantId(userId);
    const membership = await getMemberRole(supabaseAdmin, tenantId, userId);
    if (!membership || !['admin', 'manager'].includes(membership.systemRole ?? '')) {
      const err: any = new Error('Réservé aux administrateurs et managers du cabinet.');
      err.status = 403;
      throw err;
    }
    return tenantId;
  }

  const fail = (res: any, label: string, e: any) => {
    if (e?.status) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error(label, e);
    return res.status(500).json({ error: 'Opération impossible, réessayez.' });
  };

  async function shareView(shares: ShareRow[]) {
    const grants = await loadGrants(supabaseAdmin, shares.map(s => s.id));
    const ids = [...new Set(shares.map(s => s.user_id))];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data } = await supabaseAdmin.from('profiles').select('id, name').in('id', ids);
      (data || []).forEach((p: any) => names.set(p.id, p.name));
    }
    return shares.map(s => ({
      id: s.id, userId: s.user_id, email: s.email, name: names.get(s.user_id) ?? null,
      createdAt: s.created_at ?? null, grants: grants.get(s.id) ?? [],
    }));
  }

  // ─── Côté cabinet ────────────────────────────────────────────────────────────

  app.get('/api/projects/:id/shares', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', req.params.id, tenantId))) {
        return res.status(404).json({ error: 'Affaire introuvable.' });
      }
      const active = await activeSharesOfTenant(supabaseAdmin, tenantId);
      const onProject = active.filter(s => s.project_id === req.params.id);
      res.json({
        shares: await shareView(onProject),
        limits: SHARE_LIMITS,
        usage: { project: onProject.length, tenant: new Set(active.map(s => s.user_id)).size },
        kinds: SHARE_KINDS,
        writableKinds: WRITABLE_KINDS,
      });
    } catch (e: any) { fail(res, '[GET /api/projects/:id/shares]', e); }
  });

  app.post('/api/projects/:id/shares', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      const projectId = req.params.id;
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
      const parsed = normalizeGrants(req.body?.grants);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });

      const { data: project } = await supabaseAdmin.from('projects').select('id, name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });

      const { data: existingProfile } = await supabaseAdmin.from('profiles').select('id, name').eq('email', email).maybeSingle();
      if (existingProfile?.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas vous inviter vous-même.' });

      const memberships = existingProfile ? await listMemberships(supabaseAdmin, existingProfile.id) : [];
      if (memberships.some(m => m.tenantId === tenantId && m.systemRole !== GUEST_SYSTEM_ROLE)) {
        return res.status(409).json({ error: 'Cette personne est déjà membre du cabinet : ajoutez-la comme membre de l\'affaire.', code: 'ALREADY_MEMBER' });
      }

      let previous: any = null;
      if (existingProfile) {
        const { data } = await supabaseAdmin.from('project_shares').select('*').eq('project_id', projectId).eq('user_id', existingProfile.id).maybeSingle();
        previous = data;
        if (previous?.status === 'active') {
          return res.status(409).json({ error: 'L\'affaire est déjà partagée avec cette personne : modifiez ses droits.', code: 'ALREADY_SHARED' });
        }
      }

      // Les limites de la gratuité se vérifient AVANT de créer un compte : une
      // invitation refusée ne doit pas laisser derrière elle un compte inutile.
      const limit = checkShareLimits(await activeSharesOfTenant(supabaseAdmin, tenantId), projectId, existingProfile?.id ?? '__nouveau__');
      if (!limit.ok) return res.status(402).json({ error: limit.message, code: limit.code });

      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      let userId: string;
      let actionLink: string | null = null;
      if (existingProfile) {
        userId = existingProfile.id;
        // Sans cabinet à lui, il lui faut une adhésion `guest` pour entrer dans
        // l'application ; avec un cabinet, il passe par son propre compte.
        if (memberships.length === 0) {
          await addMembership(supabaseAdmin, { userId, tenantId, role: GUEST_ROLE_LABEL, systemRole: GUEST_SYSTEM_ROLE, makeDefault: true });
          invalidateGuestRoleCache(userId);
        }
      } else {
        const name = (typeof req.body?.name === 'string' && req.body.name.trim()) || email.split('@')[0];
        const { data: linkData, error: authErr } = await supabaseAdmin.auth.admin.generateLink({
          type: 'invite', email, options: { data: { name }, redirectTo: `${appUrl}/reset-password` },
        });
        if (authErr || !linkData?.user) return res.status(500).json({ error: authErr?.message || 'Création du compte impossible.' });
        userId = linkData.user.id;
        actionLink = linkData.properties?.action_link ?? null;
        await supabaseAdmin.from('profiles').upsert({
          id: userId, tenant_id: tenantId, name: name.slice(0, 120), email, role: GUEST_ROLE_LABEL, system_role: GUEST_SYSTEM_ROLE,
        });
        await addMembership(supabaseAdmin, { userId, tenantId, role: GUEST_ROLE_LABEL, systemRole: GUEST_SYSTEM_ROLE, makeDefault: true });
        invalidateGuestRoleCache(userId);
      }

      let share: any;
      if (previous) {
        const { data, error } = await supabaseAdmin.from('project_shares')
          .update({ status: 'active', revoked_at: null, invited_by: req.user.id, email })
          .eq('id', previous.id).select().single();
        if (error) throw error;
        share = data;
      } else {
        const { data, error } = await supabaseAdmin.from('project_shares')
          .insert({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: projectId, user_id: userId, email, status: 'active', invited_by: req.user.id })
          .select().single();
        if (error) throw error;
        share = data;
      }
      await replaceGrants(supabaseAdmin, share, parsed.grants);

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Partage de l'affaire "${project.name}" avec ${email}`, project.name, projectId, 'project', 'Affaires');

      const { data: tenant } = await supabaseAdmin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
      const cabinet = escapeHtml(tenant?.name || 'un cabinet d\'architecture');
      const link = actionLink || `${appUrl}/partages`;
      const emailSent = await sendPlatformMail(
        email,
        `${tenant?.name || 'Un cabinet'} partage une affaire avec vous sur ArchiOffice`,
        `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
          <h2 style="margin:0 0 12px">Affaire partagée avec vous</h2>
          <p>${cabinet} vous invite à collaborer sur l'affaire <strong>${escapeHtml(project.name)}</strong> dans ArchiOffice.</p>
          <p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#111;color:#fff;padding:10px 20px;text-decoration:none">${actionLink ? 'Choisir mon mot de passe et accéder à l\'affaire' : 'Ouvrir les affaires partagées'}</a></p>
          <p style="color:#555;font-size:13px">Votre accès est limité à cette affaire et aux éléments que le cabinet a choisi de partager. Il est gratuit.</p>
        </div>`,
      );
      res.status(201).json({ ...(await shareView([share as ShareRow]))[0], emailSent });
    } catch (e: any) { fail(res, '[POST /api/projects/:id/shares]', e); }
  });

  app.put('/api/projects/:id/shares/:shareId', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      const parsed = normalizeGrants(req.body?.grants);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      const { data: share } = await supabaseAdmin.from('project_shares').select('*')
        .eq('id', req.params.shareId).eq('tenant_id', tenantId).eq('project_id', req.params.id).maybeSingle();
      if (!share) return res.status(404).json({ error: 'Partage introuvable.' });
      if (share.status !== 'active') return res.status(409).json({ error: 'Ce partage a été retiré : invitez de nouveau la personne.' });
      await replaceGrants(supabaseAdmin, share, parsed.grants);
      res.json((await shareView([share as ShareRow]))[0]);
    } catch (e: any) { fail(res, '[PUT /api/projects/:id/shares/:shareId]', e); }
  });

  app.delete('/api/projects/:id/shares/:shareId', async (req: any, res: any) => {
    try {
      const tenantId = await requireSharer(req.user.id);
      const { data: share } = await supabaseAdmin.from('project_shares').select('*')
        .eq('id', req.params.shareId).eq('tenant_id', tenantId).eq('project_id', req.params.id).maybeSingle();
      if (!share) return res.status(404).json({ error: 'Partage introuvable.' });

      // Droits d'abord : un échec en cours de route laisse au pire un partage
      // sans droit, c'est-à-dire fermé.
      await replaceGrants(supabaseAdmin, share, []);
      const { error } = await supabaseAdmin.from('project_shares')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', share.id);
      if (error) throw error;

      // Plus aucun partage actif dans ce cabinet : l'adhésion `guest` n'a plus
      // de raison d'être. Les adhésions d'un vrai membre ne sont jamais touchées.
      const stillShared = (await activeSharesOfTenant(supabaseAdmin, tenantId)).some(s => s.user_id === share.user_id);
      if (!stillShared) {
        const membership = await getMemberRole(supabaseAdmin, tenantId, share.user_id);
        if (membership?.systemRole === GUEST_SYSTEM_ROLE) await removeMembership(supabaseAdmin, share.user_id, tenantId);
      }
      invalidateGuestRoleCache(share.user_id);

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Retrait du partage de l'affaire avec ${share.email}`, share.email, req.params.id, 'project', 'Affaires');
      res.json({ success: true });
    } catch (e: any) { fail(res, '[DELETE /api/projects/:id/shares/:shareId]', e); }
  });

  // ─── Côté invité ─────────────────────────────────────────────────────────────

  /** Le partage actif de l'appelant sur l'affaire, sinon 404 : on ne révèle pas l'existence d'une affaire non partagée. */
  async function guestShare(req: any, res: any) {
    const found = await activeShareFor(supabaseAdmin, req.user.id, req.params.id);
    if (!found) { res.status(404).json({ error: 'Affaire introuvable ou non partagée avec vous.' }); return null; }
    return found;
  }

  app.get('/api/shared/projects', async (req: any, res: any) => {
    try {
      const { data: shares } = await supabaseAdmin.from('project_shares').select('*').eq('user_id', req.user.id).eq('status', 'active');
      const rows = (shares || []) as ShareRow[];
      if (!rows.length) return res.json([]);
      const [{ data: projects }, { data: tenants }, grants] = await Promise.all([
        supabaseAdmin.from('projects').select('id, name, project_code, address').in('id', rows.map(s => s.project_id)),
        supabaseAdmin.from('tenants').select('id, name').in('id', [...new Set(rows.map(s => s.tenant_id))]),
        loadGrants(supabaseAdmin, rows.map(s => s.id)),
      ]);
      const projectById = new Map<string, any>((projects || []).map((p: any) => [p.id, p]));
      const tenantById = new Map<string, any>((tenants || []).map((t: any) => [t.id, t]));
      res.json(rows
        .filter(s => projectById.has(s.project_id))
        .map(s => ({
          shareId: s.id, projectId: s.project_id,
          projectName: projectById.get(s.project_id).name,
          projectCode: projectById.get(s.project_id).project_code ?? null,
          address: projectById.get(s.project_id).address ?? null,
          tenantName: tenantById.get(s.tenant_id)?.name ?? null,
          grants: grants.get(s.id) ?? [],
        })));
    } catch (e: any) { fail(res, '[GET /api/shared/projects]', e); }
  });

  app.get('/api/shared/projects/:id', async (req: any, res: any) => {
    try {
      const found = await guestShare(req, res);
      if (!found) return;
      const { share, grants } = found;
      const { data: project } = await supabaseAdmin.from('projects').select('id, name, project_code, address').eq('id', share.project_id).eq('tenant_id', share.tenant_id).maybeSingle();
      if (!project) return res.status(404).json({ error: 'Affaire introuvable ou non partagée avec vous.' });
      let lots: any[] | undefined;
      if (allows(grants, 'lots', 'read')) {
        // Numéro et intitulé seulement : le contact (entreprise) du lot reste au cabinet.
        const { data } = await supabaseAdmin.from('project_lots').select('id, lot_number, lot_title').eq('project_id', share.project_id).eq('tenant_id', share.tenant_id);
        lots = data || [];
      }
      res.json({
        project: pick(project, PROJECT_FIELDS), grants,
        archived: await isProjectArchived(supabaseAdmin, share.tenant_id, share.project_id),
        ...(lots ? { lots: lots.map(l => pick(l, LOT_FIELDS)) } : {}),
      });
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id]', e); }
  });

  app.get('/api/shared/projects/:id/tasks', async (req: any, res: any) => {
    try {
      const found = await guestShare(req, res);
      if (!found) return;
      if (!allows(found.grants, 'tasks', 'read')) return res.status(403).json({ error: 'Les tâches ne sont pas partagées avec vous.', code: 'SHARE_FORBIDDEN' });
      const { data } = await supabaseAdmin.from('tasks')
        .select(TASK_SELECT)
        .eq('project_id', found.share.project_id).eq('tenant_id', found.share.tenant_id);
      res.json((data || [])
        .map((t: any) => pick(t, TASK_FIELDS))
        .sort((a: any, b: any) => String(a.start_date).localeCompare(String(b.start_date))));
    } catch (e: any) { fail(res, '[GET /api/shared/projects/:id/tasks]', e); }
  });

  /** Écriture d'un confrère : droit « écriture », affaire non archivée, trace dans le journal d'activité. */
  async function guestTaskWriteGuard(req: any, res: any): Promise<{ share: ShareRow; grants: ShareGrant[] } | null> {
    const found = await guestShare(req, res);
    if (!found) return null;
    if (!allows(found.grants, 'tasks', 'write')) {
      res.status(403).json({ error: 'Vous n\'avez pas le droit de modifier les tâches de cette affaire.', code: 'SHARE_FORBIDDEN' });
      return null;
    }
    if (await isProjectArchived(supabaseAdmin, found.share.tenant_id, found.share.project_id)) {
      res.status(409).json({ error: 'Affaire archivée : lecture seule.', code: 'PROJECT_ARCHIVED' });
      return null;
    }
    return found;
  }

  app.post('/api/shared/projects/:id/tasks', async (req: any, res: any) => {
    try {
      const found = await guestTaskWriteGuard(req, res);
      if (!found) return;
      const parsed = readTaskFields(req.body, 'create');
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      const { share } = found;
      const id = crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('tasks').insert({
        id, tenant_id: share.tenant_id, project_id: share.project_id, created_by: req.user.id, ...parsed.fields,
      }).select(TASK_SELECT).single();
      if (error) throw error;
      const userName = await getUserName(share.tenant_id, req.user.id, req.user.email);
      logActivity(share.tenant_id, req.user.id, userName, `Création de la tâche "${data.title}" (confrère externe)`, data.title, id, 'task', 'Tâches');
      res.status(201).json(pick(data, TASK_FIELDS));
    } catch (e: any) { fail(res, '[POST /api/shared/projects/:id/tasks]', e); }
  });

  app.put('/api/shared/projects/:id/tasks/:taskId', async (req: any, res: any) => {
    try {
      const found = await guestTaskWriteGuard(req, res);
      if (!found) return;
      const parsed = readTaskFields(req.body, 'update');
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      if (!Object.keys(parsed.fields).length) return res.status(400).json({ error: 'Aucune modification.' });
      const { share } = found;
      // La tâche doit appartenir à CETTE affaire partagée : un identifiant d'une
      // autre affaire du cabinet est introuvable, pas interdit.
      const { data: task } = await supabaseAdmin.from('tasks').select('id, start_date, end_date')
        .eq('id', req.params.taskId).eq('project_id', share.project_id).eq('tenant_id', share.tenant_id).maybeSingle();
      if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
      const start = parsed.fields.start_date ?? task.start_date;
      const end = parsed.fields.end_date ?? task.end_date;
      if (start && end && end < start) return res.status(400).json({ error: 'La date de fin précède la date de début.' });
      const { data, error } = await supabaseAdmin.from('tasks').update(parsed.fields)
        .eq('id', task.id).eq('tenant_id', share.tenant_id)
        .select(TASK_SELECT).single();
      if (error) throw error;
      const userName = await getUserName(share.tenant_id, req.user.id, req.user.email);
      logActivity(share.tenant_id, req.user.id, userName, `Modification de la tâche "${data.title}" (confrère externe)`, data.title, task.id, 'task', 'Tâches');
      res.json(pick(data, TASK_FIELDS));
    } catch (e: any) { fail(res, '[PUT /api/shared/projects/:id/tasks/:taskId]', e); }
  });
}
