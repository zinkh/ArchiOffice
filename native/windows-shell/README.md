# ArchiOffice Drive : prototype Shell Windows (lots 1 et 2)

Extension COM x64 native avec `IShellFolder`, `IPersistFolder2` et une vue
`IShellView` hébergée par l’Explorateur. Trois volets : navigation, documents,
propriétés. Le lot 2 raccorde les métadonnées métier via le client et l’agent
existants. Aucun serveur web ni fenêtre Electron ne remplace l’Explorateur.

## Installer et ouvrir

Prérequis : Windows 11 x64, client ArchiOffice et lecteur A: activé avec vos
projets réels. Le client de test et le serveur doivent inclure le raccordement
du lot 2 pour afficher les propriétés métier ; avec un client ou serveur antérieur,
la vue locale fonctionne et indique les métadonnées indisponibles. Télécharger l’artefact **ArchiOffice-Drive-Shell-prototype-x64** du
workflow **Windows Shell prototype**, puis extraire tous ses fichiers ensemble.
Dans PowerShell x64, sous le même compte que l’Explorateur, sans élévation :

```powershell
.\install.ps1
explorer.exe 'shell:::{67B0F7BE-5F65-4AEF-9D4B-B133A991D911}'
```

Le script copie la DLL dans un répertoire immuable par empreinte sous
`%LOCALAPPDATA%\ArchiOffice\DriveShellPrototype`, puis enregistre uniquement les
clés HKCU du CLSID et de l’entrée Desktop/NameSpace. L’archive téléchargée peut
ensuite être déplacée sans casser l’entrée. Pas d’enregistrement machine, pas de
modification de A:, des associations de fichiers ou du fournisseur CFAPI.
Une politique Windows peut interdire les extensions non signées : ce prototype
n’est pas encore signé et ne contourne pas les politiques du poste.

La vue n’explore A: que si sa cible correspond au répertoire privé du courtier
courant (`%APPDATA%\ArchiOffice Client\drive-windows-namespaces\<empreinte>`).
Un lecteur A: étranger affiche un état indisponible. Cette vérification de chemin
évite de présenter un lecteur sans rapport ; elle ne remplace pas les contrôles
d’identité et de droits du courtier. Les fichiers déjà hydratés conservent les
règles d’accès locales existantes. Les configurations userData personnalisées
ne sont pas prises en charge par cette première version.

## Commandes du prototype

- Double-clic ou Entrée : entrer dans un dossier ou ouvrir le fichier avec son
  application Windows habituelle, directement au même emplacement A:.
- Retour arrière ou Alt+Haut : dossier parent, sans remonter au-delà de A:.
- F5 : relire la vue locale ; cela **ne renouvelle pas** le catalogue serveur.
- Tab/Maj+Tab : navigation entre les trois volets ; flèches pour les listes.
- Glisser les séparateurs entre les volets pour ajuster leur largeur.
- Propriétés : nom, emplacement, nature, taille et date locale de modification.

Le panneau de droite affiche les propriétés métier réellement disponibles :
projet, nom, phase, type documentaire, indice, statut, autorisation de modification
et date de lecture.
Les champs absents restent « Non renseigné ». Les droits affichés sont une
observation serveur ; les commandes continuent d’appliquer les contrôles existants.
Les vues par phase/type, la recherche et les aperçus PDF/images viennent ensuite.

### Catalogue métier de lecture (lot 2)

Le courtier relit les manifestes des projets actuellement montés, avec contrôle
d’identité et de leur empreinte, sans changer leur format ni leurs chemins.
L’agent interroge les routes desktop existantes avec le cabinet actif. Le serveur
fournit `projectId`, `phase` et `documentType` à partir des documents existants ;
aucune table ou migration n’est ajoutée. Les métadonnées métier et les permissions
restent séparées des métadonnées CFAPI utilisées pour hydrater les fichiers.

Le client écrit atomiquement un fichier `<racine-identité>.shell.json`, **à côté**
de la racine exposée dans A:, jamais à l’intérieur. Il ne contient ni jeton, ni
URL de stockage, ni copie de document. La DLL vérifie la racine, l’empreinte
d’identité, le format et un bail d’affichage de 25 secondes. Le client renouvelle
cette projection environ toutes les dix secondes après contrôle du coffre et
des projets montés ; la vue la relit toutes les cinq secondes. Un changement de
racine recharge la navigation, sans conserver la sélection de l’ancien cabinet.
Une projection expirée ou invalide masque les propriétés métier. Ces délais ne
promettent pas une révocation instantanée des octets déjà hydratés dans A:.

Les métadonnées serveur sont relues au plus une fois par minute et par sélection
de documents. Une panne réseau conserve une observation datée dans un cache
privé par utilisateur/cabinet/appareil/projet/sélection ; elle est marquée ancienne
après une minute. Un refus connu (401/402/403/404) ou une réponse incohérente
invalide les informations métier en cache. Le cache ne permet pas d’activer
Drive sans autorisation locale valide. L’état d’envoi est relu dans la file locale
existante et n’est pas repris d’un ancien état en cache.

Les notions suivantes sont affichées séparément :

- **Indice métier** : valeur `indice` observée dans ArchiOffice.
- **Version du catalogue A:** : version inscrite dans le manifeste de cette
  génération, qui ne change pas implicitement après un envoi.
