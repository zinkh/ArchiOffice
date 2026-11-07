import { lazy, useCallback, useState } from 'react';

// Clé de site publique Cloudflare Turnstile. Vide = pas de captcha.
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';

// Chargé en différé : le build hors-ligne ne télécharge jamais le widget.
export const TurnstileWidget = lazy(() => import('../components/TurnstileWidget'));

/**
 * État d'un défi Turnstile : le jeton courant et une clé qui, une fois changée
 * par `reset()`, remonte le widget pour obtenir un nouveau défi (un jeton ne
 * sert qu'une fois).
 */
export function useCaptcha() {
  const [token, setToken] = useState<string | undefined>();
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => {
    setToken(undefined);
    setResetKey(k => k + 1);
  }, []);
  return { enabled: TURNSTILE_SITE_KEY !== '', token, setToken, resetKey, reset };
}
