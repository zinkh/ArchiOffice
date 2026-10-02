import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.tsx';
import './index.css';
import './lib/authInterceptor';
import { i18nReady } from './i18n';
import { initSentry, Sentry } from './lib/sentry';
import { initOfflineQueue } from './lib/offlineQueue';
import { DEFAULT_SPRING } from './lib/motion';

initSentry();
initOfflineQueue();

// Renders only once the active locale bundle is loaded, so no component ever
// mounts with i18n uninitialized (translations lazy-load per language — see src/i18n.ts).
i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Sentry.ErrorBoundary fallback={<p>Une erreur est survenue. Veuillez recharger la page.</p>}>
        {/* reducedMotion="user" : quand le système demande de réduire les
            animations, Motion coupe les déplacements et les changements
            d'échelle et ne garde que les fondus. `transition` est le ressort
            par défaut de tout élément animé qui n'en précise pas un. */}
        <MotionConfig reducedMotion="user" transition={DEFAULT_SPRING}>
          <App />
        </MotionConfig>
      </Sentry.ErrorBoundary>
    </StrictMode>,
  );
});
