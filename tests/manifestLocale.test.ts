import { describe, it, expect } from 'vitest';
import { pickManifestLang, localizeManifest } from '../server/manifestLocale';

describe('manifeste PWA localisé', () => {
  it('choisit le français pour un appareil francophone', () => {
    expect(pickManifestLang('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr');
  });
  it('respecte les poids de qualité', () => {
    expect(pickManifestLang('en;q=0.5,fr;q=0.9')).toBe('fr');
    expect(pickManifestLang('fr;q=0.2,en-GB;q=0.8')).toBe('en');
  });
  it("retombe sur l'anglais pour une langue non gérée ou absente", () => {
    expect(pickManifestLang('de-DE,de;q=0.9')).toBe('en');
    expect(pickManifestLang(undefined)).toBe('en');
  });
  it('traduit le nom et la description sans toucher au reste', () => {
    const m = localizeManifest({ icons: [1], display: 'standalone', name: 'x' }, 'fr-CA');
    expect(m.name).toBe("ArchiOffice - Gestion de cabinet d'architecture");
    expect(m.lang).toBe('fr');
    expect(m.display).toBe('standalone');
    expect(m.icons).toEqual([1]);
  });
});
