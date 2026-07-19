import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './lib/authInterceptor';
import { i18nReady } from './i18n';
import { initSentry, Sentry } from './lib/sentry';

initSentry();

// Renders only once the active locale bundle is loaded, so no component ever
// mounts with i18n uninitialized (translations lazy-load per language — see src/i18n.ts).
i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Sentry.ErrorBoundary fallback={<p>Une erreur est survenue. Veuillez recharger la page.</p>}>
        <App />
      </Sentry.ErrorBoundary>
    </StrictMode>,
  );
});
