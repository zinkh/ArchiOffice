// Authenticated mission API. All reads/writes are scoped to BOTH tenant and
// mission creator. Approval deliberately reuses POST /api/tasks and its schema.
import type { Express } from 'express';
import { enqueueAgentMission, missionEvent } from '../agentMissions';

export interface MissionRouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  baseUrl: string;
}
export function registerAgentMissionRoutes(app: Express, { supabaseAdmin: db, getTenantId, baseUrl }: MissionRouteDeps) {
  async function owned(req: any) {
    const tenantId = await getTenantId(req.user.id);
    const { data, error } = await db.from('agent_missions').select('*')
      .eq('tenant_id', tenantId).eq('created_by', req.user.id)
      .eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    return { tenantId, mission: data };
  }

  app.get('/api/agent-missions', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await db.from('agent_missions')
        .select('id,source_type,source_ref,coordinator_agent_id,delegate_agent_id,project_id,instruction,status,task_proposal,result_text,error_message,created_task_id,created_at,updated_at')
        .eq('tenant_id', tenantId).eq('created_by', req.user.id)
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      res.json({ missions: data || [], processing_enabled: process.env.AGENT_MISSIONS_ENABLED === 'true' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/agent-missions/:id', async (req: any, res: any) => {
    try {
      const { tenantId, mission } = await owned(req);
      if (!mission) return res.status(404).json({ error: 'Mission introuvable.' });
      const { data, error } = await db.from('agent_mission_events').select('*')
        .eq('tenant_id', tenantId).eq('mission_id', mission.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      res.json({ ...mission, events: data || [] });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Creating a mission never executes an external action. Document missions
  // use persisted metadata; documents analysed during upload have separately
  // verified extracted text, see server/routes/documents.ts.
  app.post('/api/agent-missions', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const agentId = String(req.body?.agent_id || '');
      const { data: agent } = await db.from('agents').select('id').eq('id', agentId)
        .eq('tenant_id', tenantId).eq('is_active', true).maybeSingle();
      if (!agent) return res.status(400).json({ error: 'Agent inexistant ou inactif dans ce cabinet.' });

      const sourceType = req.body?.source_type === 'document' ? 'document' : 'manual';
      let sourceRef: string | null = null;
      let source = String(req.body?.source_excerpt || '').trim();
      let projectId: string | null = req.body?.project_id || null;
      if (sourceType === 'document') {
        sourceRef = String(req.body?.document_id || '');
        const { data: doc } = await db.from('documents')
          .select('id,name,project_id,file_url,mime_type,size_bytes').eq('id', sourceRef)
          .eq('tenant_id', tenantId).maybeSingle();
        if (!doc) return res.status(404).json({ error: 'Document introuvable dans ce cabinet.' });
        if (!doc.file_url || Number(doc.size_bytes || 0) > 25 * 1024 * 1024) {
          return res.status(422).json({ error: 'Document indisponible ou trop volumineux pour une lecture agentique.' });
        }
        projectId = doc.project_id || null;
        // A document mission must read ACTUAL bytes; file name / metadata
        // cannot support conclusions about contents or citations.
        const { readStorageObject, extractDocumentText, withTextExtractionTimeout } =
          await import('@zinkh/archioffice-agents/server');
        const file = await readStorageObject(db, tenantId, doc.file_url);
        if (!file || file.buffer.length > 25 * 1024 * 1024) {
          return res.status(422).json({ error: 'Contenu du document inaccessible ou trop volumineux.' });
        }
        const parsed = await withTextExtractionTimeout(
          extractDocumentText(doc.name || '', doc.mime_type || file.contentType, file.buffer)
        );
        if (!parsed.text?.trim()) {
          return res.status(422).json({ error: 'Aucun texte exploitable extrait du document ; mission non créée.' });
        }
        source = parsed.text.slice(0, 12000);
      }
      if (projectId) {
        const { data: project } = await db.from('projects').select('id')
          .eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
        if (!project) return res.status(400).json({ error: 'Affaire introuvable dans ce cabinet.' });
      }
      if (!source || source.length > 12000) return res.status(400).json({ error: 'Source requise (12 000 caractères maximum).' });
      const { mission, created } = await enqueueAgentMission(db, {
        tenantId, userId: req.user.id, agentId, projectId,
        sourceType, sourceRef, sourceExcerpt: source,
        instruction: String(req.body?.instruction || 'Repérer les actions à prévoir et proposer une tâche.'),
      });
      res.status(created ? 201 : 200).json({ mission, created, processing_enabled: process.env.AGENT_MISSIONS_ENABLED === 'true' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/agent-missions/:id/cancel', async (req: any, res: any) => {
    try {
      const { tenantId, mission } = await owned(req);
      if (!mission) return res.status(404).json({ error: 'Mission introuvable.' });
      if (!['queued', 'delegated', 'running', 'review', 'failed'].includes(mission.status)) {
        return res.status(409).json({ error: 'Mission non annulable dans cet état.' });
      }
      const { data, error } = await db.from('agent_missions')
        .update({ status: 'cancelled', lease_until: null, updated_at: new Date().toISOString() })
        .eq('id', mission.id).eq('tenant_id', tenantId).eq('created_by', req.user.id)
        .eq('status', mission.status).select('*').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(409).json({ error: 'La mission a changé entre-temps.' });
      await missionEvent(db, data, 'cancelled', 'Annulation par le demandeur.');
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/agent-missions/:id/retry', async (req: any, res: any) => {
    try {
      const { tenantId, mission } = await owned(req);
      if (!mission) return res.status(404).json({ error: 'Mission introuvable.' });
      if (mission.status !== 'failed') return res.status(409).json({ error: 'Seule une mission échouée peut être relancée.' });
      const { data, error } = await db.from('agent_missions').update({
        status: mission.plan ? 'delegated' : 'queued', attempts: 0, error_message: null,
        next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', mission.id).eq('tenant_id', tenantId).eq('created_by', req.user.id)
        .eq('status', 'failed').select('*').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(409).json({ error: 'Mission modifiée entre-temps.' });
      await missionEvent(db, data, 'retry', 'Reprise demandée par le propriétaire.');
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Durable approval: persist a task UUID BEFORE posting. If a request dies
  // between task creation and mission completion, retry checks that UUID.
  app.post('/api/agent-missions/:id/approve-task', async (req: any, res: any) => {
    try {
      const { tenantId, mission } = await owned(req);
      if (!mission) return res.status(404).json({ error: 'Mission introuvable.' });
      if (mission.status === 'completed' && mission.created_task_id) {
        return res.json({ task_id: mission.created_task_id, already_created: true });
      }
      if (!['review', 'applying'].includes(mission.status) || !mission.task_proposal?.title) {
        return res.status(409).json({ error: 'Aucune tâche en attente de validation.' });
      }
      const taskId = mission.created_task_id || crypto.randomUUID();
      if (mission.status === 'review') {
        const { data: claimed, error: claimError } = await db.from('agent_missions')
          .update({ status: 'applying', created_task_id: taskId, updated_at: new Date().toISOString() })
          .eq('id', mission.id).eq('tenant_id', tenantId).eq('created_by', req.user.id)
          .eq('status', 'review').select('id').maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) return res.status(409).json({ error: 'Validation déjà en cours.' });
      }
      const { data: existing } = await db.from('tasks').select('id')
        .eq('tenant_id', tenantId).eq('id', taskId).maybeSingle();
      let task: any = existing;
      if (!task) {
        const today = new Date().toISOString().slice(0, 10);
        const due = mission.task_proposal.due_date || null;
        const response = await fetch(baseUrl + '/api/tasks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: req.headers.authorization || '',
            'X-Tenant-Id': req.activeTenantId || tenantId,
          },
          body: JSON.stringify({
            id: taskId,
            title: mission.task_proposal.title,
            description: (mission.task_proposal.description || '') +
              '\n\nSource vérifiée : ' + mission.task_proposal.evidence,
            project_id: mission.project_id,
            start_date: today, end_date: due && due >= today ? due : today,
            due_date: due, status: 'todo', priority: mission.task_proposal.priority || 'normal',
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          const { data: raced } = await db.from('tasks').select('id')
            .eq('tenant_id', tenantId).eq('id', taskId).maybeSingle();
          if (!raced) {
            await db.from('agent_missions').update({ status: 'review' })
              .eq('id', mission.id).eq('tenant_id', tenantId).eq('status', 'applying');
            return res.status(response.status).json({ error: json.error || 'Création refusée par la validation des tâches.' });
          }
          task = raced;
        } else task = json;
      }
      const { data: done, error } = await db.from('agent_missions').update({
        status: 'completed', completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(), created_task_id: taskId,
      }).eq('id', mission.id).eq('tenant_id', tenantId).eq('created_by', req.user.id)
        .eq('status', 'applying').select('*').maybeSingle();
      if (error) throw error;
      if (!done) return res.status(409).json({ error: 'Mission modifiée pendant la validation.' });
      await missionEvent(db, done, 'approved', 'Tâche ' + taskId + ' créée après accord explicite.');
      res.json({ task_id: taskId, task, mission: done });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
