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
  resolveFileUrl: (bucket: string, value: string | null | undefined, expiresIn?: number) => Promise<string | null>;
  upload: any;
}

export function registerProfileRoutes(app: Express, { supabaseAdmin, getTenantId, uploadToStorage, deleteFromStorage, resolveFileUrl, upload }: RouteDeps) {
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
        cv_url: await resolveFileUrl('cv', (profile as any).cv_url),
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
      const signedUrl = await resolveFileUrl('cv', url);
      res.json({ url: signedUrl, filename: file.originalname });
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

  // RGPD — droit à la portabilité : export de toutes les données personnelles
  // du compte courant (profil, CV/avatar, formations, expériences). Volontairement
  // limité aux données propres à l'individu, pas aux données professionnelles
  // du cabinet (projets, factures...) qui restent des données du tenant.
  app.get("/api/profile/me/export", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const userId = req.user.id;
      const [{ data: profile }, { data: education }, { data: experience }, authUserRes] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('*').eq('id', userId).maybeSingle(),
        tenantScopedFrom(supabaseAdmin, tenantId, 'profile_education').select('*').eq('user_id', userId),
        tenantScopedFrom(supabaseAdmin, tenantId, 'profile_experience').select('*').eq('user_id', userId),
        supabaseAdmin.auth.admin.getUserById(userId),
      ]);
      if (!profile) return res.status(404).json({ error: "Profil introuvable" });
      const p = profile as any;
      const cvDownloadUrl = await resolveFileUrl('cv', p.cv_url);

      res.json({
        exported_at: new Date().toISOString(),
        account: {
          email: authUserRes?.data?.user?.email || p.email,
          account_created_at: authUserRes?.data?.user?.created_at || null,
          terms_accepted_at: p.terms_accepted_at || null,
        },
        profile: {
          name: p.name, job_title: p.job_title, department: p.department,
          phone: p.phone, address: p.address, bio: p.bio,
          avatar_url: p.avatar || null,
          cv_filename: p.cv_filename || null,
          cv_download_url: cvDownloadUrl,
          cv_download_url_note: cvDownloadUrl ? "Lien temporaire, valable quelques jours seulement." : undefined,
        },
        education: education || [],
        experience: experience || [],
      });
    } catch (e: any) {
      console.error("[GET /api/profile/me/export]", e);
      res.status(500).json({ error: "Failed to export profile data" });
    }
  });

  // RGPD — droit à l'effacement : supprime le compte et les données
  // personnelles de l'utilisateur courant (profil, CV, avatar, formations,
  // expériences) et son compte d'authentification. Les données professionnelles
  // du cabinet qu'il a produites (documents, factures...) restent, comme
  // enregistrements de l'activité du cabinet, pas de l'individu.
  app.delete("/api/profile/me", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const userId = req.user.id;

      const { count } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      if ((count || 0) <= 1) {
        return res.status(409).json({ error: "Vous êtes le seul compte de ce cabinet. Utilisez la fermeture de cabinet dans Réglages > Zone dangereuse pour supprimer l'ensemble des données du cabinet." });
      }

      const { data: profile } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('cv_url, avatar').eq('id', userId).maybeSingle();
      const p = profile as any;
      if (p?.cv_url) await deleteFromStorage('cv', p.cv_url).catch(() => {});
      if (p?.avatar) await deleteFromStorage('logos', p.avatar).catch(() => {});
      await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_education').delete().eq('user_id', userId);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_experience').delete().eq('user_id', userId);
      // Deleted explicitly rather than relying solely on the
      // `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE` FK, so the
      // row is gone even if the auth user delete below partially fails.
      await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').delete().eq('id', userId);

      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw error;

      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/profile/me]", e);
      res.status(500).json({ error: e.message || "Failed to delete account" });
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
