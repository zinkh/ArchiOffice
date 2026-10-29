import { verifyOfflineLicense } from './offlineLicense';

export interface LocalDriveIdentity { userId: string; tenantId: string }
export interface LocalDriveState extends LocalDriveIdentity {
  deviceId: string; deviceToken: string; name: string; platform: 'windows' | 'macos';
  license: string | null; lastSeenAt: number; denied: boolean; disconnectPending: boolean;
}
export interface LocalDriveDeps {
  linkedIdentity(): LocalDriveIdentity | null;
  read(): Promise<LocalDriveState | null>;
  write(state: LocalDriveState): Promise<void>;
  trustedKeys: Record<string, string>;
  configured: boolean;
  now(): number;
  monotonic(): number;
  platform: 'windows' | 'macos';
  name: string;
  /** Obtain a short-lived cloud JWT internally; never return it to the renderer. */
  cloudSession(): Promise<string>;
  request(path: string, token: string, tenantId: string | null, body?: object, method?: string): Promise<any>;
}
const failure = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });
const denied = (code: string, message: string) => ({ enabled: false, local: true, code, message, expiresAt: null as string | null });

/** Serializes disk and network operations to prevent concurrent enrollment or stale rewrites. */
export function createLocalDrive(deps: LocalDriveDeps) {
  let queue: Promise<unknown> = Promise.resolve();
  const bootWall = deps.now(); const bootMono = deps.monotonic();
  const time = () => Math.max(deps.now(), bootWall + Math.max(0, deps.monotonic() - bootMono));
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const task = queue.then(fn); queue = task.catch(() => {}); return task;
  }
  function assertIdentity(identity: LocalDriveIdentity) {
    const link = deps.linkedIdentity();
    if (!link || link.userId !== identity.userId || link.tenantId !== identity.tenantId) {
      throw failure(403, 'DRIVE_CLOUD_LINK_REQUIRED', 'Reliez ce poste au compte cloud de ce cabinet avant d’activer Drive.');
    }
  }
  async function load(identity: LocalDriveIdentity) {
    assertIdentity(identity);
    const state = await deps.read();
    if (state && (state.userId !== identity.userId || state.tenantId !== identity.tenantId)) {
      throw failure(403, 'DRIVE_IDENTITY_MISMATCH', 'L’autorisation Drive appartient à un autre compte ou cabinet.');
    }
    return state;
  }
  async function capability(identity: LocalDriveIdentity) {
    if (!deps.configured) return denied('DRIVE_TRUST_UNCONFIGURED', 'Le service Drive de ce client de bureau doit être configuré avant son activation.');
    const state = await load(identity);
    if (!state) return denied('DRIVE_ONLINE_VERIFICATION_REQUIRED', 'Connectez ce poste au service Drive pour vérifier l’abonnement.');
    if (state.denied || state.disconnectPending) return denied('DRIVE_ACCESS_SUSPENDED', 'L’accès Drive est suspendu. Vos fichiers locaux sont conservés.');
    // Protect against wall-clock rollback and frozen clocks within this process.
    if (deps.now() + 1000 < state.lastSeenAt) return denied('DRIVE_CLOCK_ROLLBACK', 'L’heure du poste a reculé. Corrigez-la puis vérifiez l’accès en ligne.');
    const claims = state.license && verifyOfflineLicense(state.license, state, deps.trustedKeys, time(), state.lastSeenAt);
    if (!claims) return denied('DRIVE_LICENSE_EXPIRED', 'L’autorisation Drive est absente, invalide ou expirée. Reconnectez ce poste.');
    state.lastSeenAt = time(); await deps.write(state);
    return { enabled: true, local: true, code: null, message: null, expiresAt: new Date(claims.exp * 1000).toISOString() };
  }
  async function disconnectRemote(state: LocalDriveState) {
    try {
      await deps.request(`/devices/${encodeURIComponent(state.deviceId)}`, state.deviceToken, null, undefined, 'DELETE');
    } catch (e: any) {
      if (e.status !== 401 && e.status !== 404) throw e;
    }
    state.disconnectPending = false; state.deviceToken = ''; await deps.write(state);
  }
  async function refresh(identity: LocalDriveIdentity, enroll: boolean) {
    if (!deps.configured) throw failure(503, 'DRIVE_TRUST_UNCONFIGURED', 'Le service Drive de ce client de bureau doit être configuré avant son activation.');
    let state = await load(identity);
    if (state?.disconnectPending) {
      await disconnectRemote(state);
      if (!enroll) return capability(identity);
    }
    if ((!state || !state.deviceToken) && !enroll) return capability(identity);
    if (!state || !state.deviceToken) {
      const jwt = await deps.cloudSession();
      const device = await deps.request('/devices', jwt, identity.tenantId, { name: deps.name, platform: deps.platform });
      if (typeof device?.deviceId !== 'string' || !/^dev_[a-zA-Z0-9_-]+$/.test(device.deviceId)
        || typeof device?.token !== 'string' || !device.token.startsWith('ds_at_')) {
        throw failure(502, 'DRIVE_INVALID_RESPONSE', 'La réponse du service Drive est invalide.');
      }
      state = { ...identity, deviceId: device.deviceId, deviceToken: device.token, name: deps.name,
        platform: deps.platform, license: null, lastSeenAt: time(), denied: false, disconnectPending: false };
      // Keep the newly issued credential even if license issuance fails, avoiding duplicates.
      await deps.write(state);
    }
    try {
      const response = await deps.request('/offline-license', state.deviceToken, identity.tenantId, {});
      // A response cannot supply its own trust roots. Never fall back on an invalid signature.
      const claims = typeof response?.license === 'string'
        && verifyOfflineLicense(response.license, state, deps.trustedKeys, time());
      if (!claims) {
        state.denied = true; state.license = null; await deps.write(state);
        throw failure(502, 'DRIVE_INVALID_LICENSE', 'L’autorisation reçue ne peut pas être vérifiée.');
      }
      state.license = response.license; state.denied = false; state.lastSeenAt = time(); await deps.write(state);
    } catch (e: any) {
      // A real server refusal beats a cached grant immediately. Network/5xx failures
      // retain only the remaining duration of an already verified grant.
      if ([401, 402, 403, 404].includes(e.status)) {
        state.denied = true; state.license = null;
        if (e.status === 401 || e.status === 404) state.deviceToken = '';
        await deps.write(state);
      }
      throw e;
    }
    return capability(identity);
  }
  return {
    capability: (id: LocalDriveIdentity) => serial(() => capability(id)),
    connect: (id: LocalDriveIdentity) => serial(() => refresh(id, true)),
    refresh: (id: LocalDriveIdentity) => serial(() => refresh(id, false)),
    devices: (id: LocalDriveIdentity) => serial(async () => {
      const state = await load(id);
      return state && !state.denied && !state.disconnectPending ? [{ id: state.deviceId, name: state.name,
        platform: state.platform, expiresAt: null, current: true }] : [];
    }),
    disconnect: (id: LocalDriveIdentity, deviceId: string) => serial(async () => {
      const state = await load(id);
      if (!state || state.deviceId !== deviceId) throw failure(404, 'DEVICE_NOT_FOUND', 'Appareil introuvable sur ce poste.');
      // Disable before the network call. A failed remote revocation is retried later.
      state.denied = true; state.disconnectPending = true; state.license = null; await deps.write(state);
      try { await disconnectRemote(state); } catch { /* encrypted pending revocation survives restart */ }
      return { success: true, remoteRevocationPending: state.disconnectPending };
    }),
  };
}
