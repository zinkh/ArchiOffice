// Le manifeste PWA n'a pas de mécanisme de traduction : le nom affiché sur
// l'écran de lancement Android (splash) et la description sont ceux du fichier
// servi. On les localise donc à la volée d'après Accept-Language, que Chrome
// envoie avec la langue de l'appareil. Seules les langues de l'interface
// (fr, en) existent ; toute autre retombe sur l'anglais, comme i18n.ts.

export type ManifestLang = 'fr' | 'en';

const LOCALIZED: Record<ManifestLang, { name: string; description: string }> = {
  fr: {
    name: "ArchiOffice - Gestion de cabinet d'architecture",
    description: "Gestion de cabinet d'architecture : projets, propositions, factures et équipe.",
  },
  en: {
    name: 'ArchiOffice - Architectural Office Management',
    description: 'Architectural office management: projects, proposals, invoices and team.',
  },
};

/** Langue préférée de l'en-tête Accept-Language (« fr-FR,fr;q=0.9,en;q=0.8 »). */
export function pickManifestLang(acceptLanguage: string | undefined): ManifestLang {
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().slice(0, 2), weight: Number.isNaN(weight) ? 0 : weight, index };
    })
    .filter((entry) => entry.lang === 'fr' || entry.lang === 'en')
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return (ranked[0]?.lang as ManifestLang | undefined) ?? 'en';
}

/** Copie du manifeste dont le nom et la description suivent la langue demandée. */
export function localizeManifest<T extends Record<string, unknown>>(
  manifest: T,
  acceptLanguage: string | undefined,
): T & { lang: ManifestLang; name: string; description: string } {
  const lang = pickManifestLang(acceptLanguage);
  return { ...manifest, lang, ...LOCALIZED[lang] };
}
