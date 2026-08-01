// Phase 7 extraction — moved out of server.ts's Tasks section (Gantt
// planning tasks).
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerTaskRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/tasks", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('tasks').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tasks" }); }
  });

  app.post("/api/tasks", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, title, start_date, end_date, progress, dependencies } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { error } = await supabaseAdmin.from('tasks').insert({ id, tenant_id: tenantId, project_id, title, start_date, end_date, progress: progress || 0, dependencies: dependencies || [] });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la tâche "${title}"`, title, id, 'task', 'Tâches');
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create task" }); }
  });

  app.put("/api/tasks/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, start_date, end_date, progress, dependencies } = req.body;
      const { error } = await supabaseAdmin.from('tasks').update({ title, start_date, end_date, progress, dependencies: dependencies || [] }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update task" }); }
  });

  app.delete("/api/tasks/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: task } = await supabaseAdmin.from('tasks').select('title').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const title = (task as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la tâche "${title}"`, title, id, 'task', 'Tâches');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete task" }); }
  });
}
