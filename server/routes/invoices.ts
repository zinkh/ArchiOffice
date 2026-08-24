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
        project_id, amount, description, status, due_date,
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        invoice_type, mission_id, mission_name, advancement_pct, affaire_invoice_number, phases,
        items
      } = req.body;

      // maybeSingle(), not single(): a caller passing another tenant's id
      // must not 404 (that would confirm the id exists) — it falls through
      // to the tenant-scoped update/select below, which then match nothing
      // and the response comes back with none of that invoice's data.
      const { data: existingInvoice } = await supabaseAdmin.from('invoices')
        .select('status, project_id, affaire_invoice_number, phases, amount, description, due_date, invoice_number, tax_amount, total_amount, issue_date, seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate, invoice_type, mission_id, mission_name, advancement_pct')
        .eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const existing = (existingInvoice as any) || {};

      // A key omitted from the body (e.g. ProjectDetail's inline status
      // dropdown, which PUTs only `{ status }`) means "leave unchanged", not
      // "reset to the field's default" — only an explicit value (including
      // an explicit null/0/'', to clear or zero a field) overrides what's
      // stored. This also covers affaire_invoice_number/phases: an edit form
      // that has no phases UI (e.g. a standard invoice) must not wipe out
      // acompte data already stored.
      const merge = (val: any, fallback: any) => val !== undefined ? val : fallback;

      // Once an invoice has left Draft (sent to the client, paid, overdue...),
      // French e-invoicing rules (Factur-X / EN 16931 audit trail) require its
      // legal content — amount, description, dates, seller details — to stay
      // frozen. Recategorizing it (invoice type, mission/phases, status) and
      // attaching/reattaching it to a project stay editable: those are
      // ArchiOffice-local bookkeeping, not part of the document already sent.
      //
      // A Zoho-imported invoice never had most of these columns populated in
      // the first place (zohoInvoiceToLocalRow in server/zohoSync.ts sets
      // only amount/tax/total/dates), so a NULL already stored counts as
      // "unchanged" the same as a matching real value — the field defaults
      // below normalize both the incoming and the existing side the same way
      // before comparing, so a merely-absent existing value never trips the
      // lock on its own.
      const fieldDefaults: Record<string, any> = {
        amount: 0, description: '', due_date: null, invoice_number: null,
        tax_amount: 0, total_amount: 0, issue_date: null,
        seller_name: null, seller_address: null, seller_siret: null,
        seller_vat_number: null, seller_iban: null, seller_bic: null, vat_rate: 20,
      };
      const incoming: Record<string, any> = {
        amount, description, due_date, invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
      };
      const protectedFields: Record<string, any> = {};
      for (const key of Object.keys(fieldDefaults)) {
        protectedFields[key] = merge(incoming[key], existing[key]) ?? fieldDefaults[key];
      }
      // A row with no status at all (never happens for a real invoice — the
      // column always defaults to 'Draft' on insert, see the POST route
      // above) is treated as still editable rather than locked.
      if (existing.status && existing.status !== 'Draft') {
        const contentChanged = Object.keys(fieldDefaults)
          .some(key => protectedFields[key] !== (existing[key] ?? fieldDefaults[key]));
        if (contentChanged) {
          return res.status(409).json({
            error: "Cette facture a déjà été envoyée au client : son montant, sa description, ses dates et ses mentions légales ne peuvent plus être modifiés. Seuls le statut, le type de facture et le rattachement à un projet restent modifiables."
          });
        }
      }

      // Attaching (or re-attaching) an invoice to a project — notably a
      // Zoho-imported one, which always lands with project_id null, see
      // zohoInvoiceToLocalRow in server/zohoSync.ts — and, for an acompte
      // invoice, assigning it a local affaire reference number: a numbering
      // series ArchiOffice manages itself, independent of Zoho, that accounts
      // for the acompte invoices already issued on that project. Only
      // generated when the caller didn't explicitly supply one.
      const finalProjectId = merge(project_id, existing.project_id) ?? null;
      const projectChanged = project_id !== undefined && project_id !== existing.project_id;
      const finalInvoiceType = merge(invoice_type, existing.invoice_type) || 'standard';
      let finalAffaireInvoiceNumber = merge(affaire_invoice_number, existing.affaire_invoice_number) ?? null;
      if (affaire_invoice_number === undefined && finalInvoiceType === 'acompte' && finalProjectId
          && (projectChanged || !finalAffaireInvoiceNumber)) {
        finalAffaireInvoiceNumber = await getNextAffaireInvoiceNumber(tenantId, finalProjectId);
      }

      const { error: updErr } = await supabaseAdmin.from('invoices').update({
        ...protectedFields,
        status: merge(status, existing.status) || 'Draft', project_id: finalProjectId,
        invoice_type: finalInvoiceType,
        mission_id: merge(mission_id, existing.mission_id) ?? null,
        mission_name: merge(mission_name, existing.mission_name) ?? null,
        advancement_pct: merge(advancement_pct, existing.advancement_pct) || 0,
        affaire_invoice_number: finalAffaireInvoiceNumber,
        phases: merge(phases, existing.phases) ?? []
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
