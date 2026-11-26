---
name: archioffice-stockage-fichiers
description: "Stockage des fichiers ArchiOffice : espace externe du cabinet (Nextcloud, kDrive, Google Drive, Dropbox), arborescence lisible et accès à l'Explorateur du client Electron, emplacement des données, synchronisation desktop (Cloud Files, File Provider) et règle CAO. À utiliser dès qu'on touche au stockage des documents et plans, à storeBusinessFile, aux connexions de stockage externe, à l'arborescence locale, ou à /api/desktop/v1."
---

# ArchiOffice : stockage fichiers

> Contenu extrait du CLAUDE.md racine, sans modification.

### Stockage sur l'espace du cabinet

Les documents et les plans d'un cabinet peuvent vivre sur SON espace de
stockage (Nextcloud, kDrive — Google Drive et Dropbox à suivre) plutôt que dans
Supabase Storage, dont les octets sont facturés à l'opérateur et plafonnés par
plan (`storage_mb`, `src/lib/billing.ts`).

**Le périmètre est volontairement étroit** : les buckets `documents` (GED,
versions, visas) et `plans`, les seuls qui pèsent. `logos` reste public par
construction, et `support-attachments` reste chez nous — le superadmin
plateforme doit pouvoir les lire depuis `/admin/support`, ce qu'un drive de
cabinet lui interdirait.

**Une couche de politique, pas une primitive mutée.** `uploadToStorage` /
`deleteFromStorage` (`server.ts`) ne changent ni de signature ni de
comportement : les dix modules de routes hors périmètre les appellent toujours
tels quels. `createBusinessFileStore()`
(`server/externalStorage/storeBusinessFile.ts`) se pose au-dessus et n'est
utilisée que par `documents.ts`, `plans.ts` et `visas.ts`. `AsyncLocalStorage`
ne pouvait pas servir de source du cabinet ici : `server/tenantContext.ts` rend
`null` dès qu'une requête ne porte pas `X-Tenant-Id`, et le mode de panne
aurait été « écrit silencieusement sur Supabase », invisible en test.

**Échec bruyant, jamais de repli silencieux.** Un dépôt qui échoue chez le
fournisseur rend 502 ; se rabattre sur Supabase remplirait précisément le quota
que le cabinet cherche à éviter et laisserait deux fichiers de la même affaire
à deux endroits sans que rien ne l'explique.

**La référence est une URI dans `file_url`** :
`archioffice+external://<fournisseur>/<connexion>/<base64url(identifiant)>?name=`.
Pas de colonnes dédiées : `file_url` circule seule dans quatre tables et une
douzaine de fichiers frontend qui ne passent que `doc.file_url`.
`parseStorageRef()` rend `null` dessus, donc ses deux copies dans
`packages/archioffice-agents` dégradent proprement. La colonne
`storage_backend` existe malgré tout, **uniquement** comme filtre SQL dérivé :
une requête PostgREST ne sait pas analyser une URI, et le quota en a besoin.

**Aucun lien public n'est créé chez le fournisseur.** Élargir le partage d'un
fichier dans le drive du cabinet sans qu'il l'ait demandé n'est pas acceptable.
La lecture passe par un jeton HMAC **sans état**
(`server/externalStorage/externalTicket.ts`, clé dérivée de
`MAIL_ENCRYPTION_KEY`) : `openSignedUrl()` ouvre par `window.open()` et
`<SignedImage>` pose l'URL dans un `src`, deux navigations sans JWT possible, et
deux requêtes successives atterrissent sur des conteneurs différents — une Map
par processus rejouerait le piège documenté dans `server/oauthState.ts`. Quand
un fournisseur sait produire un lien temporaire propre au porteur (Dropbox), la
route redirige en 302 ; sinon elle streame, **en retransmettant les requêtes
`Range`** — pdf.js (`PlanAnnotator`) découpe les gros plans, les ignorer
casserait l'affichage sans rien dire.

