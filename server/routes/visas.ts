// Phase 7 extraction — moved out of server.ts's "Visa Routes" section, part
// of the "suivi de chantier" cluster (see ordresDeService.ts for context).
//
// La pièce jointe d'un visa vit dans le bucket `documents`, donc dans le
// périmètre du stockage externe : elle passe par storeBusinessFile
// (server/externalStorage/storeBusinessFile.ts). Côté espace du cabinet elle
// tombe dans le sous-dossier « VISA » de l'affaire — « VISA » étant déjà l'une
// des phases connues, ça n'ouvre pas un dossier de plus.
import type { Express } from 'express';
import { sanitizeFilename } from '../sanitizeFilename';
import { handleDocumentUpload } from '../documentUpload';
import { assertTenantEntity } from '../assertTenantEntity';
import { buildVisaFolderPath } from '../externalStorage/businessFolderPath';
import type { StoreBusinessFile } from '../externalStorage/storeBusinessFile';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  storeBusinessFile: StoreBusinessFile;
}

export function registerVisaRoutes(app: Express, { supabaseAdmin, getTenantId, storeBusinessFile }: RouteDeps) {
  async function loadFolderProject(projectId: string | null | undefined, tenantId: string) {
    if (!projectId) return null;
    const { data } = await supabaseAdmin.from('projects')
      .select('project_code, name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
    return (data as any) || null;
  }

  app.get("/api/visas", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('visas').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch visas" }); }
  });

  app.post("/api/visas", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, title, date, status, comments, lot_id } = req.body;
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      if (lot_id && !(await assertTenantEntity(supabaseAdmin, 'project_lots', lot_id, tenantId))) {
        return res.status(400).json({ error: "Lot introuvable pour ce cabinet." });
      }
      const id = crypto.randomUUID();
      let document_url = req.body.document_url || null;
      if (req.file) {
        const stored = await storeBusinessFile({
          tenantId,
          bucket: 'documents',
          folderPath: buildVisaFolderPath(await loadFolderProject(project_id, tenantId)),
          fileName: req.file.originalname,
          supabasePath: `${tenantId}/${project_id}/visas/${id}/${sanitizeFilename(req.file.originalname)}`,
        }, req.file.buffer, req.file.mimetype);
        document_url = stored.fileUrl;
      }
      const { data, error } = await supabaseAdmin.from('visas').insert({
        id, tenant_id: tenantId, project_id, title, date, status: status || 'pending', comments, document_url, lot_id: lot_id || null
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create visa" }); }
  });

  app.put("/api/visas/:id", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, date, status, comments, lot_id } = req.body;
      if (lot_id && !(await assertTenantEntity(supabaseAdmin, 'project_lots', lot_id, tenantId))) {
        return res.status(400).json({ error: "Lot introuvable pour ce cabinet." });
      }
      const updateFields: any = { title, date, status, comments, lot_id: lot_id || null };
      if (req.file) {
        const stored = await storeBusinessFile({
          tenantId,
          bucket: 'documents',
          folderPath: buildVisaFolderPath(await loadFolderProject(req.body.project_id, tenantId)),
          fileName: req.file.originalname,
          supabasePath: `${tenantId}/${req.body.project_id || 'general'}/visas/${req.params.id}/${sanitizeFilename(req.file.originalname)}`,
        }, req.file.buffer, req.file.mimetype);
        updateFields.document_url = stored.fileUrl;
      } else if (req.body.document_url !== undefined) {
        updateFields.document_url = req.body.document_url || null;
      }
      const { data, error } = await supabaseAdmin.from('visas')
        .update(updateFields)
        .eq('id', req.params.id)
        .eq('tenant_id', tenantId)
        .select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update visa" }); }
  });

  app.delete("/api/visas/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('visas').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete visa" }); }
  });
}
