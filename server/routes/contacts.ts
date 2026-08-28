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

export function registerContactRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/contacts", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('*');
      if (error) throw error;
      res.json((data || []).map((c: any) => ({ ...c, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() })));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch contacts" }); }
  });

  app.post("/api/contacts", async (req: any, res: any) => {
    console.log("POST /api/contacts hit");
    try {
      const tenantId = await getTenantId(req.user.id);
      const contact = req.body;
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
      const contact = req.body;
      // Strip computed/non-column fields before sending to Supabase
      const { id: _id, tenant_id: _t, name: _name, ...updateData } = contact;
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
      const { data: contact } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('first_name, last_name, company_name').eq('id', id).maybeSingle();
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