**L'arborescence est `<racine>/<code affaire> - <nom affaire>/<phase>`**, avec
`Plans` et `VISA` comme sous-dossiers pour les deux autres écritures du
périmètre. Les phases sont celles que l'écran Documents affiche déjà, donc
l'architecte retrouve dans son drive le classement qu'il voit dans
l'application. `external_storage_folders` mémorise chaque niveau (index unique
`(connection_id, folder_key)`, donc upsert idempotent) : sans ce cache, chaque
dépôt coûterait deux à six appels d'API. Un dossier renommé ou supprimé côté
drive fait échouer le dépôt en `ExternalFolderMissingError` ; on oublie alors le
sous-arbre et on rejoue **une** fois. Conséquence assumée : un dossier renommé à
la main voit réapparaître un dossier au nom d'origine à côté du sien — on ne
poursuit pas les renommages. Les fichiers déjà déposés ne bougent pas, étant
référencés par leur propre identifiant, SAUF au classement d'un document (glisser-déposer vers une autre
affaire ou phase, `PUT /api/documents/:id` avec `project_id` / `phase`) : `relocateBusinessFile`
(`storeBusinessFile.ts`) appelle `moveFile` de l'adaptateur (WebDAV `MOVE`, Drive `addParents`/`removeParents`,
Dropbox `move_v2`), puis la route enregistre la nouvelle `file_url` (et celle de la version courante : en WebDAV
l'identifiant est le chemin et change). Si le fournisseur refuse, la route répond en erreur et rien ne change en
base ; si l'écriture en base échoue après le déplacement, le fichier est remis en place. Les anciennes versions,
les fichiers Supabase et l'arborescence locale du poste Electron ne sont pas déplacés. Non vérifié contre un
vrai Nextcloud, Drive ou Dropbox. Tests : `tests/externalStorageRelocate.test.ts`, `tests/webdavHardening.test.ts`.

**Ne pas réutiliser `sanitizeFilename` pour les noms de dossiers** : sa règle
`[^a-zA-Z0-9._-] → _` transforme « Général » en « G_n_ral ». Acceptable pour un
chemin d'objet Supabase que personne ne regarde, pas pour une arborescence que
l'architecte ouvre dans son propre Drive. D'où
`server/externalStorage/folderNaming.ts`.

**Le quota cesse de compter ces octets, des deux côtés à la fois** :
`checkStorageQuota` (le plafond) et `GET /api/billing/status` (la jauge) passent
tous deux par `tenantSupabaseStorageBytes()`. Les filtrer d'un seul côté
donnerait un écran qui monte sans jamais bloquer. `checkQuota(…, 'documents')`
ne bouge pas : c'est un plafond sur le NOMBRE de documents, un élément de
l'offre, pas un coût d'hébergement.

**Déconnecter et révoquer sont deux gestes distincts.** Une référence n'est
résoluble que tant que la connexion existe ET porte de quoi s'authentifier.
`POST /api/external-storage/:id/disable` arrête les écritures en gardant les
identifiants ; `DELETE /api/external-storage/:id` les efface **sans supprimer
la ligne**, et l'écran avertit alors que les fichiers déjà déposés ne seront
plus consultables depuis ArchiOffice. La ligne n'est supprimée que par la
cascade de `tenantPurge.ts`, à la fermeture du cabinet — qui **ne supprime
jamais** dans le drive du cabinet : ce sont ses fichiers, sur son espace.

**Google Drive demande le scope `drive.file`, pas `drive`.** `drive` est un
*restricted scope* chez Google : il impose une évaluation de sécurité CASA et un
audit annuel à toute application publiée. `drive.file` n'est pas restreint et
donne exactement ce qu'il faut — créer des dossiers et des fichiers, et gérer
ceux qu'on a créés. La contrepartie, assumée et dite dans l'UI : l'application
ne VOIT pas ce qu'elle n'a pas créé, donc la racine est créée par ArchiOffice
(son identifiant est mémorisé sur la connexion) et on ne peut pas pointer un
dossier existant choisi à la main. C'est précisément le cache de dossiers qui
rend ce scope exploitable. Deux paramètres sont obligatoires sur CHAQUE appel
(`supportsAllDrives`, `includeItemsFromAllDrives`) sous peine de 404 dès qu'un
cabinet travaille sur un Drive partagé, l'apostrophe doit être échappée dans une
requête `q` (« L'Atelier » est un nom d'affaire courant), et la suppression est
une mise à la corbeille (`PATCH {trashed:true}`), jamais une destruction.

**Dropbox : deux pièges, tous deux silencieux.** `token_access_type=offline`
sur l'URL de consentement, sans quoi aucun refresh token n'est délivré et la
connexion meurt au bout de quatre heures sans rien annoncer. Et l'en-tête
`Dropbox-API-Arg` doit être en **ASCII strict** : il porte le chemin du fichier,
donc le nom de l'affaire, et un « Réhabilitation Château » non échappé fait
rejeter la requête en 400 — d'où `toAsciiJsonHeader()`. L'identifiant mémorisé
est l'`id:xxxxxxx` renvoyé à l'écriture et non le chemin, pour qu'un fichier
déplacé à la main dans le Dropbox du cabinet reste consultable. C'est aussi le
seul des trois fournisseurs à produire un lien de lecture temporaire (quatre
heures, propre au porteur, sans élargir le partage) : la route de lecture y
redirige en 302 plutôt que de streamer.

**Trois effets de bord traités, et qui ne doivent pas être défaits.** L'export
ZIP RGPD (`server/tenantExport.ts`) verse les fichiers externes sous
`fichiers/externe/` et nomme dans `manifest.json` ceux qu'il n'a pas pu lire :
un export à motif légal ne peut pas mentir par omission, et il ne parcourait
jusqu'ici que les buckets Supabase. `tenantPurge.ts` ne supprime **jamais** dans
l'espace du cabinet — ces fichiers vivent sur un compte qui lui appartient, et
l'effacement RGPD porte sur les données que NOUS détenons ; seule disparaît la
connexion, donc la capacité à les rouvrir. Et `external_storage_connections`
n'entre **pas** dans `SYNC_TABLES` : propager des identifiants chiffrés vers une
installation locale dont la `MAIL_ENCRYPTION_KEY` diffère serait à la fois
inutile et un essaimage de secrets.

**Les agents IA lisent ces fichiers par un pont, pas par un import.** Le package
`@zinkh/archioffice-agents` n'importe rien depuis `server/` ; `server.ts` lui
dépose donc un lecteur au démarrage (`setExternalFileReader`), sur le patron de
`initOAuthStateStore()`. Sans ce pont, un agent rapporterait simplement qu'une
pièce jointe est vide dès qu'un cabinet a branché son espace.

**Nextcloud et kDrive partagent un seul adaptateur WebDAV**
(`server/externalStorage/providers/webdav.ts`, `MKCOL`/`PROPFIND`/`PUT`/`GET`/
`DELETE` en `fetch`, aucune dépendance npm ajoutée). Ils ne diffèrent que par
l'URL de base saisie par le cabinet. Trois pièges traités : le chemin s'encode
**segment par segment** (un `encodeURIComponent` global détruirait les barres
obliques), `MKCOL` répondant 405 vaut succès (la collection existe déjà), et un
`PUT` écrase sans prévenir — d'où la recherche d'un nom libre avant dépôt.
C'est une URL fournie par le cabinet, donc l'adaptateur ne
passe plus par `fetch` mais par `pinnedRequest` (`server/externalStorage/pinnedHttp.ts`, `https.request`
sans dépendance), qui applique le garde SSRF (`resolvePublicUrl`, `server/ssrfGuard.ts`) à l'enregistrement
**et** à chaque appel, avec trois protections : **HTTPS obligatoire** (le mot de passe d'application part en
Basic Auth ; `http://` est refusé en 400 à la saisie comme à l'usage), **connexion épinglée** sur l'adresse
publique validée (une seconde résolution DNS hostile ne peut plus viser une adresse interne ; le certificat
reste vérifié contre le nom d'hôte) et **redirections suivies à la main**, de même origine uniquement (ni autre
hôte, ni retour en http, donc l'en-tête Authorization ne part jamais ailleurs), trois sauts au plus. Le garde
reconnaît aussi les adresses IPv4 encapsulées en IPv6 sous leur forme hexadécimale (`::ffff:7f00:1`).
Après chaque dépôt, `verifyUploadedSize` relit la taille annoncée par le serveur (PROPFIND, `getcontentlength`) :
une divergence supprime le fichier et fait échouer le dépôt ; une taille absente ou une vérification en échec ne
bloquent rien. `WEBDAV_VERIFY_UPLOAD=off` coupe ce contrôle pour un serveur dont la taille annoncée diffère de
celle déposée (chiffrement côté serveur). Conseil de mise en service : créer le mot de passe d'application
pour un compte dédié, limité au dossier racine d'ArchiOffice. Un serveur WebDAV sur le réseau interne (NAS) reste
refusé par ce garde : pour un NAS, voir le projet de fournisseur « dossier local » du client Electron.
Tests : `tests/webdavHardening.test.ts`, `tests/externalStorageConnections.test.ts`.

### Arborescence lisible des fichiers (client Electron) et accès à l'Explorateur

En mode hors ligne (`OFFLINE_MODE=true`, toujours le cas dans Electron), les fichiers de la GED et des
plans ne sont plus rangés sous un nom aléatoire mais dans une arborescence que l'on ouvre à la main dans
l'Explorateur, sur le dossier de stockage choisi au premier lancement (typiquement un partage NAS commun à
plusieurs postes) : `<bucket>/<cabinet>/<code - affaire>/<phase>/<fichier>`.

- **Chemins** : `server/externalStorage/localTreePath.ts` (`readableObjectPath`, pur, testé). Accents repliés
  en ASCII (« Réhabilitation » devient « Rehabilitation ») : l'export vers le cloud (`initialExport`) ignore
  sans bruit les clés non ASCII. Longueurs bornées (dossier 50, fichier 80, chemin 190) pour la limite de 260
  caractères de Windows. Le premier segment reste le `tenantId` : c'est la frontière d'autorisation.
- **Pas d'écrasement silencieux** : le gateway (`server/offlineGateway.ts`) honore `x-upsert: false` par une
  écriture exclusive (`wx`) et répond 409. `storeBusinessFile` (`storeInReadableTree`) réessaie avec un suffixe
  numéroté (50 tentatives) sur ce seul conflit.
- **Références** : `objectPathFromRef` (`server/storagePaths.ts`) décode l'URL stockée ; `deleteFromStorage`
  l'utilise (un chemin encodé ne se supprimait plus).
- **Migration des fichiers existants** (`server/storageTreeMigration.ts`, routes
  `server/routes/desktopStorage.ts`, carte `StorageTreeMigrationCard.tsx` dans Réglages, administrateurs) :
  simuler, copier (jamais déplacer, empreinte sha256 vérifiée, reprise possible, journal
  `.archioffice-migration.json` à côté du dossier de stockage), puis repointer `file_url`. Les anciens
  fichiers ne sont supprimés que par un geste séparé (simulation puis confirmation), à faire quand tous les
  postes sont à jour : un poste resté sur l'ancienne version a encore besoin des anciens chemins. Les routes
  répondent 404 hors client de bureau.
- **Explorateur et ouverture** : boutons « Afficher dans l'Explorateur » et « Ouvrir » (`Documents.tsx`,
  `src/lib/localFiles.ts`). Le renderer ne fournit jamais de chemin de disque : le serveur
  (`GET /api/storage/local-file`) vérifie l'appartenance au cabinet et rend une clé `{bucket, path}` ; le
  processus principal (`electron/fileAccess.cjs`, IPC `desktop:reveal-file` / `desktop:open-file`) reconstruit
  le chemin (realpath, rejet des liens symboliques et de `..`) et n'ouvre qu'une liste blanche d'extensions.
- **Limites connues** : seuls `documents` et `plans` sont rangés ; `meeting-photos` et autres buckets, ainsi que
  `receptions.document_url`, ne sont pas migrés ; boutons seulement dans `Documents.tsx`. Comportement sous
  Windows/NAS réel et acceptation par Supabase Storage des noms avec espaces non vérifiés ici.
- Tests : `localTreePath`, `readableTreeStorage`, `storageTreeMigration`, `desktopStorageRoutes`,
  `electronFileAccess`, `src/lib/__tests__/localFiles.test.ts`.

### Emplacement des données (client Electron)

Historiquement, la base Postgres embarquée (`pgdata/`) et les fichiers
uploadés (`storage/<bucket>/…`) vivaient sous un seul dossier imposé par le
système (`app.getPath('userData')`). `electron/dataLocation.cjs` laisse
choisir les deux **séparément**, typiquement pour mettre les documents sur un
disque réseau ou un dossier partagé pendant que la base reste locale.

**Le choix n'est proposé qu'une seule fois, au tout premier lancement**,
avant que la moindre donnée n'existe — le déplacer ensuite reviendrait à
migrer un Postgres déjà peuplé (arrêt propre, copie intégrale vérifiée,
reprise), volontairement hors périmètre. Un poste déjà installé avant
l'existence de ce choix (repéré par un `pgdata/` déjà présent à l'emplacement
historique) n'est donc jamais reposé la question : `resolveDataLocation()`
lui réécrit silencieusement `data-location.json` sur son emplacement
d'origine. Ce fichier-pointeur reste, lui, toujours à l'emplacement standard
du système — il ne contient que deux chemins, rien qui justifie de le
déplacer aussi.