- **Version distante observée** : dernière version lue sur le serveur. Elle ne
  signifie pas que le fichier de A: a été remplacé.
- **État d’envoi** : état suivi par l’agent. « Dernier envoi accepté » ne garantit
  pas l’absence de retouches locales plus récentes.

Le catalogue distant ne remplace jamais les fichiers, même si la phase, le type,
l’indice ou la version distante changent. Le renouvellement volontaire du
catalogue A: reste le parcours existant. Pas de nouvelles actions documentaires
ni d’écriture depuis l’extension dans ce lot.
La navigation interne n’alimente pas encore l’adresse et l’historique précédent/
suivant de l’Explorateur. Pas de menu contextuel, renommage, suppression, glisser-
déposer, sélection multiple ni miniatures. Les colonnes métier et leur
mémorisation ne font pas partie de ce prototype. Les limites du moteur restent
100 documents par projet, 50 Mio par fichier et dix projets sélectionnés.

## Mettre à jour et désinstaller

Fermer toutes les fenêtres utilisant la vue, puis exécuter `install.ps1` depuis
le nouvel artefact. Le répertoire par empreinte évite d’écraser une DLL encore
chargée. Si une ancienne vue persiste, fermer la session puis la rouvrir.

```powershell
.\install.ps1 -Uninstall
```

La désinstallation retire les deux clés propres au prototype, même si la DLL
est absente. Elle conserve les DLL éventuellement chargées. Après fermeture de
session, le dossier `DriveShellPrototype` peut être supprimé manuellement. Aucun
fichier de travail, cache, catalogue ou mappage A: n’est supprimé. L’extension
est distribuée séparément et reste explicitement activable ; son intégration
au cycle NSIS et aux mises à jour générales appartient au lot 8.

## Compiler et vérifier

Visual Studio Build Tools C++ et Windows SDK, x64 :

```powershell
cmake -S native/windows-shell -B native/windows-shell/build -A x64
cmake --build native/windows-shell/build --config Release
native/windows-shell/build/Release/archioffice-shell-smoke.exe native/windows-shell/build/Release/archioffice-drive-shell.dll
```

Le test natif héberge la véritable DLL et vérifie la fabrique COM, le PIDL,
les trois contrôles, le redimensionnement (640/1200/1920), le clavier et la
libération des objets. Il vérifie aussi le rejet des projections expirées,
étrangères ou malformées, ainsi que la lecture native d’une fixture synthétique
produite par le véritable module de projection Electron. Il ne monte ni ne
modifie A:. La CI Windows vérifie aussi
l’installation utilisateur, l’activation COM enregistrée et la suppression des
clés. Ces tests ne prouvent pas que Windows 11 choisira cette vue dans son
Explorateur ; la réception manuelle ci-dessous reste une condition de passage.

## Réception Windows 11 à remplir sur poste réel

Noter build Windows (`winver`), version client, empreinte DLL, cabinet, projet,
résultat et captures. Ne pas annoncer le jalon validé sans ces observations.

- [ ] A: ouvre toujours les projets avant installation de l’extension.
- [ ] Installer ; une entrée ArchiOffice Drive apparaît dans la navigation.
- [ ] Ouvrir cette entrée et l’URI Shell : trois volets dans Explorer, pas une
      fenêtre séparée. Noter toute substitution par une vue Windows standard.
- [ ] Parcourir VIP-TC, puis son dossier de phase ; sélectionner quelques vrais
      fichiers, vérifier noms, tailles, dates et emplacements contre A:.
- [ ] Comparer phase, type, indice et statut aux données ArchiOffice ; distinguer
      version du catalogue, version distante et état d’envoi.
- [ ] Couper le réseau : métadonnées datées du même cabinet ; aucun état d’envoi
      inventé. Refuser le coffre ou changer de cabinet : propriétés masquées au
      plus tard à l’expiration du bail et à la relecture de la vue.
- [ ] Ouvrir un document, l’enregistrer avec l’édition existante activée ; vérifier
      la nouvelle version et l’état d’envoi **dans ArchiOffice** à ce stade.
- [ ] Tester Entrée, flèches, Tab/Maj+Tab, Retour arrière, Alt+Haut, F5, focus.
- [ ] Redimensionner Explorer, déplacer les séparateurs et changer de DPI/écran.
- [ ] Fermer/réouvrir la vue et plusieurs fenêtres ; Explorer reste stable.
- [ ] A: déconnecté ou occupé par un autre lecteur : état indisponible, pas de
      documents étrangers ; reconnexion puis F5 restaure la vue.
- [ ] Redémarrer Windows : entrée valide ; état d’attente tant que A: n’est pas
      reconnecté par le client existant, puis F5.
- [ ] Mettre à jour le prototype, fermer puis réouvrir la session si nécessaire.
- [ ] Désinstaller, rouvrir Explorer : aucune entrée cassée et A: intact.

La maquette validée n’étant pas disponible dans la demande, la composition suit
uniquement la structure à trois volets explicitement demandée, avec contrôles,
police et couleurs système. La fidélité graphique reste à comparer à la maquette.

Références :
[IShellView](https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishellview),
[Namespace extensions](https://learn.microsoft.com/windows/win32/shell/nse-works),
[Registering namespace extensions](https://learn.microsoft.com/windows/win32/shell/nse-reg).
