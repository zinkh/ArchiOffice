import type { AgentContext } from '../types.js';

const MAX_DOC_BYTES = 80_000; // ~80KB per document injected into context

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
  };

  const fetches: Promise<void>[] = [];

  if (scopes.includes('projects')) {
    fetches.push(
      supabaseAdmin.from('projects').select('id, name, status, client, start_date, end_date')
        .eq('tenant_id', tenantId).neq('status', 'Completed')
        .order('created_at', { ascending: false }).limit(30)
        .then((r: any) => { ctx.projects = r.data || []; })
    );
  }
  if (scopes.includes('contacts')) {
    fetches.push(
      supabaseAdmin.from('contacts').select('id, first_name, last_name, company_name, email')
        .eq('tenant_id', tenantId).limit(50)
        .then((r: any) => { ctx.contacts = r.data || []; })
    );
  }
  if (scopes.includes('meetings')) {
    fetches.push(
      supabaseAdmin.from('meetings').select('id, title, date, project_id')
        .eq('tenant_id', tenantId).gte('date', new Date().toISOString())
        .order('date', { ascending: true }).limit(10)
        .then((r: any) => { ctx.upcomingMeetings = r.data || []; })
    );
  }
  if (scopes.includes('documents')) {
    fetches.push(
      supabaseAdmin.from('documents').select('id, name, project_id, phase, uploaded_at, file_url')
        .eq('tenant_id', tenantId).order('uploaded_at', { ascending: false }).limit(15)
        .then((r: any) => { ctx.recentDocuments = r.data || []; })
    );
  }
  if (scopes.includes('tasks')) {
    fetches.push(
      supabaseAdmin.from('tasks').select('id, title, status, due_date, project_id')
        .eq('tenant_id', tenantId).neq('status', 'done')
        .order('due_date', { ascending: true }).limit(20)
        .then((r: any) => { ctx.tasks = r.data || []; })
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
