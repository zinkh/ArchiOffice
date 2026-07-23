import type { AgentContext } from '../types.js';

const MAX_DOC_BYTES = 80_000; // ~80KB per document injected into context

// firm_knowledge is auto-injected on every message (unlike user-attached
// documents), and the tenant is billed per token for it — keep these caps
// tight relative to MAX_DOC_BYTES above.
const MIN_PHASE_SAMPLE = 2; // don't show a phase average derived from a single transition
const MAX_PRICE_CATALOG_ROWS = 40;
const MAX_COST_HISTORY_ROWS = 30;
const MAX_CCTP_EXCERPTS = 5;
const MAX_CCTP_EXCERPT_CHARS = 2000;

function daysBetween(start: string, end: string): number | null {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e) || e <= s) return null;
  return Math.round((e - s) / 86_400_000);
}

function average(nums: number[]): number {
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function summarizePhaseBenchmarks(rows: { phase: string; entered_at: string; exited_at: string }[]) {
  const byPhase = new Map<string, number[]>();
  for (const r of rows) {
    const days = daysBetween(r.entered_at, r.exited_at);
    if (days === null) continue;
    const list = byPhase.get(r.phase);
    if (list) list.push(days); else byPhase.set(r.phase, [days]);
  }
  return [...byPhase.entries()]
    .filter(([, days]) => days.length >= MIN_PHASE_SAMPLE)
    .map(([phase, days]) => ({ phase, avgDurationDays: average(days), sampleSize: days.length }))
    .sort((a, b) => b.sampleSize - a.sampleSize);
}

function summarizeCostHistory(rows: { designation: string; unite: string; prix_unitaire_ht: number }[]) {
  const byItem = new Map<string, { unite: string; prices: number[] }>();
  for (const r of rows) {
    if (!r.designation || r.prix_unitaire_ht == null) continue;
    const key = `${r.designation}|${r.unite}`;
    const entry = byItem.get(key);
    if (entry) entry.prices.push(r.prix_unitaire_ht);
    else byItem.set(key, { unite: r.unite, prices: [r.prix_unitaire_ht] });
  }
  return [...byItem.entries()]
    .map(([key, { unite, prices }]) => ({
      designation: key.split('|')[0],
      unite,
      avgPrixUnitaireHt: average(prices),
      occurrences: prices.length,
    }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, MAX_COST_HISTORY_ROWS);
}

export async function buildAgentContext(
  supabaseAdmin: any,
  tenantId: string,
  userId: string,
  scopes: string[],
  attachedDocumentIds: string[] = []
): Promise<AgentContext> {
  const [tenantRes, profileRes] = await Promise.all([
    supabaseAdmin.from('tenants').select('name').eq('id', tenantId).single(),
    supabaseAdmin.from('profiles').select('name').eq('id', userId).single(),
  ]);

  const ctx: AgentContext = {
    tenantName: tenantRes.data?.name ?? 'Cabinet',
    currentDate: new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    currentUserName: profileRes.data?.name ?? 'Utilisateur',
    projects: [],
    contacts: [],
    upcomingMeetings: [],
    recentDocuments: [],
    tasks: [],
    documentContents: [],
    firmKnowledge: { phaseBenchmarks: [], priceCatalog: [], projectCostHistory: [], cctpExcerpts: [] },
  };

  const fetches: Promise<void>[] = [];

  if (scopes.includes('projects')) {
    fetches.push(
      supabaseAdmin.from('projects').select('id, name, status, client, start_date, end_date')
        .eq('tenant_id', tenantId).neq('status', 'Completed')
        .order('updated_at', { ascending: false }).limit(30)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] projects fetch failed:', r.error.message);
          ctx.projects = r.data || [];
        })
    );
  }
  if (scopes.includes('contacts')) {
    fetches.push(
      supabaseAdmin.from('contacts').select('id, first_name, last_name, company_name, email')
        .eq('tenant_id', tenantId).limit(50)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] contacts fetch failed:', r.error.message);
          ctx.contacts = r.data || [];
        })
    );
  }
  if (scopes.includes('meetings')) {
    fetches.push(
      supabaseAdmin.from('meetings').select('id, title, date, project_id')
        .eq('tenant_id', tenantId).gte('date', new Date().toISOString())
        .order('date', { ascending: true }).limit(10)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] meetings fetch failed:', r.error.message);
          ctx.upcomingMeetings = r.data || [];
        })
    );
  }
  if (scopes.includes('documents')) {
    fetches.push(
      supabaseAdmin.from('documents').select('id, name, project_id, phase, uploaded_at, file_url')
        .eq('tenant_id', tenantId).order('uploaded_at', { ascending: false }).limit(15)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] documents fetch failed:', r.error.message);
          ctx.recentDocuments = r.data || [];
        })
    );
  }
  if (scopes.includes('tasks')) {
    fetches.push(
      supabaseAdmin.from('tasks').select('id, title, status, due_date, project_id')
        .eq('tenant_id', tenantId).neq('status', 'done')
        .order('due_date', { ascending: true }).limit(20)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] tasks fetch failed:', r.error.message);
          ctx.tasks = r.data || [];
        })
    );
  }

  if (scopes.includes('firm_knowledge')) {
    fetches.push(
      supabaseAdmin.from('project_phase_history').select('phase, entered_at, exited_at')
        .eq('tenant_id', tenantId).not('exited_at', 'is', null)
        .then((r: any) => {
          if (r.error) { console.warn('[agent context] firm_knowledge phase history fetch failed:', r.error.message); return; }
          ctx.firmKnowledge.phaseBenchmarks = summarizePhaseBenchmarks(r.data || []);
        })
    );
    fetches.push(
      supabaseAdmin.from('articles_type').select('designation, unite, prix_unitaire, categorie')
        .eq('tenant_id', tenantId).not('prix_unitaire', 'is', null)
        .order('categorie', { ascending: true }).order('designation', { ascending: true })
        .limit(MAX_PRICE_CATALOG_ROWS)
        .then((r: any) => {
          if (r.error) { console.warn('[agent context] firm_knowledge articles_type fetch failed:', r.error.message); return; }
          ctx.firmKnowledge.priceCatalog = r.data || [];
        })
    );
    fetches.push(
      supabaseAdmin.from('dpgf_items').select('designation, unite, prix_unitaire_ht')
        .eq('tenant_id', tenantId).limit(500)
        .then((r: any) => {
          if (r.error) { console.warn('[agent context] firm_knowledge dpgf_items fetch failed:', r.error.message); return; }
          ctx.firmKnowledge.projectCostHistory = summarizeCostHistory(r.data || []);
        })
    );
    fetches.push(
      supabaseAdmin.from('specifications').select('title, content, is_template')
        .eq('tenant_id', tenantId).not('content', 'is', null)
        .order('is_template', { ascending: false }).order('last_updated', { ascending: false })
        .limit(MAX_CCTP_EXCERPTS)
        .then((r: any) => {
          if (r.error) { console.warn('[agent context] firm_knowledge specifications fetch failed:', r.error.message); return; }
          ctx.firmKnowledge.cctpExcerpts = ((r.data || []) as any[])
            .filter((s: any) => s.content && String(s.content).trim().length > 0)
            .map((s: any) => ({ title: s.title, excerpt: String(s.content).slice(0, MAX_CCTP_EXCERPT_CHARS) }));
        })
    );
  }

  // Fetch specific documents attached to this message (overrides scope-based recentDocuments)
  if (attachedDocumentIds.length > 0) {
    fetches.push(
      supabaseAdmin.from('documents').select('id, name, project_id, phase, uploaded_at, file_url')
        .eq('tenant_id', tenantId).in('id', attachedDocumentIds)
        .then((r: any) => { ctx.recentDocuments = r.data || []; })
    );
  }

  await Promise.all(fetches);

  // RAG — fetch content of explicitly attached documents
  if (attachedDocumentIds.length > 0) {
    const { data: docs } = await supabaseAdmin
      .from('documents')
      .select('id, name, file_url')
      .eq('tenant_id', tenantId)
      .in('id', attachedDocumentIds);

    const contentFetches = ((docs as any[]) || []).map(async (doc: any) => {
      try {
        const res = await fetch(doc.file_url);
        if (!res.ok) return;
        const contentType = res.headers.get('content-type') ?? '';
        // Only inject text-based content
        if (!contentType.includes('text') && !contentType.includes('json') && !contentType.includes('csv') && !contentType.includes('xml')) return;
        const text = await res.text();
        ctx.documentContents.push({
          id: doc.id,
          name: doc.name,
          content: text.slice(0, MAX_DOC_BYTES),
        });
      } catch {
        // skip unreadable documents silently
      }
    });

    await Promise.all(contentFetches);
  }

  return ctx;
}
