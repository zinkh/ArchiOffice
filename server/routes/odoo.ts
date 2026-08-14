// Phase 7 extraction — moved out of server.ts's "─── Odoo Integration ───"
// section. Same profile as ragic.ts: API-key based (no OAuth browser
// redirect, no webhook endpoint), sync can insert new invoice/proposal/
// project/contact rows on pull but doesn't touch the deferred Invoices/
// Proposals CRUD route handlers themselves. Explicit
// `.eq('tenant_id', tenantId)` chains kept as-is rather than
// tenantScopedFrom, matching zohoInvoice.ts/zohoBooks.ts/ragic.ts.
import type { Express } from 'express';
import axios from 'axios';
import { assertPublicHttpUrl } from '../ssrfGuard';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

// Calls Odoo JSON-RPC endpoint with API key authentication (Odoo 14+)
async function odooRpc(url: string, db: string, username: string, apiKey: string, model: string, method: string, args: any[], kwargs: any = {}) {
  const resp = await axios.post(
    `${url}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: { model, method, args, kwargs },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
      },
      params: { db },
    }
  );
  if (resp.data?.error) throw new Error(resp.data.error.data?.message ?? resp.data.error.message ?? 'Odoo RPC error');
  return resp.data?.result;
}

export function registerOdooRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  // GET /api/odoo/status
  app.get('/api/odoo/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('odoo_url,odoo_api_key').eq('tenant_id', tenantId).single();
      const connected = !!(settings as any)?.odoo_url && !!(settings as any)?.odoo_api_key;
      res.json({ connected });
    } catch (error: any) {
      console.error("[GET /api/odoo/status]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/odoo/disconnect
  app.delete('/api/odoo/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await supabaseAdmin.from('settings').update({
        odoo_url: null, odoo_db: null, odoo_username: null, odoo_api_key: null,
      }).eq('tenant_id', tenantId);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion d\'Odoo', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error: any) {
      console.error("[DELETE /api/odoo/disconnect]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/odoo/sync  — bidirectional sync for contacts, projects, invoices, proposals
  app.post('/api/odoo/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      const s = settings as any;
      if (!s?.odoo_url || !s?.odoo_api_key || !s?.odoo_username || !s?.odoo_db) {
        return res.status(400).json({ error: 'Odoo non configuré. Veuillez renseigner l\'URL, la base de données, l\'identifiant et la clé API dans les Paramètres.' });
      }

      // The stored Odoo URL is used verbatim as an outbound RPC target —
      // validate it resolves to a public host so a private/internal URL saved
      // in settings can't turn this sync into an SSRF proxy.
      try {
        await assertPublicHttpUrl(s.odoo_url);
      } catch (e: any) {
        return res.status(e.status || 400).json({ error: `URL Odoo non autorisée : ${e.message}` });
      }

      const rpc = (model: string, method: string, args: any[], kwargs?: any) =>
        odooRpc(s.odoo_url, s.odoo_db, s.odoo_username, s.odoo_api_key, model, method, args, kwargs);

      const results: Record<string, { pushed: number; pulled: number; errors: string[] }> = {};

      // ── Contacts ─────────────────────────────────────────────────────────────
      try {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };

        // Push: ArchiOffice → Odoo res.partner
        const { data: contacts } = await supabaseAdmin.from('contacts').select('*').eq('tenant_id', tenantId);
        for (const c of (contacts ?? [])) {
          try {
            const vals = {
              name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Contact',
              email: c.email ?? c.email_work ?? '',
              phone: c.phone ?? c.phone_mobile ?? c.phone_work ?? '',
              street: c.address ?? c.address_work_street ?? '',
              city: c.city ?? c.address_work_city ?? '',
              zip: c.zip ?? c.address_work_zip ?? '',
              vat: c.vat_number ?? '',
              ref: c.siret ?? '',
              comment: c.notes ?? '',
              customer_rank: 1,
              is_company: !!(c.company_name && !c.first_name),
              company_name: c.company_name ?? '',
            };
            if (c.odoo_id) {
              await rpc('res.partner', 'write', [[c.odoo_id], vals]);
            } else {
              const newId = await rpc('res.partner', 'create', [vals]);
              if (newId) await supabaseAdmin.from('contacts').update({ odoo_id: newId }).eq('id', c.id).eq('tenant_id', tenantId);
            }
            out.pushed++;
          } catch (err: any) {
            console.error("[POST /api/odoo/sync]", err); out.errors.push(`Push contact ${c.id}: ${err.message}`); }
        }

        // Pull: Odoo res.partner → ArchiOffice
        try {
          const partners = await rpc('res.partner', 'search_read',
            [[['customer_rank', '>', 0]]],
            { fields: ['id', 'name', 'email', 'phone', 'street', 'city', 'zip', 'vat', 'ref', 'comment', 'is_company', 'company_name'], limit: 500 }
          );
          for (const p of (partners ?? [])) {
            try {
              const nameParts = (p.name ?? '').split(' ');
              const mapped = {
                first_name: nameParts[0] ?? '',
                last_name: nameParts.slice(1).join(' ') ?? '',
                email: p.email ?? '',
                phone: p.phone ?? '',
                address: p.street ?? '',
                city: p.city ?? '',
                zip: p.zip ?? '',
                vat_number: p.vat ?? '',
                siret: p.ref ?? '',
                notes: p.comment ?? '',
                company_name: p.company_name ?? '',
                candidatures: '', affaires: '', logo: '', ca_amount: 0,
                electronic_signature: '', contact_references: '', tags: '', created_by: 'odoo',
              };
              const { data: existing } = await supabaseAdmin.from('contacts').select('id').eq('odoo_id', p.id).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from('contacts').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from('contacts').insert({ ...mapped, odoo_id: p.id, tenant_id: tenantId, created_at: new Date().toISOString() });
              }
              out.pulled++;
            } catch (err: any) {
              console.error("[POST /api/odoo/sync]", err); out.errors.push(`Pull partner ${p.id}: ${err.message}`); }
          }
        } catch (err: any) {
          console.error("[POST /api/odoo/sync]", err); out.errors.push(`Pull contacts échoué: ${err.message}`); }

        results.contacts = out;
      } catch (err: any) {
        console.error("[POST /api/odoo/sync]", err); results.contacts = { pushed: 0, pulled: 0, errors: [err.message] }; }

      // ── Projects ─────────────────────────────────────────────────────────────
      try {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };

        const { data: projects } = await supabaseAdmin.from('projects').select('*').eq('tenant_id', tenantId);
        for (const p of (projects ?? [])) {
          try {
            const vals = {
              name: p.name ?? '',
              description: p.description ?? '',
              date_start: p.start_date ? p.start_date.split('T')[0] : false,
              date: p.end_date ? p.end_date.split('T')[0] : false,
            };
            if (p.odoo_id) {
              await rpc('project.project', 'write', [[p.odoo_id], vals]);
            } else {
              const newId = await rpc('project.project', 'create', [vals]);
              if (newId) await supabaseAdmin.from('projects').update({ odoo_id: newId }).eq('id', p.id).eq('tenant_id', tenantId);
            }
            out.pushed++;
          } catch (err: any) {
            console.error("[POST /api/odoo/sync]", err); out.errors.push(`Push project ${p.id}: ${err.message}`); }
        }

        // Pull
        try {
          const odooProjects = await rpc('project.project', 'search_read',
            [[]],
            { fields: ['id', 'name', 'description', 'date_start', 'date'], limit: 200 }
          );
          for (const op of (odooProjects ?? [])) {
            try {
              const mapped = {
                name: op.name ?? '',
                description: op.description ?? '',
                start_date: op.date_start ?? null,
                end_date: op.date ?? null,
                status: 'Planning' as const,
                budget: 0,
                client: '',
              };
              const { data: existing } = await supabaseAdmin.from('projects').select('id').eq('odoo_id', op.id).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from('projects').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from('projects').insert({ ...mapped, odoo_id: op.id, tenant_id: tenantId });
              }
              out.pulled++;
            } catch (err: any) {
              console.error("[POST /api/odoo/sync]", err); out.errors.push(`Pull project ${op.id}: ${err.message}`); }
          }
        } catch (err: any) {
          console.error("[POST /api/odoo/sync]", err); out.errors.push(`Pull projects échoué: ${err.message}`); }

        results.projects = out;
      } catch (err: any) {
        console.error("[POST /api/odoo/sync]", err); results.projects = { pushed: 0, pulled: 0, errors: [err.message] }; }

      // ── Invoices ─────────────────────────────────────────────────────────────
      try {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };

        const { data: invoices } = await supabaseAdmin.from('invoices').select('*').eq('tenant_id', tenantId);
        for (const inv of (invoices ?? [])) {
          try {
            const vals = {
              move_type: 'out_invoice',
              name: inv.invoice_number ?? '/',
              ref: inv.description ?? '',
              invoice_date: inv.issue_date ? inv.issue_date.split('T')[0] : false,
              invoice_date_due: inv.due_date ? inv.due_date.split('T')[0] : false,
              invoice_line_ids: (inv.items && (inv as any).items.length)
                ? (inv as any).items.map((item: any) => ([0, 0, {
                    name: item.description ?? 'Prestation',
                    quantity: item.quantity ?? 1,
                    price_unit: item.unit_price ?? item.amount ?? 0,
                    tax_ids: [],
                  }]))
                : [[0, 0, { name: inv.description ?? 'Honoraires', quantity: 1, price_unit: inv.amount ?? 0, tax_ids: [] }]],
            };
            if (inv.odoo_id) {
              await rpc('account.move', 'write', [[inv.odoo_id], { ref: vals.ref, invoice_date_due: vals.invoice_date_due }]);
            } else {
              const newId = await rpc('account.move', 'create', [vals]);
              if (newId) await supabaseAdmin.from('invoices').update({ odoo_id: newId }).eq('id', inv.id).eq('tenant_id', tenantId);
            }
            out.pushed++;
          } catch (err: any) {
            console.error("[POST /api/odoo/sync]", err); out.errors.push(`Push invoice ${inv.id}: ${err.message}`); }
        }

        // Pull
        try {
          const odooInvoices = await rpc('account.move', 'search_read',
            [[['move_type', '=', 'out_invoice']]],
            { fields: ['id', 'name', 'amount_untaxed', 'amount_tax', 'amount_total', 'payment_state', 'invoice_date', 'invoice_date_due', 'ref'], limit: 500 }
          );
          const stateMap: Record<string, string> = { paid: 'Paid', not_paid: 'Sent', in_payment: 'Sent', partial: 'Sent', reversed: 'Draft' };
          for (const oi of (odooInvoices ?? [])) {
            try {
              const mapped = {
                invoice_number: oi.name ?? '',
                amount: oi.amount_untaxed ?? 0,
                tax_amount: oi.amount_tax ?? 0,
                total_amount: oi.amount_total ?? 0,
                status: stateMap[oi.payment_state] ?? 'Draft',
                issue_date: oi.invoice_date ?? null,
                due_date: oi.invoice_date_due ?? null,
                description: oi.ref ?? '',
                project_id: '',
                created_at: new Date().toISOString(),
              };
              const { data: existing } = await supabaseAdmin.from('invoices').select('id').eq('odoo_id', oi.id).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from('invoices').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from('invoices').insert({ ...mapped, odoo_id: oi.id, tenant_id: tenantId });
              }
              out.pulled++;
            } catch (err: any) {
              console.error("[POST /api/odoo/sync]", err); out.errors.push(`Pull invoice ${oi.id}: ${err.message}`); }
          }
        } catch (err: any) {
          console.error("[POST /api/odoo/sync]", err); out.errors.push(`Pull invoices échoué: ${err.message}`); }

        results.invoices = out;
      } catch (err: any) {
        console.error("[POST /api/odoo/sync]", err); results.invoices = { pushed: 0, pulled: 0, errors: [err.message] }; }

      // ── Proposals / Devis ─────────────────────────────────────────────────────
      try {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };

        const { data: proposals } = await supabaseAdmin.from('proposals').select('*').eq('tenant_id', tenantId);
        for (const prop of (proposals ?? [])) {
          try {
            const vals = {
              name: prop.title ?? 'Devis',
              note: prop.description ?? '',
              client_order_ref: prop.project_code ?? '',
            };
            if (prop.odoo_id) {
              await rpc('sale.order', 'write', [[prop.odoo_id], vals]);
            } else {
              const newId = await rpc('sale.order', 'create', [vals]);
              if (newId) await supabaseAdmin.from('proposals').update({ odoo_id: newId }).eq('id', prop.id).eq('tenant_id', tenantId);
            }
            out.pushed++;
          } catch (err: any) {
            console.error("[POST /api/odoo/sync]", err); out.errors.push(`Push proposal ${prop.id}: ${err.message}`); }
        }

        // Pull
        try {
          const odooOrders = await rpc('sale.order', 'search_read',
            [[]],
            { fields: ['id', 'name', 'amount_total', 'state', 'note', 'date_order', 'partner_id'], limit: 200 }
          );
          const saleStateMap: Record<string, string> = { draft: 'Draft', sent: 'Sent', sale: 'Accepted', done: 'Accepted', cancel: 'Rejected' };
          for (const so of (odooOrders ?? [])) {
            try {
              const mapped = {
                title: so.name ?? '',
                client_id: '',
                client_name: so.partner_id?.[1] ?? '',
                amount: so.amount_total ?? 0,
                status: saleStateMap[so.state] ?? 'Draft',
                description: so.note ?? '',
                created_at: so.date_order ?? new Date().toISOString(),
              };
              const { data: existing } = await supabaseAdmin.from('proposals').select('id').eq('odoo_id', so.id).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from('proposals').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from('proposals').insert({ ...mapped, odoo_id: so.id, tenant_id: tenantId });
              }
              out.pulled++;
            } catch (err: any) {
              console.error("[POST /api/odoo/sync]", err); out.errors.push(`Pull sale.order ${so.id}: ${err.message}`); }
          }
        } catch (err: any) {
          console.error("[POST /api/odoo/sync]", err); out.errors.push(`Pull proposals échoué: ${err.message}`); }

        results.proposals = out;
      } catch (err: any) {
        console.error("[POST /api/odoo/sync]", err); results.proposals = { pushed: 0, pulled: 0, errors: [err.message] }; }

      const totalPushed = Object.values(results).reduce((sum, r) => sum + (r?.pushed || 0), 0);
      const totalPulled = Object.values(results).reduce((sum, r) => sum + (r?.pulled || 0), 0);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Synchronisation Odoo (${totalPushed} envoyée(s), ${totalPulled} reçue(s))`, '', tenantId, 'integration', 'Intégrations');
      res.json({ results });
    } catch (error: any) {
      console.error('[Odoo sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync Odoo échouée' });
    }
  });

  // POST /api/odoo/test  — test connectivity without syncing
  app.post('/api/odoo/test', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('odoo_url,odoo_db,odoo_username,odoo_api_key').eq('tenant_id', tenantId).single();
      const s = settings as any;
      if (!s?.odoo_url || !s?.odoo_api_key || !s?.odoo_username || !s?.odoo_db) {
        return res.status(400).json({ error: 'Configuration incomplète' });
      }
      // Simple connectivity test: list Odoo companies
      const result = await odooRpc(s.odoo_url, s.odoo_db, s.odoo_username, s.odoo_api_key, 'res.company', 'search_read', [[]], { fields: ['name'], limit: 1 });
      const company = result?.[0]?.name ?? 'Odoo';
      res.json({ connected: true, company });
    } catch (error: any) {
      console.error("[POST /api/odoo/test]", error);
      res.status(400).json({ connected: false, error: error.message });
    }
  });
}
