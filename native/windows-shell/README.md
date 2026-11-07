# ArchiOffice Drive — liste documentaire Explorer, lots 3 à 5

Vue native Windows x64 enregistrée dans **Ce PC → ArchiOffice Drive**, séparée du lecteur A: et du fournisseur CFAPI existant. Le client ArchiOffice doit être ouvert et A: actif. Les projets déjà montés sont les seuls proposés.

## Parcours livré

- Six vues dans l’arbre : **Par projet**, **Par phase**, **Par type**, **À classer**, **Hors ligne** et **Conflits**.
- Recherche sur nom, projet, phase, type documentaire, format, indice et statut : plusieurs mots se combinent avec ET, sans distinction de casse ni d’accents. Ctrl+F place le focus dans la recherche.
- Filtres projet, phase, type documentaire et statut, combinables entre eux, avec la recherche et la vue choisie. « Effacer » remet tous les critères à zéro. Une valeur disparue du catalogue reste sélectionnée et signalée comme absente, sans élargissement silencieux des résultats.
- Liste et propriétés en lecture seule. Les métadonnées restent liées à la version du manifeste : une observation d’une autre version ne classe pas arbitrairement le fichier monté.
- Sept colonnes : Document, Phase, Type documentaire, Indice, Version, Statut et Synchronisation. Les champs absents restent indiqués par un tiret.
- Sélection par souris/clavier, ouverture par double-clic/Entrée, F5 ou bouton Actualiser. Les séparateurs sont déplaçables ; sous 850 unités logiques, le bouton Propriétés permet d’alterner avec la liste des documents. La géométrie, les colonnes et les polices suivent le DPI Windows.
- « Ouvrir » résout un identifiant opaque dans le manifeste actif et ouvre le fichier physique canonique utilisé par A:, sans créer une seconde copie de travail.
- « Ouvrir dans ArchiOffice » ouvre Documents sur le projet et met le document en évidence après vérification de sa présence dans les données chargées.

Le catalogue local est relu toutes les cinq secondes. Une réponse identique ne reconstruit pas la vue ; un changement conserve la sélection, les branches repliées et les positions de défilement. L’enrichissement métier réutilise le cache local isolé par utilisateur/cabinet/appareil/projet du lot 2 et ses API VFS authentifiées, sans télécharger les fichiers. Sa lecture distante se renouvelle au plus une fois par minute. Les propriétés affichent la date de l’observation et signalent une donnée en cache dont l’actualisation est en attente. Il ne s’applique qu’à une version identique à celle du manifeste monté. Cette vue ne rafraîchit pas automatiquement les fichiers de A: : la commande existante de mise à jour du catalogue conserve ce rôle.

## Panneau de droite (lot 5)

Les onglets **Propriétés**, **Aperçu** et **Versions** suivent la sélection sans
ouvrir de page du client. Une sélection multiple affiche son résumé et ne lance
aucun aperçu ni consultation arbitraire du premier document.

- PDF : aperçu ajusté au panneau et navigation page précédente/suivante.
- Images : PNG, JPEG, GIF, BMP et TIFF ; seule la première image des formats animés
  ou multi-images est affichée. L’aperçu est une image de lecture, sans annotation.
- DWG, IFC, RVT et autres formats : message d’aperçu indisponible et commande
  Ouvrir conservée pour le logiciel habituel. Les fichiers protégés, illisibles,
  trop complexes ou indisponibles hors connexion affichent un état adapté.
- Versions : au plus les cinquante dernières lignes réellement retournées par
  ArchiOffice, triées par version décroissante, avec date, taille et description
  disponibles. Le nombre total et la date d’observation sont affichés. Aucun
  enregistrement historique n’est inventé pour combler une version absente.

Le rendu lit un instantané temporaire du fichier canonique de A: dans le cache
privé du client. La création de cet instantané peut déclencher l’hydratation CFAPI
existante si le contenu n’est pas encore local ; elle ne modifie pas le fichier de
travail et ne crée pas une deuxième copie éditable. Une modification pendant la
copie ou le rendu refuse l’image. L’instantané est nettoyé à la fin de la demande ;
un arrêt brutal peut laisser un résidu dans le cache privé de prévisualisation.

Le processus séparé `archioffice-shell-preview.exe` utilise Windows.Data.Pdf et
GDI+ pour produire un raster borné à 512 × 640 pixels. La DLL Explorer ne reçoit
que ces pixels et les compteurs de page, sans chemin de disque ni jeton cloud,
et n’héberge aucun décodeur PDF ou image. La limite de contenu reste 50 Mio ; les
images sources sont limitées à 64 mégapixels. Un échec ne bloque pas les propriétés
ni les commandes existantes. L’ouverture normale reste le parcours pour une
lecture haute résolution, la modification et l’annotation.

