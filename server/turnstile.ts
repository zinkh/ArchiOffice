// Vérification serveur d'un jeton Cloudflare Turnstile.
//
// Les routes /api/public/register et /api/public/forgot-password fabriquent
// leurs liens avec supabaseAdmin.auth.admin.generateLink : le captcha de
// Supabase Auth ne s'y applique donc pas, et c'est ici que le jeton est vérifié.
//
// Sans TURNSTILE_SECRET_KEY, la vérification est désactivée (instance sans
// captcha, tests, client Electron) : le comportement antérieur est conservé.
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5000;

export type TurnstileResult = { ok: true } | { ok: false; status: number; error: string };

export function isTurnstileEnabled(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

export async function verifyTurnstile(token: unknown, remoteIp?: string): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true };

  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { ok: false, status: 400, error: 'Vérification de sécurité requise.' };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const data = (await res.json()) as { success?: boolean };
    if (data.success === true) return { ok: true };
    return { ok: false, status: 400, error: 'Vérification de sécurité échouée. Veuillez réessayer.' };
  } catch (e) {
    // Cloudflare injoignable : on refuse plutôt que de laisser passer sans contrôle.
    console.error('[turnstile] siteverify indisponible:', e);
    return { ok: false, status: 503, error: 'Vérification de sécurité indisponible. Réessayez dans un instant.' };
  }
}
