// Phase 7 extraction — moved out of server.ts's "─── Document Templates ───"
// section. Self-contained CRUD + template-filling logic, no dependency on
// any other route module beyond the usual pair plus the static seed list.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { SEED_DOCUMENT_TEMPLATES } from '../seedDocumentTemplates';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerDocumentTemplateRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/document_templates", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { category } = req.query;
      const { count } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').select('*', { count: 'exact', head: true });
      if (!count) {
        const now = new Date().toISOString();
        const seenCategory = new Set<string>();
        const seedRows = SEED_DOCUMENT_TEMPLATES.map(t => {
          // First seeded template of each category becomes that category's default,
          // so a brand-new tenant already has a sensible CCTP/OS default with zero clicks.
          const isFirstOfCategory = !seenCategory.has(t.category);
          seenCategory.add(t.category);
          return {
            id: crypto.randomUUID(), name: t.name, category: t.category,
            description: t.description, content: t.content, variables: t.variables,
            is_seeded: true, editable: false, is_default: isFirstOfCategory, created_at: now, updated_at: now,
          };
        });
        const { error: seedErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').insert(seedRows);
        if (seedErr) throw seedErr;
      }
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').select('*').order('category').order('name');
      if (category) query = query.eq('category', category as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to fetch document templates" }); }
  });

  app.post("/api/document_templates", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { name, category, description, content, variables } = req.body;
      if (!name || !content) return res.status(400).json({ error: 'name et content requis' });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').insert({
        id, name, category: category || 'Autre', description: description || null,
        content, variables: variables || [], is_seeded: false, editable: true,
        created_by: req.user.id, created_at: now, updated_at: now,
      });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du modèle "${name}"`, name, id, 'document_template', 'Modèles de documents');
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to create document template" }); }
  });

  app.put("/api/document_templates/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').select('editable').eq('id', id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
      if (!existing.editable) return res.status(403).json({ error: "Ce modèle de base ne peut pas être modifié directement — dupliquez-le" });
      const { name, category, description, content, variables } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').update({
        name, category, description: description || null, content, variables: variables || [],
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to update document template" }); }
  });

  app.delete("/api/document_templates/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').select('editable, name').eq('id', id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
      if (!existing.editable) return res.status(403).json({ error: "Ce modèle de base ne peut pas être supprimé — dupliquez-le si besoin" });
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').delete().eq('id', id);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du modèle "${existing.name}"`, existing.name, id, 'document_template', 'Modèles de documents');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to delete document template" }); }
  });

  app.post("/api/document_templates/:id/duplicate", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: source } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').select('*').eq('id', id).maybeSingle();
      if (!source) return res.status(404).json({ error: 'Modèle introuvable' });
      const newId = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').insert({
        id: newId, name: `${source.name} (copie)`, category: source.category,
        description: source.description, content: source.content, variables: source.variables,
        is_seeded: false, editable: true, source_template_id: id,
        created_by: req.user.id, created_at: now, updated_at: now,
      });
      if (error) throw error;
      res.status(201).json({ id: newId });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to duplicate document template" }); }
  });

  // Marks a template as the tenant's default for its category (used by the Onboarding
  // wizard's "Modèles par défaut" step, and by the "Définir par défaut" action on the
  // Document Templates page). Allowed even on non-editable seeded templates — picking
  // a default doesn't modify the template itself, unlike edit/delete.
  app.post("/api/document_templates/:id/set-default", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: target } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').select('id, category').eq('id', id).maybeSingle();
      if (!target) return res.status(404).json({ error: 'Modèle introuvable' });
      const { error: clearErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').update({ is_default: false }).eq('category', target.category).eq('is_default', true);
      if (clearErr) throw clearErr;
      const { error: setErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').update({ is_default: true }).eq('id', id);
      if (setErr) throw setErr;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to set default template" }); }
  });

  app.post("/api/document_templates/:id/generate", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { variable_values } = req.body;
      const { data: template } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_templates').select('*').eq('id', id).maybeSingle();
      if (!template) return res.status(404).json({ error: 'Modèle introuvable' });
      const values = variable_values || {};
      const missing = (template.variables || []).filter((v: any) => v.required && !values[v.key]).map((v: any) => v.label);
      if (missing.length > 0) return res.status(400).json({ error: `Champs requis manquants : ${missing.join(', ')}` });
      let filled = template.content as string;
      for (const [key, value] of Object.entries(values)) {
        filled = filled.split(`{{${key}}}`).join(String(value ?? ''));
      }
      res.json({ filled_content: filled });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to generate document" }); }
  });
}
