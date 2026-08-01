// Phase 7 extraction — moved out of server.ts's "── Profile (bio, CV,
// éducation, expérience, projets en cours) ──" section. CV upload/delete
// needs the same storage helpers + multer instance as Meetings.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { sanitizeFilename } from '../sanitizeFilename';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  deleteFromStorage: (bucket: string, fileUrl: string) => Promise<void>;
  upload: any;
}

export function registerProfileRoutes(app: Express, { supabaseAdmin, getTenantId, uploadToStorage, deleteFromStorage, upload }: RouteDeps) {
  app.get("/api/profile/:userId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { userId } = req.params;

      const { data: profile, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles')
        .select('id, name, email, role, job_title, department, phone, address, avatar, bio, cv_url, cv_filename')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!profile) return res.status(404).json({ error: "Profil introuvable" });

      const [{ data: education }, { data: experience }, { data: memberships }] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'profile_education').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
        tenantScopedFrom(supabaseAdmin, tenantId, 'profile_experience').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
        tenantScopedFrom(supabaseAdmin, tenantId, 'project_members').select('project_id, role, projects(name, status)').eq('user_id', userId),
      ]);

      const currentProjects = (memberships || [])
        .filter((m: any) => m.projects)
        .map((m: any) => ({ id: m.project_id, name: m.projects.name, status: m.projects.status, role: m.role }));

      res.json({
        ...profile,
        jobTitle: profile.job_title,
        education: education || [],
        experience: experience || [],
        current_projects: currentProjects,
        is_self: userId === req.user.id,
      });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  app.put("/api/profile", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { bio, job_title, department } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles')
        .update({ bio, job_title, department })
        .eq('id', req.user.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.post("/api/profile/cv", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const storagePath = `${tenantId}/${req.user.id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
      const url = await uploadToStorage('cv', storagePath, file.buffer, file.mimetype);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').update({ cv_url: url, cv_filename: file.originalname }).eq('id', req.user.id);
      res.json({ url, filename: file.originalname });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to upload CV" });
    }
  });

  app.delete("/api/profile/cv", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: profile } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('cv_url').eq('id', req.user.id).maybeSingle();
      await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').update({ cv_url: null, cv_filename: null }).eq('id', req.user.id);
      if ((profile as any)?.cv_url) deleteFromStorage('cv', (profile as any).cv_url).catch(() => {});
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/profile/cv]", e);
      res.status(500).json({ error: "Failed to remove CV" });
    }
  });

  app.post("/api/profile/education", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { school, degree, field, start_year, end_year } = req.body;
      if (!school?.trim()) return res.status(400).json({ error: "L'établissement est requis" });
      const id = crypto.randomUUID();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_education').insert({
        id, user_id: req.user.id, school: school.trim(), degree, field, start_year, end_year
      });
      if (error) throw error;
      res.status(201).json({ id, school, degree, field, start_year, end_year });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to add education entry" });
    }
  });

  app.put("/api/profile/education/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { school, degree, field, start_year, end_year } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_education')
        .update({ school, degree, field, start_year, end_year })
        .eq('id', req.params.id).eq('user_id', req.user.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[PUT /api/profile/education/:id]", e);
      res.status(500).json({ error: "Failed to update education entry" });
    }
  });

  app.delete("/api/profile/education/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_education').delete()
        .eq('id', req.params.id).eq('user_id', req.user.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/profile/education/:id]", e);
      res.status(500).json({ error: "Failed to delete education entry" });
    }
  });

  app.post("/api/profile/experience", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, company, start_date, end_date, description } = req.body;
      if (!title?.trim()) return res.status(400).json({ error: "L'intitulé du poste est requis" });
      const id = crypto.randomUUID();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_experience').insert({
        id, user_id: req.user.id, title: title.trim(), company, start_date, end_date, description
      });
      if (error) throw error;
      res.status(201).json({ id, title, company, start_date, end_date, description });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to add experience entry" });
    }
  });

  app.put("/api/profile/experience/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, company, start_date, end_date, description } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_experience')
        .update({ title, company, start_date, end_date, description })
        .eq('id', req.params.id).eq('user_id', req.user.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[PUT /api/profile/experience/:id]", e);
      res.status(500).json({ error: "Failed to update experience entry" });
    }
  });

  app.delete("/api/profile/experience/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_experience').delete()
        .eq('id', req.params.id).eq('user_id', req.user.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/profile/experience/:id]", e);
      res.status(500).json({ error: "Failed to delete experience entry" });
    }
  });
}
