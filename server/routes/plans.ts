// Phase 7 extraction — moved out of server.ts's Plans section.
//
// Le fichier passe par storeBusinessFile/removeBusinessFile
// (server/externalStorage/storeBusinessFile.ts), qui décide selon le cabinet
// entre Supabase Storage et l'espace qu'il a branché. Les plans sont, avec les
// documents, le poste de stockage qui pèse réellement — d'où leur présence dans
// le périmètre.
import type { Express } from 'express';
import { sanitizeFilename } from '../sanitizeFilename';
import { handleDocumentUpload } from '../documentUpload';
import { assertTenantEntity } from '../assertTenantEntity';
import { isOwnStorageRef } from '../externalStorage/externalRef';
import { buildPlanFolderPath } from '../externalStorage/businessFolderPath';
import type { RemoveBusinessFile, StoreBusinessFile } from '../externalStorage/storeBusinessFile';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  storeBusinessFile: StoreBusinessFile;
  removeBusinessFile: RemoveBusinessFile;
}

export function registerPlanRoutes(app: Express, { supabaseAdmin, getTenantId, storeBusinessFile, removeBusinessFile }: RouteDeps) {
  app.get("/api/plans", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('plans').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch plans" }); }
  });

  app.post("/api/plans", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, name, index, version, parent_id, category } = req.body;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      if (parent_id && !(await assertTenantEntity(supabaseAdmin, 'plans', parent_id, tenantId))) {
        return res.status(400).json({ error: "Plan parent introuvable pour ce cabinet." });
      }
      const id = bodyId || crypto.randomUUID();
      const uploaded_at = new Date().toISOString();
      const { data: project } = project_id
        ? await supabaseAdmin.from('projects').select('project_code, name').eq('id', project_id).eq('tenant_id', tenantId).maybeSingle()
        : { data: null };
      const stored = await storeBusinessFile({
        tenantId,
        bucket: 'plans',
        folderPath: buildPlanFolderPath(project as any),
        fileName: file.originalname,
        supabasePath: `${tenantId}/${project_id}/${id}/${sanitizeFilename(file.originalname)}`,
      }, file.buffer, file.mimetype);
      const file_url = stored.fileUrl;
      const versionVal = version ? Number(version) : 1;
      const { error } = await supabaseAdmin.from('plans').insert({
        id, tenant_id: tenantId, project_id, name, file_url, storage_backend: stored.storageBackend, uploaded_at,
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
      // Reconnaît les deux formes de référence : un plan déposé sur l'espace du
      // cabinet doit y être supprimé aussi, sans quoi il y resterait orphelin.
      if (isOwnStorageRef((plan as any)?.file_url, 'plans')) {
        removeBusinessFile(tenantId, 'plans', (plan as any).file_url).catch(() => {});
      }
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete plan" }); }
  });
}
