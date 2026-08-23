import { describe, it, expect, vi, beforeEach } from 'vitest';

type AuthListener = (event: string, session: unknown) => void;

const listeners: AuthListener[] = [];
const getSession = vi.fn();
const refreshSession = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      refreshSession: () => refreshSession(),
      onAuthStateChange: (cb: AuthListener) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

/** Fresh module instance per test — the token mirror/cache is module state. */
async function loadAuthToken() {
  vi.resetModules();
  listeners.length = 0;
  getSession.mockReset();
  refreshSession.mockReset();
  return import('../authToken');
}

const secondsFromNow = (s: number) => Math.floor(Date.now() / 1000) + s;

function emit(session: unknown) {
  listeners.forEach((cb) => cb('TOKEN_REFRESHED', session));
}

describe('getAccessToken', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    refreshSession.mockResolvedValue({ data: { session: null }, error: null });
  });

  it('registers a synchronous auth state listener', async () => {
    await loadAuthToken();
    expect(listeners).toHaveLength(1);
    // A callback that returns a promise would keep supabase-js's exclusive auth
    // lock held while it settles, deadlocking every later getSession(). See the
    // comment in src/UserContext.tsx.
    expect(listeners[0]('TOKEN_REFRESHED', null)).toBeUndefined();
  });

  it('serves the mirrored session without touching getSession()', async () => {
    const { getAccessToken } = await loadAuthToken();
    emit({ access_token: 'tok-1', expires_at: secondsFromNow(3600) });

    await expect(getAccessToken()).resolves.toBe('tok-1');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('picks up a refreshed token from the listener', async () => {
    const { getAccessToken } = await loadAuthToken();
    emit({ access_token: 'tok-1', expires_at: secondsFromNow(3600) });
    emit({ access_token: 'tok-2', expires_at: secondsFromNow(3600) });

    await expect(getAccessToken()).resolves.toBe('tok-2');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('falls back to getSession() when no session has been mirrored yet', async () => {
    const { getAccessToken } = await loadAuthToken();
    getSession.mockResolvedValue({
      data: { session: { access_token: 'from-get-session', expires_at: secondsFromNow(3600) } },
      error: null,
    });

    await expect(getAccessToken()).resolves.toBe('from-get-session');
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('falls back to getSession() when the mirrored token is about to expire', async () => {
    const { getAccessToken } = await loadAuthToken();
    emit({ access_token: 'stale', expires_at: secondsFromNow(10) });
    getSession.mockResolvedValue({
      data: { session: { access_token: 'stale', expires_at: secondsFromNow(10) } },
      error: null,
    });
    refreshSession.mockResolvedValue({
      data: { session: { access_token: 'fresh', expires_at: secondsFromNow(3600) } },
      error: null,
    });

    await expect(getAccessToken()).resolves.toBe('fresh');
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent callers onto a single getSession() call', async () => {
    const { getAccessToken } = await loadAuthToken();
    getSession.mockResolvedValue({
      data: { session: { access_token: 'tok', expires_at: secondsFromNow(3600) } },
      error: null,
    });

    const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);

    expect(tokens).toEqual(['tok', 'tok', 'tok']);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('does not report the session as gone when getSession() merely times out', async () => {
    const { getAccessToken, isSessionDefinitelyGone } = await loadAuthToken();
    getSession.mockRejectedValue(new Error('auth-timeout'));

    await expect(getAccessToken()).resolves.toBeNull();
    expect(isSessionDefinitelyGone()).toBe(false);
  });

  it('reports the session as gone when Supabase rejects the refresh token', async () => {
    const { getAccessToken, isSessionDefinitelyGone } = await loadAuthToken();
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('refresh_token_not_found') });

    await expect(getAccessToken()).resolves.toBeNull();
    expect(isSessionDefinitelyGone()).toBe(true);
  });
});
