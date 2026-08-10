// Proactive "next steps" suggestions for the global copilot badge
// (packages/archioffice-agents/src/client/AgentChat.tsx). Rule-based only —
// no Gemini call, no AI credit consumed. Reuses the same rule engine as the
// Dashboard's "Suggestions IA" widget (src/lib/copilotSuggestions.ts) so the
// two surfaces never drift out of sync. Computed on every request — no
// background job, matching how the Dashboard already recomputes on load.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { computeCopilotSuggestions } from '../../src/lib/copilotSuggestions';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerCopilotSuggestionRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/copilot/suggestions', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);

      const [projectsRes, milestonesRes, invoicesRes] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('id, name, client, status, end_date, progression'),
        tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').select('id, project_id, title, due_date, completed'),
        supabaseAdmin.from('invoices').select('id, invoice_number, status, total_amount, amount, projects(name)').eq('tenant_id', tenantId),
      ]);
      if (projectsRes.error) throw projectsRes.error;
      if (milestonesRes.error) throw milestonesRes.error;
      if (invoicesRes.error) throw invoicesRes.error;

      const invoices = (invoicesRes.data || []).map((inv: any) => {
        const { projects: p, ...rest } = inv;
        return { ...rest, project_name: p?.name || null };
      });

      const suggestions = computeCopilotSuggestions({
        projects: projectsRes.data || [],
        milestones: milestonesRes.data || [],
        invoices,
      });
      res.json(suggestions);
    } catch (e: any) {
      console.error('Failed to compute copilot suggestions:', e);
      res.status(500).json({ error: 'Failed to compute copilot suggestions' });
    }
  });
}
