// Phase 7 extraction — moved out of server.ts's "Visa Routes" section, part
// of the "suivi de chantier" cluster (see ordresDeService.ts for context).
// Needs the same uploadToStorage/multer `upload` pair meetings.ts already
// receives, for the optional visa document attachment.
import type { Express } from 'express';
import { sanitizeFilename } from '../sanitizeFilename';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  resolveFileUrl: (bucket: string, value: string | null | undefined, expiresIn?: number) => Promise<string | null>;
  upload: any;
}

export function registerVisaRoutes(app: Express, { supabaseAdmin, getTenantId, uploadToStorage, resolveFileUrl, upload }: RouteDeps) {
  app.get("/api/visas", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('visas').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      const withUrls = await Promise.all((data || []).map(async (v: any) => ({ ...v, document_url: await resolveFileUrl('documents', v.document_url) })));
      res.json(withUrls);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch visas" }); }
  });

  app.post("/api/visas", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, title, date, status, comments, lot_id } = req.body;
      const id = crypto.randomUUID();
      // A client resubmitting an unchanged visa (no new file) sends back
      // whatever URL it last displayed — possibly an already-signed one from
      // a prior GET. resolveFileUrl's path extraction understands that
      // shape too, so it always re-derives the true storage path.
      let document_url = req.body.document_url || null;
      if (req.file) {
        const storagePath = `${tenantId}/${project_id}/visas/${id}/${sanitizeFilename(req.file.originalname)}`;
        document_url = await uploadToStorage('documents', storagePath, req.file.buffer, req.file.mimetype);
      }
      const { data, error } = await supabaseAdmin.from('visas').insert({
        id, tenant_id: tenantId, project_id, title, date, status: status || 'pending', comments, document_url, lot_id: lot_id || null
      }).select().single();
      if (error) throw error;
      res.json({ ...data, document_url: await resolveFileUrl('documents', data.document_url) });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create visa" }); }
  });

  app.put("/api/visas/:id", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, date, status, comments, lot_id } = req.body;
      const updateFields: any = { title, date, status, comments, lot_id: lot_id || null };
      if (req.file) {
        const storagePath = `${tenantId}/${req.body.project_id || 'general'}/visas/${req.params.id}/${sanitizeFilename(req.file.originalname)}`;
        updateFields.document_url = await uploadToStorage('documents', storagePath, req.file.buffer, req.file.mimetype);
      } else if (req.body.document_url !== undefined) {
        updateFields.document_url = req.body.document_url || null;
      }
      const { data, error } = await supabaseAdmin.from('visas')
        .update(updateFields)
        .eq('id', req.params.id)
        .eq('tenant_id', tenantId)
        .select().single();
      if (error) throw error;
      res.json({ ...data, document_url: await resolveFileUrl('documents', data.document_url) });
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
