// Server-owned subscription data only: never trust a device token, local plan or
// catalogue price as proof of payment. trial_ends_at is also the paid-through
// date for paid plans (billing.ts / planChanges.ts).
export const DRIVE_SUBSCRIPTION_REQUIRED = 'DRIVE_SUBSCRIPTION_REQUIRED';
const PAID_PLANS = new Set(['starter', 'pro', 'enterprise']);

export function hasActiveDriveSubscription(tenant: any, now = Date.now()): boolean {
  const until = Date.parse(tenant?.trial_ends_at ?? '');
  return PAID_PLANS.has(tenant?.plan) && Number.isFinite(until) && until > now
    && !tenant?.suspended_at;
}

export async function driveCapability(db: any, tenantId: string, userId?: string) {
  // A local plan never grants access: validate a device-bound cloud signature.
  if (process.env.OFFLINE_MODE === 'true') {
    if (userId) {
      const { localDrive } = await import('./localDriveRuntime');
      return localDrive.capability({ userId, tenantId });
    }
    return { enabled: false, code: 'DRIVE_ONLINE_VERIFICATION_REQUIRED',
      message: 'Activez ArchiOffice Drive depuis une connexion au service en ligne.' };
  }
  const { data, error } = await db.from('tenants')
    .select('plan, trial_ends_at, suspended_at').eq('id', tenantId).maybeSingle();
  if (error) {
    throw Object.assign(new Error('Vérification de l’abonnement indisponible. Réessayez ultérieurement.'),
      { status: 503, code: 'DRIVE_ENTITLEMENT_UNAVAILABLE' });
  }
  const enabled = hasActiveDriveSubscription(data);
  return { enabled, code: enabled ? null : DRIVE_SUBSCRIPTION_REQUIRED,
    message: enabled ? null : 'ArchiOffice Drive est réservé aux cabinets disposant d’un abonnement payant actif.' };
}

export async function requireDriveSubscription(db: any, tenantId: string, userId?: string): Promise<void> {
  const capability = await driveCapability(db, tenantId, userId);
  if (!capability.enabled) {
    throw Object.assign(new Error(capability.message!), { status: 402, code: capability.code });
  }
}
