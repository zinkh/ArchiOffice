import type { AgentContext } from '../types.js';

export async function buildAgentContext(
  supabaseAdmin: any,
  tenantId: string,
  userId: string,
  scopes: string[]
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
      supabaseAdmin.from('documents').select('id, name, project_id, phase, uploaded_at')
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

  await Promise.all(fetches);
  return ctx;
}
