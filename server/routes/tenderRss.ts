// Phase 7 extraction — moved out of server.ts's "--- Veille RSS des appels
// d'offres ---" section. pollAllTenderRssSources is imported directly
// (already its own module, server/tenderRssPoller.ts) rather than passed
// as a dependency, following the sanitizeFilename/fetchWithTimeout pattern.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { pollAllTenderRssSources, matchesKeywords } from '../tenderRssPoller';
import { BOAMP_API_URL, fetchBoampRecords, normalizeBoampConfig, boampKeywordText, mapBoampRecord } from '../tenderBoampConnector';
import { TED_API_URL, fetchTedNotices, normalizeTedConfig, tedKeywordText, mapTedNotice } from '../tenderTedConnector';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

type SourceType = 'rss' | 'boamp' | 'ted';
type ConnectorType = Exclude<SourceType, 'rss'>;

function parseSourceType(raw: unknown): SourceType {
  return raw === 'boamp' || raw === 'ted' ? raw : 'rss';
}

const CONNECTORS: Record<ConnectorType, { column: 'tender_boamp_enabled' | 'tender_ted_enabled'; label: string; apiUrl: string }> = {
  boamp: { column: 'tender_boamp_enabled', label: 'BOAMP', apiUrl: BOAMP_API_URL },
  ted: { column: 'tender_ted_enabled', label: 'TED', apiUrl: TED_API_URL },
};

// Préférence par cabinet (Paramètres > Marketplace > BOAMP / TED). Une
// colonne absente (migration non appliquée) ou une ligne settings manquante
// vaut « désactivé ».
async function isConnectorEnabled(supabaseAdmin: any, tenantId: string, connector: ConnectorType): Promise<boolean> {
  const { column } = CONNECTORS[connector];
  const { data, error } = await supabaseAdmin.from('settings').select(column).eq('tenant_id', tenantId).maybeSingle();
  if (error) return false;
  return !!data?.[column];
}

function disabledMessage(connector: ConnectorType): string {
  return `Le connecteur ${CONNECTORS[connector].label} est désactivé pour ce cabinet (Paramètres > Marketplace > ${CONNECTORS[connector].label})`;
}

/**
 * Valide et normalise le corps d'une source. Pour une source BOAMP, l'URL
 * est imposée (endpoint de l'API) et les critères sont normalisés ; retourne
 * une erreur 4xx à renvoyer telle quelle si la source est invalide.
 */
async function buildSourcePayload(supabaseAdmin: any, tenantId: string, body: any): Promise<{ payload?: Record<string, unknown>; error?: { status: number; message: string } }> {
  const source_type = parseSourceType(body?.source_type);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: { status: 400, message: 'Le nom de la source est requis' } };

  const include_keywords = Array.isArray(body?.include_keywords) ? body.include_keywords : [];
  const exclude_keywords = Array.isArray(body?.exclude_keywords) ? body.exclude_keywords : [];

  if (source_type === 'boamp' || source_type === 'ted') {
    if (!(await isConnectorEnabled(supabaseAdmin, tenantId, source_type))) {
      return { error: { status: 403, message: disabledMessage(source_type) } };
    }
    return {
      payload: {
        name, url: CONNECTORS[source_type].apiUrl, source_type,
        boamp_config: source_type === 'boamp' ? normalizeBoampConfig(body?.boamp_config) : {},
        ted_config: source_type === 'ted' ? normalizeTedConfig(body?.ted_config) : {},
        include_keywords, exclude_keywords,
      },
    };
  }

  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) return { error: { status: 400, message: "L'URL du flux RSS est requise" } };
  return { payload: { name, url, source_type, boamp_config: {}, ted_config: {}, include_keywords, exclude_keywords } };
}

interface PreviewResult {
  count: number;
  api_total: number | null;
  degraded: boolean;
  jours_recents: number;
  sample: { title: string; pouvoir_adjudicateur: string | null; date_limite_reponse: string | null; link: string | null }[];
}

