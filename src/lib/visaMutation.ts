import type { Visa } from '../types';

/** Only a confirmed HTTP success may change the visible VISA list. */
export async function mutateVisa(visa: Visa, action: 'approved' | 'rejected' | 'delete',
  request: typeof fetch = fetch, timeoutMs = 20000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(`/api/visas/${encodeURIComponent(visa.id)}`, {
      method: action === 'delete' ? 'DELETE' : 'PUT',
      ...(action === 'delete' ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...visa, status: action }),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`VISA mutation not confirmed (${response.status})`);
  } finally {
    clearTimeout(timer);
  }
}
