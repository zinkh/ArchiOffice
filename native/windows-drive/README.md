# Prototype Windows ArchiOffice Drive

Ce composant est un **prototype de consultation**, disponible sur activation explicite dans Documents. Il ouvre
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
# L'aperçu est activé par défaut ; pour le couper : $env:ARCHIOFFICE_DRIVE_WINDOWS_PREVIEW='0'
npx electron .
```

Dans une version installée contenant ce composant compilé, ouvrir Documents
et activer le lecteur A: pour le projet sélectionné. La publication de cette PR n’installe pas une nouvelle version
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
  Les anciens dossiers et enregistrements de racine sont conservés. Le lecteur A: est reconnecté vers un nouvel instantané au lancement. Le nettoyage
  explicite des anciennes racines reste à concevoir avant généralisation.

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

## Lecteur persistant A: (remplace l’activation par variable)

Dans un client Windows livré avec le composant natif, sélectionner un projet dans
Documents puis **Activer le lecteur A: pour ce projet**. La variable de préversion
n’est plus nécessaire ; `ARCHIOFFICE_DRIVE_WINDOWS_PREVIEW=0` reste un coupe-circuit.
Les réglages du compte affichent également l’état et un lien vers Documents.

L’activation crée un lecteur logique DOS `A:` pour la session Windows courante,
visible sous **Ce PC**. Ce n’est ni un formatage ni un disque réseau : il expose
le dossier CFAPI de consultation. Une lettre A: déjà utilisée bloque l’activation,
sans remplacement et sans choix automatique d’une autre lettre. Le libellé
« ArchiOffice Drive » est proposé via la personnalisation utilisateur de
l’Explorateur, si aucun libellé personnalisé n’existe déjà.

Le choix du projet et de l’identité utilisateur/cabinet/appareil est enregistré
sans jeton dans `drive-windows.json` sous userData. L’application est inscrite au
démarrage de session par l’API Electron `setLoginItemSettings`. Au lancement, elle
attend un coffre valide pour cette identité, puis reconnecte le dernier projet
sans ouvrir de fenêtre Explorateur. Une identité différente ne déclenche pas de
connexion automatique. Un échec de montage est affiché et demande une nouvelle
tentative explicite ; l’attente d’initialisation du coffre est reprise toutes les
30 secondes. Le serveur continue de contrôler l’abonnement et les droits.

**Permanence du choix, pas service système indépendant :** A: est présent tant
que le courtier natif fonctionne. Quitter ArchiOffice retire le mappage mais garde
le choix pour le prochain lancement. Déconnecter A: dans l’application retire aussi
la reconnexion et le lancement automatique. Windows peut désactiver ce dernier
dans ses réglages. L’installation et le lancement doivent utiliser la même
session Windows que l’Explorateur, sans élévation manuelle.

Chaque projet possède désormais un **catalogue local et un dossier conservés**.
Une reconnexion utilise le même dossier et les mêmes versions : elle ne relit pas
le catalogue réseau et ne recrée pas les fichiers déjà hydratés. Les placeholders
non hydratés restent téléchargeables par le nouveau processus. Le catalogue peut être renouvelé volontairement après comparaison et confirmation,
comme décrit dans la section Actualisation ci-dessous. Les versions distantes
restent également consultables dans Documents.

Le catalogue est conservé dans un manifeste local par utilisateur/cabinet/appareil
et projet, sans identifiant de connexion. Déconnecter A: retire la préférence de
reconnexion, mais conserve le manifeste ; choisir ce projet de nouveau retrouve
son dossier. Le lecteur A: regroupe désormais jusqu’à dix projets ajoutés depuis
Documents. Le bouton « Ajouter ce projet à A: » ne déconnecte pas les autres.
« Retirer ce projet de A: » retire uniquement son entrée du lecteur ; son dossier,
son catalogue et ses fichiers téléchargés restent conservés. Retirer le dernier
projet déconnecte le lecteur et désactive son lancement automatique.

Le courtier valide le catalogue et son empreinte. La racine CFAPI enregistre cette
identité ; avant de la reconnecter, le composant natif contrôle la racine, les
identités des placeholders, leurs tailles et leur état. Un fichier remplacé,
modifié ou manquant bloque la reconnexion : aucune réparation silencieuse et
aucun écrasement. Les ajouts locaux hors catalogue sont conservés. Une population
initiale interrompue peut compléter uniquement ses entrées manquantes dans le même
dossier ; le manifeste marque son achèvement après le signal natif « ready ».

Les anciens dossiers créés avant cette évolution restent conservés. Leur première
activation prépare une seule nouvelle racine avec manifeste, sans tenter de
réutiliser une racine ancienne dont le catalogue n’a jamais été enregistré. Les
références CAO, l’édition depuis A:, le catalogue de toutes les opérations et le
nettoyage explicite des archives restent à réaliser. Aucun fichier de travail
n’est supprimé. Ce lot n’ajoute pas de raccourci épinglé au volet de navigation ni
d’intégration Finder.

Le composant utilise `QueryDosDeviceW` avant `DefineDosDeviceW`, puis retire
uniquement son chemin exact avec `DDD_EXACT_MATCH_ON_REMOVE`. Après arrêt brutal,
le prochain lancement peut remplacer seulement le mappage du dernier instantané
mémorisé. `mapping-smoke.mjs`, exécuté dans la CI Windows, vérifie la lecture via
A:, cette reprise après arrêt forcé, la déconnexion et le refus d’un lecteur A:
existant créé séparément. Un essai visuel sur Windows 10/11 reste nécessaire.

Références : [DefineDosDeviceW](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-definedosdevicew),
[QueryDosDeviceW](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-querydosdevicew),
[Electron login items](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows).


## Installateur de test automatique

Les PR internes touchant le client, l’agent ou le composant natif lancent aussi le
workflow **Build Windows installer**. L’installateur NSIS est disponible dans
l’artefact `ArchiOffice-Windows-installer` du run, après réussite. Il reçoit une
version distincte, par exemple `1.0.20-drive.49` si la dernière release stable
est `1.0.19`. Ces runs utilisent `--publish never` : aucune release ni mise à jour
automatique des postes n’est publiée. Les forks ne reçoivent pas les secrets du
registre de paquets. Les versions publiques restent publiées par le workflow de
tag existant.

Le test Windows `resume-smoke.mjs` utilise le véritable courtier persistant et
CFAPI. Il reconnecte le même chemin avec le catalogue réseau indisponible, vérifie
qu’un fichier déjà hydraté ne se télécharge pas une seconde fois, hydrate un ancien
placeholder, conserve un ajout local puis refuse un fichier remplacé localement.


## Racine A: multi-projets

`windowsDriveMulti.cjs` supervise un fournisseur CFAPI indépendant par projet et
un processus natif de mappage de A:. `windowsDriveNamespace.cjs` prépare une racine
stable par utilisateur/cabinet/appareil. Ses entrées sont des jonctions Windows
vers les dossiers de projet déjà validés ; aucune racine CFAPI n’est déplacée.
L’entrée reprend le nom mémorisé du projet et pointe directement vers son premier
niveau : les chemins A:\Projet\Phase\Fichier gardent la même forme que dans le
prototype précédent. Les catalogues sont actualisés sur demande et les documents restent en consultation.

La sélection complète est enregistrée dans `drive-windows.json` (version 2).
L’ancien format contenant un seul projet est repris à la première activation.
Chaque projet garde son manifeste existant ; les nouvelles préférences de sa
connexion sont dans le sous-dossier `connections`, hors de la racine exposée.
Déconnecter A: conserve la sélection mais positionne `autoConnect: false` ; une
activation explicite retrouve les projets sélectionnés. Retirer un projet conserve
ses données et retire seulement sa jonction vérifiée. Retirer les dix projets
permet de repartir d’une sélection vide.

Avant d’exposer la racine, le courtier vérifie que chaque entrée est une jonction
attendue, qu’elle cible exactement le dossier validé du projet et qu’aucune entrée
inconnue ne s’y est glissée. Un chemin substitué bloque la connexion et est conservé
pour diagnostic ; il n’est jamais supprimé automatiquement. Le retrait vérifie de
nouveau la cible puis utilise `unlink`, jamais une suppression récursive du projet.
Le processus de mappage ne reçoit que la racine privée et l’ancienne cible A: ; il
ne reçoit aucun jeton. La révocation connue, le changement d’identité ou la perte
d’un fournisseur ferment la racine et ses fournisseurs lors des contrôles d’accès.
Un échec réseau pendant l’ajout d’un nouveau projet conserve les projets sains.

Le bouton de déconnexion reste utilisable si les préférences sont corrompues ; il
peut effacer ces seules préférences, en conservant les manifestes et les fichiers.
La limite de dix projets évite un nombre non borné de processus natifs ; les limites
restent de 100 documents et 50 Mio par fichier pour chaque projet. Aucun projet
n’est ajouté automatiquement depuis l’ensemble du cabinet.

`multi-smoke.mjs` teste le véritable courtier et les jonctions Windows : deux
projets hydratés simultanément sous A:, retrait sans suppression, réajout au même
chemin, reprise de la sélection au redémarrage et coupure après changement de
cabinet. L’installateur de test est construit automatiquement pour la PR.


## Actualisation volontaire des catalogues

Dans Documents, « Vérifier le catalogue » compare le projet local au catalogue
actuel du serveur et présente les ajouts, mises à jour, retraits de la vue A:,
changements de chemin et changements de dossiers. La comparaison ne télécharge
pas le contenu des documents. Un catalogue identique ne crée pas de nouvelle
copie. La proposition est liée au projet, à l’identité, à la génération locale et
au catalogue distant ; elle expire après cinq minutes et doit être revalidée si
les données distantes ont changé.

« Actualiser ce projet » demande une confirmation et la fermeture des fichiers.
Une nouvelle génération est préparée dans un dossier séparé, sans écraser ni
supprimer les fichiers de la génération précédente. Les noms locaux existants
sont conservés par identifiant lorsque le type de fichier et le classement le
permettent. Le premier niveau du projet garde toujours son nom dans A:. Les
changements de dossier ou d’extension figurent dans la comparaison. Une baisse de
version technique est refusée.

Le fournisseur natif vérifie la racine et tous ses placeholders avant la
préparation, puis de nouveau juste avant la bascule. Cette vérification lit les
attributs et les identités, sans hydrater les fichiers. Une modification locale,
un remplacement ou un fichier attendu manquant bloque l’actualisation. Les ajouts
locaux hors catalogue restent dans l’ancienne génération. Aucun envoi vers le
serveur n’est effectué par ce parcours.

Un journal durable enregistre les deux générations et l’intention confirmée. La
jonction du projet est déplacée vers une sauvegarde privée, puis remplacée par une
jonction vers la nouvelle génération. Le projet peut être brièvement indisponible
entre ces deux opérations ; les autres projets restent accessibles. Si le second
renommage échoue, le courtier tente de restaurer immédiatement l’ancienne jonction.
Le journal permet de reprendre une opération interrompue au prochain lancement ou
à la réouverture de A:, en revérifiant les racines et les cibles. Une cible
étrangère est refusée sans suppression automatique.

La copie précédente est accessible avec « Voir la copie précédente », y compris
après une interruption si l’autorisation locale reste valide. Les octets déjà
téléchargés, les ajouts locaux et les retouches tardives enregistrées dans l’ancien
fichier sont conservés. Les anciens placeholders non hydratés peuvent rester
indisponibles : la conservation de l’arborescence ne signifie pas que tous ses
fichiers avaient été téléchargés. Les générations plus anciennes sont également
conservées dans les données privées ; ce lot expose seulement la copie précédente.

`refresh-smoke.mjs` teste ces opérations avec CFAPI et les jonctions Windows réels :
actualisation d’un projet pendant qu’un autre reste ouvert, téléchargement d’une
nouvelle version et d’un ajout, conservation des anciennes données, interruption
simulée du second renommage, reprise après redémarrage et refus après une retouche
locale. L’interface attend une confirmation explicite avant toute application.
