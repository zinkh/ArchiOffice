import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { I18nextProvider } from 'react-i18next';
import i18n, { i18nReady, changeLanguageLazy } from '../../src/i18n';
import { DEFAULT_SPRING } from '../../src/lib/motion';
import Team from '../../src/pages/Team';
import './preview.css';

const params = new URLSearchParams(window.location.search);
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
document.body.className = 'bg-[#f4f6fb] text-zinc-900 dark:bg-[#182433] dark:text-zinc-100 antialiased';
const lang = params.get('lang');

(async () => {
  await i18nReady;
  await changeLanguageLazy(lang === 'en' ? 'en' : 'fr');
  const member = params.get('member');
  createRoot(document.getElementById('root')!).render(
    <I18nextProvider i18n={i18n}>
      <MotionConfig reducedMotion="user" transition={DEFAULT_SPRING}>
        <MemoryRouter initialEntries={[member ? `/team?member=${member}` : '/team']}>
          <main className="min-h-dvh px-4 py-6 sm:px-8 sm:py-10">
            <Routes>
              <Route path="/team" element={<Team />} />
              <Route path="*" element={<p className="p-8 font-mono text-sm">Route : profil (hors banc)</p>} />
            </Routes>
          </main>
        </MemoryRouter>
      </MotionConfig>
    </I18nextProvider>,
  );
})();