**La base de données doit rester sur un disque local.** Un Postgres dont le
répertoire de données vit dans un dossier synchronisé (Drive, Dropbox,
OneDrive…) ou sur un partage réseau s'expose à des écritures partielles et
des verrous que ces systèmes ne respectent pas comme un disque local — un
risque réel de base corrompue. Le dialogue de premier lancement le dit
explicitement ; rien ne l'empêche techniquement (détecter un lecteur réseau
de façon fiable, tous OS confondus, n'a pas de solution simple), c'est
délibéré : mieux vaut prévenir que bloquer sur une détection qui se
tromperait dans un sens ou dans l'autre. Les documents, eux, n'ont pas cette
contrainte : ce sont de simples fichiers.

`server/offlineAccount.ts::storageDir()` lit `OFFLINE_STORAGE_DIR`
(repli sur `OFFLINE_DATA_DIR/storage` si absent — rétrocompatible avec un
poste installé avant cette variable) ; tout le reste (compte local, secret
JWT, état du lien cloud) continue de vivre sous `OFFLINE_DATA_DIR` via
`getDataDir()`, inchangé. `server/offlineGateway.ts`'s `/storage/v1` passe
uniformément par `storageDir(bucket)`, donc ce seul changement couvre tous
les buckets (documents, logos, photos de réunion, CV…) sans les lister un
par un.

