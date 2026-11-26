// Écran réel « Base de données », API réelle du serveur sur une fausse base (e2e-kb/kbApiServer.ts) ; aucun
// identifiant de production. Routage par « # » : un rechargement de la page garde la page ouverte.
// `?theme=dark` active le thème sombre.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import BaseDeDonnees from '../../src/pages/BaseDeDonnees';
import { i18nReady } from '../../src/i18n';
import '../../src/index.css';

if (new URLSearchParams(location.search).get('theme') === 'dark') document.documentElement.classList.add('dark');
await i18nReady;
createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <main className="p-4 max-w-7xl mx-auto">
      <Routes>
        <Route path="/base-de-donnees" element={<BaseDeDonnees />} />
        <Route path="/base-de-donnees/:pageId" element={<BaseDeDonnees />} />
        <Route path="*" element={<BaseDeDonnees />} />
      </Routes>
    </main>
  </HashRouter>,
);
