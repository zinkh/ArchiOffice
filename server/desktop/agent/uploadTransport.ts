import type { UploadTransport } from './transferQueue';

/** Credentials and entitlement checks are supplied by the vault owner, never the renderer.
 * Upload traffic never follows redirects carrying a device token. */
export function createUploadTransport(origin: string, tenantId: string,
  authorize: () => Promise<string>): UploadTransport {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('HTTPS origin required');
  async function call(route: string, method: string, body?: object | Buffer, signal?: AbortSignal, range?: string) {
    const token = await authorize();
    const response = await fetch(`${origin}/api/desktop/v1${route}`, { method, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId,
        ...(body ? { 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' } : {}),
        ...(range ? { 'Content-Range': range } : {}) },
      body: body ? (Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body)) : undefined });
    if (response.status === 204) return;
    const reader = response.body?.getReader(); let text = ''; let size = 0; const decoder = new TextDecoder();
    try { if (reader) { for (;;) { const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length; if (size > 65536) throw Object.assign(new Error('Invalid upload response'), { status: 400, code: 'INVALID_UPLOAD_STATUS' });
      text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); } }
    finally { await reader?.cancel().catch(() => {}); }
    let data: any; try { data = JSON.parse(text); } catch { data = null; }
    if (!response.ok) throw Object.assign(new Error('Upload request failed'), { status: response.status, code: data?.code });
    if (!data) throw Object.assign(new Error('Invalid upload response'), { status: 400, code: 'INVALID_UPLOAD_STATUS' });
    return data;
  }
  return {
    open: (input, signal) => call('/uploads', 'POST', input, signal),
    status: (id, signal) => call(`/uploads/${encodeURIComponent(id)}`, 'GET', undefined, signal),
    chunk: async (id, start, total, bytes, signal) => { await call(`/uploads/${encodeURIComponent(id)}`, 'PUT', bytes, signal, `bytes ${start}-${start+bytes.length-1}/${total}`); },
    complete: (id, sha256, signal) => call(`/uploads/${encodeURIComponent(id)}/complete`, 'POST', { sha256 }, signal),
  };
}
