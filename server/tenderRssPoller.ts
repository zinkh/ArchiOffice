// Periodic RSS polling for the "Veille RSS" tender-watch feature. Started once
// from server.ts's startServer(). Polls every enabled tender_rss_sources row
// across all tenants, applies each source's include/exclude keyword filters,
// and inserts newly-seen items into tender_rss_matches (deduped by the
// (source_id, guid) unique constraint from migrate_add_tender_rss_watch.sql).
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import Parser from 'rss-parser';
import iconv from 'iconv-lite';
import { extractTenderFields } from './tenderFieldExtractor';
import { fetchBoampRecords, mapBoampRecord, boampKeywordText, normalizeBoampConfig } from './tenderBoampConnector';
import { fetchTedNotices, mapTedNotice, tedKeywordText, normalizeTedConfig } from './tenderTedConnector';
import { dedupTitleKey, dedupBuyerKey, dropDuplicates } from './tenderDedup';

const DEFAULT_INTERVAL_MINUTES = 30;
const FETCH_TIMEOUT_MS = 15000;

const parser = new Parser();

// Many French tender RSS feeds (BOAMP mirrors, marchesonline.com, etc.) are
// still published as ISO-8859-1/Windows-1252, not UTF-8. Fetching as
// responseType 'text' would let axios/Node decode the raw bytes as UTF-8
// unconditionally, mangling accented characters (é, è...) into U+FFFD
// replacement characters before rss-parser even sees the XML. Fetching raw
// bytes instead and decoding with the encoding the feed actually declares
// avoids that.
async function fetchFeedXml(url: string): Promise<string> {
  const response = await axios.get<Buffer>(url, { timeout: FETCH_TIMEOUT_MS, responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data);

  const contentType = String(response.headers['content-type'] || '');
  const headerCharsetMatch = contentType.match(/charset=([^;]+)/i);
  const prologMatch = buffer.subarray(0, 200).toString('ascii').match(/encoding=["']([^"']+)["']/i);
  const declaredCharset = (headerCharsetMatch?.[1] || prologMatch?.[1] || 'utf-8').trim();

  const charset = iconv.encodingExists(declaredCharset) ? declaredCharset : 'utf-8';
  return iconv.decode(buffer, charset);
}

interface TenderRssSourceRow {
  id: string;
  tenant_id: string;
  url: string;
  include_keywords: string[] | null;
  exclude_keywords: string[] | null;
  // 'rss' (défaut), 'boamp' ou 'ted' — voir migrate_add_tender_boamp_connector.sql
  // et migrate_add_tender_ted_connector.sql.
  source_type?: 'rss' | 'boamp' | 'ted' | null;
  boamp_config?: unknown;
  ted_config?: unknown;
}

export function matchesKeywords(text: string, includeKeywords: string[], excludeKeywords: string[]): boolean {
  const haystack = text.toLowerCase();
  if (includeKeywords.length && !includeKeywords.some(k => haystack.includes(k.toLowerCase()))) {
    return false;
  }
  if (excludeKeywords.some(k => haystack.includes(k.toLowerCase()))) {
    return false;
  }
  return true;
}

async function fetchBoampRows(source: TenderRssSourceRow, includeKeywords: string[], excludeKeywords: string[]) {
  const config = normalizeBoampConfig(source.boamp_config);
  const { records } = await fetchBoampRecords(config);
  return records
    .filter(record => matchesKeywords(boampKeywordText(record), includeKeywords, excludeKeywords))
    .map(record => mapBoampRecord(record, source));
}

async function fetchTedRows(source: TenderRssSourceRow, includeKeywords: string[], excludeKeywords: string[]) {
  const config = normalizeTedConfig(source.ted_config);
  const { notices } = await fetchTedNotices(config);
  return notices
    .filter(notice => matchesKeywords(tedKeywordText(notice), includeKeywords, excludeKeywords))
    .map(notice => mapTedNotice(notice, source));
}

async function fetchRssRows(source: TenderRssSourceRow, includeKeywords: string[], excludeKeywords: string[]) {
  const xml = await fetchFeedXml(source.url);
  const feed = await parser.parseString(xml);

  return (feed.items || [])
    .filter(item => matchesKeywords(`${item.title || ''} ${item.contentSnippet || item.content || ''}`, includeKeywords, excludeKeywords))
    .map(item => {
      const description = item.contentSnippet || item.content || null;
      const extracted = extractTenderFields(description);
      return {
        id: randomUUID(),
        tenant_id: source.tenant_id,
        source_id: source.id,
        guid: item.guid || item.link || item.title || randomUUID(),
        title: item.title || '(sans titre)',
        link: item.link || null,
        description,
        pub_date: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
        status: 'new' as const,
        ville_execution: extracted.ville_execution || null,
        pouvoir_adjudicateur: extracted.pouvoir_adjudicateur || null,
        montant_travaux: extracted.montant_travaux ?? null,
        date_limite_reponse: extracted.date_limite_reponse || null,
      };
    });
}

async function pollSource(supabaseAdmin: SupabaseClient, source: TenderRssSourceRow): Promise<void> {
  const includeKeywords = source.include_keywords || [];
  const excludeKeywords = source.exclude_keywords || [];

  try {
    const fetched = source.source_type === 'boamp'
      ? await fetchBoampRows(source, includeKeywords, excludeKeywords)
      : source.source_type === 'ted'
        ? await fetchTedRows(source, includeKeywords, excludeKeywords)
        : await fetchRssRows(source, includeKeywords, excludeKeywords);

    // Un même avis relayé par plusieurs sources (BOAMP, TED, flux RSS) n'est
    // inséré qu'une fois par cabinet — voir server/tenderDedup.ts.
    const keyed = fetched.map(row => ({
      ...row,
      dedup_key: dedupTitleKey(row.title),
      dedup_buyer: dedupBuyerKey(row.pouvoir_adjudicateur),
    }));
    const rows = keyed.length ? await dropDuplicates(supabaseAdmin, source.tenant_id, keyed) : [];

    if (rows.length) {
      await supabaseAdmin.from('tender_rss_matches').upsert(rows, { onConflict: 'source_id,guid', ignoreDuplicates: true });
    }

    await supabaseAdmin.from('tender_rss_sources')
      .update({ last_polled_at: new Date().toISOString(), last_error: null })
      .eq('id', source.id);
  } catch (e: any) {
    console.error(`[tenderRssPoller] Failed to poll source ${source.id} (${source.url}):`, e.message);
    await supabaseAdmin.from('tender_rss_sources')
      .update({ last_polled_at: new Date().toISOString(), last_error: e.message })
      .eq('id', source.id);
  }
}

// Les connecteurs BOAMP et TED sont des préférences par cabinet (Paramètres >
// Marketplace) : une source d'un cabinet qui a désactivé le connecteur depuis
// est ignorée sans être supprimée, pour reprendre telle quelle à la
// réactivation.
async function loadEnabledTenants(supabaseAdmin: SupabaseClient, column: 'tender_boamp_enabled' | 'tender_ted_enabled', tenantId?: string): Promise<Set<string>> {
  let query = supabaseAdmin.from('settings').select(`tenant_id, ${column}`).eq(column, true);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) {
    console.error(`[tenderRssPoller] Failed to read ${column} preference (matching sources skipped this cycle):`, error.message);
    return new Set();
  }
  return new Set(((data || []) as { tenant_id: string }[]).map(s => s.tenant_id));
}

