// Phase 7 extraction — moved out of server.ts's Document Routes section
// (CRUD, versioning, statut transitions, diffusions to external contacts).
// Distinct from documentTemplates.ts (lot 4, generated documents from a
// template) — this is the general document repository. Same
// uploadToStorage/deleteFromStorage/upload/sanitizeFilename dependency set
// as meetings.ts/visas.ts/plans.ts for file attachments and versioning.
import type { Express } from 'express';
import { sanitizeFilename } from '../sanitizeFilename';
import { handleDocumentUpload } from '../documentUpload';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  checkQuota: (tenantId: string, resource: 'projects' | 'users' | 'documents') => Promise<void>;
  checkStorageQuota: (tenantId: string, incomingBytes: number) => Promise<void>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  deleteFromStorage: (bucket: string, fileUrl: string) => Promise<void>;
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => Promise<void>;
}

export function registerDocumentRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, checkQuota, checkStorageQuota, uploadToStorage, deleteFromStorage, requireRole }: RouteDeps) {
  app.get("/api/documents", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const query = supabaseAdmin.from('documents').select('*').eq('tenant_id', tenantId);
      if (project_id) query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch documents" }); }
  });

  app.post("/api/documents", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      await checkQuota(tenantId, 'documents');
      await checkStorageQuota(tenantId, file.size);
      const { project_id, name, category, phase, description } = req.body;
      // Derived from the authenticated caller, never trusted from the request
      // body — the client used to be able to submit any uploaded_by value and
      // falsify a document's apparent author (security audit finding).
      const uploaded_by = await getUserName(tenantId, req.user.id, req.user.email);
      const projectIdVal = project_id === '' || project_id === 'null' ? null : project_id;
      const phaseVal = phase || null;
      const id = crypto.randomUUID();
      const phaseSegment = phaseVal ? `${phaseVal}/` : '';
      const storagePath = `${tenantId}/${projectIdVal || 'general'}/${phaseSegment}${id}/${sanitizeFilename(file.originalname)}`;
      const file_url = await uploadToStorage('documents', storagePath, file.buffer, file.mimetype);
      const uploaded_at = new Date().toISOString();
      const { indice, emetteur, doc_type, contact_id, contact_name } = req.body;
      const { error: e1 } = await supabaseAdmin.from('documents').insert({ id, tenant_id: tenantId, project_id: projectIdVal, name, category, phase: phaseVal, version: 1, file_url, uploaded_by, uploaded_at, description, indice: indice || 'A', doc_statut: 'en_cours', emetteur: emetteur || null, doc_type: doc_type || null, contact_id: contact_id || null, contact_name: contact_name || null, validation_status: 'pending' });
      if (e1) throw e1;
      await supabaseAdmin.from('document_versions').insert({ id: crypto.randomUUID(), tenant_id: tenantId, document_id: id, version: 1, file_url, uploaded_by, uploaded_at, description, size_bytes: file.size });
      logActivity(tenantId, req.user.id, uploaded_by, `Ajout du document "${name}"`, name, id, 'document', 'Documents');
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to upload document" }); }
  });

  // admin/manager/pm only — any authenticated tenant member (including the
  // base 'user' role) could previously delete any document (security audit
  // finding); there's no per-document ownership/project-membership model
  // yet to check against, so this is the narrowest fix available today.
  app.delete("/api/documents/:id", requireRole('admin', 'manager', 'pm'), async (req: any, res: any) => {
    try {
      const tenantId = req.tenantId as string;
      const { id } = req.params;
      // Fetch all version URLs before deleting DB rows
      const { data: doc } = await supabaseAdmin.from('documents').select('name').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { data: versions } = await supabaseAdmin.from('document_versions').select('file_url').eq('document_id', id).eq('tenant_id', tenantId);
      await supabaseAdmin.from('document_versions').delete().eq('document_id', id).eq('tenant_id', tenantId);
      const { error } = await supabaseAdmin.from('documents').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      // Delete storage files (best-effort, don't fail if storage cleanup fails)
      if (versions?.length) {
        for (const v of versions) {
          if (v.file_url?.includes('/object/public/documents/')) {
            deleteFromStorage('documents', v.file_url).catch(() => {});
          }
        }
      }
      const docName = (doc as any)?.name || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du document "${docName}"`, docName, id, 'document', 'Documents');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete document" }); }
  });

  app.put("/api/documents/:id", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { name, category, phase, description, indice, emetteur, doc_type, contact_id, contact_name, validation_status, validation_comments } = req.body;
      const file = req.file;
      const phaseVal = phase || null;
      if (file) {
        await checkStorageQuota(tenantId, file.size);
        // Derived from the authenticated caller, not the request body — see the
        // same fix on POST /api/documents above.
        const uploaded_by = await getUserName(tenantId, req.user.id, req.user.email);
        const { data: doc } = await supabaseAdmin.from('documents').select('version, project_id, phase, indice').eq('id', id).eq('tenant_id', tenantId).single();
        const newVersion = ((doc as any)?.version || 1) + 1;
        const currentIndice = (doc as any)?.indice || 'A';
        const nextIndice = String.fromCharCode(currentIndice.charCodeAt(0) + 1);
        const existingPhase = phaseVal || (doc as any)?.phase || null;
        const projectId = (doc as any)?.project_id || 'general';
        const phaseSegment = existingPhase ? `${existingPhase}/` : '';
        const storagePath = `${tenantId}/${projectId}/${phaseSegment}${id}/v${newVersion}-${sanitizeFilename(file.originalname)}`;
        const file_url = await uploadToStorage('documents', storagePath, file.buffer, file.mimetype);
        const uploaded_at = new Date().toISOString();
        const updateFields: any = { name, category, description, version: newVersion, file_url, uploaded_at, indice: nextIndice, doc_statut: 'en_cours', emetteur: emetteur || null, doc_type: doc_type || null };
        if (phaseVal !== undefined) updateFields.phase = phaseVal;
        if (contact_id !== undefined) updateFields.contact_id = contact_id || null;
        if (contact_name !== undefined) updateFields.contact_name = contact_name || null;
        if (validation_status !== undefined) updateFields.validation_status = validation_status;
        if (validation_comments !== undefined) updateFields.validation_comments = validation_comments || null;
        const { error } = await supabaseAdmin.from('documents').update(updateFields).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
        await supabaseAdmin.from('document_versions').insert({ id: crypto.randomUUID(), tenant_id: tenantId, document_id: id, version: newVersion, file_url, uploaded_by, uploaded_at, description, size_bytes: file.size });
      } else {
        const updateFields: any = { name, category, description, emetteur: emetteur || null, doc_type: doc_type || null };
        if (indice !== undefined) updateFields.indice = indice;
        if (phaseVal !== undefined) updateFields.phase = phaseVal;
        if (contact_id !== undefined) updateFields.contact_id = contact_id || null;
        if (contact_name !== undefined) updateFields.contact_name = contact_name || null;
        if (validation_status !== undefined) updateFields.validation_status = validation_status;
        if (validation_comments !== undefined) updateFields.validation_comments = validation_comments || null;
        const { error } = await supabaseAdmin.from('documents').update(updateFields).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      }
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update document: " + e.message }); }
  });

  app.get("/api/documents/:id/versions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await supabaseAdmin.from('document_versions').select('*').eq('tenant_id', tenantId).eq('document_id', id).order('version', { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch document versions" }); }
  });

  // PATCH statut d'un document
  app.patch("/api/documents/:id/statut", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { doc_statut, approbateur } = req.body;
      if (!['en_cours', 'approuve', 'perime'].includes(doc_statut)) {
        return res.status(400).json({ error: 'Invalid statut' });
      }
      const updateData: any = { doc_statut };
      if (doc_statut === 'approuve') {
        updateData.approbateur = approbateur || null;
        updateData.date_approbation = new Date().toISOString();
      }
      const { error } = await supabaseAdmin.from('documents').update(updateData).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // GET diffusions d'un document
  app.get("/api/documents/:id/diffusions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await supabaseAdmin.from('document_diffusions').select('*').eq('tenant_id', tenantId).eq('document_id', id).order('sent_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // POST diffusion (send to recipient)
  app.post("/api/documents/:id/diffusions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { contact_name, contact_email, notes } = req.body;
      if (!contact_name) return res.status(400).json({ error: 'contact_name required' });
      const diffusion = { id: crypto.randomUUID(), tenant_id: tenantId, document_id: id, contact_name, contact_email: contact_email || null, sent_at: new Date().toISOString(), notes: notes || null };
      const { error } = await supabaseAdmin.from('document_diffusions').insert(diffusion);
      if (error) throw error;
      res.status(201).json(diffusion);
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // PATCH acknowledge
  app.patch("/api/documents/:id/diffusions/:diffId/acknowledge", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { diffId } = req.params;
      const { error } = await supabaseAdmin.from('document_diffusions').update({ acknowledged_at: new Date().toISOString() }).eq('id', diffId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });
}
