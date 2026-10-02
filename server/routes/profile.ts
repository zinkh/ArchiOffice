// Phase 7 extraction — moved out of server.ts's "── Profile (bio, CV,
// éducation, expérience, projets en cours) ──" section. CV upload/delete
// needs the same storage helpers + multer instance as Meetings.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { findMembership, listTenantMemberIds } from '../tenantMemberships';
import { sanitizeFilename } from '../sanitizeFilename';
import { handleDocumentUpload } from '../documentUpload';
import { parseStorageRef } from '../storagePaths';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  deleteFromStorage: (bucket: string, fileUrl: string) => Promise<void>;
}

export function registerProfileRoutes(app: Express, { supabaseAdmin, getTenantId, uploadToStorage, deleteFromStorage }: RouteDeps) {
  app.get("/api/profile/:userId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { userId } = req.params;

      // Le profil est une donnée d'identité : une seule ligne par personne,
      // dont le `tenant_id` ne dit que le cabinet par défaut. C'est donc
      // l'appartenance au cabinet courant qui décide de la visibilité, pas
      // cette colonne — sinon un collègue exerçant aussi ailleurs deviendrait
      // introuvable ici (et lui-même ne verrait plus son propre profil depuis
      // son second cabinet).
      if (!(await findMembership(supabaseAdmin, userId, tenantId))) {
        return res.status(404).json({ error: "Profil introuvable" });
      }
      const { data: profile, error } = await supabaseAdmin.from('profiles')
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
      // Filtré sur l'identifiant seul : l'appelant est par construction membre
      // du cabinet courant, et son profil n'a qu'une ligne, quel que soit le
      // nombre de cabinets où il exerce.
      const { error } = await supabaseAdmin.from('profiles')
        .update({ bio, job_title, department })
        .eq('id', req.user.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.post("/api/profile/cv", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const storagePath = `${tenantId}/${req.user.id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
      const url = await uploadToStorage('cv', storagePath, file.buffer, file.mimetype);
      await supabaseAdmin.from('profiles').update({ cv_url: url, cv_filename: file.originalname }).eq('id', req.user.id);
      res.json({ url, filename: file.originalname });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to upload CV" });
    }
  });

  app.delete("/api/profile/cv", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: profile } = await supabaseAdmin.from('profiles').select('cv_url').eq('id', req.user.id).maybeSingle();
      await supabaseAdmin.from('profiles').update({ cv_url: null, cv_filename: null }).eq('id', req.user.id);
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

  // Resolves a stored CV reference (see server/storagePaths.ts) to a
  // short-lived signed URL, same mechanism as server/routes/storageAccess.ts —
  // called server-side here since the export bundles the link directly into
  // the downloaded JSON rather than making the browser ask for it separately.
  async function resolveCvDownloadUrl(cvUrl: string | null | undefined): Promise<string | null> {
    if (!cvUrl) return null;
    const ref = parseStorageRef(cvUrl);
    if (!ref) return null;
    const { data, error } = await supabaseAdmin.storage.from(ref.bucket).createSignedUrl(ref.path, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }

  // RGPD — droit à la portabilité : export de toutes les données personnelles
  // du compte courant (profil, CV/avatar, formations, expériences). Volontairement
  // limité aux données propres à l'individu, pas aux données professionnelles
  // du cabinet (projets, factures...) qui restent des données du tenant.
  app.get("/api/profile/me/export", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const userId = req.user.id;
      const [{ data: profile }, { data: education }, { data: experience }, authUserRes] = await Promise.all([
        supabaseAdmin.from('profiles').select('*').eq('id', userId).maybeSingle(),
        tenantScopedFrom(supabaseAdmin, tenantId, 'profile_education').select('*').eq('user_id', userId),
        tenantScopedFrom(supabaseAdmin, tenantId, 'profile_experience').select('*').eq('user_id', userId),
        supabaseAdmin.auth.admin.getUserById(userId),
      ]);
      if (!profile) return res.status(404).json({ error: "Profil introuvable" });
      const p = profile as any;
      const cvDownloadUrl = await resolveCvDownloadUrl(p.cv_url);

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

      // Compté sur les adhésions : la question est « reste-t-il quelqu'un
      // dans ce cabinet ? », pas « qui l'a en cabinet par défaut ? ».
      const count = (await listTenantMemberIds(supabaseAdmin, tenantId)).length;
      if (count <= 1) {
        return res.status(409).json({ error: "Vous êtes le seul compte de ce cabinet. Utilisez la fermeture de cabinet dans Réglages > Zone dangereuse pour supprimer l'ensemble des données du cabinet." });
      }

      const { data: profile } = await supabaseAdmin.from('profiles').select('cv_url, avatar').eq('id', userId).maybeSingle();
      const p = profile as any;
      if (p?.cv_url) await deleteFromStorage('cv', p.cv_url).catch(() => {});
      if (p?.avatar) await deleteFromStorage('logos', p.avatar).catch(() => {});
      await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_education').delete().eq('user_id', userId);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'profile_experience').delete().eq('user_id', userId);
      // Deleted explicitly rather than relying solely on the
      // `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE` FK, so the
      // row is gone even if the auth user delete below partially fails.
      await supabaseAdmin.from('profiles').delete().eq('id', userId);

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
