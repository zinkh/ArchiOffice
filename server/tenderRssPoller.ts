// Periodic RSS polling for the "Veille RSS" tender-watch feature. Started once
// from server.ts's startServer(). Polls every enabled tender_rss_sources row
// across all tenants, applies each source's include/exclude keyword filters,
// and inserts newly-seen items into tender_rss_matches (deduped by the
// (source_id, guid) unique constraint from migrate_add_tender_rss_watch.sql).
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import Parser from 'rss-parser';

const DEFAULT_INTERVAL_MINUTES = 30;
const FETCH_TIMEOUT_MS = 15000;

const parser = new Parser();

interface TenderRssSourceRow {
  id: string;
  tenant_id: string;
  url: string;
  include_keywords: string[] | null;
  exclude_keywords: string[] | null;
}

function matchesKeywords(text: string, includeKeywords: string[], excludeKeywords: string[]): boolean {
  const haystack = text.toLowerCase();
  if (includeKeywords.length && !includeKeywords.some(k => haystack.includes(k.toLowerCase()))) {
    return false;
  }
  if (excludeKeywords.some(k => haystack.includes(k.toLowerCase()))) {
    return false;
  }
  return true;
}

async function pollSource(supabaseAdmin: SupabaseClient, source: TenderRssSourceRow): Promise<void> {
  const includeKeywords = source.include_keywords || [];
  const excludeKeywords = source.exclude_keywords || [];

  try {
    const response = await axios.get(source.url, { timeout: FETCH_TIMEOUT_MS, responseType: 'text' });
    const feed = await parser.parseString(response.data);

    const rows = (feed.items || [])
      .filter(item => matchesKeywords(`${item.title || ''} ${item.contentSnippet || item.content || ''}`, includeKeywords, excludeKeywords))
      .map(item => ({
        id: randomUUID(),
        tenant_id: source.tenant_id,
        source_id: source.id,
        guid: item.guid || item.link || item.title || randomUUID(),
        title: item.title || '(sans titre)',
        link: item.link || null,
        description: item.contentSnippet || item.content || null,
        pub_date: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
        status: 'new' as const,
      }));

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

export async function pollAllTenderRssSources(supabaseAdmin: SupabaseClient, tenantId?: string): Promise<void> {
  let query = supabaseAdmin.from('tender_rss_sources').select('*').eq('enabled', true);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) {
    console.error('[tenderRssPoller] Failed to list sources:', error.message);
    return;
  }
  for (const source of (data || []) as TenderRssSourceRow[]) {
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
