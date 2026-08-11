// Phase 7 extraction — moved out of server.ts's "─── Ragic Integration ───"
// section. Unlike Zoho, Ragic sync can insert brand-new invoice/proposal/
// project/contact rows on pull (not just update a status field), but the
// route handlers themselves are a self-contained sync mechanism — they
// don't touch the Invoices/Proposals CRUD route handlers that are still
// deferred. All queries filter by `.eq('tenant_id', tenantId)` explicitly
// (kept as-is rather than tenantScopedFrom, matching the Zoho modules,
// since several filter by ragic_id or write to `settings`).
//
// Security fix found while extracting: POST /api/ragic/webhook is meant to
// be called by Ragic itself (external, no JWT) — it authenticates via a
// `secret` query param compared against the tenant's own ragic_api_key,
// not via our session auth. It was missing from AUTH_EXEMPT, so the global
// auth middleware 401'd it before the handler's own secret check ever ran
// — the webhook has likely never received a single real notification.
import type { Express } from 'express';
import axios from 'axios';
import crypto from 'crypto';

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

function ragicHeaders(apiKey: string) {
  return {
    Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

function ragicUrl(account: string, sheet: string, recordId?: string | number) {
  const base = `https://${account}.ragic.com/${sheet}`;
  return recordId != null ? `${base}/${recordId}` : base;
}

export function registerRagicRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // GET /api/ragic/status
  app.get('/api/ragic/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('ragic_api_key,ragic_account').eq('tenant_id', tenantId).single();
      const connected = !!(settings as any)?.ragic_api_key && !!(settings as any)?.ragic_account;
      res.json({ connected });
    } catch (error: any) {
      console.error("[GET /api/ragic/status]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/ragic/disconnect
  app.delete('/api/ragic/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await supabaseAdmin.from('settings').update({
        ragic_api_key: null,
        ragic_account: null,
        ragic_sheet_contacts: null,
        ragic_sheet_projects: null,
        ragic_sheet_invoices: null,
        ragic_sheet_proposals: null,
      }).eq('tenant_id', tenantId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[DELETE /api/ragic/disconnect]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/ragic/sync  — bidirectional sync for contacts, projects, invoices, proposals
  app.post('/api/ragic/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      const s = settings as any;
      if (!s?.ragic_api_key || !s?.ragic_account) {
        return res.status(400).json({ error: 'Ragic non configuré. Veuillez renseigner la clé API et le compte dans les Paramètres.' });
      }

      const hdrs = ragicHeaders(s.ragic_api_key);
      const results: Record<string, { pushed: number; pulled: number; errors: string[] }> = {};

      // ── Helper: push one entity ──────────────────────────────────────────────
      async function pushEntity(
        table: string,
        sheet: string | undefined,
        rows: any[],
        toRagic: (row: any) => Record<string, any>,
      ) {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };
        if (!sheet) return out;
        for (const row of rows) {
          try {
            if (row.ragic_id) {
              // Update existing Ragic record
              await axios.post(ragicUrl(s.ragic_account, sheet, row.ragic_id), toRagic(row), { headers: hdrs });
            } else {
              // Create new Ragic record
              const resp = await axios.post(ragicUrl(s.ragic_account, sheet), toRagic(row), { headers: hdrs });
              const newId = resp.data?._ragicId ?? resp.data?.id ?? Object.keys(resp.data ?? {})[0];
              if (newId) {
                await supabaseAdmin.from(table).update({ ragic_id: String(newId) }).eq('id', row.id).eq('tenant_id', tenantId);
              }
            }
            out.pushed++;
          } catch (err: any) {
            console.error("[POST /api/ragic/sync]", err);
            out.errors.push(`Push ${row.id}: ${err.response?.data?.status ?? err.message}`);
          }
        }
        return out;
      }

      // ── Helper: pull one entity ──────────────────────────────────────────────
      async function pullEntity(
        table: string,
        sheet: string | undefined,
        fromRagic: (rec: any) => Record<string, any>,
        uniqueKey: string,
      ) {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };
        if (!sheet) return out;
        try {
          const resp = await axios.get(ragicUrl(s.ragic_account, sheet), { headers: hdrs });
          const records: any[] = Object.entries(resp.data ?? {})
            .filter(([k]) => !isNaN(Number(k)))
            .map(([id, val]: any) => ({ _ragicId: id, ...val }));

          for (const rec of records) {
            try {
              const mapped = fromRagic(rec);
              const { data: existing } = await supabaseAdmin
                .from(table).select('id').eq('ragic_id', rec._ragicId).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from(table).update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from(table).insert({ ...mapped, ragic_id: rec._ragicId, tenant_id: tenantId });
              }
              out.pulled++;
            } catch (err: any) {
              console.error("[POST /api/ragic/sync]", err);
              out.errors.push(`Pull ${rec._ragicId}: ${err.message}`);
            }
          }
        } catch (err: any) {
          console.error("[POST /api/ragic/sync]", err);
          out.errors.push(`Fetch échoué: ${err.response?.data?.status ?? err.message}`);
        }
        return out;
      }

      // ── Contacts ─────────────────────────────────────────────────────────────
      if (s.ragic_sheet_contacts) {
        const { data: contacts } = await supabaseAdmin.from('contacts').select('*').eq('tenant_id', tenantId);
        const toRagic = (c: any) => ({
          first_name: c.first_name ?? '',
          last_name: c.last_name ?? '',
          email: c.email ?? c.email_work ?? '',
          phone: c.phone ?? c.phone_mobile ?? c.phone_work ?? '',
          company_name: c.company_name ?? '',
          address: c.address ?? c.address_work_street ?? '',
          city: c.city ?? c.address_work_city ?? '',
          zip: c.zip ?? c.address_work_zip ?? '',
          country: c.country ?? c.address_work_country ?? '',
          siret: c.siret ?? '',
          category: c.category ?? '',
          notes: c.notes ?? '',
        });
        const fromRagic = (r: any) => ({
          first_name: r.first_name ?? '',
          last_name: r.last_name ?? '',
          email: r.email ?? '',
          phone: r.phone ?? '',
          company_name: r.company_name ?? '',
          address: r.address ?? '',
          city: r.city ?? '',
          zip: r.zip ?? '',
          country: r.country ?? '',
          siret: r.siret ?? '',
          category: r.category ?? '',
          notes: r.notes ?? '',
          candidatures: '',
          affaires: '',
          logo: '',
          ca_amount: 0,
          electronic_signature: '',
          contact_references: '',
          tags: '',
          created_at: new Date().toISOString(),
          created_by: 'ragic',
        });
        const push = await pushEntity('contacts', s.ragic_sheet_contacts, contacts ?? [], toRagic);
        const pull = await pullEntity('contacts', s.ragic_sheet_contacts, fromRagic, 'email');
        results.contacts = { pushed: push.pushed, pulled: pull.pulled, errors: [...push.errors, ...pull.errors] };
      }

      // ── Projects ─────────────────────────────────────────────────────────────
      if (s.ragic_sheet_projects) {
        const { data: projects } = await supabaseAdmin.from('projects').select('*').eq('tenant_id', tenantId);
        const toRagic = (p: any) => ({
          name: p.name ?? '',
          client: p.client ?? '',
          status: p.status ?? '',
          budget: p.budget ?? 0,
          start_date: p.start_date ?? '',
          end_date: p.end_date ?? '',
          description: p.description ?? '',
          address: p.address ?? '',
          project_code: p.project_code ?? '',
          surface: p.surface ?? '',
          construction_cost: p.construction_cost ?? '',
        });
        const fromRagic = (r: any) => ({
          name: r.name ?? '',
          client: r.client ?? '',
          status: r.status ?? 'Planning',
          budget: parseFloat(r.budget) || 0,
          start_date: r.start_date ?? null,
          end_date: r.end_date ?? null,
          description: r.description ?? '',
          address: r.address ?? '',
          project_code: r.project_code ?? '',
        });
        const push = await pushEntity('projects', s.ragic_sheet_projects, projects ?? [], toRagic);
        const pull = await pullEntity('projects', s.ragic_sheet_projects, fromRagic, 'name');
        results.projects = { pushed: push.pushed, pulled: pull.pulled, errors: [...push.errors, ...pull.errors] };
      }

      // ── Invoices ──────────────────────────────────────────────────────────────
      if (s.ragic_sheet_invoices) {
        const { data: invoices } = await supabaseAdmin.from('invoices').select('*').eq('tenant_id', tenantId);
        const toRagic = (inv: any) => ({
          invoice_number: inv.invoice_number ?? '',
          project_name: inv.project_name ?? '',
          amount: inv.amount ?? 0,
          tax_amount: inv.tax_amount ?? 0,
          total_amount: inv.total_amount ?? 0,
          status: inv.status ?? '',
          issue_date: inv.issue_date ?? '',
          due_date: inv.due_date ?? '',
          description: inv.description ?? '',
        });
        const fromRagic = (r: any) => ({
          invoice_number: r.invoice_number ?? '',
          amount: parseFloat(r.amount) || 0,
          tax_amount: parseFloat(r.tax_amount) || 0,
          total_amount: parseFloat(r.total_amount) || 0,
          status: r.status ?? 'Draft',
          issue_date: r.issue_date ?? null,
          due_date: r.due_date ?? null,
          description: r.description ?? '',
          project_id: '',
          created_at: new Date().toISOString(),
        });
        const push = await pushEntity('invoices', s.ragic_sheet_invoices, invoices ?? [], toRagic);
        const pull = await pullEntity('invoices', s.ragic_sheet_invoices, fromRagic, 'invoice_number');
        results.invoices = { pushed: push.pushed, pulled: pull.pulled, errors: [...push.errors, ...pull.errors] };
      }

      // ── Proposals ─────────────────────────────────────────────────────────────
      if (s.ragic_sheet_proposals) {
        const { data: proposals } = await supabaseAdmin.from('proposals').select('*').eq('tenant_id', tenantId);
        const toRagic = (p: any) => ({
          title: p.title ?? '',
          client_name: p.client_name ?? '',
          amount: p.amount ?? 0,
          status: p.status ?? '',
          description: p.description ?? '',
          created_at: p.created_at ?? '',
          construction_cost: p.construction_cost ?? '',
        });
        const fromRagic = (r: any) => ({
          title: r.title ?? '',
          client_id: '',
          client_name: r.client_name ?? '',
          amount: parseFloat(r.amount) || 0,
          status: r.status ?? 'Draft',
          description: r.description ?? '',
          created_at: r.created_at ?? new Date().toISOString(),
        });
        const push = await pushEntity('proposals', s.ragic_sheet_proposals, proposals ?? [], toRagic);
        const pull = await pullEntity('proposals', s.ragic_sheet_proposals, fromRagic, 'title');
        results.proposals = { pushed: push.pushed, pulled: pull.pulled, errors: [...push.errors, ...pull.errors] };
      }

      res.json({ results });
    } catch (error: any) {
      console.error('[Ragic sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync Ragic échouée' });
    }
  });

  // POST /api/ragic/webhook  — receives Ragic webhook notifications. No JWT
  // (see AUTH_EXEMPT in server.ts) — authenticated instead via the `secret`
  // query param, checked below against the tenant's own ragic_api_key.
  app.post('/api/ragic/webhook', async (req: any, res: any) => {
    try {
      // Ragic sends the updated record as JSON; detect entity from query param ?entity=contacts|projects|invoices|proposals
      const entity = req.query.entity as string;
      const secret = req.query.secret as string;
      const body = req.body;

      if (!entity || !['contacts', 'projects', 'invoices', 'proposals'].includes(entity)) {
        return res.status(400).json({ error: 'Paramètre entity manquant ou invalide' });
      }

      // Find the tenant by webhook secret (stored in ragic_account field prefix or a dedicated secret)
      const tenantId = req.query.tenant as string;
      if (!tenantId) return res.status(400).json({ error: 'Paramètre tenant manquant' });

      // Validate secret against the tenant's API key prefix
      const { data: settings } = await supabaseAdmin.from('settings')
        .select('ragic_api_key,ragic_sheet_contacts,ragic_sheet_projects,ragic_sheet_invoices,ragic_sheet_proposals')
        .eq('tenant_id', tenantId).single();
      if (!(settings as any)?.ragic_api_key) return res.status(403).json({ error: 'Tenant non configuré' });
      if (!secret || !timingSafeEqualStr(secret, (settings as any).ragic_api_key)) {
        return res.status(403).json({ error: 'Secret invalide' });
      }

      const records: any[] = Array.isArray(body) ? body : [body];
      let upserted = 0;

      for (const rec of records) {
        try {
          const ragicId = String(rec._ragicId ?? rec.id ?? '');
          if (!ragicId) continue;

          if (entity === 'contacts') {
            const mapped = {
              first_name: rec.first_name ?? '', last_name: rec.last_name ?? '',
              email: rec.email ?? '', phone: rec.phone ?? '',
              company_name: rec.company_name ?? '', siret: rec.siret ?? '',
              address: rec.address ?? '', city: rec.city ?? '',
              zip: rec.zip ?? '', country: rec.country ?? '',
              notes: rec.notes ?? '', category: rec.category ?? '',
              candidatures: '', affaires: '', logo: '', ca_amount: 0,
              electronic_signature: '', contact_references: '', tags: '', created_by: 'ragic',
            };
            const { data: existing } = await supabaseAdmin.from('contacts').select('id').eq('ragic_id', ragicId).eq('tenant_id', tenantId).maybeSingle();
            if (existing) {
              await supabaseAdmin.from('contacts').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
            } else {
              await supabaseAdmin.from('contacts').insert({ ...mapped, ragic_id: ragicId, tenant_id: tenantId, created_at: new Date().toISOString() });
            }
          } else if (entity === 'projects') {
            const mapped = {
              name: rec.name ?? '', client: rec.client ?? '',
              status: rec.status ?? 'Planning', budget: parseFloat(rec.budget) || 0,
              start_date: rec.start_date ?? null, end_date: rec.end_date ?? null,
              description: rec.description ?? '', address: rec.address ?? '',
              project_code: rec.project_code ?? '',
            };
            const { data: existing } = await supabaseAdmin.from('projects').select('id').eq('ragic_id', ragicId).eq('tenant_id', tenantId).maybeSingle();
            if (existing) {
              await supabaseAdmin.from('projects').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
            } else {
              await supabaseAdmin.from('projects').insert({ ...mapped, ragic_id: ragicId, tenant_id: tenantId });
            }
          } else if (entity === 'invoices') {
            const mapped = {
              invoice_number: rec.invoice_number ?? '',
              amount: parseFloat(rec.amount) || 0, tax_amount: parseFloat(rec.tax_amount) || 0,
              total_amount: parseFloat(rec.total_amount) || 0,
              status: rec.status ?? 'Draft',
              issue_date: rec.issue_date ?? null, due_date: rec.due_date ?? null,
              description: rec.description ?? '', project_id: '',
            };
            const { data: existing } = await supabaseAdmin.from('invoices').select('id').eq('ragic_id', ragicId).eq('tenant_id', tenantId).maybeSingle();
            if (existing) {
              await supabaseAdmin.from('invoices').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
            } else {
              await supabaseAdmin.from('invoices').insert({ ...mapped, ragic_id: ragicId, tenant_id: tenantId, created_at: new Date().toISOString() });
            }
          } else if (entity === 'proposals') {
            const mapped = {
              title: rec.title ?? '', client_id: '',
              client_name: rec.client_name ?? '',
              amount: parseFloat(rec.amount) || 0,
              status: rec.status ?? 'Draft',
              description: rec.description ?? '',
            };
            const { data: existing } = await supabaseAdmin.from('proposals').select('id').eq('ragic_id', ragicId).eq('tenant_id', tenantId).maybeSingle();
            if (existing) {
              await supabaseAdmin.from('proposals').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
            } else {
              await supabaseAdmin.from('proposals').insert({ ...mapped, ragic_id: ragicId, tenant_id: tenantId, created_at: new Date().toISOString() });
            }
          }
          upserted++;
        } catch (err: any) {
          console.error('[Ragic webhook record error]', err.message);
        }
      }

      res.json({ upserted });
    } catch (error: any) {
      console.error('[Ragic webhook error]', error.message);
      res.status(500).json({ error: error.message });
    }
  });
}
