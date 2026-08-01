// Shared by server.ts and any extracted route module that proxies an
// external API and needs a bounded request instead of Node's default
// (no timeout at all).
export async function fetchWithTimeout(url: string, options: any = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    console.error(`[fetchWithTimeout] ${url}`, error);
    clearTimeout(id);
    throw error;
  }
}
