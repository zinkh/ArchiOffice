// Phase 7 extraction — moved verbatim out of server.ts's "─── Global
// Search ───" section. Reads across four domains (projects, contacts,
// tenders, invoices) but is itself a single, self-contained, read-only
// endpoint with no dependency on any other route module.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerGlobalSearchRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/search', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const q = (req.query.q as string || '').trim();
      if (!q || q.length < 2) return res.json({ projects: [], contacts: [], tenders: [], invoices: [] });

      const pattern = `%${q}%`;

      const [projectsRes, contactsRes, tendersRes, invoicesRes] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('id, name, client, status, address')
          .or(`name.ilike.${pattern},client.ilike.${pattern},address.ilike.${pattern},description.ilike.${pattern}`)
          .limit(8),
        tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('id, first_name, last_name, company, email')
          .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`)
          .limit(8),
        tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('id, title, client, status, type')
          .or(`title.ilike.${pattern},client.ilike.${pattern}`)
          .limit(8),
        tenantScopedFrom(supabaseAdmin, tenantId, 'invoices').select('id, invoice_number, project_name, status')
          .or(`invoice_number.ilike.${pattern},project_name.ilike.${pattern}`)
          .limit(8),
      ]);

      res.json({
        projects: (projectsRes.data || []).map((p: any) => ({ ...p, _type: 'project', _url: `/projects/${p.id}`, _label: p.name })),
        contacts: (contactsRes.data || []).map((c: any) => ({ ...c, _type: 'contact', _url: '/contacts', _label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company })),
        tenders: (tendersRes.data || []).map((t: any) => ({ ...t, _type: 'tender', _url: `/tenders/${t.id}`, _label: t.title })),
        invoices: (invoicesRes.data || []).map((i: any) => ({ ...i, _type: 'invoice', _url: '/invoices', _label: i.invoice_number || i.project_name })),
      });
    } catch (e: any) { console.error('[GET /api/search]', e); res.status(500).json({ error: 'Search failed' }); }
  });
}
