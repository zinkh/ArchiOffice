import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './lib/authInterceptor';
import { i18nReady } from './i18n';

// Renders only once the active locale bundle is loaded, so no component ever
// mounts with i18n uninitialized (translations lazy-load per language — see src/i18n.ts).
i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
