# Tests navigateur Playwright — ArchiOffice

Playwright complète les tests unitaires Vitest par une vérification du parcours web dans Chromium, sur ordinateur et en émulation mobile Android.

## Installation locale

```bash
npm install --legacy-peer-deps
npx playwright install chromium
```

## Exécution

```bash
npm run test:e2e              # Démarre Vite et lance les tests
npm run test:e2e:ui           # Interface interactive
npm run test:e2e:report       # Ouvre le dernier rapport HTML
```

Par défaut, Playwright démarre un serveur Vite isolé sur `http://127.0.0.1:4173` et injecte une URL et une clé Supabase fictives pour le test public de démarrage. Aucune donnée réelle de cabinet n'est nécessaire.

Pour tester une instance de préproduction sans lancer le serveur local :

```bash
PLAYWRIGHT_BASE_URL=https://preproduction.example.fr npm run test:e2e
```

Ne configurez pas les tests pour modifier des données de production. Les futurs parcours nécessitant une authentification devront utiliser un tenant de test et des identifiants transmis par secrets CI.

La suite et la configuration sont dans `e2e/` et `playwright.config.ts`. Une GitHub Action lance automatiquement les tests sur les PR qui touchent au frontend et permet aussi un déclenchement manuel.
