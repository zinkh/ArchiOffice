// Real, DB-backed superadmin check — see supabase/migrate_platform_admin.sql.
// SUPER_ADMIN_EMAIL is kept as a bootstrap fallback only: it lets the
// initial platform operator reach POST /api/admin/platform-admins to add
// themselves (and colleagues) into platform_admins for real, without a
// manual SQL insert. Shared between server/routes/superAdmin.ts (route
// guard) and server/routes/team.ts (GET /api/me, so the frontend knows
// whether to render the back-office link at all).
export async function isSuperAdmin(supabaseAdmin: any, user: { id?: string; email?: string } | undefined): Promise<boolean> {
  if (!user?.id) return false;
  const envEmail = process.env.SUPER_ADMIN_EMAIL;
  if (envEmail && user.email && user.email.trim().toLowerCase() === envEmail.trim().toLowerCase()) return true;
  const { data } = await supabaseAdmin.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  return !!data;
}
