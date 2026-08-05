// Phase 7 extraction — moved out of server.ts's inline Invoices section
// (the last domain of the deliberately-deferred core, alongside Proposals).
// This is the client-facing "cabinet bills its client" facture CRUD —
// distinct from Stancer Billing (server/routes/billing.ts, the cabinet's
// own ArchiOffice subscription) and from the SuperPDP/Chorus Pro/Zoho
// integrations, which all read/write these same `invoices` rows for
// e-invoicing submission but never define the CRUD itself.
import type { Express } from 'express';
import { validateBody } from '../../src/lib/validateRequest';
import { invoiceSchema } from '../../src/schemas/invoice.schema';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  captureWithContext: (error: any, context: Record<string, any>) => void;
  getNextDocNumber: (tenantId: string, settingCol: string, countTable: string, defaultPrefix: string) => Promise<string>;
  getNextAffaireInvoiceNumber: (tenantId: string, projectId: string) => Promise<string>;
}

export function registerInvoiceRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext, getNextDocNumber, getNextAffaireInvoiceNumber }: RouteDeps) {
  app.get("/api/invoices", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: invoices, error } = await supabaseAdmin.from('invoices').select('*, invoice_items(*), projects(name)').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (error) throw error;
      const result = (invoices || []).map((inv: any) => {
        const project_name = inv.projects?.name || null;
        const { projects: _p, invoice_items, ...rest } = inv;
        return { ...rest, project_name, items: invoice_items || [] };
      });
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.post("/api/invoices", validateBody(invoiceSchema), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const {
        project_id, amount, description, status, due_date,
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        invoice_type, mission_id, mission_name, advancement_pct, affaire_invoice_number, phases,
        items
      } = req.body;

      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();

      // Fetch default seller info from settings if not provided
      let finalSellerName = seller_name;
      let finalSellerAddress = seller_address;
      let finalSellerSiret = seller_siret;
      let finalSellerVatNumber = seller_vat_number;
      let finalSellerIban = seller_iban;
      let finalSellerBic = seller_bic;

      if (!finalSellerName || !finalSellerAddress || !finalSellerSiret) {
        const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
        if (settings) {
          finalSellerName = finalSellerName || (settings as any).agencyName;
          finalSellerAddress = finalSellerAddress || (settings as any).address;
          finalSellerSiret = finalSellerSiret || (settings as any).siret;
          finalSellerVatNumber = finalSellerVatNumber || (settings as any).vatNumber;
          finalSellerIban = finalSellerIban || (settings as any).seller_iban;
          finalSellerBic = finalSellerBic || (settings as any).seller_bic;
        }
      }

      // Auto-generate invoice_number if not provided — the tenant-wide legal
      // sequential reference, unaffected by the per-affaire number below.
      const finalInvoiceNumber = invoice_number || await getNextDocNumber(tenantId, 'num_prefix_facture', 'invoices', 'FAC');

      // Auto-generate the per-affaire business reference for acompte invoices
      // only (e.g. "26014-ACO-02") — a complement to, never a replacement of,
      // finalInvoiceNumber above.
      const finalAffaireInvoiceNumber = affaire_invoice_number
        || (invoice_type === 'acompte' && project_id ? await getNextAffaireInvoiceNumber(tenantId, project_id) : null);

      const { error: insErr } = await supabaseAdmin.from('invoices').insert({
        id, tenant_id: tenantId, invoice_number: finalInvoiceNumber, project_id,
        amount: amount || 0, tax_amount: tax_amount || 0, total_amount: total_amount || 0,
        status: status || 'Draft', due_date: due_date || null,
        issue_date: issue_date || created_at.split('T')[0], description: description || '', created_at,
        seller_name: finalSellerName || null, seller_address: finalSellerAddress || null,
        seller_siret: finalSellerSiret || null, seller_vat_number: finalSellerVatNumber || null,
        seller_iban: finalSellerIban || null, seller_bic: finalSellerBic || null, vat_rate: vat_rate || 20,
        invoice_type: invoice_type || 'standard',
        mission_id: mission_id || null, mission_name: mission_name || null, advancement_pct: advancement_pct || 0,
        affaire_invoice_number: finalAffaireInvoiceNumber, phases: phases || []
      });
      if (insErr) throw insErr;

      if (items && Array.isArray(items) && items.length > 0) {
        const itemRows = items.map((item: any) => ({ id: crypto.randomUUID(), invoice_id: id, tenant_id: tenantId, description: item.description, quantity: item.quantity, unit_price: item.unit_price, vat_rate: item.vat_rate }));
        const { error: itemErr } = await supabaseAdmin.from('invoice_items').insert(itemRows);
        if (itemErr) throw itemErr;
      }

      const { data: invoice } = await supabaseAdmin.from('invoices').select('*, invoice_items(*), projects(name)').eq('id', id).single();
      const project_name = (invoice as any)?.projects?.name || null;
      const { projects: _p, invoice_items, ...rest } = (invoice as any) || {};

      // Log activity
      const userNameInv = await getUserName(tenantId, req.user.id, req.user.email);
      const invLabel = invoice_type === 'acompte' ? "Facture d'acompte" : 'Facture';
      logActivity(tenantId, req.user.id, userNameInv, `Création de la ${invLabel.toLowerCase()} N° ${invoice_number || id.slice(0, 8)}`, project_name || '', id, 'invoice', 'Factures');

      res.status(201).json({ ...rest, project_name, items: invoice_items || [] });
    } catch (error: any) {
      console.error("Error creating invoice:", error);
      res.status(500).json({ error: "Failed to create invoice: " + error.message });
    }
  });

  app.put("/api/invoices/:id", validateBody(invoiceSchema), async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const {
        amount, description, status, due_date,
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        invoice_type, mission_id, mission_name, advancement_pct, affaire_invoice_number, phases,
        items
      } = req.body;

      // affaire_invoice_number/phases are only ever set at creation time (or
      // by a client that explicitly resends them) — an edit form that omits
      // them (e.g. a standard-invoice form with no phases UI) must not wipe
      // out the acompte data already stored, unlike the other fields above
      // which intentionally reset to their default when absent.
      const { data: existingInvoice } = await supabaseAdmin.from('invoices').select('affaire_invoice_number, phases').eq('id', id).eq('tenant_id', tenantId).maybeSingle();

      const { error: updErr } = await supabaseAdmin.from('invoices').update({
        amount: amount || 0, description: description || '', status: status || 'Draft', due_date: due_date || null,
        invoice_number: invoice_number || null, tax_amount: tax_amount || 0, total_amount: total_amount || 0, issue_date: issue_date || null,
        seller_name: seller_name || null, seller_address: seller_address || null, seller_siret: seller_siret || null,
        seller_vat_number: seller_vat_number || null, seller_iban: seller_iban || null, seller_bic: seller_bic || null, vat_rate: vat_rate || 20,
        invoice_type: invoice_type || 'standard',
        mission_id: mission_id || null, mission_name: mission_name || null, advancement_pct: advancement_pct || 0,
        affaire_invoice_number: affaire_invoice_number ?? (existingInvoice as any)?.affaire_invoice_number ?? null,
        phases: phases ?? (existingInvoice as any)?.phases ?? []
      }).eq('id', id).eq('tenant_id', tenantId);
      if (updErr) throw updErr;

      if (items && Array.isArray(items)) {
        await supabaseAdmin.from('invoice_items').delete().eq('invoice_id', id).eq('tenant_id', tenantId);
        if (items.length > 0) {
          const itemRows = items.map((item: any) => ({ id: item.id || crypto.randomUUID(), invoice_id: id, tenant_id: tenantId, description: item.description, quantity: item.quantity, unit_price: item.unit_price, vat_rate: item.vat_rate }));
          const { error: itemErr } = await supabaseAdmin.from('invoice_items').insert(itemRows);
          if (itemErr) throw itemErr;
        }
      }

      const { data: invoice } = await supabaseAdmin.from('invoices').select('*, invoice_items(*), projects(name)').eq('id', id).eq('tenant_id', tenantId).single();
      const project_name = (invoice as any)?.projects?.name || null;
      const { projects: _p, invoice_items, ...rest } = (invoice as any) || {};
      res.json({ ...rest, project_name, items: invoice_items || [] });
    } catch (error: any) {
      captureWithContext(error, { route: 'PUT /api/invoices/:id', tenantId, userId: req.user?.id });
      res.status(500).json({ error: "Failed to update invoice: " + error.message });
    }
  });
}
