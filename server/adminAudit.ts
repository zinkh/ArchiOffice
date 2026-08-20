// Audit trail for mutating platform back-office actions — see
// supabase/migrate_platform_admin.sql's admin_audit_log table. Best-effort:
// a logging failure must never fail the action it's logging.
export async function logAdminAction(
  supabaseAdmin: any,
  actor: { id?: string; email?: string },
  action: string,
  targetTenantId: string | null,
  details?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabaseAdmin.from('admin_audit_log').insert({
    actor_user_id: actor.id || null,
    actor_email: actor.email || null,
    action,
    target_tenant_id: targetTenantId,
    details: details ?? null,
  });
  if (error) console.error('[adminAudit] Failed to log admin action:', error.message);
}
