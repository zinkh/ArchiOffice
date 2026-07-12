// electron/main.cjs spawns this server with `ELECTRON_RUN_AS_NODE: '1'`,
// making it a plain Node process — Electron's `safeStorage` API (OS-level
// encryption: DPAPI on Windows) is main-process-only and unreachable here
// directly. This bridges to it over the Node IPC channel electron/main.cjs
// adds to the spawned process's stdio (`['ignore','pipe','pipe','ipc']`),
// which gives this process `process.send`/`process.on('message')`.
//
// Used to persist the cloud-link refresh token (server/cloudLinkState.ts)
// without ever writing it in plaintext to disk.

interface PendingRequest {
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

const pending = new Map<string, PendingRequest>();
let listenerAttached = false;

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  process.on('message', (msg: any) => {
    if (!msg || (msg.type !== 'safeStorage:encrypt:result' && msg.type !== 'safeStorage:decrypt:result')) return;
    const entry = pending.get(msg.requestId);
    if (!entry) return;
    pending.delete(msg.requestId);
    clearTimeout(entry.timeout);
    if (msg.error) entry.reject(new Error(msg.error));
    else entry.resolve(msg.value);
  });
}

function request(type: 'safeStorage:encrypt' | 'safeStorage:decrypt', value: string): Promise<string> {
  if (typeof process.send !== 'function') {
    return Promise.reject(new Error('No IPC channel to the Electron main process — cloud-link requires the packaged/dev Electron app, not a bare `npm run dev`.'));
  }
  ensureListener();
  const requestId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Timed out waiting for ${type} from the Electron main process.`));
    }, 10000);
    pending.set(requestId, { resolve, reject, timeout });
    process.send!({ type, requestId, value });
  });
}

/** @returns base64-encoded ciphertext */
export async function encryptForStorage(plaintext: string): Promise<string> {
  return request('safeStorage:encrypt', plaintext);
}

/** @param ciphertext base64-encoded, as returned by encryptForStorage */
export async function decryptFromStorage(ciphertext: string): Promise<string> {
  return request('safeStorage:decrypt', ciphertext);
}
