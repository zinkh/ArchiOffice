---
paths:
  - "public/push-sw.js"
  - "src/lib/push.ts"
  - "src/lib/desktop*.ts"
  - "server/push.ts"
  - "server/manifestLocale.ts"
  - "electron/**"
  - "vite.config.ts"
---

# Plateforme : PWA et client Electron

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Notifications système (PWA et poste de travail)

Le flux d'activité ne prévient personne quand l'application est fermée, et le
mail (`server/mailer.ts`) arrive avec la latence d'une boîte de réception. Le
canal « système » comble cet écart. Une seule source, deux transports, parce
qu'aucun des deux ne couvre tous les postes :

| | Web Push | File `notification_outbox` |
|---|---|---|
| Cible | PWA installée (navigateur, iOS 16.4+ depuis l'écran d'accueil) | Client Electron |
| Sens | Le serveur pousse | Le client relève, toutes les 60 s |
| Fichiers | `public/push-sw.js`, `src/lib/push.ts` | `electron/{main,preload}.cjs`, `src/lib/desktopNotifications.ts` |

`notifyUsers()` (`server/push.ts`) est le point d'entrée unique : il écrit une
ligne par destinataire dans `notification_outbox`, puis tente le Web Push
par-dessus. L'écriture est inconditionnelle, l'envoi est un meilleur effort —
une instance sans clés VAPID garde donc les notifications du poste de travail
et le flux en application, elle perd seulement le canal navigateur.

Deux points à ne pas contourner :

1. **Chromium embarqué dans Electron n'est enregistré auprès d'aucun service de
   push.** FCM et consorts sont liés à un navigateur, pas à une application :
   le Web Push ne peut pas fonctionner dans le client de bureau, d'où le
   relevé périodique. Ce n'est pas un contournement provisoire.
2. **Le service worker est généré par Workbox (`generateSW`).** Les
   gestionnaires `push`/`notificationclick` vivent donc dans un fichier
   statique importé en tête (`workbox.importScripts` dans `vite.config.ts`),
   et non dans un service worker écrit à la main : passer en `injectManifest`
   reviendrait à reprendre la précache et le cycle de mise à jour dont dépend
   `src/components/UpdateBanner.tsx`.

Producteurs branchés : `server/agentAlerts.ts` (toute alerte créée, quelle que
soit la préférence d'envoi de mail de la règle) et les mentions `@` de
`server/routes/activityFeed.ts`. Le filtrage propre au canal est personnel et
non par cabinet : `profiles.notification_prefs` (`{ muted: [catégories] }`),
réglé depuis `src/components/PushNotificationsCard.tsx`.

### Icône et écran de lancement de la PWA (Android)

Les icônes de `public/` sont **opaques, fond blanc** : l'ancien PNG transparent
plein cadre s'affichait sur fond noir au splash Android et, déclaré aussi
`maskable`, était rogné par le masque (logo trop grand). `icon-192/512.png`
(« any », logo à 62 %), `icon-maskable-512.png` (logo à 56 %, zone de sécurité)
et `apple-touch-icon.png` sont régénérés ainsi ; ne pas remettre de
transparence ni réutiliser l'icône « any » comme `maskable`.

Le nom affiché au splash est celui du manifeste, sans mécanisme de traduction :
`GET /manifest.webmanifest` (`server.ts`, production) le sert localisé d'après
`Accept-Language` (`server/manifestLocale.ts`, fr/en, repli anglais, testé).
Android fige nom et icône à l'installation du WebAPK : un appareil déjà
installé doit réinstaller l'application, ou attendre la mise à jour que Chrome
déclenche seul.

### Écran de démarrage (client Electron)

`electron/splash.html` (+ `electron/splashPreload.cjs`) remplace la fenêtre
blanche qui s'affichait pendant que Postgres/PostgREST/le serveur applicatif
démarraient. Une seule liste d'étapes fait foi, `SPLASH_STEPS` dans
`electron/main.cjs`, envoyée au splash par IPC (`splash:init`) — le HTML ne
code aucun libellé en dur, pour qu'il n'existe qu'un seul endroit à mettre à
jour si une étape change.

`reportStep(id, status, detail)` (`main.cjs`) est passé tel quel à
`startOfflineDataStack()`/`startLocalPostgres()` (`electron/pgBootstrap.cjs`),
qui l'appellent à leurs points réels de progression (initialisation
Postgres, application des migrations, démarrage de PostgREST) — l'écran
reflète donc l'avancement RÉEL, pas une simulation minutée. Une étape (`app-
server`, « Démarrage du serveur applicatif ») couvre volontairement PostgREST
ET le serveur Node lancé juste après : `pgBootstrap.cjs` la laisse `active`
en sortant, c'est `main.cjs` qui la clôt une fois SON propre contrôle de
santé (`/api/health`) passé — le vrai signal que l'API est utilisable, pas
seulement que PostgREST répond.

Sur un échec fatal, l'étape en cause se marque `error` à l'endroit précis de
la panne (jamais deviné après coup par un `catch` générique), et l'écran de
démarrage reste affiché avec un bandeau détaillant le chemin du journal et un
bouton « Quitter » — cette fenêtre n'a ni barre de titre ni menu, donc aucune
croix système pour se fermer autrement. Remplace l'ancien écran d'erreur en
texte brut (`data:text/plain`), qui montrait un message mais jamais À QUEL
ENDROIT précis le démarrage avait échoué.

Un piège rencontré en le construisant, à ne pas réintroduire : une tuile
d'icône de taille fixe (`width/height: 84px`), enfant direct d'un conteneur
flex `column` et elle-même conteneur flex pour son SVG, se voyait
sous-dimensionnée à la taille de son contenu (42px) sur la toute première
passe de mise en page de Chromium — reproductible de façon fiable, et pas
seulement en tests headless. `flex: 0 0 84px` (une base explicite, plutôt que
`flex-basis:auto` dérivé de `height`) lève l'ambiguïté dès cette première
passe.
