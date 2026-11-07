import { Suspense } from 'react';
import { TurnstileWidget, useCaptcha } from '../lib/turnstile';

/**
 * Affiche le défi Turnstile d'un `useCaptcha()` quand une clé de site est
 * configurée, et ne rend rien sinon (aucun script chargé, comportement antérieur).
 */
export function TurnstileField({ captcha }: { captcha: ReturnType<typeof useCaptcha> }) {
  if (!captcha.enabled) return null;
  return (
    <Suspense fallback={null}>
      <TurnstileWidget key={captcha.resetKey} onToken={captcha.setToken} />
    </Suspense>
  );
}
