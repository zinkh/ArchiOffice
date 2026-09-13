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
import { assertTenantEntity } from '../assertTenantEntity';
import { getActiveAccountingProvider, syncInvoiceToAccounting } from '../invoiceAccountingSync';
import { loadInvoiceClientContact, resolveInvoiceClientId } from '../invoiceClientContact';

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
  // Liste allégée : ni `invoice_items` (une facture peut en porter des
  // dizaines, et rien dans la liste ne les affiche — seul le générateur de
  // facture, ouvert sur UNE facture à la fois, en a besoin ; voir GET
  // /api/invoices/:id juste en dessous). Un cabinet avec des années
  // d'archives voit vite ce fan-out peser plus lourd que tout le reste de la
  // réponse.
  //
  // `limit`/`cursor` (curseur opaque sur `created_at`, la colonne déjà triée
  // dessus) sont optionnels et rétrocompatibles : sans eux, la route rend
  // exactement le même tableau qu'avant — aucun des nombreux appelants qui
  // n'utilisent `/api/invoices` que comme un annuaire projet↔factures
  // (Dashboard, Gantt, ManagerDashboard, ...) n'a besoin d'être touché. Un
  // appelant qui PAGINE réellement (la page Factures) passe les deux et
  // reçoit `{ data, nextCursor }` à la place.
  app.get("/api/invoices", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const limit = req.query.limit ? Math.min(Math.max(parseInt(String(req.query.limit), 10) || 0, 1), 500) : undefined;
      let query = supabaseAdmin.from('invoices').select('*, projects(name)').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (req.query.cursor) {
        const cursorCreatedAt = Buffer.from(String(req.query.cursor), 'base64url').toString('utf8');
        query = query.lt('created_at', cursorCreatedAt);
      }
      if (limit) query = query.limit(limit);
      const { data: invoices, error } = await query;
      if (error) throw error;
      const result = (invoices || []).map((inv: any) => {
        const project_name = inv.projects?.name || null;
        const { projects: _p, ...rest } = inv;
        return { ...rest, project_name };
      });
      if (!limit) return res.json(result);
      const last = result[result.length - 1];
      const nextCursor = result.length === limit && last?.created_at
        ? Buffer.from(last.created_at, 'utf8').toString('base64url')
        : null;
      res.json({ data: result, nextCursor });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  // Pendant de la liste allégée ci-dessus : les lignes chiffrées d'UNE
  // facture, lues quand le générateur de facture (InvoiceGenerator.tsx)
  // s'ouvre sur elle plutôt qu'en fan-out sur chaque ligne de la liste.
  app.get("/api/invoices/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: inv, error } = await supabaseAdmin.from('invoices').select('*, invoice_items(*), projects(name)')
        .eq('id', req.params.id).eq('tenant_id', tenantId).single();
      if (error || !inv) return res.status(404).json({ error: 'Invoice not found' });
      const { projects: p, invoice_items, ...rest } = inv as any;
      // Fan-out kept to this single-item route only (never the list above) —
      // see CLAUDE.md's "Pagination et fan-out sur les listes" for why.
      const client = await loadInvoiceClientContact(supabaseAdmin, tenantId, rest);
      res.json({ ...rest, project_name: p?.name || null, items: invoice_items || [], client });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  app.post("/api/invoices", validateBody(invoiceSchema), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const {
        project_id, client_id, amount, description, status, due_date,
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        invoice_type, mission_id, mission_name, advancement_pct, affaire_invoice_number, phases,
        items
      } = req.body;

      // A project_id/client_id accepted straight from the body without
      // checking whose it is would let this tenant's invoice reference (and,
      // via the service-role `projects(name)`/contacts join on GET, leak the
      // name of) another tenant's project or contact.
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      if (client_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', client_id, tenantId))) {
        return res.status(400).json({ error: "Contact introuvable pour ce cabinet." });
      }
      // A Maître d'Ouvrage explicitly supplied wins; otherwise fall back to
      // the project's own client, so a facture created from a project still
      // carries a buyer identity without the caller having to look it up.
      const finalClientId = await resolveInvoiceClientId(supabaseAdmin, tenantId, { client_id, project_id });

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

      // When a connector (Zoho Invoice/Books, Odoo, ...) is this tenant's
      // numbering authority, the local sequential number must never be
      // assigned — including one supplied by the client, which used to win
      // outright (`invoice_number || getNextDocNumber(...)`) regardless of
      // whether a connector was active. The invoice is created as a
      // numberless Draft; syncInvoiceToAccounting below fills invoice_number
      // in only once the connector confirms it, so ArchiOffice never invents
      // a number the connector's own sequence doesn't recognise.
      const accountingProvider = await getActiveAccountingProvider(supabaseAdmin, tenantId);
      const finalInvoiceNumber = accountingProvider === 'none'
        ? (invoice_number || await getNextDocNumber(tenantId, 'num_prefix_facture', 'invoices', 'FAC'))
        : null;
      const finalStatus = accountingProvider === 'none' ? (status || 'Draft') : 'Draft';

      // Auto-generate the per-affaire business reference for acompte invoices
      // only (e.g. "26014-ACO-02") — a complement to, never a replacement of,
      // finalInvoiceNumber above, and unaffected by which numbering authority
      // owns finalInvoiceNumber: it's ArchiOffice-local bookkeeping either way.
      const finalAffaireInvoiceNumber = affaire_invoice_number
        || (invoice_type === 'acompte' && project_id ? await getNextAffaireInvoiceNumber(tenantId, project_id) : null);

      const { error: insErr } = await supabaseAdmin.from('invoices').insert({
        id, tenant_id: tenantId, invoice_number: finalInvoiceNumber, project_id, client_id: finalClientId,
        amount: amount || 0, tax_amount: tax_amount || 0, total_amount: total_amount || 0,
        status: finalStatus, due_date: due_date || null,
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

      let accountingSyncResult: any = null;
      if (accountingProvider !== 'none') {
        let pushProjectName: string | null = null;
        let pushProjectCode: string | null = null;
        let pushProjectAddress: string | null = null;
        if (project_id) {
          const { data: proj } = await supabaseAdmin.from('projects').select('name, project_code, address').eq('id', project_id).eq('tenant_id', tenantId).maybeSingle();
          pushProjectName = (proj as any)?.name || null;
          // Numéro et adresse de l'affaire : portés jusqu'à l'article Zoho créé
          // pour chaque ligne de la facture (zohoItemIdentity, server/zohoSync.ts)
          // — c'est ce qui rend l'article repérable dans le catalogue Zoho, plutôt
          // qu'une ligne libre anonyme.
          pushProjectCode = (proj as any)?.project_code || null;
          pushProjectAddress = (proj as any)?.address || null;
        }
        // Best effort, like the rest of this codebase's remontée/push
        // patterns: the invoice already exists locally (Draft, numberless),
        // so a connector outage here never loses it — it's retried via
        // POST /api/invoices/:id/sync-retry once the connector is reachable.
        accountingSyncResult = await syncInvoiceToAccounting(supabaseAdmin, tenantId, id, accountingProvider, {
          project_id, client_id: finalClientId, project_name: pushProjectName,
          project_code: pushProjectCode, project_address: pushProjectAddress, description,
          issue_date: issue_date || created_at.split('T')[0], due_date, amount, vat_rate, items: items || [],
        });
      }

      const { data: invoice } = await supabaseAdmin.from('invoices').select('*, invoice_items(*), projects(name)').eq('id', id).single();
      const project_name = (invoice as any)?.projects?.name || null;
      const { projects: _p, invoice_items, ...rest } = (invoice as any) || {};

      // Log activity
      const userNameInv = await getUserName(tenantId, req.user.id, req.user.email);
      const invLabel = invoice_type === 'acompte' ? "Facture d'acompte" : 'Facture';
      const loggedNumber = (invoice as any)?.invoice_number || id.slice(0, 8);
      logActivity(tenantId, req.user.id, userNameInv, `Création de la ${invLabel.toLowerCase()} N° ${loggedNumber}`, project_name || '', id, 'invoice', 'Factures');

      res.status(201).json({
        ...rest, project_name, items: invoice_items || [],
        accounting_sync: accountingProvider === 'none' ? null : { provider: accountingProvider, ...accountingSyncResult },
      });
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
        project_id, client_id, amount, description, status, due_date,
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
        .select('status, project_id, client_id, affaire_invoice_number, phases, amount, description, due_date, invoice_number, tax_amount, total_amount, issue_date, seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate, invoice_type, mission_id, mission_name, advancement_pct')
        .eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const existing = (existingInvoice as any) || {};

      if (project_id && project_id !== existing.project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      if (client_id && client_id !== existing.client_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', client_id, tenantId))) {
        return res.status(400).json({ error: "Contact introuvable pour ce cabinet." });
      }

      // A connector-confirmed invoice number is the connector's own legal
      // document reference, not local bookkeeping — it must stay frozen even
      // while the invoice is still 'Draft' locally (freshly synced but not
      // yet sent to the client), which the status-based lock below doesn't
      // cover on its own.
      const { data: syncedRow } = await supabaseAdmin.from('invoice_accounting_sync')
        .select('id').eq('local_invoice_id', id).eq('tenant_id', tenantId).eq('sync_status', 'synced').maybeSingle();
      const isAccountingSynced = !!syncedRow;

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
      if ((existing.status && existing.status !== 'Draft') || isAccountingSynced) {
        const contentChanged = Object.keys(fieldDefaults)
          .some(key => protectedFields[key] !== (existing[key] ?? fieldDefaults[key]));
        if (contentChanged) {
          return res.status(409).json({
            error: isAccountingSynced && (!existing.status || existing.status === 'Draft')
              ? "Cette facture est numérotée par le connecteur comptable connecté : son numéro et ses mentions légales ne peuvent plus être modifiés ici."
              : "Cette facture a déjà été envoyée au client : son montant, sa description, ses dates et ses mentions légales ne peuvent plus être modifiés. Seuls le statut, le type de facture et le rattachement à un projet restent modifiables."
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
      // client_id (the Maître d'Ouvrage) stays editable even once the
      // invoice's legal content is locked — same rationale as project_id
      // just above: correcting who a document is attached to isn't part of
      // the content already sent, and it's exactly what lets a Zoho/Odoo-
      // created placeholder contact be fixed after the fact.
      const finalClientId = merge(client_id, existing.client_id) ?? null;
      const projectChanged = project_id !== undefined && project_id !== existing.project_id;
      const finalInvoiceType = merge(invoice_type, existing.invoice_type) || 'standard';
      let finalAffaireInvoiceNumber = merge(affaire_invoice_number, existing.affaire_invoice_number) ?? null;
      if (affaire_invoice_number === undefined && finalInvoiceType === 'acompte' && finalProjectId
          && (projectChanged || !finalAffaireInvoiceNumber)) {
        finalAffaireInvoiceNumber = await getNextAffaireInvoiceNumber(tenantId, finalProjectId);
      }

      const { error: updErr } = await supabaseAdmin.from('invoices').update({
        ...protectedFields,
        status: merge(status, existing.status) || 'Draft', project_id: finalProjectId, client_id: finalClientId,
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

  // POST /api/invoices/:id/sync-retry — replays the connector push for an
  // invoice that came out of POST /api/invoices numberless because the
  // first attempt errored (connector unreachable, rate-limited, ...). Safe
  // to call any number of times: syncInvoiceToAccounting reuses the same
  // idempotency_key, so a push that actually succeeded on a prior attempt
  // is found and adopted rather than duplicated (see server/routes/
  // zohoInvoice.ts, zohoBooks.ts, odoo.ts's search-before-create).
  app.post("/api/invoices/:id/sync-retry", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const provider = await getActiveAccountingProvider(supabaseAdmin, tenantId);
      if (provider === 'none') {
        return res.status(400).json({ error: "Aucun connecteur comptable actif pour ce cabinet." });
      }
      const { data: inv } = await supabaseAdmin.from('invoices')
        .select('*, projects(name, project_code, address)').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (!inv) return res.status(404).json({ error: "Facture introuvable." });

      const result = await syncInvoiceToAccounting(supabaseAdmin, tenantId, id, provider, {
        project_id: (inv as any).project_id, client_id: (inv as any).client_id,
        project_name: (inv as any).projects?.name || null,
        // Numéro et adresse de l'affaire — voir le commentaire équivalent à la
        // création de la facture : rattachent l'article Zoho créé pour chaque
        // ligne à l'affaire facturée.
        project_code: (inv as any).projects?.project_code || null,
        project_address: (inv as any).projects?.address || null,
        description: (inv as any).description, issue_date: (inv as any).issue_date,
        due_date: (inv as any).due_date, amount: (inv as any).amount, vat_rate: (inv as any).vat_rate,
        items: (inv as any).invoice_items || [],
      });
      res.json({ provider, ...result });
    } catch (error: any) {
      console.error("Error retrying invoice sync:", error);
      res.status(500).json({ error: "Failed to retry accounting sync: " + error.message });
    }
  });
}
