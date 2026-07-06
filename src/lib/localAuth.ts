import { storeLocalSession, clearLocalSession, LocalSession } from './authToken';

async function parseJsonOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export async function checkLocalStatus(): Promise<{ configured: boolean }> {
  const res = await fetch('/api/auth/local-status');
  return parseJsonOrThrow(res);
}

export async function localSetup(agencyName: string, password: string): Promise<LocalSession> {
  const res = await fetch('/api/auth/local-setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agencyName, password }),
  });
  const session: LocalSession = await parseJsonOrThrow(res);
  storeLocalSession(session);
  return session;
}

export async function localSignIn(password: string): Promise<LocalSession> {
  const res = await fetch('/api/auth/local-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const session: LocalSession = await parseJsonOrThrow(res);
  storeLocalSession(session);
  return session;
}

export function localSignOut(): void {
  clearLocalSession();
}
