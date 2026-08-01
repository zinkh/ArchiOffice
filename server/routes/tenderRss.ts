// Phase 7 extraction — moved out of server.ts's "--- Veille RSS des appels
// d'offres ---" section. pollAllTenderRssSources is imported directly
// (already its own module, server/tenderRssPoller.ts) rather than passed
// as a dependency, following the sanitizeFilename/fetchWithTimeout pattern.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { pollAllTenderRssSources } from '../tenderRssPoller';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerTenderRssRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/tender-rss-sources", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_sources').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tender RSS sources" }); }
  });

  app.post("/api/tender-rss-sources", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { name, url, enabled, include_keywords, exclude_keywords } = req.body;
      const id = crypto.randomUUID();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_sources').insert({
        id, name, url, enabled: enabled !== false,
        include_keywords: include_keywords || [], exclude_keywords: exclude_keywords || []
      });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Ajout de la source de veille RSS "${name}"`, name, id, 'tender_rss_source', 'Appels d\'offres');
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create tender RSS source: " + e.message }); }
  });

  app.put("/api/tender-rss-sources/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { name, url, enabled, include_keywords, exclude_keywords } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_sources').update({
        name, url, enabled: !!enabled, include_keywords: include_keywords || [], exclude_keywords: exclude_keywords || []
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update tender RSS source: " + e.message }); }
  });

  app.delete("/api/tender-rss-sources/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: source } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_sources').select('name').eq('id', id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_sources').delete().eq('id', id);
      if (error) throw error;
      const name = (source as any)?.name || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la source de veille RSS "${name}"`, name, id, 'tender_rss_source', 'Appels d\'offres');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete tender RSS source" }); }
  });

  app.post("/api/tender-rss-sources/poll-now", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await pollAllTenderRssSources(supabaseAdmin, tenantId);
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to poll tender RSS sources: " + e.message }); }
  });

  app.get("/api/tender-rss-matches", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches').select('*, tender_rss_sources(name)').order('pub_date', { ascending: false, nullsFirst: false });
      if (req.query.status) query = query.eq('status', req.query.status as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json((data || []).map((m: any) => ({ ...m, source_name: m.tender_rss_sources?.name || null, tender_rss_sources: undefined })));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tender RSS matches" }); }
  });

  app.put("/api/tender-rss-matches/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { status } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches').update({ status }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update tender RSS match" }); }
  });

  app.post("/api/tender-rss-matches/:id/convert", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: match, error: me } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches').select('*').eq('id', id).single();
      if (me || !match) return res.status(404).json({ error: "Tender RSS match not found" });

      const tenderId = crypto.randomUUID();
      const notes = [match.link, match.description].filter(Boolean).join('\n\n');
      const { error: te } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').insert({
        id: tenderId, title: match.title, client: '',
        submission_deadline: '', status: 'Draft', value: 0, notes, archived: false
      });
      if (te) throw te;

      await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches').update({ status: 'converted', tender_id: tenderId }).eq('id', id);

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Appel d'offres créé depuis la veille RSS "${match.title}"`, match.title, tenderId, 'tender', 'Appels d\'offres');
      res.status(201).json({ id: tenderId });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to convert tender RSS match: " + e.message }); }
  });
}
