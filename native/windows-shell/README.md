# ArchiOffice Drive — navigation documentaire Explorer, lot 3

Vue native Windows x64 enregistrée dans **Ce PC → ArchiOffice Drive**, séparée du lecteur A: et du fournisseur CFAPI existant. Le client ArchiOffice doit être ouvert et A: actif. Les projets déjà montés sont les seuls proposés.

## Parcours livré

- Six vues dans l’arbre : **Par projet**, **Par phase**, **Par type**, **À classer**, **Hors ligne** et **Conflits**.
- Recherche sur nom, projet, phase, type documentaire, format, indice et statut : plusieurs mots se combinent avec ET, sans distinction de casse ni d’accents. Ctrl+F place le focus dans la recherche.
- Filtres projet, phase, type documentaire et statut, combinables entre eux, avec la recherche et la vue choisie. « Effacer » remet tous les critères à zéro. Une valeur disparue du catalogue reste sélectionnée et signalée comme absente, sans élargissement silencieux des résultats.
- Liste et propriétés en lecture seule. Les métadonnées restent liées à la version du manifeste : une observation d’une autre version ne classe pas arbitrairement le fichier monté.
- Colonnes Document, Phase, Type documentaire, Indice, Version et Statut. Les champs absents restent indiqués par un tiret.
- Sélection par souris/clavier, ouverture par double-clic/Entrée, F5 ou bouton Actualiser. Les séparateurs sont déplaçables ; sous 850 unités logiques, le bouton Propriétés permet d’alterner avec la liste des documents. La géométrie, les colonnes et les polices suivent le DPI Windows.
- « Ouvrir » résout un identifiant opaque dans le manifeste actif et ouvre le fichier physique canonique utilisé par A:, sans créer une seconde copie de travail.
- « Ouvrir dans ArchiOffice » ouvre Documents sur le projet et met le document en évidence après vérification de sa présence dans les données chargées.

Le catalogue local est relu toutes les cinq secondes. Une réponse identique ne reconstruit pas la vue ; un changement conserve la sélection, les branches repliées et les positions de défilement. L’enrichissement métier réutilise le cache local isolé par utilisateur/cabinet/appareil/projet du lot 2 et ses API VFS authentifiées, sans télécharger les fichiers. Sa lecture distante se renouvelle au plus une fois par minute. Il ne s’applique qu’à une version identique à celle du manifeste monté. Cette vue ne rafraîchit pas automatiquement les fichiers de A: : la commande existante de mise à jour du catalogue conserve ce rôle.

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

Le composant COM ne fait aucun appel HTTP. Des tâches natives en arrière-plan dialoguent avec un pipe local aléatoire et authentifié par un secret éphémère ; les E/S sont bornées à cinq secondes. Les jetons cloud restent dans le client. Les messages Explorer contiennent exclusivement des identifiants et des métadonnées d’affichage.

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
disponibilité avant/après hydratation. Le test d’hôte ne remplace pas une recette
dans explorer.exe sur un poste réel.

## Limites de cette étape

Pas d’aperçu PDF, recherche dans le contenu des fichiers, édition des propriétés, action de classement, résolution de conflits ni déploiement automatique de la version de test. L’arbre métier appartient à la vue personnalisée ; le volet Windows standard n’énumère pas les projets comme des sous-dossiers Shell. Les limites existantes du montage restent dix projets, cent fichiers par projet, cinquante Mio par fichier.

## Réception avec les documents du cabinet

Dans VIP-TC monté dans A:, retrouver un même document depuis Par projet, Par phase
et Par type, puis vérifier que les trois ouvertures ciblent le même fichier.
Combiner une phase, un type, un statut et deux mots de recherche ; tester un
résultat vide puis Effacer. Actualiser sans perdre les critères. Vérifier les
vues À classer/Hors ligne/Conflits contre les données et la file existantes.
Couper le réseau, changer de cabinet, redimensionner à 780 puis 1280 unités et
parcourir recherche/filtres/arbre/liste/propriétés avec Tab et Maj+Tab.
La résolution des conflits et l’activation explicite du hors-ligne restent les
actions des lots suivants.
