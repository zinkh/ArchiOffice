# ArchiOffice Drive — prototype Explorer, étape 1

Vue native Windows x64 enregistrée dans **Ce PC → ArchiOffice Drive**, séparée du lecteur A: et du fournisseur CFAPI existant. Le client ArchiOffice doit être ouvert et A: actif. Les projets déjà montés sont les seuls proposés.

## Parcours livré

- Arbre des projets et des phases, liste des documents et propriétés en lecture seule.
- Colonnes Document, Phase, Type de fichier, Indice, Version et Statut. Les champs absents restent indiqués par un tiret.
- Sélection par souris/clavier, ouverture par double-clic/Entrée, F5 ou bouton Actualiser. Les séparateurs sont déplaçables ; le volet de propriétés se masque sous 850 px.
- « Ouvrir » résout un identifiant opaque dans le manifeste actif et ouvre le fichier physique canonique utilisé par A:, sans créer une seconde copie de travail.
- « Ouvrir dans ArchiOffice » ouvre Documents sur le projet et met le document en évidence après vérification de sa présence dans les données chargées.

Le catalogue local est relu toutes les cinq secondes. L’enrichissement métier utilise les API VFS existantes, sans télécharger les fichiers, et se renouvelle au plus une fois par minute. Il ne s’applique qu’à une version identique à celle du manifeste monté. Cette vue ne rafraîchit pas automatiquement les fichiers de A: : la commande existante de mise à jour du catalogue conserve ce rôle.

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

Sur Windows, `node native/windows-shell/smoke.mjs` instancie la vraie classe COM dans un hôte IShellBrowser, exerce les contrôles Win32 et le broker livré avec des fichiers synthétiques, capture `build/shell-prototype.png`, ouvre le fichier canonique, appelle le lien applicatif, invalide l’identité et vérifie la libération COM. L’enregistrement est répété puis retiré. Le workflow Windows conserve DLL, outil et capture ; le workflow installateur produit le NSIS de test. Le test d’hôte ne remplace pas une recette dans explorer.exe sur un poste réel.

## Limites de cette étape

Pas d’aperçu PDF, recherche avancée, édition des propriétés, classement, résolution de conflits ni déploiement automatique de la version de test. L’arbre métier appartient à la vue personnalisée ; le volet Windows standard n’énumère pas les projets comme des sous-dossiers Shell. Les limites existantes du montage restent dix projets, cent fichiers par projet, cinquante Mio par fichier.
