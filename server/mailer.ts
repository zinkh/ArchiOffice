// Shared platform-level (non-tenant-scoped) mail sending — used for
// pre-tenant flows (registration, password reset) and platform-initiated
// tenant notifications (server/lifecycleEmails.ts) where no per-tenant SMTP
// config exists to fall back on yet. Tenant-scoped sends (using a cabinet's
// own SMTP settings) stay local to server/routes/sendEmail.ts and team.ts.
import nodemailer from 'nodemailer';

// Best-effort platform-level SMTP send. Returns whether it was actually sent.
export async function sendPlatformMail(to: string, subject: string, html: string): Promise<boolean> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn('[mail] SMTP_HOST/SMTP_USER/SMTP_PASS not configured — email not sent.');
    return false;
  }
  // Reject header-injection attempts rather than pass a CR/LF-bearing
  // recipient/subject into the mail headers.
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    console.warn('[mail] Rejected send: invalid characters in recipient/subject.');
    return false;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(String(process.env.SMTP_PORT || '587')),
      secure: String(process.env.SMTP_PORT) === '465',
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({ from: `"ArchiOffice" <${smtpUser}>`, to, subject, html });
    return true;
  } catch (err: any) {
    console.error('[mail] Send failed:', err.message);
    return false;
  }
}

// Notifies every admin (system_role='admin') of a tenant at once — for
// platform-initiated tenant lifecycle notices (trial ending, inactivity...)
// where the recipient is "the cabinet's admins", not a single known address.
export async function notifyTenantAdmins(supabaseAdmin: any, tenantId: string, subject: string, html: string): Promise<boolean> {
  const { data: admins, error } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('system_role', 'admin');
  if (error) {
    console.error(`[mail] Failed to list admins for tenant ${tenantId}:`, error.message);
    return false;
  }
  const recipients = ((admins || []) as { email: string | null }[]).map(a => a.email).filter(Boolean) as string[];
  if (!recipients.length) return false;
  return sendPlatformMail(recipients.join(','), subject, html);
}

// Notifies the ArchiOffice platform team (platform_admins, see
// server/superAdminAuth.ts) — used when a tenant raises a new support
// ticket. Falls back to SUPER_ADMIN_EMAIL if platform_admins is still empty,
// mirroring isSuperAdmin's own bootstrap fallback.
export async function notifyPlatformAdmins(supabaseAdmin: any, subject: string, html: string): Promise<boolean> {
  const { data: admins, error } = await supabaseAdmin.from('platform_admins').select('email');
  if (error) console.error('[mail] Failed to list platform_admins:', error.message);
  const recipients = new Set(((admins || []) as { email: string | null }[]).map(a => a.email).filter(Boolean) as string[]);
  const envEmail = process.env.SUPER_ADMIN_EMAIL;
  if (envEmail) recipients.add(envEmail.trim());
  if (!recipients.size) return false;
  return sendPlatformMail([...recipients].join(','), subject, html);
}
