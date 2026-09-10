import { getAccessToken } from './authToken';
import { applyTenantHeader, handleTenantRejection } from './activeTenant';

export const baseFetchJson = async <T = any>(url: string, options?: RequestInit): Promise<T> => {
  const fetchFn = (window as any)._originalFetch || window.fetch;
  const res = await fetchFn(url, options);

  if (!res.ok) {
    // Most endpoints reply with a JSON body ({ error: "..." }) describing what
    // actually went wrong server-side — surface that instead of a bare status
    // code, which by itself gives no way to tell a 500 apart from another.
    let message = `Failed to fetch ${url}: ${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      else if (body?.message) message = body.message;
      // Lets a caller branch on a stable machine-readable reason (e.g.
      // 'INSUFFICIENT_SCOPE' from the mail connectors, see
      // server/mailProviderErrors.ts) instead of matching the French
      // error text above.
      code = body?.code;
    } catch {
      // Body wasn't JSON (e.g. an HTML error page) — keep the generic message.
    }
    // Le cabinet sélectionné n'est plus l'un des siens (départ du cabinet,
    // adhésion révoquée) : on l'oublie et on repart sur le cabinet par défaut
    // du compte, plutôt que de rejouer une requête que le serveur refusera
    // toujours (src/lib/activeTenant.ts).
    if (res.status === 403 && code === 'TENANT_NOT_MEMBER') handleTenantRejection();

    const err: any = new Error(message);
    err.status = res.status;
    err.code = code;
    throw err;
  }

  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await res.text();
    if (text.includes('Please wait while your application starts')) {
      throw new Error('Server is still starting. Please wait a moment and refresh.');
    }
    throw new Error(`Expected JSON response from ${url} but received ${contentType || 'unknown content type'}`);
  }

  return res.json();
};

export const fetchJson = async <T = any>(url: string, options?: RequestInit): Promise<T> => {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  applyTenantHeader(headers);
  return baseFetchJson<T>(url, { ...options, headers });
};

// Authenticated fetch — injecte automatiquement le JWT (Supabase en ligne, local hors-ligne)
export const apiFetch = async <T = any>(url: string, options?: RequestInit): Promise<T> => {
  const token = await getAccessToken();

  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Ces appels court-circuitent le window.fetch instrumenté
  // (src/lib/authInterceptor.ts) : l'en-tête de cabinet doit donc être posé
  // ici aussi, sans quoi la moitié de l'application travaillerait sur le
  // cabinet par défaut et l'autre sur le cabinet sélectionné.
  applyTenantHeader(headers);
  return baseFetchJson<T>(url, { ...options, headers });
};
