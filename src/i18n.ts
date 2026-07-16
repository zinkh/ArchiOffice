import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

export type SupportedLang = 'en' | 'fr';

// Each locale is its own ~25-30KB module — only the active one is fetched at
// startup instead of bundling both languages into the initial JS payload.
const localeLoaders: Record<SupportedLang, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import('./locales/en'),
  fr: () => import('./locales/fr'),
};

function detectInitialLang(): SupportedLang {
  try {
    const stored = localStorage.getItem('i18nextLng');
    if (stored?.slice(0, 2).toLowerCase() === 'fr') return 'fr';
    if (stored?.slice(0, 2).toLowerCase() === 'en') return 'en';
  } catch {
    // localStorage unavailable (private browsing, etc.) — fall through to navigator.
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const initialLang = detectInitialLang();
const loadedLanguages = new Set<SupportedLang>([initialLang]);

/** Resolves once the initial locale bundle is loaded and i18n.init() has completed. */
export const i18nReady: Promise<void> = localeLoaders[initialLang]().then(({ default: initialResources }) =>
  i18n
    // Registered for its cacheUserLanguage side effect (persists the language
    // to localStorage on changeLanguageLazy below) — initial detection is done
    // above so only the needed locale is fetched before i18n.init() runs.
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: { [initialLang]: { translation: initialResources } },
      lng: initialLang,
      fallbackLng: 'en',
      supportedLngs: ['en', 'fr'],
      interpolation: {
        escapeValue: false
      }
    })
    .then(() => {})
);

/** Switches the active language, lazily fetching its bundle the first time it's needed. */
export async function changeLanguageLazy(lng: SupportedLang): Promise<void> {
  if (!loadedLanguages.has(lng)) {
    const { default: resources } = await localeLoaders[lng]();
    i18n.addResourceBundle(lng, 'translation', resources);
    loadedLanguages.add(lng);
  }
  await i18n.changeLanguage(lng);
}

export default i18n;
