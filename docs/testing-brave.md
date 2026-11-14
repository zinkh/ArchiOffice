# Diagnostic de l'interface avec Brave et Playwright

Ce diagnostic lance **Brave réellement installé** (pas Chromium substitué) sur les pages publiques de l'application, en desktop et mobile simulé. Il recueille les erreurs JavaScript, messages d'erreur de la console, échecs réseau du domaine, codes HTTP, débordements horizontaux et captures d'écran.

## GitHub Actions
Le workflow `Brave browser diagnostics` installe Brave depuis le dépôt signé officiel, puis teste `https://www.archioffice.fr`, `/login`, `/register`. Les rapports JSON, captures, traces et rapports HTML sont déposés comme artefact de workflow. Aucun identifiant ou donnée privée n'est utilisé.

## Sur votre PC Windows

```powershell
npm install --legacy-peer-deps
$env:PLAYWRIGHT_BRAVE_EXECUTABLE_PATH = "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
$env:PLAYWRIGHT_BASE_URL = "https://www.archioffice.fr"
npx playwright test e2e/brave-diagnostics.spec.ts --project=brave-desktop --project=brave-mobile
npx playwright show-report
```

Si Brave est installé dans un autre dossier, renseigner son chemin absolu. En local, laisser `PLAYWRIGHT_BASE_URL` non défini pour démarrer Vite ; ne pas utiliser de comptes de production pour les futurs tests authentifiés.

Ce test est un diagnostic en lecture seule des pages publiques, **pas un audit complet après connexion**. Il ne teste ni la compatibilité iPadOS ni le mode PWA installé. L'utilisation d'un exécutable externe n'est pas officiellement garantie par Playwright.