Les requêtes du panneau sont indépendantes du chargement du catalogue. La
sélection, le numéro de page et la génération sont contrôlés avant affichage ;
une réponse tardive est ignorée. Un changement rapide annule la requête précédente
et coalesce les demandes. L’historique déjà lu peut être réaffiché en cache pendant
la session, avec sa date et un libellé explicite ; un refus connu l’invalide. Il
reste séparé de la version du catalogue A: et de l’état d’envoi.

## Liste documentaire et présentation (lot 4)

Un clic sur un en-tête trie la liste ; un second inverse le sens. La flèche indique
le tri actif. La version technique est triée numériquement, les textes de manière
naturelle ; les valeurs métier absentes restent en fin de liste. Les colonnes sont
redimensionnables et réordonnables par glisser-déposer. Les identifiants de colonnes
restent stables après déplacement, et la sélection reste liée au document, pas au
numéro de ligne résultant du tri.

Les notions restent distinctes : **Indice** est l’indice métier, **Version** la
version technique du catalogue A:, et **Synchronisation** l’état d’envoi suivi par
l’agent. Le panneau de propriétés explicite ces libellés. « Dernier envoi accepté »
ne garantit pas l’absence de retouches plus récentes ; un état inconnu est indiqué
comme indisponible, jamais comme synchronisé.

La sélection multiple utilise Ctrl/Maj et Ctrl+A dans la liste. Elle est conservée
lors d’un tri ou d’une actualisation dans le même cabinet, pour les documents
encore visibles. Les propriétés montrent un résumé et les commandes d’ouverture
sont désactivées lorsque plusieurs documents sont sélectionnés : aucune action
n’est appliquée arbitrairement au premier fichier.

L’ordre et la largeur des colonnes, le tri et les séparateurs sont mémorisés par
compte/cabinet/poste dans les préférences utilisateur Windows. Les dimensions sont
stockées en unités logiques et restent adaptées au changement de DPI. Aucun nom
de fichier, identifiant de document, sélection ou texte de recherche n’y est
conservé. Des préférences absentes ou invalides ramènent aux valeurs par défaut.
Le bouton **Présentation par défaut** rétablit cette présentation sans effacer les
critères de recherche ; **Effacer** agit sur les critères sans modifier le tri.

## Sens des vues et périmètre

Toutes les vues concernent uniquement les projets montés dans A: et résolvent le
même identifiant opaque vers le même fichier canonique. Changer de vue, chercher
ou filtrer ne déplace, ne télécharge et ne copie aucun document.

- **Par type** utilise le champ métier `doc_type`, jamais l’extension PDF/DWG/IFC.
  Le format de fichier reste indiqué séparément dans les propriétés.
- **À classer** regroupe les documents montés dont les métadonnées vérifiées
  indiquent une phase ou un type absent. Une métadonnée indisponible n’est pas
  interprétée comme un classement manquant. Les documents sans projet, non montés
  dans A:, restent accessibles dans ArchiOffice et ne sont pas ajoutés ici.
- **Hors ligne** montre les fichiers dont CFAPI indique que tout le contenu est
  déjà sur le poste, ainsi que les fichiers locaux issus d’un enregistrement
  autorisé. La mesure n’ouvre que les attributs et les informations du placeholder ;
  elle n’hydrate pas le fichier. C’est une observation de disponibilité, pas une
  commande d’épinglage ni une garantie contre une éviction ultérieure par Windows.
- **Conflits** utilise l’état `conflict` de la file d’envoi existante. Un état
  indisponible n’est ni un conflit ni une preuve de synchronisation.

Les vues signalent les états inconnus. Les critères et la sélection survivent aux
actualisations dans le même cabinet ; un changement d’identité remet la recherche,
les filtres et la sélection à zéro. Les regroupements et filtres sont locaux à la
vue, sans nouvelle racine CFAPI ni second moteur de synchronisation.

## Séparation des responsabilités

Le composant COM ne fait aucun appel HTTP. Des tâches natives en arrière-plan dialoguent avec un pipe local aléatoire et authentifié par un secret éphémère ; les E/S sont bornées à vingt secondes pour les aperçus, douze secondes pour les versions et cinq secondes pour les autres demandes. Les jetons cloud restent dans le client. Les messages Explorer contiennent exclusivement des identifiants et des métadonnées d’affichage.

Le broker vérifie l’identité utilisateur/cabinet/poste, l’activation du montage et la génération du catalogue. Il refuse les chemins fournis par le demandeur, les liens symboliques, les types dangereux et les ouvertures après déconnexion de la requête. Les actions recontrôlent l’identité juste avant leur effet ; le prochain rafraîchissement vide une vue dont l’accès est refusé. Les autorisations hors ligne existantes gardent leur durée de validité.

