import { lazy } from 'react';

// Clé de site publique Cloudflare Turnstile. Vide = pas de captcha.
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';

// Chargé en différé : le build hors-ligne ne télécharge jamais le widget.
export const TurnstileWidget = lazy(() => import('../components/TurnstileWidget'));
