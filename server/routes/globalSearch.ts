// Phase 7 extraction — moved verbatim out of server.ts's "─── Global
// Search ───" section. Reads across four domains (projects, contacts,
// tenders, invoices) but is itself a single, self-contained, read-only
// endpoint with no dependency on any other route module.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { isMissingKbTable } from './knowledgeBase';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerGlobalSearchRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/search', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const q = (req.query.q as string || '').trim();
      if (!q || q.length < 2) return res.json({ projects: [], contacts: [], tenders: [], invoices: [], kb_pages: [] });

      // `q` is interpolated into PostgREST `.or()` expressions below, whose
      // grammar uses comma (condition separator), parentheses (grouping) and
      // backslash. Strip those so a caller can't inject extra filter
      // conditions. The tenant scope is still ANDed by tenantScopedFrom, so
      // this never crossed tenants — but unsanitized input still let a caller
      // reshape the query and trigger errors. `%`/`_` are left intact as
      // intentional ilike wildcards.
      const safeQ = q.replace(/[,()\\]/g, ' ');
      const pattern = `%${safeQ}%`;

      const [projectsRes, contactsRes, tendersRes, invoicesRes, kbRes] = await Promise.all([
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
        // Pages de la « Base de données » du cabinet : titre et texte, hors corbeille.
        tenantScopedFrom(supabaseAdmin, tenantId, 'kb_pages').select('id, title, icon, kind')
          .is('trashed_at', null)
          .or(`title.ilike.${pattern},content_text.ilike.${pattern}`)
          .limit(8),
      ]);

      // A failed domain is not an empty search, nor a complete result set. Seule exception : une instance
      // dont la base n'a pas encore la migration kb_pages n'a simplement aucune page à proposer.
      const kbPages = kbRes.error && isMissingKbTable(kbRes.error) ? { data: [], error: null } : kbRes;
      const failed = [projectsRes, contactsRes, tendersRes, invoicesRes, kbPages].find(result => result.error);
      if (failed) throw failed.error;

      res.json({
        projects: (projectsRes.data || []).map((p: any) => ({ ...p, _type: 'project', _url: `/projects/${p.id}`, _label: p.name })),
        contacts: (contactsRes.data || []).map((c: any) => ({ ...c, _type: 'contact', _url: '/contacts', _label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company })),
        tenders: (tendersRes.data || []).map((t: any) => ({ ...t, _type: 'tender', _url: `/tenders/${t.id}`, _label: t.title })),
        invoices: (invoicesRes.data || []).map((i: any) => ({ ...i, _type: 'invoice', _url: '/invoices', _label: i.invoice_number || i.project_name })),
        kb_pages: (kbPages.data || []).map((p: any) => ({ ...p, _type: 'kb_page', _url: `/base-de-donnees/${p.id}`, _label: p.title || 'Sans titre' })),
      });
    } catch (e: any) { console.error('[GET /api/search]', e); res.status(500).json({ error: 'Search failed' }); }
  });
}
