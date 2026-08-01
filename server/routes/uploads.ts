// Phase 7 extraction — moved out of server.ts's agency logo / user avatar
// upload routes. Both share the "logos" storage bucket (created on first
// use if missing) despite serving two different purposes.
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  upload: any;
}

export function registerUploadRoutes(app: Express, { supabaseAdmin, getTenantId, uploadToStorage, upload }: RouteDeps) {
  // Upload agency logo → save to Supabase Storage, update settings.logo_url
  app.post("/api/upload/logo", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const ext = file.originalname.split('.').pop() || 'png';
      const storagePath = `${tenantId}/logo/${Date.now()}.${ext}`;
      // Ensure logos bucket exists
      const { data: bucketData } = await supabaseAdmin.storage.getBucket('logos');
      if (!bucketData) {
        await supabaseAdmin.storage.createBucket('logos', { public: true, fileSizeLimit: 5242880 });
      }
      const url = await uploadToStorage('logos', storagePath, file.buffer, file.mimetype);
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
  app.post("/api/upload/avatar", upload.single('file'), async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const ext = file.originalname.split('.').pop() || 'png';
      const storagePath = `avatars/${userId}/${Date.now()}.${ext}`;
      const { data: bucketData } = await supabaseAdmin.storage.getBucket('logos');
      if (!bucketData) {
        await supabaseAdmin.storage.createBucket('logos', { public: true, fileSizeLimit: 5242880 });
      }
      const url = await uploadToStorage('logos', storagePath, file.buffer, file.mimetype);
      await supabaseAdmin.from('profiles').update({ avatar: url }).eq('id', userId);
      res.json({ url });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message || "Upload failed" }); }
  });
}
