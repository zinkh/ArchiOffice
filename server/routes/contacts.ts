// Phase 7 extraction — moved out of server.ts's inline Contacts CRUD
// section, plus all three /api/contact-categories routes. POST/DELETE
// used to stay inline because they landed in the middle of the (until now)
// still-inline Invoices section of server.ts — an unrelated code
// organization quirk, not a real dependency — and moved here alongside
// GET now that Invoices itself is extracted too.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

// Mirrors the `contacts` table columns in supabase/schema.sql. The web form
// only ever sends these, so it never hits this — but the AI agent generates
// its insert/update payload straight from a JSON schema (see AGENT_RESOURCES
// in packages/archioffice-agents), and a field name it invents (e.g. a
// plausible-looking "type" or "legal_form" for a company contact) would
// otherwise reach Supabase verbatim: PostgREST rejects the whole write with
// "column not found", which the agent then has no way to self-correct from.
// Whitelisting silently drops anything unrecognized instead, same as a human
// form implicitly does by only ever sending known fields.
const CONTACT_COLUMNS = new Set([
  'id', 'prefix', 'first_name', 'middle_name', 'last_name', 'suffix', 'nickname',
  'company_name', 'job_title', 'department',
  'email_work', 'email_home', 'email_other', 'email',
  'phone_mobile', 'phone_work', 'phone_home', 'phone_main', 'phone_fax_work', 'phone_fax_home', 'phone_pager', 'phone_other', 'phone',
  'address_work_street', 'address_work_city', 'address_work_state', 'address_work_zip', 'address_work_country',
  'address_home_street', 'address_home_city', 'address_home_state', 'address_home_zip', 'address_home_country',
  'address', 'zip', 'city', 'state', 'country',
  'candidatures', 'affaires', 'logo', 'ca_amount', 'electronic_signature', 'contact_references', 'tags',
  'category', 'notes', 'birthday', 'website', 'created_at', 'created_by',
  'siret', 'vat_number', 'market_number', 'market_amount_base', 'market_amount_options', 'market_amount_avenants',
  'is_personal', 'corps_etat', 'specialite',
]);

function pickContactColumns(body: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of Object.keys(body || {})) {
    if (CONTACT_COLUMNS.has(key)) out[key] = body[key];
  }
  return out;
}

export function registerContactRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  // Un contact "pro" reste partagé par tout le cabinet ; un contact
  // `is_personal` n'appartient qu'à son créateur (`owner_user_id`, jamais
  // `created_by` — un champ texte libre déjà utilisé pour d'autres valeurs
  // comme 'odoo'/'ragic', pas un identifiant fiable). Filtré en mémoire
  // plutôt que via `.or()` PostgREST : la liste d'un cabinet reste petite, et
  // ça évite de dépendre de la syntaxe `and()` imbriquée dans un `.or()`.
  app.get("/api/contacts", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: profileRow } = await supabaseAdmin.from('profiles').select('show_personal_contacts').eq('id', req.user.id).maybeSingle();
      // Absent (colonne pas encore migrée, ou profil introuvable) vaut "oui" :
      // le réglage ne doit jamais masquer des contacts déjà visibles avant son
      // introduction.
      const showPersonal = (profileRow as any)?.show_personal_contacts ?? true;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('*');
      if (error) throw error;
      const visible = (data || []).filter((c: any) => {
        if (!c.is_personal) return true;
        if (!showPersonal) return false;
        return c.owner_user_id === req.user.id;
      });
      res.json(visible.map((c: any) => ({ ...c, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() })));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch contacts" }); }
  });

  app.post("/api/contacts", async (req: any, res: any) => {
    console.log("POST /api/contacts hit");
    try {
      const tenantId = await getTenantId(req.user.id);
      const contact = pickContactColumns(req.body);
      const id = contact.id || crypto.randomUUID();
      // first_name/last_name are NOT NULL columns, but a company-only contact
      // (no named person) is a valid case the UI already supports — the web
      // form always sends '' for these when left blank, but a caller that
      // omits the keys entirely (e.g. the AI agent creating a company
      // contact) would otherwise hit a not-null constraint violation.
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').insert({
        ...contact,
        id,
        first_name: contact.first_name ?? '',
        last_name: contact.last_name ?? '',
        // Never client-writable (owner_user_id isn't in CONTACT_COLUMNS —
        // pickContactColumns already dropped it from `contact` above): a
        // personal contact belongs to whoever creates it, a pro one to no one.
        owner_user_id: contact.is_personal ? req.user.id : null,
      });
      if (error) throw error;
      const contactName = contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du contact "${contactName}"`, contactName, id, 'contact', 'Contacts');
      res.status(201).json({ id });
    } catch (e: any) {
      console.error("Error creating contact:", e.message);
      res.status(500).json({ error: "Failed to create contact: " + e.message });
    }
  });

  app.put("/api/contacts/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('is_personal, owner_user_id').eq('id', id).maybeSingle();
      // A personal contact owned by someone else stays invisible in the list
      // (GET above), but the id can still leak elsewhere (an activity log, a
      // link shared between colleagues) — refuse the edit outright rather
      // than rely on it never being guessed.
      if (existing && (existing as any).is_personal && (existing as any).owner_user_id && (existing as any).owner_user_id !== req.user.id) {
        return res.status(403).json({ error: "Ce contact personnel appartient à un autre utilisateur." });
      }
      // pickContactColumns already strips computed/non-column fields (id,
      // tenant_id, the derived `name`, and anything else not a real column) —
      // owner_user_id in particular is never in that whitelist, so it can
      // only be set below, never straight from the request body.
      const updateData = pickContactColumns(req.body);
      delete updateData.id;
      const nextIsPersonal = updateData.is_personal !== undefined ? !!updateData.is_personal : !!(existing as any)?.is_personal;
      updateData.owner_user_id = nextIsPersonal
        // Keep the existing owner once one is set; a legacy personal contact
        // (created before owner_user_id existed) is claimed by whoever edits
        // it first, rather than staying invisible to everyone forever.
        ? ((existing as any)?.owner_user_id || req.user.id)
        : null;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').update(updateData).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error updating contact:", e.message);
      res.status(500).json({ error: "Failed to update contact: " + e.message });
    }
  });

  app.delete("/api/contacts/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: contact } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('first_name, last_name, company_name, is_personal, owner_user_id').eq('id', id).maybeSingle();
      if (contact && (contact as any).is_personal && (contact as any).owner_user_id && (contact as any).owner_user_id !== req.user.id) {
        return res.status(403).json({ error: "Ce contact personnel appartient à un autre utilisateur." });
      }
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').delete().eq('id', id);
      if (error) throw error;
      const contactName = (contact as any)?.company_name || `${(contact as any)?.first_name || ''} ${(contact as any)?.last_name || ''}`.trim();
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du contact "${contactName}"`, contactName, id, 'contact', 'Contacts');
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error deleting contact:", e.message);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  app.get("/api/contact-categories", async (req: any, res: any) => {
    console.log("GET /api/contact-categories called");
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_categories').select('*').order('name');
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch contact categories" }); }
  });

  app.post("/api/contact-categories", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, name } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_categories').insert({ id, name });
      if (error) throw error;
      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create contact category" });
    }
  });

  app.delete("/api/contact-categories/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_categories').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete contact category" });
    }
  });
}
