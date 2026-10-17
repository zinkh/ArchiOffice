// Journal des appels téléphoniques du cabinet, attribués à un collaborateur.
//
// Tous les rôles voient tous les appels du cabinet (le filtre « Mes appels » de
// l'écran est un confort, pas une barrière). L'attribution à un collaborateur
// le prévient par notification, sauf s'il s'attribue lui-même l'appel. Un appel
// peut devenir une tâche (POST /:id/task), liée par phone_calls.task_id.
import type { Express } from 'express';
import crypto from 'node:crypto';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';
import { findMembership } from '../tenantMemberships';
import { notifyUsers } from '../push';
import { validateBody } from '../../src/lib/validateRequest';
import { createPhoneCallSchema, updatePhoneCallSchema } from '../../src/schemas/phoneCall.schema';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

// Liste blanche des colonnes qu'un PUT peut écrire : c'est elle, et non le
// schéma Zod (passthrough), qui empêche un tenant_id ou un created_by venu du
// corps de requête d'atteindre l'UPDATE.
const UPDATABLE_FIELDS = [
  'direction', 'called_at', 'duration_minutes', 'caller_name', 'caller_company',
  'caller_phone', 'caller_email', 'contact_id', 'project_id', 'subject', 'notes',
  'assignee_id', 'status', 'priority', 'callback_due',
] as const;

const MAX_LIST = 500;
const DEFAULT_LIST = 200;

// Catégorie du flux d'activité et des notifications : une attribution d'appel
// est de même nature qu'une attribution de tâche, et ne justifie pas une
// catégorie de plus à tenir en phase dans cinq listes.
const CATEGORY = 'Tâches';

function blankToNull(value: unknown): unknown {
  return value === '' ? null : value;
}

// Instance dont la base n'a pas encore joué supabase/migrate_phone_calls.sql :
// la lecture rend une liste vide et l'écriture un 503 explicite, sans casser le
// reste de l'application (même convention que le journal de l'opération).
function isMissingTable(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42P01' || error?.code === 'PGRST205' || (/phone_calls/.test(message) && /does not exist|schema cache/i.test(message));
}

const MIGRATION_MISSING = 'Le journal des appels n\'est pas encore disponible sur cette instance (migration phone_calls à appliquer).';

function sendFailure(res: any, error: any, fallback: string) {
  console.error(error);
  if (isMissingTable(error)) return res.status(503).json({ error: MIGRATION_MISSING });
  return res.status(500).json({ error: fallback });
}

function whoCalled(call: { caller_name?: string | null; caller_company?: string | null }): string {
  return [call.caller_name, call.caller_company].filter(Boolean).join(' · ');
}

export function buildTaskFromCall(call: any, today: string) {
  const who = whoCalled(call);
  const lines = [
    who && `Interlocuteur : ${who}`,
    call.caller_phone && `Téléphone : ${call.caller_phone}`,
    call.caller_email && `E-mail : ${call.caller_email}`,
    call.notes && `Notes de l'appel :\n${call.notes}`,
  ].filter(Boolean);
  const due = call.callback_due ? String(call.callback_due).slice(0, 10) : null;
  return {
    title: `Suite à l'appel : ${call.subject}`,
    description: lines.length ? lines.join('\n') : null,
    start_date: today,
    end_date: due && due > today ? due : today,
    due_date: due,
    priority: call.priority || 'normal',
    assignee_id: call.assignee_id || null,
    project_id: call.project_id || null,
  };
}

