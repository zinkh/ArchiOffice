import { authorizeDriveAgent } from '../localDriveRuntime';
let attached = false;
/** Main process is the only peer of this Node IPC channel, not a browser page. */
export function registerDriveVaultBridge() {
  if (attached || !process.send) return;
  attached = true; let pending = 0;
  process.on('message', async (msg: any) => {
    if (msg?.type !== 'drive:vault' || typeof msg.requestId !== 'string' || !/^[a-z0-9-]{1,100}$/.test(msg.requestId)) return;
    if (pending >= 8) return;
    pending++;
    try {
      const result = await authorizeDriveAgent();
      if (process.connected) process.send?.({ type: 'drive:vault-result', requestId: msg.requestId, result });
    } catch (e: any) {
      if (process.connected) process.send?.({ type: 'drive:vault-result', requestId: msg.requestId,
        error: { status: e.status || 503, code: e.code || 'DRIVE_VAULT_UNAVAILABLE' } });
    } finally { pending--; }
  });
}
