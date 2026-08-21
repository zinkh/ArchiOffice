// Lifecycle emails for tenant trials and inactivity — reminds a cabinet's
// admins before/after their trial lapses, and nudges dormant paying tenants
// back in. Same setInterval-on-boot pattern as server/tenantPurge.ts and
// server/notificationArchiver.ts. Idempotency is tracked per-tenant via the
// tenants.*_email_sent_at columns (migrate_lifecycle_emails.sql) rather than
// a separate email log, mirroring how tenantPurge/notificationArchiver each
// use an existing column as their own "already handled" guard. The welcome
// email is handled separately, synchronously at signup — see
// server/routes/registration.ts — since it doesn't need polling.
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyTenantAdmins } from './mailer';

const DEFAULT_CHECK_INTERVAL_HOURS = 12;
const TRIAL_ENDING_SOON_DAYS = 3;
const INACTIVITY_THRESHOLD_DAYS = 21;

// Exported for reuse by server/dunning.ts and server/routes/billing.ts's
// webhook — same platform-notice email shell, no reason to duplicate it a
// third time.
export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function emailShell(title: string, bodyHtml: string): string {
  return `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
    <h2 style="color: #2563eb;">${title}</h2>
    ${bodyHtml}
  </div>`;
}

export function ctaButton(href: string, label: string): string {
  return `<p style="margin: 24px 0;"><a href="${href}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">${label}</a></p>`;
}

async function checkTrialEndingSoon(supabaseAdmin: SupabaseClient): Promise<void> {
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + TRIAL_ENDING_SOON_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .eq('plan', 'trial')
    .is('deletion_requested_at', null)
    .is('trial_ending_email_sent_at', null)
    .not('trial_ends_at', 'is', null)
    .lte('trial_ends_at', soonCutoff)
    .gt('trial_ends_at', now.toISOString());
  if (error) {
    console.error('[lifecycleEmails] Failed to list trials ending soon:', error.message);
    return;
  }
  for (const tenant of (data || []) as { id: string; name: string }[]) {
    const html = emailShell(
      "Votre essai se termine bientôt",
      `<p>Bonjour,</p>
       <p>L'essai gratuit du cabinet <strong>${tenant.name}</strong> sur ArchiOffice se termine dans ${TRIAL_ENDING_SOON_DAYS} jours. Passez à un abonnement pour continuer à utiliser vos projets, devis et documents sans interruption.</p>
       ${ctaButton(`${appUrl()}/billing`, "Voir les abonnements")}`
    );
    const sent = await notifyTenantAdmins(supabaseAdmin, tenant.id, "Votre essai ArchiOffice se termine bientôt", html);
    if (!sent) continue;
    const { error: updErr } = await supabaseAdmin.from('tenants').update({ trial_ending_email_sent_at: new Date().toISOString() }).eq('id', tenant.id);
    if (updErr) console.error(`[lifecycleEmails] Failed to mark trial-ending email sent for ${tenant.id}:`, updErr.message);
    else console.log(`[lifecycleEmails] Sent trial-ending-soon email for tenant ${tenant.id}`);
  }
}

async function checkTrialExpired(supabaseAdmin: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .eq('plan', 'trial')
    .is('deletion_requested_at', null)
    .is('trial_expired_email_sent_at', null)
    .not('trial_ends_at', 'is', null)
    .lt('trial_ends_at', now);
  if (error) {
    console.error('[lifecycleEmails] Failed to list expired trials:', error.message);
    return;
  }
  for (const tenant of (data || []) as { id: string; name: string }[]) {
    const html = emailShell(
      "Votre essai est terminé",
      `<p>Bonjour,</p>
       <p>L'essai gratuit du cabinet <strong>${tenant.name}</strong> sur ArchiOffice est arrivé à son terme. Vos données sont conservées, mais l'accès est désormais limité. Souscrivez à un abonnement pour continuer à travailler normalement.</p>
       ${ctaButton(`${appUrl()}/billing`, "Souscrire à un abonnement")}`
    );
    const sent = await notifyTenantAdmins(supabaseAdmin, tenant.id, "Votre essai ArchiOffice est terminé", html);
    if (!sent) continue;
    const { error: updErr } = await supabaseAdmin.from('tenants').update({ trial_expired_email_sent_at: new Date().toISOString() }).eq('id', tenant.id);
    if (updErr) console.error(`[lifecycleEmails] Failed to mark trial-expired email sent for ${tenant.id}:`, updErr.message);
    else console.log(`[lifecycleEmails] Sent trial-expired email for tenant ${tenant.id}`);
  }
}

async function lastActivityAt(supabaseAdmin: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('activities')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { created_at: string } | null)?.created_at ?? null;
}

async function checkInactiveTenants(supabaseAdmin: SupabaseClient): Promise<void> {
  const cutoff = new Date(Date.now() - INACTIVITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  // Only paying tenants — a lapsed trial already gets its own email above;
  // nudging it as "inactive" too would be redundant.
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name, created_at, inactivity_email_sent_at')
    .neq('plan', 'trial')
    .is('deletion_requested_at', null);
  if (error) {
    console.error('[lifecycleEmails] Failed to list tenants for inactivity check:', error.message);
    return;
  }
  for (const tenant of (data || []) as { id: string; name: string; created_at: string; inactivity_email_sent_at: string | null }[]) {
    const lastActivity = (await lastActivityAt(supabaseAdmin, tenant.id)) ?? tenant.created_at;
    if (new Date(lastActivity) > cutoff) continue;
    // Re-eligible once the tenant has been active again since the last
    // reminder — otherwise this would resend every cycle forever.
    if (tenant.inactivity_email_sent_at && new Date(tenant.inactivity_email_sent_at) >= new Date(lastActivity)) continue;
    const html = emailShell(
      "On ne vous a pas vu récemment",
      `<p>Bonjour,</p>
       <p>Le cabinet <strong>${tenant.name}</strong> n'a pas eu d'activité sur ArchiOffice depuis un moment. Si vous avez besoin d'aide pour reprendre en main vos projets, notre équipe est disponible.</p>
       ${ctaButton(`${appUrl()}/dashboard`, "Retourner sur ArchiOffice")}`
    );
    const sent = await notifyTenantAdmins(supabaseAdmin, tenant.id, "Cela fait un moment — ArchiOffice", html);
    if (!sent) continue;
    const { error: updErr } = await supabaseAdmin.from('tenants').update({ inactivity_email_sent_at: new Date().toISOString() }).eq('id', tenant.id);
    if (updErr) console.error(`[lifecycleEmails] Failed to mark inactivity email sent for ${tenant.id}:`, updErr.message);
    else console.log(`[lifecycleEmails] Sent inactivity reminder for tenant ${tenant.id}`);
  }
}

export async function checkLifecycleEmails(supabaseAdmin: SupabaseClient): Promise<void> {
  await checkTrialEndingSoon(supabaseAdmin);
  await checkTrialExpired(supabaseAdmin);
  await checkInactiveTenants(supabaseAdmin);
}

export function startLifecycleEmails(supabaseAdmin: SupabaseClient): void {
  const intervalHours = parseInt(process.env.LIFECYCLE_EMAIL_INTERVAL_HOURS || '', 10) || DEFAULT_CHECK_INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  checkLifecycleEmails(supabaseAdmin).catch(e => console.error('[lifecycleEmails] Initial check failed:', e.message));
  setInterval(() => {
    checkLifecycleEmails(supabaseAdmin).catch(e => console.error('[lifecycleEmails] Check cycle failed:', e.message));
  }, intervalMs);
}
