// Dunning follow-up — the immediate "your payment failed" notice is sent
// synchronously from the Stancer webhook (server/routes/billing.ts); this
// periodic job sends ONE follow-up reminder a few days later if the failure
// is still unresolved. Same setInterval-on-boot pattern as
// server/tenantPurge.ts / server/lifecycleEmails.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyTenantAdmins } from './mailer';
import { emailShell, ctaButton, appUrl } from './lifecycleEmails';

const DEFAULT_CHECK_INTERVAL_HOURS = 12;
const REMINDER_DELAY_HOURS = 72; // 3 days grace before nagging again

const PLAN_NAMES: Record<string, string> = { starter: 'Starter', pro: 'Pro' };

export async function checkDunning(supabaseAdmin: SupabaseClient): Promise<void> {
  const cutoff = new Date(Date.now() - REMINDER_DELAY_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('billing_events')
    .select('id, tenant_id, plan_id, created_at')
    .eq('event_type', 'checkout_created')
    .eq('status', 'failed')
    .is('dunning_email_sent_at', null)
    .lte('created_at', cutoff);
  if (error) {
    console.error('[dunning] Failed to list unresolved payment failures:', error.message);
    return;
  }

  for (const event of (data || []) as { id: string; tenant_id: string; plan_id: string | null; created_at: string }[]) {
    // Only remind if this is still the tenant's most recent checkout attempt
    // — a retry (successful, failed again, or still pending) is a newer row
    // and supersedes this one, so this old failure no longer needs nagging.
    const { data: latest } = await supabaseAdmin
      .from('billing_events')
      .select('id')
      .eq('tenant_id', event.tenant_id)
      .eq('event_type', 'checkout_created')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest || (latest as any).id !== event.id) {
      // Superseded — mark handled so it's not rechecked every cycle, but no email.
      await supabaseAdmin.from('billing_events').update({ dunning_email_sent_at: new Date().toISOString() }).eq('id', event.id);
      continue;
    }

    const planName = PLAN_NAMES[event.plan_id || ''] || event.plan_id || 'votre abonnement';
    const sent = await notifyTenantAdmins(
      supabaseAdmin, event.tenant_id,
      '[ArchiOffice] Toujours un problème avec votre paiement',
      emailShell(
        'Votre paiement est toujours en attente de régularisation',
        `<p>Bonjour,</p>
         <p>Le paiement de l'abonnement <strong>${planName}</strong> pour votre cabinet a échoué il y a quelques jours et n'a pas encore été retenté. Votre accès actuel n'est pas affecté, mais le changement de plan est resté sans suite.</p>
         ${ctaButton(`${appUrl()}/billing`, 'Réessayer le paiement')}`
      )
    );
    if (!sent) continue;
    const { error: updErr } = await supabaseAdmin.from('billing_events').update({ dunning_email_sent_at: new Date().toISOString() }).eq('id', event.id);
    if (updErr) console.error(`[dunning] Failed to mark reminder sent for billing_event ${event.id}:`, updErr.message);
    else console.log(`[dunning] Sent payment-failure reminder for tenant ${event.tenant_id}`);
  }
}

export function startDunning(supabaseAdmin: SupabaseClient): void {
  const intervalHours = parseInt(process.env.DUNNING_INTERVAL_HOURS || '', 10) || DEFAULT_CHECK_INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  checkDunning(supabaseAdmin).catch(e => console.error('[dunning] Initial check failed:', e.message));
  setInterval(() => {
    checkDunning(supabaseAdmin).catch(e => console.error('[dunning] Check cycle failed:', e.message));
  }, intervalMs);
}
