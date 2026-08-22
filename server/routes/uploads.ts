// Phase 7 extraction — moved out of server.ts's agency logo / user avatar
// upload routes. Both share the "logos" storage bucket (created on first
// use if missing) despite serving two different purposes.
import type { Express } from 'express';
import { sniffImageMime, extensionForImageMime, handleSingleImageUpload, resizeImage, LOGO_MAX_DIMENSION, AVATAR_MAX_DIMENSION } from '../imageUpload';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => Promise<void>;
}

export function registerUploadRoutes(app: Express, { supabaseAdmin, getTenantId, uploadToStorage, requireRole }: RouteDeps) {
  // Upload agency logo → save to Supabase Storage, update settings.logo_url.
  // Admin-only: this replaces branding shared by the whole tenant (security
  // audit finding — previously any authenticated member could change it).
  app.post("/api/upload/logo", requireRole('admin'), handleSingleImageUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      // file.mimetype is client-supplied and easily spoofed — trust only what
      // the actual bytes sniff as (see server/imageUpload.ts).
      const sniffedMime = sniffImageMime(file.buffer);
      if (!sniffedMime) {
        return res.status(400).json({ error: "Type de fichier non autorisé. Formats acceptés : PNG, JPEG, WebP." });
      }
      const { buffer, mimetype } = await resizeImage(file.buffer, sniffedMime, LOGO_MAX_DIMENSION);
      const storagePath = `${tenantId}/logo/${Date.now()}.${extensionForImageMime(mimetype)}`;
      // Ensure logos bucket exists
      const { data: bucketData } = await supabaseAdmin.storage.getBucket('logos');
      if (!bucketData) {
        await supabaseAdmin.storage.createBucket('logos', { public: true, fileSizeLimit: 5242880 });
      }
      const url = await uploadToStorage('logos', storagePath, buffer, mimetype);
      // Persist to settings
      const { data: existing } = await supabaseAdmin.from('settings').select('tenant_id').eq('tenant_id', tenantId).single();
      if (existing) {
        await supabaseAdmin.from('settings').update({ logo_url: url }).eq('tenant_id', tenantId);
      } else {
        await supabaseAdmin.from('settings').insert({ id: tenantId, tenant_id: tenantId, logo_url: url });
      }
      res.json({ url });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message || "Upload failed" }); }
  });

  // Upload user avatar → save to Supabase Storage, update profile.avatar
  app.post("/api/upload/avatar", handleSingleImageUpload('file'), async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const sniffedMime = sniffImageMime(file.buffer);
      if (!sniffedMime) {
        return res.status(400).json({ error: "Type de fichier non autorisé. Formats acceptés : PNG, JPEG, WebP." });
      }
      const { buffer, mimetype } = await resizeImage(file.buffer, sniffedMime, AVATAR_MAX_DIMENSION);
      const storagePath = `avatars/${userId}/${Date.now()}.${extensionForImageMime(mimetype)}`;
      const { data: bucketData } = await supabaseAdmin.storage.getBucket('logos');
      if (!bucketData) {
        await supabaseAdmin.storage.createBucket('logos', { public: true, fileSizeLimit: 5242880 });
      }
      const url = await uploadToStorage('logos', storagePath, buffer, mimetype);
      await supabaseAdmin.from('profiles').update({ avatar: url }).eq('id', userId);
      res.json({ url });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message || "Upload failed" }); }
  });
}