export async function pollAllTenderRssSources(supabaseAdmin: SupabaseClient, tenantId?: string): Promise<void> {
  let query = supabaseAdmin.from('tender_rss_sources').select('*').eq('enabled', true);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) {
    console.error('[tenderRssPoller] Failed to list sources:', error.message);
    return;
  }
  const sources = (data || []) as TenderRssSourceRow[];
  const boampTenants = sources.some(s => s.source_type === 'boamp')
    ? await loadEnabledTenants(supabaseAdmin, 'tender_boamp_enabled', tenantId)
    : new Set<string>();
  const tedTenants = sources.some(s => s.source_type === 'ted')
    ? await loadEnabledTenants(supabaseAdmin, 'tender_ted_enabled', tenantId)
    : new Set<string>();
  for (const source of sources) {
    if (source.source_type === 'boamp' && !boampTenants.has(source.tenant_id)) continue;
    if (source.source_type === 'ted' && !tedTenants.has(source.tenant_id)) continue;
    await pollSource(supabaseAdmin, source);
  }
}

export function startTenderRssPolling(supabaseAdmin: SupabaseClient): void {
  const intervalMinutes = parseInt(process.env.TENDER_RSS_POLL_INTERVAL_MINUTES || '', 10) || DEFAULT_INTERVAL_MINUTES;
  const intervalMs = intervalMinutes * 60 * 1000;

  pollAllTenderRssSources(supabaseAdmin).catch(e => console.error('[tenderRssPoller] Initial poll failed:', e.message));
  setInterval(() => {
    pollAllTenderRssSources(supabaseAdmin).catch(e => console.error('[tenderRssPoller] Poll cycle failed:', e.message));
  }, intervalMs);
}
