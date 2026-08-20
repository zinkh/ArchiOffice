// Applies scheduled plan downgrades/cancellations requested via
// POST /api/billing/cancel (server/routes/billing.ts) once the tenant's
// current paid-through period (tenants.trial_ends_at, reused as a renewal
// date for paid plans) has elapsed. Same setInterval-on-boot pattern as
// server/tenantPurge.ts. No proration/refund: the tenant keeps their current
// plan until the period they already paid for ends — this job just flips
// `plan` to `pending_plan` at that point. When pending_plan is 'trial',
// trial_ends_at is already in the past by construction, so the existing
// is_expired check in server.ts's getTenantPlan correctly locks the tenant
// out immediately — no extra date bookkeeping needed here.
import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_CHECK_INTERVAL_HOURS = 6;

export async function applyPendingPlanChanges(supabaseAdmin: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, pending_plan')
    .not('pending_plan', 'is', null)
    .not('trial_ends_at', 'is', null)
    .lte('trial_ends_at', now);
  if (error) {
    console.error('[planChanges] Failed to list tenants with pending plan changes:', error.message);
    return;
  }
  for (const tenant of (data || []) as { id: string; pending_plan: string }[]) {
    const { error: updErr } = await supabaseAdmin.from('tenants').update({
      plan: tenant.pending_plan,
      pending_plan: null,
      plan_change_requested_at: null,
    }).eq('id', tenant.id);
    if (updErr) console.error(`[planChanges] Failed to apply pending plan change for ${tenant.id}:`, updErr.message);
    else console.log(`[planChanges] Applied pending plan change for tenant ${tenant.id} -> ${tenant.pending_plan}`);
  }
}

export function startPlanChanges(supabaseAdmin: SupabaseClient): void {
  const intervalHours = parseInt(process.env.PLAN_CHANGE_INTERVAL_HOURS || '', 10) || DEFAULT_CHECK_INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  applyPendingPlanChanges(supabaseAdmin).catch(e => console.error('[planChanges] Initial check failed:', e.message));
  setInterval(() => {
    applyPendingPlanChanges(supabaseAdmin).catch(e => console.error('[planChanges] Check cycle failed:', e.message));
  }, intervalMs);
}