Les chemins choisis sont lus par le renderer via le pont IPC
(`src/lib/desktopBridge.ts`, affiché en lecture seule dans Réglages), jamais
via l'API HTTP : ce sont des chemins du poste, pas une donnée du cabinet.
`openDataFolder(kind)` n'accepte que `'db' | 'storage'`, jamais un chemin
fourni par le renderer — c'est `main.cjs` qui résout le chemin réel depuis sa
propre variable interne, pour ne jamais ouvrir un chemin arbitraire à la
demande du renderer.

### Synchronisation desktop (Explorateur Windows, Finder macOS) : socle serveur

Les documents d'affaire sont exposés à deux clients natifs à venir (Cloud Files API sous Windows,
File Provider sous macOS) par `/api/desktop/v1` (`server/routes/desktopSync.ts`, `server/desktop/*`).
Le contrat complet, ses écarts avec le code d'origine et ce qui reste à faire sont dans
`docs/desktop-sync-contract.md`. Migration `supabase/migrate_desktop_sync.sql` (hors `SYNC_TABLES`) ;
une instance non migrée répond 503 `DESKTOP_SYNC_UNAVAILABLE` sur ce préfixe seulement.

- **Jeton d'appareil `ds_at_…`**, rattaché à la PERSONNE (`desktop_devices`, SHA-256 seul stocké, rendu une fois,
  90 jours glissants, révocable). Le middleware `/api` de `server.ts` ne le laisse atteindre QUE `/api/desktop/v1`
  (403 `DEVICE_SCOPE` ailleurs : à ne pas aligner sur `mcp_at_`, qui ouvre toute l'API) et exige `X-Tenant-Id`,
  revérifié contre les adhésions (sauf `/roots` et `/devices`). Un appareil n'en enregistre pas un autre.
- **Règle CAO : les octets d'un fichier CAO, BIM ou 3D ne vont jamais dans Supabase Storage.**
  `src/lib/cadFiles.ts` (`CAD_EXTENSIONS`, liste unique) ; `server/desktop/uploads.ts` répond 409
  `EXTERNAL_STORAGE_REQUIRED` à l'ouverture d'un dépôt, le revérifie à la fin (le dépôt peut durer des heures) et
  `PATCH` refuse de renommer un fichier Supabase en `.dwg`. Pas de repli : un espace externe en panne fait échouer
  le dépôt. Mode hors ligne (`OFFLINE_MODE`) exempté, les octets restant sur le poste. **Appliquée aussi au web** : la
  branche Supabase de `storeBusinessFile` (documents, plans, visas, DOE) refuse un CAO en 409
  `EXTERNAL_STORAGE_REQUIRED` avant le quota (`tests/cadRuleDocuments.test.ts`). Le mode de verrouillage se règle
  dans Réglages > Cabinet (`settings.desktop_lock_mode`, `PUT /api/settings` valide `off`, `advisory`, `enforced`).
  `tests/desktopSyncUploads.test.ts` compte les écritures vers Supabase Storage ; retirer la règle fait échouer 11 tests.
- **Version technique et indice de diffusion sont deux choses.** Un dépôt crée `version + 1` et laisse l'indice
  (`A`, `B`...) intact ; il n'avance que sur demande (`bumpIndice`, `POST /nodes/:id/bump-indice`). L'ancien
  `PUT /api/documents/:id` fait avancer l'indice à CHAQUE fichier envoyé : un enregistrement automatique de Word
  y brûlerait une lettre.
- **Concurrence** : `baseVersion` obligatoire pour modifier un document existant ; `409 VERSION_CONFLICT` rend la
  version courante et le nœud. À la fin d'un dépôt la mise à jour est CONDITIONNELLE sur la version lue, et le fichier
  déjà stocké est retiré si elle échoue. Le client dépose son fichier en copie `conflit` (`conflict_of`), le serveur
  ne fusionne jamais.
- **Journal de changements écrit par des déclencheurs SQL**, pas par les routes : plusieurs chemins écrivent dans
  `documents` (dépôts, DOE, agents, MCP, migration de stockage). `desktop_changes.tenant_id` n'a volontairement PAS de
  clé étrangère (la suppression en cascade d'un cabinet déclenche ces écritures et échouerait) ; `tenantPurge.ts`
  nettoie APRÈS la suppression du cabinet. Le curseur est un `seq` ; `desktop_changes_prune` relève un plancher
  (`desktop_sync_state`) et un curseur plus ancien reçoit 410 `CURSOR_EXPIRED`. L'événement porte l'ÉTAT courant : un
  `upsert` dont le document a disparu est rendu comme `delete`. Verrou et contenu sont des natures distinctes à la
  compaction, sinon un `lock` masquerait un `upsert` récent.
- **Verrous** (`settings.desktop_lock_mode` : `off`, `advisory` par défaut, `enforced`) : le verrou d'un autre bloque
  (423) seulement en `enforced`. Huit heures sans renouvellement, reprise d'un verrou expiré par mise à jour
  conditionnelle, rupture réservée aux administrateurs et managers. Chaque requête de `locks.ts` porte `tenant_id`.
- **Suppression logique** (`documents.deleted_at`) pour les appareils : jamais de `DELETE` définitif, rôles `admin`,
  `manager`, `pm` comme sur l'écran. Les dossiers (affaire, phase) se déduisent des documents, on n'en crée pas.
- **Arborescence calculée par le serveur** (`server/desktop/nodes.ts`, mêmes chemins que le stockage externe) : le
  client ne calcule aucun chemin. Les noms sont valides pour Windows et macOS (`safeNodeName`) et uniques par dossier
  sans tenir compte de la casse (`uniqueSiblingNames`, suffixe ` (2)`). Un renommage ou un changement de phase ne
  déplace PAS le fichier chez le fournisseur (WebDAV : l'identifiant est le chemin relatif).
- **Dépôt par morceaux** sur le disque temporaire du serveur (`DESKTOP_UPLOAD_DIR`, 24 h, purge opportuniste),
  `complete` idempotent ; limite actuelle de 200 Mo (`DESKTOP_MAX_UPLOAD_MB`) parce que `storeBusinessFile` exige un
  `Buffer`.
- **Tests** : `tests/desktopSync{Devices,Routes,Uploads}.test.ts`, `src/lib/__tests__/{cadFiles,desktopNodes}.test.ts`
  et `tests/desktopSyncMigration.pg.test.ts` (déclencheurs, purge, cascade, rejeu ; ignoré sans `PGHOST`). Le faux
  Supabase est partagé par fichier et les identifiants se répètent d'un test à l'autre : relire une ligne par
  `(tenant_id, id)`, jamais par `id` seul.
