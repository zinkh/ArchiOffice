# Prototype Windows ArchiOffice Drive

Ce composant est un **prototype de consultation**, désactivé par défaut. Il ouvre
un dossier de projet dans l’Explorateur, crée des fichiers CFAPI et hydrate une
version documentaire à la demande via le cache vérifié de l’agent existant.
Il ne synchronise pas les enregistrements, ajouts, suppressions ou renommages
faits dans ce dossier. Utiliser le parcours Documents pour modifier et envoyer
les copies de travail.

## Construction et lancement

Sur Windows x64 avec Visual Studio Build Tools (C++) et le Windows SDK :

```powershell
cmake -S native/windows-drive -B native/windows-drive/build -A x64
cmake --build native/windows-drive/build --config Release
node native/windows-drive/smoke.mjs
node native/windows-drive/broker-smoke.mjs
npm run build
npm run build:server
$env:ARCHIOFFICE_DRIVE_WINDOWS_PREVIEW='1'
npx electron .
```

Dans une version installée contenant ce composant compilé, définir la même
variable **dans le processus de lancement d’ArchiOffice**, puis relancer
l’application. La publication de cette PR n’installe pas une nouvelle version
sur le poste. Le workflow de l’installateur construit et embarque l’exécutable
comme ressource externe à l’ASAR. Le workflow `Windows Drive prototype` compile
également le composant et conserve son exécutable en artefact de CI.

L’autorisation Drive locale doit être valide (cabinet payant, connexion du poste
activée dans Réglages). Dans Documents, sélectionner un projet puis choisir
« Ouvrir le projet dans l’Explorateur (prototype) ». Le contrôle n’apparaît que si
le mode expérimental est activé et l’exécutable présent. Pour changer de projet,
déconnecter d’abord le prototype. Ne pas placer les données de l’application dans
un répertoire surveillé par Nextcloud, kDrive ou un autre moteur de synchronisation.

## Périmètre

- Un projet par session, 100 fichiers au plus, 50 Mio par fichier, 256 entrées
  au total. Un dépassement refuse le catalogue entier ; aucun oubli silencieux.
- Catalogue figé au lancement, chemins nettoyés et suffixés par identifiant pour
  éviter les collisions et les chemins fournis par le serveur. Chaque fichier
  est lié à sa version technique et à sa taille au moment du catalogue.
- Dossier fraîchement créé sous les données privées de l’application, séparé du
  cache et des copies de travail. Le chemin reste natif ; il n’est pas renvoyé au
  renderer. Les liens/jonctions sont refusés.
- Attribut lecture seule sur les fichiers et refus CFAPI des suppressions et
  renommages des placeholders. Ce n’est pas une protection contre une personne
  qui retire ces attributs ou crée un fichier normal : ces changements locaux
  ne sont pas envoyés au serveur et ne sont pas supprimés par le prototype.
- Hydratation FULL : le cache télécharge puis vérifie la version entière avant
  remise à CFAPI, qui reçoit les octets par blocs alignés. Windows ou un antivirus
  peut demander du contenu avant un double clic ; l’ouverture n’est pas le seul
  déclencheur possible d’hydratation.
- Le composant natif ne reçoit ni jeton d’appareil, ni JWT, ni URL de stockage.
  Il demande une clé opaque au courtier Electron. Celui-ci accepte uniquement
  les clés du catalogue, revérifie l’identité dans le coffre et contrôle le
  chemin de cache dérivé du compte/document/version avant de répondre.
- Le cache exige l’autorisation signée locale ; les accès réseau repassent par
  les droits serveur. Une licence refusée ou un compte changé refuse une
  hydratation ; une vérification périodique du coffre déconnecte aussi le
  prototype. Des octets déjà remis au système restent accessibles localement.
- Une déconnexion n’effectue que `CfDisconnectSyncRoot`, sans suppression ni
  remplacement des fichiers. Le processus s’arrête sur fermeture du parent.
  Les anciens dossiers et enregistrements de racine sont conservés. Leur reprise
  persistante et leur nettoyage explicite sont à concevoir avant généralisation.

Le prototype ouvre un dossier normal dans l’Explorateur ; il n’enregistre pas
encore d’entrée de navigation dédiée via StorageProviderSyncRootManager, de
menus métier ou de panneau de propriétés. Les icônes/colonnes disponibles
restent celles prises en charge par Windows et doivent être observées lors du
pilote. Il n’y a pas d’intégration Finder dans ce lot.

## Vérifications

Le test `smoke.mjs` s’exécute sur Windows : il enregistre une racine temporaire,
crée des placeholders, contrôle le bit reparse-point, lit un fichier avec chemin
Unicode, compare 9 001 octets, vérifie un refus d’hydratation, puis contrôle la
conservation des données après déconnexion. Le courtier du test est synthétique ;
un second test utilise le courtier Electron livré avec le véritable composant
CFAPI, un cache correctement dérivé et un coffre/agent synthétiques. Les contrôles
du coffre et de l’agent sont couverts séparément par les tests Node/React.

**Nettoyage du test uniquement :** `--unregister <racine>` appelle
`CfUnregisterSyncRoot`. Windows peut alors supprimer les placeholders non
hydratés. Cette commande n’est jamais appelée à la déconnexion de l’utilisateur
ni exposée dans l’interface. Ne pas l’employer sur un dossier contenant du travail.

Avant un pilote cabinet : tester l’installation et le lancement opt-in sur
Windows 10/11, l’Explorateur, un PDF/DWG représentatif, une coupure réseau,
la révocation connue du poste, l’arrêt d’ArchiOffice pendant une lecture et
l’absence d’altération des copies existantes. Les références relatives CAO,
les sauvegardes natives, le renouvellement du catalogue, la reprise de racine,
la sélection hors connexion et les usages collaboratifs restent hors périmètre.

Références primaires Microsoft :

- [Cloud Filter API](https://learn.microsoft.com/en-us/windows/win32/api/_cloudapi/)
- [CfCreatePlaceholders](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfcreateplaceholders)
- [Transfert et alignement des octets](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/ns-cfapi-cf_operation_parameters)
- [Effets de la désinscription](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfunregistersyncroot)