export function registerPhoneCallRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  async function checkReferences(
    tenantId: string,
    refs: { project_id?: unknown; contact_id?: unknown; assignee_id?: unknown },
  ): Promise<string | null> {
    if (refs.project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', refs.project_id as string, tenantId))) {
      return 'Projet introuvable pour ce cabinet.';
    }
    if (refs.contact_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', refs.contact_id as string, tenantId))) {
      return 'Contact introuvable pour ce cabinet.';
    }
    if (refs.assignee_id && !(await findMembership(supabaseAdmin, refs.assignee_id as string, tenantId))) {
      return 'Assigné introuvable pour ce cabinet.';
    }
    return null;
  }

  async function notifyAssignee(tenantId: string, actorId: string, actorName: string, call: any) {
    if (!call.assignee_id || call.assignee_id === actorId) return;
    const who = whoCalled(call);
    await notifyUsers(supabaseAdmin, tenantId, [call.assignee_id], {
      title: `${actorName} vous a attribué un appel`,
      body: [who, call.subject].filter(Boolean).join(' : ').slice(0, 200),
      url: `/appels?open=${encodeURIComponent(call.id)}`,
      category: CATEGORY,
      tag: `phone-call:${call.id}`,
    });
  }

  app.get('/api/phone-calls', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { assignee_id, status, project_id, contact_id, from, to } = req.query;
      const requested = Number.parseInt(String(req.query.limit ?? ''), 10);
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIST) : DEFAULT_LIST;
      const query = tenantScopedFrom(supabaseAdmin, tenantId, 'phone_calls').select('*');
      if (assignee_id === 'none') query.is('assignee_id', null);
      else if (assignee_id) query.eq('assignee_id', assignee_id as string);
      if (status) query.eq('status', status as string);
      if (project_id) query.eq('project_id', project_id as string);
      if (contact_id) query.eq('contact_id', contact_id as string);
      if (from) query.gte('called_at', from as string);
      if (to) query.lte('called_at', to as string);
      const { data, error } = await query.order('called_at', { ascending: false }).limit(limit);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      if (isMissingTable(e)) return res.json([]);
      sendFailure(res, e, 'Failed to fetch phone calls');
    }
  });

  app.post('/api/phone-calls', validateBody(createPhoneCallSchema), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const b = req.body;
      const refError = await checkReferences(tenantId, b);
      if (refError) return res.status(400).json({ error: refError });

      const id = b.id || crypto.randomUUID();
      // Idempotence : la file hors ligne du client rejoue une création avec le
      // même identifiant, qui ne doit ni échouer ni dupliquer.
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'phone_calls').select('*').eq('id', id).maybeSingle();
      if (existing) return res.status(200).json(existing);

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'phone_calls').insert({
        id,
        direction: b.direction || 'entrant',
        called_at: b.called_at ? new Date(b.called_at).toISOString() : new Date().toISOString(),
        duration_minutes: b.duration_minutes ?? null,
        caller_name: b.caller_name || null,
        caller_company: b.caller_company || null,
        caller_phone: b.caller_phone || null,
        caller_email: b.caller_email || null,
        contact_id: b.contact_id || null,
        project_id: b.project_id || null,
        subject: b.subject,
        notes: b.notes || null,
        assignee_id: b.assignee_id || null,
        status: b.status || 'a_traiter',
        priority: b.priority || 'normal',
        callback_due: b.callback_due || null,
        created_by: req.user.id,
      }).select().single();
      if (error) throw error;

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Saisie de l'appel "${data.subject}"`, data.subject, id, 'phone_call', CATEGORY);
      await notifyAssignee(tenantId, req.user.id, userName, data);
      res.status(201).json(data);
    } catch (e: any) { sendFailure(res, e, 'Failed to create phone call: ' + e.message); }
  });

  app.put('/api/phone-calls/:id', validateBody(updatePhoneCallSchema), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const patch: Record<string, any> = {};
      for (const field of UPDATABLE_FIELDS) {
        if (req.body[field] !== undefined) patch[field] = blankToNull(req.body[field]);
      }
      if (patch.subject === null) return res.status(400).json({ error: 'subject is required' });
      if (patch.called_at) patch.called_at = new Date(patch.called_at).toISOString();
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
      const refError = await checkReferences(tenantId, patch);
      if (refError) return res.status(400).json({ error: refError });

      const { data: before } = await tenantScopedFrom(supabaseAdmin, tenantId, 'phone_calls').select('assignee_id').eq('id', id).maybeSingle();
      if (!before) return res.status(404).json({ error: 'Appel introuvable' });

      patch.updated_at = new Date().toISOString();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'phone_calls').update(patch).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Appel introuvable' });

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Modification de l'appel "${data.subject}"`, data.subject, id, 'phone_call', CATEGORY);
      // Seul un changement d'assigné prévient : un statut ou une note modifiés
      // ne doivent pas renotifier la personne à chaque frappe.
      if (patch.assignee_id !== undefined && patch.assignee_id !== (before as any).assignee_id) {
        await notifyAssignee(tenantId, req.user.id, userName, data);
      }
      res.json(data);
    } catch (e: any) { sendFailure(res, e, 'Failed to update phone call'); }
  });

  app.delete('/api/phone-calls/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: call } = await tenantScopedFrom(supabaseAdmin, tenantId, 'phone_calls').select('subject').eq('id', id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'phone_calls').delete().eq('id', id);
      if (error) throw error;
      const subject = (call as any)?.subject || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'appel "${subject}"`, subject, id, 'phone_call', CATEGORY);
      res.json({ success: true });
    } catch (e: any) { sendFailure(res, e, 'Failed to delete phone call'); }
  });

  // Crée la tâche de suivi d'un appel. Rejouable : un appel qui a déjà sa tâche
  // rend celle-ci au lieu d'en créer une seconde.
  app.post('/api/phone-calls/:id/task', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: call } = await tenantScopedFrom(supabaseAdmin, tenantId, 'phone_calls').select('*').eq('id', id).maybeSingle();
      if (!call) return res.status(404).json({ error: 'Appel introuvable' });

      if ((call as any).task_id) {
        const { data: current } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tasks').select('*').eq('id', (call as any).task_id).maybeSingle();
        if (current) return res.status(200).json({ task: current, call, already_exists: true });
      }

      const today = new Date().toISOString().slice(0, 10);
      const taskId = crypto.randomUUID();
      const { data: task, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tasks').insert({
        id: taskId,
        ...buildTaskFromCall(call, today),
        progress: 0,
        dependencies: JSON.stringify([]),
        status: 'todo',
        created_by: req.user.id,
      }).select().single();
      if (error) throw error;

      const callPatch: Record<string, any> = { task_id: taskId, updated_at: new Date().toISOString() };
      if ((call as any).status === 'a_traiter') callPatch.status = 'en_cours';
      const { data: updated, error: linkError } = await tenantScopedFrom(supabaseAdmin, tenantId, 'phone_calls').update(callPatch).eq('id', id).select().maybeSingle();
      if (linkError) throw linkError;

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la tâche "${task.title}" depuis un appel`, task.title, taskId, 'task', CATEGORY);
      res.status(201).json({ task: { ...task, dependencies: [] }, call: updated, already_exists: false });
    } catch (e: any) { sendFailure(res, e, 'Failed to create task from phone call: ' + e.message); }
  });
}
