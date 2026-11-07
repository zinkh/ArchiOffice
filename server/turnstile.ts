// Vérification serveur d'un jeton Cloudflare Turnstile.
//
// Les routes /api/public/register, /api/public/forgot-password et
// /api/public/resend-confirmation fabriquent leurs liens avec
// supabaseAdmin.auth.admin.generateLink : le captcha de Supabase Auth ne s'y
// applique donc pas, et c'est ici que le jeton est vérifié.
//
// Sans TURNSTILE_SECRET_KEY, la vérification est désactivée (instance sans
// captcha, tests) : le comportement antérieur est conservé. Le serveur local
// du client Electron n'appelle pas verifyTurnstile : il relaie seulement le
// jeton à Supabase Auth (captchaTokenFrom, plus bas).
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5000;

export type TurnstileResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Jeton Turnstile à transmettre tel quel à Supabase Auth (`options.captchaToken`).
 * Le client Electron relaie ici celui que le widget de l'interface a produit :
 * c'est Supabase, et non ce serveur local, qui le vérifie auprès de Cloudflare.
 */
export function captchaTokenFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 ? value : undefined;
}

/** Message utilisateur pour un échec de connexion cloud (le refus du captcha est traduit). */
export function cloudSignInErrorMessage(message: string | undefined, fallback: string): string {
  if (message && /captcha/i.test(message)) {
    return 'Vérification de sécurité requise ou expirée. Validez-la de nouveau puis réessayez.';
  }
  return message || fallback;
}

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
