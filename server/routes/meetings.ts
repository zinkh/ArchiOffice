// Phase 7 extraction — moved out of server.ts's "── Meetings ──" section.
// Needs more than the usual {supabaseAdmin, getTenantId} pair: photo upload
// routes close over the same uploadToStorage/deleteFromStorage helpers and
// multer `upload` instance server.ts's createApp() already defines, and
// activity logging needs getUserName/logActivity like the Situations and
// Project Phase History modules from the previous batch.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { sanitizeFilename } from '../sanitizeFilename';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  deleteFromStorage: (bucket: string, fileUrl: string) => Promise<void>;
  resolveFileUrl: (bucket: string, value: string | null | undefined, expiresIn?: number) => Promise<string | null>;
  upload: any;
}

export function registerMeetingRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, uploadToStorage, deleteFromStorage, resolveFileUrl, upload }: RouteDeps) {
  app.get("/api/meetings", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, proposal_id, tender_id, type } = req.query;
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'meetings').select('*').order('date', { ascending: false });
      if (project_id) query = query.eq('project_id', project_id);
      else if (proposal_id) query = query.eq('proposal_id', proposal_id);
      else if (tender_id) query = query.eq('tender_id', tender_id);
      if (type) query = query.eq('type', type);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error("[GET /api/meetings]", e); res.status(500).json({ error: e.message }); }
  });

  app.get("/api/meetings/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: meeting, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meetings').select('*').eq('id', id).single();
      if (error) throw error;
      const { data: photos } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_photos').select('*').eq('meeting_id', id).order('uploaded_at');
      const photosWithUrls = await Promise.all((photos || []).map(async (p: any) => ({ ...p, file_url: await resolveFileUrl('meeting-photos', p.file_url) })));
      res.json({ ...meeting, photos: photosWithUrls });
    } catch (e: any) {
      console.error("[GET /api/meetings/:id]", e); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/meetings", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, proposal_id, tender_id, type, title, date, notes } = req.body;
      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meetings').insert({ id, project_id: project_id || null, proposal_id: proposal_id || null, tender_id: tender_id || null, type: type || 'projet', title, date, notes: notes || null, created_at });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la réunion "${title}"`, title, id, 'meeting', 'Réunions');
      res.status(201).json({ id, project_id, proposal_id, tender_id, type: type || 'projet', title, date, notes, created_at, photos: [] });
    } catch (e: any) {
      console.error("[POST /api/meetings]", e); res.status(500).json({ error: e.message }); }
  });

  app.put("/api/meetings/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, date, notes } = req.body;
      const updated_at = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meetings').update({ title, date, notes: notes || null, updated_at }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[PUT /api/meetings/:id]", e); res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/meetings/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: meeting } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meetings').select('title').eq('id', id).maybeSingle();
      const { data: photos } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_photos').select('file_url').eq('meeting_id', id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_photos').delete().eq('meeting_id', id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'meetings').delete().eq('id', id);
      if (photos?.length) {
        for (const p of photos) deleteFromStorage('meeting-photos', p.file_url).catch(() => {});
      }
      const title = (meeting as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la réunion "${title}"`, title, id, 'meeting', 'Réunions');
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/meetings/:id]", e); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/meetings/:id/photos", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { caption } = req.body;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const photoId = crypto.randomUUID();
      const storagePath = `${tenantId}/${id}/${photoId}-${sanitizeFilename(file.originalname)}`;
      const file_url = await uploadToStorage('meeting-photos', storagePath, file.buffer, file.mimetype);
      const uploaded_at = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_photos').insert({ id: photoId, meeting_id: id, file_url, caption: caption || null, uploaded_at });
      if (error) throw error;
      const signedUrl = await resolveFileUrl('meeting-photos', file_url);
      res.status(201).json({ id: photoId, meeting_id: id, file_url: signedUrl, caption, uploaded_at });
    } catch (e: any) {
      console.error("[POST /api/meetings/:id/photos]", e); res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/meetings/:meetingId/photos/:photoId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { meetingId, photoId } = req.params;
      const { data: photo } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_photos').select('file_url').eq('id', photoId).eq('meeting_id', meetingId).single();
      await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_photos').delete().eq('id', photoId);
      if (photo?.file_url) deleteFromStorage('meeting-photos', photo.file_url).catch(() => {});
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/meetings/:meetingId/photos/:photoId]", e); res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/meetings/photos/:photoId/caption", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { photoId } = req.params;
      const { caption } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_photos').update({ caption }).eq('id', photoId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[PATCH /api/meetings/photos/:photoId/caption]", e); res.status(500).json({ error: e.message }); }
  });
}
