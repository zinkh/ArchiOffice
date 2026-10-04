import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { dispatchWebhookEvent } from '../webhookDispatch';
import { findMembership } from '../tenantMemberships';
import { CONTROL_PHASES, controlConfigSchema, evaluateControls, transitionSchema, type ControlAnswer } from '../../src/lib/phaseControls';
import { loadPhaseControls, PhaseControlError } from '../phaseControls';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => Promise<void>;
}

export function registerProjectPhaseHistoryRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  const fail = (res: any, error: any) => {
    console.error('[phase controls]', error);
    return res.status(error instanceof PhaseControlError ? error.status : 500).json({
      error: error instanceof PhaseControlError ? error.message : 'Impossible de traiter les contrôles. Vérifiez la migration phase_transition_controls.',
    });
  };
  app.get('/api/projects/:id/phase-history', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_history')
        .select('*').eq('project_id', req.params.id).order('entered_at', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (error) { fail(res, error); }
  });

  app.get('/api/projects/:id/phase-controls', async (req: any, res: any) => {
    try {
      if (!CONTROL_PHASES.includes(req.query.to)) throw new PhaseControlError(400, 'Phase inconnue.');
      const tenantId = await getTenantId(req.user.id);
      const { project: _project, current: _current, ...preview } = await loadPhaseControls(supabaseAdmin, tenantId, req.params.id, req.query.to);
      res.json(preview);
    } catch (error) { fail(res, error); }
  });

  app.put('/api/projects/:id/phase-controls/config', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const member = await findMembership(supabaseAdmin, req.user.id, tenantId);
      if (!member || !['admin', 'manager', 'pm'].includes(member.systemRole ?? '')) throw new PhaseControlError(403, 'Configuration réservée aux responsables de projet.');
      const parsed = controlConfigSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Configuration invalide.', details: parsed.error.issues });
      for (const id of new Set(parsed.data.rules.map(r => r.defaultAssigneeId).filter(Boolean))) {
        if (!(await findMembership(supabaseAdmin, id!, tenantId))) throw new PhaseControlError(400, 'Responsable inconnu dans ce cabinet.');
      }
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects')
        .update({ phase_control_config: parsed.data }).eq('id', req.params.id).select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new PhaseControlError(404, 'Projet introuvable.');
      res.json(parsed.data);
    } catch (error) { fail(res, error); }
  });

  app.post('/api/projects/:id/phase', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: projectId } = req.params;
      if (!CONTROL_PHASES.includes(req.body?.phase)) throw new PhaseControlError(400, 'Phase inconnue.');
      const state = await loadPhaseControls(supabaseAdmin, tenantId, projectId, req.body.phase);
      if (state.current?.phase === req.body.phase) return res.json(state.current);
      const initializing = !state.current && req.body.phase === 'ESQ';
      const parsed = transitionSchema.safeParse(req.body);
      if (!initializing && !parsed.success) throw new PhaseControlError(400, 'Ouvrez et renseignez la checklist avant de changer de phase.');
      const input = parsed.success ? parsed.data : { phase: 'ESQ', expectedCurrentId: null, revision: state.revision, answers: [] as ControlAnswer[], createTasks: false };
      if (input.expectedCurrentId !== state.expectedCurrentId || input.revision !== state.revision) throw new PhaseControlError(409, 'La phase ou la configuration a changé. Rechargez les contrôles.');
      const controls = evaluateControls(state.config, state.from, input.phase, state.documents, input.answers, new Date(), state.context);
      const expected = new Set(controls.map(c => c.rule.id));
      if (new Set(input.answers.map(a => a.ruleId)).size !== input.answers.length || input.answers.some(a => !expected.has(a.ruleId))) throw new PhaseControlError(400, 'Réponses dupliquées ou contrôle inconnu.');
      const tasks: Record<string, unknown>[] = [];
      for (const control of controls) {
        const { rule, answer } = control;
        if (answer.status === 'not_required' && !answer.justification.trim()) throw new PhaseControlError(400, `Justification requise : ${rule.title}`);
        if (answer.documentId && !state.documents.some(d => d.id === answer.documentId)) throw new PhaseControlError(400, 'La preuve ne fait pas partie des documents de ce projet.');
        if (answer.assigneeId && !(await findMembership(supabaseAdmin, answer.assigneeId, tenantId))) throw new PhaseControlError(400, 'Responsable inconnu dans ce cabinet.');
        if (control.group === 'compliant') continue;
        if (rule.severity === 'blocking') throw new PhaseControlError(422, `Contrôle bloquant à résoudre : ${rule.title}`);
        if (!rule.required) continue;
        if (!input.createTasks) throw new PhaseControlError(422, 'Créez les tâches manquantes ou complétez les contrôles requis.');
        if (!control.dueDate) throw new PhaseControlError(422, `Renseignez l’échéance théorique de la phase ${rule.from} avant de créer les tâches.`);
        tasks.push({ id: crypto.randomUUID(), project_id: projectId, title: rule.title,
          description: `Contrôle ${rule.id} · ${rule.from} → ${rule.to}\nRetard à la création : ${control.overdueDays} jour(s).\n${answer.justification}`,
          start_date: control.dueDate, end_date: control.dueDate, due_date: control.dueDate,
          status: 'todo', progress: 0, priority: rule.severity === 'important' ? 'high' : 'normal',
          assignee_id: answer.assigneeId, dependencies: '[]', created_by: req.user.id,
          phase_control_id: rule.id });
      }
      const audit = { version: 1, from: state.from, to: input.phase, revision: state.revision,
        checked_by: req.user.id, checked_at: new Date().toISOString(), context: state.context,
        controls: controls.map(({ candidates: _candidates, ...control }) => control) };
      const { data: created, error } = await supabaseAdmin.rpc('commit_phase_transition', {
        p_tenant_id: tenantId, p_project_id: projectId, p_expected_id: state.expectedCurrentId,
        p_expected_config: state.project.phase_control_config ?? null,
        p_phase: input.phase, p_id: crypto.randomUUID(), p_audit: audit, p_tasks: tasks,
      });
      if (error?.code === '40001') throw new PhaseControlError(409, 'Le projet a changé. Rechargez les contrôles.');
      if (error) throw error;
      try {
        const userName = await getUserName(tenantId, req.user.id, req.user.email);
        await logActivity(tenantId, req.user.id, userName, `Passage du projet "${state.project.name}" en phase ${input.phase} (${tasks.length} tâches)`, state.project.name, projectId, 'project', 'Projets');
        dispatchWebhookEvent(supabaseAdmin, tenantId, 'project.phase_changed', {
          project_id: projectId, project_name: state.project.name, phase: input.phase, previous_phase: state.current?.phase ?? null,
        });
      } catch (error) { console.error('[phase controls activity]', error); }
      res.status(201).json(created);
    } catch (error) { fail(res, error); }
  });
}