## Compilation et enregistrement

```powershell
cmake -S native/windows-shell -B native/windows-shell/build -A x64 -DSHELL_BUILD_ID=dev
cmake --build native/windows-shell/build --config Release
$control = "native/windows-shell/build/Release/archioffice-shell-control.exe"
& $control --register # HKCU, développement uniquement
& $control --open
& $control --unregister
```

L’installateur enregistre le CLSID sous HKLM après installation du runtime VC++. Il n’altère aucune autre extension et refuse un CLSID occupé par un tiers. La désinstallation ne supprime que son propre enregistrement pointant sur sa propre DLL. Le nom de DLL contient l’identifiant de compilation pour éviter d’écraser un module chargé par Explorer. Une fenêtre Explorer existante peut conserver l’ancienne DLL jusqu’à sa fermeture ; aucun arrêt forcé d’Explorer n’est effectué.

## Validation

`tests/driveWindowsShell.test.ts` vérifie les références, l’enrichissement, le refus d’identité/génération, le fichier canonique et le protocole. `tests/driveWindowsMulti.test.ts` vérifie les snapshots du véritable contrôleur de montage.

Sur Windows, `node native/windows-shell/smoke.mjs` instancie la vraie classe COM dans un hôte IShellBrowser, exerce les contrôles Win32 et le broker livré avec des fichiers synthétiques, capture `build/shell-prototype.png`, ouvre le fichier canonique, appelle le lien applicatif, invalide l’identité et vérifie la libération COM. Les contrôles reçoivent des noms accessibles MSAA ; le test vérifie ces noms et le parcours Tab/Maj+Tab. Il capture aussi une fenêtre étroite et simule un changement à 150 % pour vérifier les dimensions. Le maintien d’une branche repliée après un catalogue inchangé est vérifié. L’enregistrement est répété puis retiré. Le workflow Windows conserve DLL, outil et capture ; le workflow installateur produit le NSIS de test. Le test d’hôte exerce aussi les six vues, la recherche insensible aux accents,
les filtres combinés, le cas sans résultat, l’effacement des critères et l’ouverture
du même fichier depuis plusieurs classements. Le test du courtier CFAPI mesure la
disponibilité avant/après hydratation. Le test vérifie aussi le tri numérique (versions 2/12), la sélection après tri,
Ctrl+A sans ouverture ambiguë, la conservation après actualisation, le déplacement
des colonnes et le rechargement des préférences après recréation de la vue.
Le test d’hôte ne remplace pas une recette
dans explorer.exe sur un poste réel.

## Limites de cette étape

Pas de recherche dans le contenu des fichiers ni déploiement automatique de la version de test. L’arbre métier appartient à la vue personnalisée ; le volet Windows standard n’énumère pas les projets comme des sous-dossiers Shell. Les limites existantes du montage restent dix projets et cinquante Mio par fichier, sans quota de nombre de documents.

## Réception Windows 11 avec les documents du cabinet

Dans VIP-TC monté dans A:, retrouver un même document depuis Par projet, Par phase
et Par type, puis vérifier que les trois ouvertures ciblent le même fichier.
Combiner une phase, un type, un statut et deux mots de recherche ; tester un
résultat vide puis Effacer. Actualiser sans perdre les critères. Vérifier les
vues À classer/Hors ligne/Conflits contre les données et la file existantes.
Couper le réseau, changer de cabinet, redimensionner à 780 puis 1280 unités et
parcourir recherche/filtres/arbre/liste/propriétés avec Tab et Maj+Tab.
La résolution des conflits et l’activation explicite du hors-ligne sont décrites
dans les lots 6 et 7 ci-dessous.

Pour le lot 4, vérifier les sept colonnes contre les données ArchiOffice. Trier
les versions et les indices séparément ; déplacer la colonne Version, la
redimensionner, changer de DPI puis fermer et rouvrir la vue. Vérifier le retour
de la présentation et l’ouverture du bon document après le tri. Sélectionner
plusieurs lignes avec Ctrl/Maj, actualiser, puis vérifier que les commandes
d’ouverture restent désactivées jusqu’à la sélection d’un seul document. Changer
de cabinet et vérifier que les préférences et la sélection ne sont pas mélangées.

Pour le lot 5, sélectionner un PDF de VIP-TC et vérifier ses pages, puis une image
et un DWG/IFC/RVT. Comparer les versions au client ArchiOffice. Changer rapidement
de document, filtrer la sélection, couper le réseau puis changer de cabinet :
aucune image ni historique de l’ancienne sélection ne doit rester affiché. Tester
les trois onglets et le clavier en fenêtre étroite. Les essais automatisés utilisent
un PDF de deux pages et une image synthétique avec le vrai moteur de rendu Windows ;
ils ne remplacent pas cette réception sur Windows 11 avec vos fichiers réels.

