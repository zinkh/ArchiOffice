// Phase 7 extraction — moved out of server.ts's Plans section. Same
// uploadToStorage/deleteFromStorage/upload/sanitizeFilename dependency set
// as meetings.ts/visas.ts for the plan file attachment.
import type { Express } from 'express';
import { sanitizeFilename } from '../sanitizeFilename';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  deleteFromStorage: (bucket: string, fileUrl: string) => Promise<void>;
  upload: any;
}

export function registerPlanRoutes(app: Express, { supabaseAdmin, getTenantId, uploadToStorage, deleteFromStorage, upload }: RouteDeps) {
  app.get("/api/plans", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('plans').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch plans" }); }
  });

  app.post("/api/plans", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, name, index, version, parent_id, category } = req.body;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const id = bodyId || crypto.randomUUID();
      const uploaded_at = new Date().toISOString();
      const storagePath = `${tenantId}/${project_id}/${id}/${sanitizeFilename(file.originalname)}`;
      const file_url = await uploadToStorage('plans', storagePath, file.buffer, file.mimetype);
      const versionVal = version ? Number(version) : 1;
      const { error } = await supabaseAdmin.from('plans').insert({
        id, tenant_id: tenantId, project_id, name, file_url, uploaded_at,
        index: index || 'A', version: versionVal, parent_id: parent_id || null, category: category || null
      });
      if (error) throw error;
      res.json({ id, project_id, name, file_url, uploaded_at, index: index || 'A', version: versionVal, parent_id: parent_id || null, category: category || null });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to create plan" }); }
  });

  app.delete("/api/plans/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: plan } = await supabaseAdmin.from('plans').select('file_url').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('plans').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      if ((plan as any)?.file_url?.includes('/object/public/plans/')) {
        deleteFromStorage('plans', (plan as any).file_url).catch(() => {});
      }
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete plan" }); }
  });
}