// Aperçu des critères d'un connecteur avant enregistrement : interroge l'API
// avec la configuration saisie (deux pages au plus) et renvoie le nombre
// d'avis retenus après filtres locaux et mots-clés, plus un échantillon.
async function previewConnector(connector: ConnectorType, tenantId: string, body: any): Promise<PreviewResult> {
  const includeKeywords = Array.isArray(body?.include_keywords) ? body.include_keywords : [];
  const excludeKeywords = Array.isArray(body?.exclude_keywords) ? body.exclude_keywords : [];
  const previewSource = { id: 'preview', tenant_id: tenantId };

  if (connector === 'boamp') {
    const config = normalizeBoampConfig(body?.boamp_config);
    const { records, apiTotal, degraded } = await fetchBoampRecords(config, { maxPages: 2 });
    const kept = records.filter(r => matchesKeywords(boampKeywordText(r), includeKeywords, excludeKeywords));
    const sample = kept.slice(0, 5).map(r => mapBoampRecord(r, previewSource));
    return {
      count: kept.length, api_total: apiTotal, degraded, jours_recents: config.jours_recents,
      sample: sample.map(row => ({ title: row.title, pouvoir_adjudicateur: row.pouvoir_adjudicateur, date_limite_reponse: row.date_limite_reponse, link: row.link })),
    };
  }

  const config = normalizeTedConfig(body?.ted_config);
  const { notices, apiTotal, degraded } = await fetchTedNotices(config, { maxPages: 2 });
  const kept = notices.filter(n => matchesKeywords(tedKeywordText(n), includeKeywords, excludeKeywords));
  const sample = kept.slice(0, 5).map(n => mapTedNotice(n, previewSource));
  return {
    count: kept.length, api_total: apiTotal, degraded, jours_recents: config.jours_recents,
    sample: sample.map(row => ({ title: row.title, pouvoir_adjudicateur: row.pouvoir_adjudicateur, date_limite_reponse: row.date_limite_reponse, link: row.link })),
  };
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
      const built = await buildSourcePayload(supabaseAdmin, tenantId, req.body);
      if (built.error) return res.status(built.error.status).json({ error: built.error.message });
      const id = crypto.randomUUID();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_sources').insert({
        id, ...built.payload, enabled: req.body?.enabled !== false,
      });
      if (error) throw error;
      const name = String(built.payload!.name);
      const type = built.payload!.source_type as SourceType;
      const label = type === 'rss' ? 'source de veille RSS' : `source ${CONNECTORS[type].label}`;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Ajout de la ${label} "${name}"`, name, id, 'tender_rss_source', 'Appels d\'offres');
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create tender RSS source: " + e.message }); }
  });

  app.put("/api/tender-rss-sources/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const built = await buildSourcePayload(supabaseAdmin, tenantId, req.body);
      if (built.error) return res.status(built.error.status).json({ error: built.error.message });
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_sources').update({
        ...built.payload, enabled: !!req.body?.enabled,
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update tender RSS source: " + e.message }); }
  });

  for (const connector of Object.keys(CONNECTORS) as ConnectorType[]) {
    app.post(`/api/tender-rss-sources/${connector}/preview`, async (req: any, res: any) => {
      try {
        const tenantId = await getTenantId(req.user.id);
        if (!(await isConnectorEnabled(supabaseAdmin, tenantId, connector))) {
          return res.status(403).json({ error: disabledMessage(connector) });
        }
        res.json(await previewConnector(connector, tenantId, req.body));
      } catch (e: any) { console.error(e); res.status(502).json({ error: e.message || `Échec du test de connexion ${CONNECTORS[connector].label}` }); }
    });
  }

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

  app.post("/api/tender-rss-matches/bulk-delete", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids requis" });
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches').delete().in('id', ids);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de ${ids.length} annonce(s) de veille RSS`, '', '', 'tender_rss_match', 'Appels d\'offres');
      res.json({ success: true, count: ids.length });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to bulk delete tender RSS matches: " + e.message }); }
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
        id: tenderId, title: match.title, client: match.pouvoir_adjudicateur || '',
        submission_deadline: match.date_limite_reponse || '', status: 'Draft', value: 0,
        construction_cost: match.montant_travaux || null, ville_execution: match.ville_execution || null,
        notes, archived: false
      });
      if (te) throw te;

      await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches').update({ status: 'converted', tender_id: tenderId }).eq('id', id);

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Appel d'offres créé depuis la veille RSS "${match.title}"`, match.title, tenderId, 'tender', 'Appels d\'offres');
      res.status(201).json({ id: tenderId });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to convert tender RSS match: " + e.message }); }
  });
}
