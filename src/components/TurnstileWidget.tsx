import { Turnstile } from '@marsidev/react-turnstile';

interface TurnstileWidgetProps {
  onToken: (token: string | undefined) => void;
}

/**
 * Widget Cloudflare Turnstile. Chargé en différé depuis Login.tsx : il n'entre
 * donc jamais dans le parcours du build hors-ligne (VITE_OFFLINE_MODE).
 * Pour obtenir un nouveau défi, le parent change la `key` de ce composant.
 */
export default function TurnstileWidget({ onToken }: TurnstileWidgetProps) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string;
  return (
    <div className="flex justify-center">
      <Turnstile
        siteKey={siteKey}
        options={{ theme: 'auto', language: 'fr' }}
        onSuccess={onToken}
        onExpire={() => onToken(undefined)}
        onError={() => onToken(undefined)}
      />
    </div>
  );
}