### Capacité documentaire et stockage de l’agence

Le catalogue, les propriétés, les états de synchronisation et les manifestes de
reconnexion acceptent plus de 100 documents par projet. Les listes distantes sont
parcourues par pages de 100 avec détection des doublons et des cycles ; les lectures
individuelles de métadonnées sont limitées à huit demandes simultanées.

Le nombre de documents n’est pas un quota d’offre. Chaque dépôt et nouvelle version
hébergé par ArchiOffice reste contrôlé par le quota de stockage de l’agence, partagé
avec les autres projets et fichiers métier. Un stockage externe reste soumis à sa
propre capacité et ses refus ne déclenchent aucun repli vers ArchiOffice. Un quota
atteint bloque l’envoi, conserve la copie locale et permet une reprise après
libération ou augmentation de l’espace. Il n’empêche pas de consulter les fichiers
existants. Les versions conservées consomment également du stockage.

Les protections de transport et de mémoire restent distinctes de ce quota : 64 Mio
au plus pour un catalogue JSON/manifeste/trame native, 2 Mio pour une réponse d’aperçu,
50 Mio par fichier et dix projets montés. Dépasser un budget technique refuse un
catalogue entier ; aucun document n’est silencieusement tronqué.

## Lots 6 et 7 : commandes et récupération

L’onglet Actions réunit le classement (phase et type documentaire), la mise à
disposition hors ligne, la conservation d’une copie en conflit, la reprise distante,
la relance d’un envoi bloqué et l’ouverture des copies précédentes. Il travaille
sur une seule sélection ; les références sont résolues contre le manifeste courant,
avec identité utilisateur/cabinet/poste et génération. Le classement relit les droits
et la version puis utilise PATCH desktop avec baseVersion ; les règles du serveur
(archivage, approbation, verrous et permissions) s’appliquent sans exception. Un champ
vide retire la classification correspondante. Le type est un code métier de 60
caractères au plus, comme dans l’API existante. Le classement ne déplace pas la copie
physique de A: ; la mise à jour du catalogue existante adapte ensuite ses dossiers.

La commande hors ligne épingle le fichier CFAPI et lit le contenu canonique pour
terminer son hydratation. Elle ne crée aucune seconde pièce de travail et n’annonce
le succès qu’après lecture complète et vérification de la génération. Un échec laisse
un résultat explicite, sans annoncer que le fichier est disponible.

Les propriétés indiquent les codes contrôlés des blocages (dont stockage plein,
verrou et version concurrente), et l’état d’envoi de la copie de conservation.
La conservation copie l’instantané en conflit dans la file existante à destination
« À classer », avec un lien conflictOf vers l’original. Si le fichier a encore été
retouché, une copie supplémentaire de ces octets récents est envoyée. Les commandes
restent idempotentes et une conservation bloquée peut être relancée par le même geste.

La reprise distante exige que la copie d’origine et les dernières retouches aient
été effectivement acceptées par le serveur. Le client verrouille la lecture du
fichier contre les écritures/replace-saves, compare son SHA-256 à la copie conservée,
revérifie les autres fichiers du projet, puis prépare une nouvelle génération dans
un autre dossier. Le changement du lien du projet et la réconciliation de la file
sont journalisés pour reprise après interruption. L’ancien dossier reste accessible
par « Ouvrir les copies précédentes ». Aucun fichier en conflit n’est écrasé. Une
autre modification locale bloque le changement du projet. Fermer ses fichiers avant
la confirmation ; des applications restées ouvertes peuvent garder un ancien handle.

## Lot 8 : installation et recette

Le NSIS vérifie le résultat du runtime Visual C++ avant l’enregistrement. L’application
ne se lance pas automatiquement à la fin de l’installateur. Le test Windows
installer-smoke.ps1 exerce l’installation silencieuse, une réinstallation, la présence
du renderer et du contrôle natif, l’enregistrement HKLM, puis la désinstallation et
l’absence d’entrées Explorer résiduelles. Un marqueur dans les données locales doit
rester présent après réinstallation et désinstallation. L’ancienne DLL peut rester
chargée dans Explorer jusqu’à fermeture de sa fenêtre ; aucune fermeture forcée n’est
utilisée. Les fichiers locaux de travail ne sont pas supprimés à la désinstallation.

La construction et les tests CI ne constituent pas une publication de version. La
recette finale sur votre poste reste nécessaire : mise à jour depuis votre version
installée, redémarrage réel, fichiers VIP-TC, changements de cabinet, perte de réseau,
droits en lecture seule, quota atteint, sauvegarde concurrente, conservation puis
reprise distante et vérification de la version suivante. Les formats DWG/IFC/RVT
restent ouverts par leurs logiciels ; les aperçus restent PDF et images.
