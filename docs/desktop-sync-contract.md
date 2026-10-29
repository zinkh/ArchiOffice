# Contrat d'API de synchronisation desktop (Windows et macOS)

Statut : **le socle serveur est implémenté** (section 17) ; les clients natifs Windows et macOS ne le sont pas. Ce document fixe l'interface entre le serveur ArchiOffice et les deux composants natifs qui exposent les documents dans l'Explorateur Windows (Cloud Files API) et dans le Finder (File Provider). Le même contrat sert aux deux systèmes : seul le client natif diffère.

Il remplace les hypothèses des échanges préliminaires par ce que le code actuel fait réellement (section 2).

## 1. Périmètre

- **Inclus (v1)** : les documents d'affaire (`documents` avec `resource_type = 'projects'`), rangés `<cabinet>/<code - affaire>/<phase>/<fichier>`.
- **Exclus (v1)** : pièces jointes d'autres fiches (permis, devis, appels d'offres...), bibliothèques d'agents, bibliothèque du cabinet, plans annotés (bucket `plans`), photos de réunion.
- **Hors contrat** : validation métier (visas, DOE), diffusion, analyse par agents. Elles restent dans l'application.
- **Un cabinet à la fois par connexion** : l'en-tête `X-Tenant-Id` désigne le cabinet, comme pour le reste de l'API. Chaque cabinet est une racine distincte côté client (un domaine File Provider ou une racine de synchronisation par cabinet).

## 2. Constats sur l'existant (à connaître avant d'implémenter)

Relevés dans `server/routes/documents.ts`, `server/documentUpload.ts`, `server/routes/storageAccess.ts` et `supabase/schema.sql`.

| Constat | Conséquence pour le contrat |
|---|---|
| Les versions sont `documents.version` (entier) + lignes de `document_versions`. **`parent_id` n'est pas un mécanisme de version** (il sert aux plans et aux marchés). | Le contrat s'appuie sur `version`, pas sur `parent_id`. |
| `PUT /api/documents/:id` avec fichier fait **toujours avancer l'indice** (`A`, `B`...) : `charCode + 1`, sans borne après `Z`. | Une sauvegarde automatique de Word créerait un indice par enregistrement. Le contrat sépare **version technique** et **indice de diffusion** : l'indice n'avance que sur demande explicite (`bumpIndice`). |
| Aucune concurrence : `PUT` n'attend pas de version de base. Le dernier écrivain gagne. | Ajout de `If-Match` / `baseVersion` et d'une réponse 409. |
| Aucun verrou de document. | Table `document_locks` (section 7). |
| `GET /api/documents` rend **tous les documents** du cabinet, sans pagination ni date de modification. Pas de colonne `updated_at`. | Ajout d'un journal de changements avec curseur (section 6). |
| Upload **multipart en mémoire, 50 Mo maximum** (`multer.memoryStorage`, `fileSize: 50 Mo`). | Impossible pour des DWG ou RVT lourds. Ajout d'un **dépôt par morceaux reprenable** (section 8). `storeBusinessFile` prend un `Buffer` : un flux sera nécessaire pour dépasser la mémoire (risque d'implémentation, section 12). |
| Types dangereux refusés (`exe`, `html`, `svg`, `js`...) par extension, MIME et contenu. | La même règle s'applique au dépôt par morceaux, sans exception pour les clients desktop. |
| Suppression : `DELETE` **définitive**, réservée à `admin`, `manager`, `pm`. | Un utilisateur qui supprime dans l'Explorateur ne doit jamais déclencher une suppression définitive : suppression logique (corbeille) pour les jetons d'appareil. |
| Pas de droit par affaire : tout membre du cabinet lit tous les documents (commentaire de `documents.ts`). | Le contrat expose des `permissions` par nœud mais ne promet pas plus que le serveur ne sait vérifier. |
| Lecture : `GET /api/storage/signed-url?url=` puis, pour un drive externe, `GET /api/storage/external/:ticket` (jeton HMAC, `Range` retransmis). | Réutilisé tel quel pour le téléchargement (section 5). |
| Affaire archivée : écritures refusées en 409 `PROJECT_ARCHIVED` (`archivedProjectGuard`). | Les nœuds d'une affaire archivée sont en lecture seule (`readOnlyReason: "archived"`). |
| Jetons non-JWT déjà connus du middleware `/api` : `mcp_at_`, `tg_at_`, `mail_at_`. | Un quatrième préfixe `ds_at_` pour les appareils (section 3). |
| Le quota de documents s'applique à la création (`checkQuota`). | Réponse 503 neutre, comme pour les dépôts publics. |
| **Où partent les octets** (`storeBusinessFile.ts`) : avec un espace externe actif, uniquement sur cet espace (échec en 502, jamais de repli sur Supabase) ; **sans espace externe actif, dans Supabase Storage**. Aucune règle ne traite le CAO à part. | **Rien ne garantit aujourd'hui que le CAO reste hors de Supabase.** Le contrat l'impose pour les clients desktop (section 8.4). |
| Les métadonnées (nom, taille, version, chemin) restent dans la base Supabase, quel que soit l'endroit où sont les octets. | La règle CAO porte sur les **octets**, pas sur les lignes de la base. |
| Adaptateur WebDAV (Nextcloud et kDrive) : dépôt par PUT unique avec le fichier entier en mémoire, identifiant = **chemin relatif**, pas de lien temporaire, suffixe ` (2)` si le nom existe. | Voir « Stockage externe : WebDAV, Nextcloud et kDrive » (section 12). |

## 3. Conventions

- **Préfixe** : `/api/desktop/v1`. Un changement incompatible crée `/v2`. Le client envoie `X-Client: archioffice-desktop/<plateforme>/<version>`, le serveur peut répondre `426 CLIENT_TOO_OLD` avec la version minimale.
- **Authentification** : jeton d'appareil `ds_at_<aléatoire>`, en-tête `Authorization: Bearer`. Le client natif ne détient jamais de JWT Supabase. Voir 3.1.
- **Cabinet** : `X-Tenant-Id` obligatoire, validé contre les adhésions (`403 TENANT_NOT_MEMBER` sinon), comme le reste de l'API.
- **Format** : JSON UTF-8, noms en `camelCase`, dates ISO 8601 UTC. Erreurs : `{ "error": "texte français", "code": "CODE_STABLE" }` (même forme que l'existant).
- **Identifiants** : opaques et stables. Un renommage ou un déplacement ne change jamais l'identifiant d'un document.
- **Chemins** : **le serveur est la seule source des chemins** (réutilise `buildDocumentFolderPath` et `readableObjectPath`). Le client ne les calcule pas.
- **Limiteurs** : par appareil. En-têtes `Retry-After` sur 429.

### 3.1 Appareils

| Route | Rôle |
|---|---|
| `POST /devices` | Appelée par l'application Electron déjà connectée (avec son JWT), corps `{ name, platform: "windows" \| "macos", appVersion }`. Rend `{ deviceId, token }`. **Le jeton n'est rendu qu'une fois**, seul son SHA-256 est stocké. |
| `GET /devices` | Liste des appareils de la personne (nom, plateforme, dernière activité). |
| `DELETE /devices/:id` | Révoque. Les appels suivants rendent `401 DEVICE_REVOKED` : le client natif efface ses données locales. |

Le jeton est conservé dans le Gestionnaire d'identifiants Windows ou le Trousseau macOS. Durée : 90 jours glissants. Un administrateur peut révoquer les appareils d'une personne depuis l'administration du cabinet. Un jeton ne porte que les droits de la personne, jamais plus (comme les jetons `mcp_at_`).

## 4. Modèle de nœuds

Un **nœud** est un dossier ou un fichier.

```json
{
  "id": "doc:3f2a...",
  "kind": "file",
  "parentId": "phase:p_123:APD",
  "name": "Plan RDC indice B.pdf",
  "path": "26014 - Villa Martin/APD/Plan RDC indice B.pdf",
  "size": 4821937,
  "mimeType": "application/pdf",
  "sha256": "9f86d0...",
  "modifiedAt": "2026-10-24T09:12:44Z",
  "version": 7,
  "indice": "B",
  "etag": "v7",
  "lock": { "by": { "id": "u_1", "name": "S. Zomeno" }, "mine": false, "since": "...", "expiresAt": "..." },
  "permissions": { "read": true, "write": true, "delete": false },
  "readOnlyReason": null,
  "status": "en_cours"
}
```

- `id` : `tenant:<id>` (racine), `prj:<projectId>`, `phase:<projectId>:<code>`, `doc:<documentId>`. Une phase est un dossier virtuel : il n'existe en base que par la valeur de `documents.phase`.
- `sha256` : absent tant que non calculé pour un document ancien ; le serveur le calcule à la demande et le stocke (colonne `content_sha256`).
- `readOnlyReason` : `archived`, `locked`, `role`, `approved` ou `null`.
- `status` : `doc_statut` actuel (`en_cours`, `approuve`, `perime`). Un fichier approuvé n'est pas modifiable depuis le disque (`readOnlyReason: "approved"`), il faut une nouvelle version explicite depuis l'application.
- `lock.mine` vrai : la personne tient le verrou.
- Nom de fichier : le serveur rend un nom **déjà valide pour Windows et macOS** (caractères interdits remplacés, 255 caractères, chemin entier borné pour les 260 caractères Windows) et **unique dans son dossier** (suffixe ` (2)` sinon). Le nom d'origine reste dans `documents.name`.

### 4.1 Routes de lecture

| Route | Rôle |
|---|---|
| `GET /roots` | Cabinets accessibles à la personne : `[{ tenantId, name, slug, role }]`. |
| `GET /nodes/{id}` | Un nœud. |
| `GET /nodes/{id}/children?cursor=&limit=` | Enfants d'un dossier, `limit` 500 par défaut (1000 au plus), `nextCursor` ou `null`. **Jamais l'arbre entier** : un cabinet a des dizaines de milliers de fichiers. |
| `GET /nodes/{id}/versions` | Versions techniques : `[{ version, indice, uploadedAt, uploadedBy, size, sha256, description }]`. |

Seules les affaires visibles du cabinet apparaissent. Une affaire archivée apparaît, en lecture seule.

## 5. Téléchargement (hydratation)

`GET /nodes/{id}/content?version=` :

- Sans `version` : version courante. Avec : une version précise (restauration).
- **`Range` obligatoire côté serveur** (réponse 206). Le serveur retransmet l'en-tête au fournisseur. Les clients natifs demandent des plages (CFAPI `FETCH_DATA`, File Provider `startProvidingItem`).
- Réponse : redirection 302 vers l'URL signée quand le fournisseur sait la produire (Supabase, Dropbox), sinon flux direct. Le jeton signé existant (`externalTicket`) est réutilisé ; **aucun lien public n'est créé chez le fournisseur**.
- En-têtes : `ETag: "v7"`, `Content-Length`, `X-Content-SHA256`.
- Mode hors ligne du poste (`OFFLINE_MODE`) : le serveur local sert les octets depuis le dossier de stockage. Un fichier sur un drive distant répond 503 `NOT_AVAILABLE_OFFLINE`, comme aujourd'hui.

## 6. Journal de changements

Le client natif garde un **curseur** et ne relit jamais l'arbre.

`GET /changes?cursor=&limit=` :

```json
{
  "events": [
    { "seq": 10231, "type": "upsert", "node": { "id": "doc:3f2a...", "...": "..." } },
    { "seq": 10232, "type": "delete", "id": "doc:77c1...", "projectId": "p_123" },
    { "seq": 10233, "type": "lock", "id": "doc:3f2a...", "lock": { "...": "..." } },
    { "seq": 10234, "type": "unlock", "id": "doc:3f2a..." }
  ],
  "nextCursor": "10234",
  "hasMore": false
}
```

- Types : `upsert` (création, nouvelle version, renommage, déplacement, changement de statut ou de permissions), `delete` (y compris corbeille), `lock`, `unlock`, `scope` (une affaire apparaît ou disparaît pour la personne : droits, archivage, suppression).
- **Sans curseur** (premier appel) : renvoie `{ "cursor": "<courant>", "resync": true }` ; le client parcourt alors l'arborescence par `children` pour initialiser, puis lit les changements à partir de ce curseur.
- **Curseur trop ancien** (30 jours de conservation) : `410 CURSOR_EXPIRED` ; le client refait une synchronisation complète.
- Les événements sont **idempotents et ordonnés** par `seq`. Un `upsert` porte l'état complet du nœud.
- **Indication de temps réel** (optionnelle, **pas encore implémentée**) : `GET /events` en flux SSE n'enverrait que `{ "hint": "changes" }`. Le client rappellerait `/changes`. Sans ce flux, un sondage toutes les 60 s suffit (même principe que la file `notification_outbox` des notifications desktop).
- L'écriture dans le journal se fait par **déclencheurs en base** (sur `documents`, `document_versions`, `document_locks`, `project_*`), pas dans le code des routes : plusieurs chemins du serveur modifient `documents` (dépôts, DOE, agents, MCP, migration de stockage).

## 7. Verrous

Le mode est un réglage du cabinet : `settings.desktop_lock_mode` = `off` | `advisory` | `enforced` (défaut `advisory`).

| Mode | Comportement |
|---|---|
| `off` | Aucun verrou. Les conflits se règlent par versions (section 9). |
| `advisory` | Le verrou **signale** : le fichier est affiché « en cours de modification par X ». Un dépôt d'une autre personne reste possible mais produit un conflit visible. |
| `enforced` | Le verrou **bloque** : `423 LOCKED` pour tout dépôt d'une autre personne. |

Routes :

| Route | Rôle |
|---|---|
| `POST /nodes/{id}/lock` | Pose le verrou. `409 ALREADY_LOCKED` (avec le détenteur) s'il est pris. Corps `{ deviceId }`. |
| `POST /nodes/{id}/lock/renew` | Prolonge. Le client le fait toutes les 10 minutes tant que le fichier est ouvert. |
| `DELETE /nodes/{id}/lock` | Libère. Un dépôt réussi par le détenteur ne libère pas seul : la libération est un geste (ou la fermeture du fichier détectée par le client). |
| `DELETE /nodes/{id}/lock?force=true` | Rupture par un administrateur ou un manager. Journalisée dans le journal d'activité ; la notification de la personne (`notifyUsers`) n'est pas encore faite. |

Durée de vie : 8 h sans renouvellement, puis expiration. Un appareil révoqué perd ses verrous. Sous Windows et macOS, un fichier verrouillé par une autre personne est livré **en lecture seule** (attribut de fichier).

## 8. Dépôt (nouvelle version ou création)

Dépôt **par sessions reprenables**, taille maximale configurable (2 Go par défaut), indépendant de la limite multipart de 50 Mo qui reste en vigueur pour l'application web.

### 8.1 Ouvrir

`POST /uploads` :

```json
{
  "target": { "documentId": "3f2a..." },
  "baseVersion": 7,
  "bumpIndice": false,
  "name": "Plan RDC indice B.pdf",
  "size": 4821937,
  "sha256": "9f86d0...",
  "mimeType": "application/pdf",
  "description": "Enregistré depuis le poste",
  "deviceId": "d_9"
}
```

ou, pour un nouveau document :

```json
{
  "target": { "create": { "parentId": "phase:p_123:APD" } },
  "name": "Note de calcul.xlsx", "size": 120331, "sha256": "...", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
```

Réponse `201` : `{ "uploadId": "up_...", "chunkSize": 8388608, "expiresAt": "..." }`.

Contrôles à l'ouverture (avant tout octet) : affaire non archivée (409 `PROJECT_ARCHIVED`), **stockage externe actif pour un fichier CAO (409 `EXTERNAL_STORAGE_REQUIRED`, section 8.4)**, droit d'écriture, verrou (423 `LOCKED` en mode `enforced`), **extension et type refusés** (400 `FILE_TYPE_REFUSED`, mêmes listes que `documentUpload.ts`), quota (503 neutre), `baseVersion` égal à la version courante (409 `VERSION_CONFLICT`, voir 9). Un document approuvé répond 409 `DOCUMENT_APPROVED`.

### 8.2 Envoyer

`PUT /uploads/{uploadId}` avec `Content-Range: bytes 0-8388607/4821937` et corps binaire. `204` si le morceau est accepté. Les morceaux peuvent arriver dans le désordre ; un morceau renvoyé ou qui en recoupe un autre écrase simplement les mêmes octets (les intervalles reçus sont fusionnés). `GET /uploads/{uploadId}` rend `{ received: [[0, 8388607], ...] }` pour reprendre après une coupure. Une session non terminée expire au bout de 24 h et ses morceaux sont purgés.

### 8.3 Terminer

`POST /uploads/{uploadId}/complete` avec `{ "sha256": "..." }` (recontrôle de bout en bout). Le serveur :

1. recompose et vérifie la taille et l'empreinte (`422 CHECKSUM_MISMATCH` sinon) ;
2. **contrôle le contenu** (`looksDangerous`) sur les premiers octets ;
3. stocke par la couche existante (`storeBusinessFile`, qui choisit Supabase ou l'espace du cabinet) ;
4. crée la version : `documents.version + 1`, ligne `document_versions`, `indice` **inchangé sauf `bumpIndice: true`** ;
5. répond `{ node, version, etag }` (nœud complet).

Idempotent : un second `complete` de la même session rend le même résultat. Journal d'activité alimenté comme aujourd'hui (`logActivity`).

### 8.4 Fichiers CAO : stockage externe obligatoire

Les octets d'un fichier CAO, BIM ou 3D **ne sont jamais écrits dans Supabase Storage** par un client desktop.

- **Liste fermée d'extensions** (insensible à la casse), réglée côté serveur et non par le client : `dwg`, `dxf`, `dwt`, `dwf`, `rvt`, `rfa`, `rte`, `ifc`, `ifczip`, `skp`, `pln`, `pla`, `mod`, `dgn`, `vwx`, `3dm`, `rhl`. La liste est une constante unique, partagée avec la règle équivalente de l'interface web (voir plus bas).
- **Contrôle à l'ouverture** (`POST /uploads`, avant tout octet) : si l'extension est dans la liste et que le cabinet n'a **aucun espace externe actif** (`getActiveConnection` vide), le serveur répond **409 `EXTERNAL_STORAGE_REQUIRED`** avec un message qui nomme la cause (« Les fichiers CAO se déposent sur l'espace de stockage de votre cabinet. Branchez-le dans Réglages. »). Rien n'est reçu, rien n'est créé.
- **Pas de repli** : si l'espace externe est actif mais ne répond pas, le dépôt échoue en 502, comme pour les autres fichiers. Il ne bascule jamais sur Supabase.
- **Morceaux en cours** : conservés sur le **disque temporaire du serveur**, purgés à la fin de la session ou à son expiration (24 h). Ils ne passent jamais par Supabase Storage.
- **Mode hors ligne du poste** (`OFFLINE_MODE`) : les octets vont dans le dossier de stockage local ou le NAS du poste, jamais vers un Supabase distant. Le contrôle ne refuse donc pas un dépôt dans ce mode ; la valeur `storage_backend = 'supabase'` y désigne le dossier local, pas le cloud.
- **Nœud côté client** : un fichier CAO dont le dépôt est refusé reste en erreur visible (« espace de stockage requis ») ; il n'est ni supprimé ni envoyé ailleurs.
- **Lecture** : inchangée. Un CAO déjà présent dans Supabase (déposé avant cette règle) reste lisible ; il n'est pas migré automatiquement (voir questions ouvertes).

**Même règle côté interface web** (hors périmètre du contrat, mais même faille) : `POST /api/documents` et `PUT /api/documents/:id` envoient aujourd'hui un CAO dans Supabase quand le cabinet n'a rien branché. La constante d'extensions doit y être appliquée avec le même code d'erreur, sans quoi la garantie « le CAO n'est pas dans Supabase » reste fausse dès qu'un utilisateur passe par l'écran Documents.

### 8.5 Création depuis l'Explorateur

Un fichier déposé dans un dossier d'affaire est créé avec `category` et `phase` **déduits du dossier** et `doc_type` déduit de l'extension. Un fichier déposé à un endroit qui ne permet pas de déduire l'affaire (racine du cabinet) va dans la **zone « À classer »** : dossier virtuel `inbox:<tenantId>`, documents sans affaire, visibles dans l'application pour classement. Aucun formulaire n'est imposé à l'utilisateur.

## 9. Concurrence et conflits

- Chaque nœud porte un `etag` (`v<version>`). Toute écriture porte `baseVersion` (ou `If-Match`).
- `409 VERSION_CONFLICT` répond `{ code, currentVersion, currentNode }`. Le client **ne perd jamais** la modification locale :
  1. il dépose son fichier comme **nouveau document** nommé `<nom> (conflit <prénom> <date>).<ext>`, dans le même dossier, avec `conflictOf: "<documentId>"` ;
  2. il notifie l'utilisateur (notification système) ;
  3. la réconciliation se fait dans l'application.
- Le serveur ne fusionne jamais le contenu.
- **Fichiers temporaires** : Word, AutoCAD, Archicad et SketchUp enregistrent par fichier temporaire puis renommage. Le client natif doit détecter ce motif et déposer **une version**, pas un document par fichier temporaire. Le serveur refuse néanmoins les noms `~$*`, `*.tmp`, `*.bak`, `Thumbs.db`, `.DS_Store`, `desktop.ini` (400 `NAME_IGNORED`) ; le client les ignore localement.
- **Coalescence** : le client attend 30 s après la dernière écriture avant de déposer, pour ne pas créer une version par enregistrement automatique.

## 10. Métadonnées, renommage, déplacement, suppression

| Route | Rôle |
|---|---|
| `PATCH /nodes/{id}` | Renomme (`name`), change de phase (`phase`) ou de type (`docType`), change le statut (`status`, avec les règles de `PATCH /api/documents/:id/statut`), le commentaire. Avec `If-Match`. Un déplacement vers un autre dossier de phase du même projet change `phase`. Un déplacement vers une **autre affaire est refusé en v1** (400 `MOVE_ACROSS_PROJECTS`). |
| `POST /nodes/{id}/restore` | Restaure depuis la corbeille. |
| `DELETE /nodes/{id}` | **Suppression logique** (`deleted_at`). Corbeille 30 jours, puis purge par le serveur. Jamais de suppression définitive depuis un appareil. Rôle `admin`, `manager` ou `pm` comme aujourd'hui, sinon 403. |
| `POST /nodes/{id}/bump-indice` | Fait avancer l'indice de diffusion (geste explicite, dans l'application ou le menu contextuel). Refuse au-delà de `Z`. |
| `POST /nodes/{id}/link` | Rend le lien profond `archioffice://document/<id>` et l'identifiant du nœud (pas d'adresse web en v1). |

La création de dossier (hors dossiers de phase existants) n'est pas supportée en v1 : les dossiers sont l'affaire et la phase. Un utilisateur qui crée un dossier dans l'Explorateur reçoit une erreur claire (`409 FOLDER_NOT_SUPPORTED`) ; le client natif la présente comme un refus du système de fichiers.

## 11. Correspondance avec les plateformes

| Concept du contrat | Windows (Cloud Files API) | macOS (File Provider) |
|---|---|---|
| Racine | Racine de synchronisation par cabinet | Domaine File Provider par cabinet |
| Identité d'un nœud | `FileIdentity` = `id` du nœud | `NSFileProviderItemIdentifier` = `id` du nœud |
| Énumérer un dossier | `FETCH_PLACEHOLDERS` → `children` | `enumerator` → `children` |
| Hydrater | `FETCH_DATA` → `content` (Range) | `startProvidingItem` → `content` |
| Détecter le changement distant | Interrogation de `/changes` | `signalEnumerator` après `/changes` |
| Enregistrement local | Surveillance du dossier, notification de fermeture | `modifyItem` |
| Lecture seule | Attribut de fichier + état « verrouillé » | `capabilities` sans `allowsWriting` |
| Icônes de statut | Superpositions Cloud Files | Décorations File Provider |
| Menu contextuel | `IExplorerCommand` (MSIX « sparse ») | Extension d'action File Provider |
| Jeton | Gestionnaire d'identifiants | Trousseau (groupe partagé avec l'extension) |
| « Conserver hors ligne » | Épinglage (`pinned`) | « Conserver téléchargé » |

Le contrat ne définit rien de plus que ces points d'appui : toute différence de comportement entre plateformes se règle côté client natif.

## 12. Changements à prévoir côté serveur

La migration est **`supabase/migrate_desktop_sync.sql`** (additive, rejouable, testée contre un vrai Postgres par
`tests/desktopSyncMigration.pg.test.ts`). Elle est appliquée par le MCP Supabase au déploiement ; elle n'a pas été
appliquée à une base distante lors de l'implémentation. Écarts avec le brouillon initial de ce contrat :

- `desktop_devices` est rattaché à la **personne** (`user_id`), sans `tenant_id` : un architecte qui exerce dans deux cabinets a un seul appareil.
- `desktop_changes.tenant_id` n'a **pas de clé étrangère** vers `tenants` : les déclencheurs écrivent à chaque suppression de document, et la suppression en cascade d'un cabinet échouerait sinon. `server/tenantPurge.ts` nettoie ces lignes après la suppression du cabinet.
- Un plancher de curseur (`desktop_sync_state.floor_seq`, relevé par `desktop_changes_prune`) permet de répondre `410 CURSOR_EXPIRED`.
- Les déclencheurs couvrent `documents` (mise à jour de `updated_at`, journal), `document_locks` et `projects` (nom, code, archivage : événement `scope`).
- `desktop_uploads` porte aussi `device_id`, `mime_type`, `description` et `result` (pour rendre `complete` idempotent).

Points à décider avant la migration :

- Les déclencheurs sont écrits et testés (`documents`, `document_locks`, `projects`). Restent à décider : un événement `scope` quand un lot ou une phase est renommé (aujourd'hui seule l'affaire déclenche), et l'ajout de `document_versions` si l'on veut tracer une restauration de version.
- `documents.id` est un `TEXT` (UUID généré par l'application) et non un `UUID` : les clés étrangères ci-dessus le respectent.
- Les tables doivent rester **hors `SYNC_TABLES`** (poste local) : un poste Electron ne synchronise pas les jetons d'appareil.
- Une instance non migrée répond `503 DESKTOP_SYNC_UNAVAILABLE` sur `/api/desktop/v1/*` sans toucher au reste de l'API, comme les autres modules facultatifs.

### Stockage externe : WebDAV, Nextcloud et kDrive

Le contrat passe par l'interface `ExternalStorageProvider` : aucun appel n'est propre à un fournisseur. Nextcloud et kDrive partagent l'adaptateur WebDAV (`server/externalStorage/providers/webdav.ts`), Google Drive et Dropbox ont le leur. Ce que cet adaptateur impose au contrat :

| Comportement vérifié dans le code | Conséquence |
|---|---|
| `openReadStream` retransmet l'en-tête `Range` et rejoue le 206. | L'hydratation par plages (section 5) est compatible. |
| `getTemporaryLink` rend `null` : aucun lien temporaire. | **Tous les octets lus transitent par le serveur ArchiOffice.** La bande passante et la durée des requêtes sont à dimensionner. Pas de redirection 302 pour WebDAV, contrairement à Dropbox. |
| `uploadFile` fait **un seul PUT avec le fichier entier** (`Buffer`), puis relit la taille par PROPFIND. Pas de dépôt par morceaux côté Nextcloud. | Les morceaux reçus du client sont **réassemblés sur le disque du serveur**, puis envoyés en un PUT. Un gros fichier dépend des limites du serveur du cabinet (PHP, serveur mandataire, délais). Voir risques. |
| `externalId` est le **chemin relatif** du fichier, alors que Dropbox utilise un identifiant stable. | Renommer ou déplacer un fichier directement dans Nextcloud ou kDrive **casse la référence** ArchiOffice. |
| `freeName` suffixe le nom (` (2)`, ` (3)`) si le fichier existe déjà. | Chaque version est un **fichier distinct** dans le drive, avec un nom qui peut différer de `name` dans le nœud. Le nœud reste la référence. |
| HTTPS obligatoire, garde SSRF, connexion épinglée, redirections de même origine. | Un serveur WebDAV sur le réseau interne (NAS) reste refusé. |
| Authentification par mot de passe d'application. | Le contrat n'a rien à ajouter ; le compte devrait être limité au dossier racine d'ArchiOffice. |

**Règles propres au contrat :**

1. **Un renommage ou un changement de phase fait depuis l'Explorateur ou le Finder ne déplace pas le fichier dans le drive.** `PATCH /nodes/{id}` ne modifie que la base ; l'arborescence du drive et celle du poste peuvent donc diverger. Le chemin du drive n'est jamais exposé comme un chemin de travail.
2. **Le dossier racine d'ArchiOffice ne doit pas être synchronisé en écriture par un autre client** (client de bureau Nextcloud ou kDrive, par exemple). Une modification faite ainsi change les octets sans passer par les versions ni les verrous, et fait diverger `size` et `sha256`. Le serveur détecte l'écart à la lecture (`X-Content-SHA256` ne correspond plus) et le signale ; il ne le corrige pas. Si un cabinet souhaite ce client en lecture, le dossier doit y être en lecture seule.
3. **Les suppressions** : la suppression logique de l'appareil n'appelle pas `deleteFile`. Le fichier du drive n'est supprimé qu'à la purge de la corbeille (30 jours), et le comportement de la corbeille du fournisseur à ce moment n'est pas garanti par le contrat.
4. **Capacité à tester** avant de promettre une taille maximale : dépôt de 100 Mo, 500 Mo et 1 Go sur un Nextcloud et sur un kDrive réels, avec délais et limites du serveur mandataire. Le comportement de kDrive sur de gros fichiers n'a pas été vérifié.

### Risques d'implémentation

1. **Mémoire** : `storeBusinessFile` exige un `Buffer`. Un fichier de plusieurs centaines de Mo en mémoire n'est pas acceptable. Il faut faire évoluer les fournisseurs pour accepter un flux, ou limiter la v1 à 200 Mo.
2. **Cohérence du nom et du chemin** : le renommage d'une affaire ou d'une phase change le chemin de centaines de fichiers. Les événements `upsert` doivent suivre, ou un événement `scope` force le client à relire le dossier.
3. **Documents sans affaire** : la zone « À classer » suppose de lever la contrainte implicite `project_id` pour ces lignes ; vérifier l'effet sur les écrans qui présument un projet.
4. **Statut approuvé** : `doc_statut = 'approuve'` ne doit pas rester modifiable par un enregistrement automatique.
5. **Quota de stockage** : les octets sur un drive externe ne comptent pas (règle existante) ; les morceaux temporaires, eux, passent par un stockage temporaire du serveur à dimensionner.

## 13. Sécurité

- Jetons d'appareil : SHA-256 en base, affichés une fois, révocables, liés à une personne et à ses adhésions.
- Même isolation que l'API : `tenant_id` sur chaque lecture, `assertTenantEntity` sur chaque identifiant reçu.
- Un fichier n'est **jamais exécuté ni ouvert** par le serveur ; la liste d'extensions sûres d'`electron/fileAccess.cjs` reste la règle du client Electron pour « Ouvrir ». Le client natif ouvre par l'application associée de l'utilisateur, comme l'Explorateur.
- Les liens profonds `archioffice://document/<id>` ne donnent aucun accès par eux-mêmes : ils exigent une session valide et le droit de lecture.
- **Aucun octet CAO dans Supabase** : garanti par le contrôle d'ouverture (section 8.4) et par le fait que les morceaux restent sur le disque temporaire. Un refus 409 est journalisé (`logActivity`) pour qu'un administrateur sache qu'un poste tente de déposer du CAO sans espace branché.
- Journal d'activité (`logActivity`) pour chaque dépôt, suppression, restauration, rupture de verrou et révocation d'appareil.
- Nettoyage RGPD : la fermeture d'un cabinet purge appareils, verrous, sessions et journal (`tenantPurge.ts` doit les connaître).

## 14. Tests de conformité (identiques sur les deux plateformes)

Un jeu de scénarios exécuté contre un serveur de test, par le client Windows comme par le client macOS :

1. Énumération d'un cabinet de 20 000 fichiers sans lire l'arbre entier ; pagination `children`.
2. Hydratation d'un fichier de 500 Mo avec lecture par plages, puis reprise après coupure.
3. Dépôt d'un fichier de 500 Mo, coupure du réseau à mi-chemin, reprise sans retransmettre ce qui est reçu.
4. Deux personnes modifient le même fichier à partir de la même version : une version et un document « conflit », aucune perte.
5. Enregistrement par fichier temporaire (Word, AutoCAD) : une seule version créée.
6. Fichier verrouillé par un tiers : lecture seule en `advisory`, `423` en `enforced`.
7. Affaire archivée en cours de synchronisation : devient lecture seule, aucune perte du fichier local.
8. Renommage d'une affaire : tous les chemins suivent, les identifiants restent, les liens profonds fonctionnent.
9. Révocation d'un appareil : les données locales sont effacées, plus aucun appel n'aboutit.
10. Rattrapage après 30 jours hors ligne : `410 CURSOR_EXPIRED`, resynchronisation complète sans doublon.
11. Dépôt d'un `.exe` ou d'un `.html` : refusé, aucune trace côté serveur.
12. Chemin de plus de 260 caractères : le nom serveur est déjà borné, le fichier reste ouvrable.
13. Documents CAO avec références externes : les chemins relatifs vers les fichiers voisins résolvent (test sur un jeu réel d'Archicad ou d'AutoCAD).
14. **CAO sans espace externe** : dépôt d'un `.dwg` par un cabinet sans espace actif, refusé en 409 `EXTERNAL_STORAGE_REQUIRED` avant le premier octet ; vérifier qu'aucun objet n'existe dans le bucket `documents` de Supabase et qu'aucune ligne `documents` n'a été créée.
15. **CAO avec espace externe** : le fichier est sur le drive, `storage_backend = 'external'`, et le bucket Supabase reste vide. Espace coupé en cours de dépôt : 502, toujours aucun octet dans Supabase.
16. **Morceaux temporaires** : session abandonnée à mi-chemin, les morceaux sont purgés du disque temporaire à l'expiration, rien n'est resté dans Supabase.
17. **Même règle côté web** : le dépôt d'un `.rvt` par l'écran Documents est refusé de la même façon.
18. **WebDAV (Nextcloud et kDrive)** : hydratation par plages, dépôt de 100 Mo, 500 Mo et 1 Go, délais et limites du serveur mandataire relevés ; deux versions d'un même fichier produisent deux fichiers distincts dans le drive, le nœud restant le même.
19. **Renommage dans le drive** : un fichier renommé directement dans Nextcloud ou kDrive devient illisible côté ArchiOffice avec une erreur claire, sans corrompre les autres.
20. **Écriture externe** : un fichier modifié dans le drive par un autre client est détecté à la lecture (empreinte différente) et signalé, jamais écrasé en silence.

## 15. Ce qui n'est pas dans ce contrat

- Vues par métadonnées dans l'Explorateur (lecteur virtuel de type M-Files) : seraient un autre contrat, sur un autre mécanisme.
- Intégration Office, Outlook, AutoCAD ou Revit (compléments).
- Co-édition en temps réel : le contrat est un partage de fichiers avec verrous ou versions, pas de la collaboration BIM.
- Chiffrement de bout en bout côté client.

## 16. Questions ouvertes (à trancher avant l'implémentation)

1. Mode de verrou par défaut : `advisory` (proposé) ou `enforced` pour les DWG et RVT ?
2. Taille maximale d'un fichier en v1 : 200 Mo (sans changer les fournisseurs) ou 2 Go (flux obligatoire) ?
3. La corbeille de 30 jours existe-t-elle déjà dans l'application web, ou ce contrat en crée-t-il une pour les appareils seulement ?
4. Les documents d'autres fiches (permis, devis...) doivent-ils apparaître plus tard sous un dossier « Autres pièces » ?
5. Droits par affaire : le contrat expose `permissions` mais le serveur ne vérifie que le rôle du cabinet ; faut-il restreindre aux `project_members` ?
6. **CAO déjà dans Supabase** : faut-il les migrer vers l'espace externe du cabinet (outil de migration, comme celui de l'arborescence locale), ou les laisser en place ? Le contrat ne change pas leur lecture.
7. **Cabinet sans espace externe** : le refus est le comportement retenu pour le CAO. Souhaite-t-on un message qui renvoie vers les Réglages, ou un déblocage ponctuel par un administrateur ?
8. **Liste d'extensions CAO** (section 8.4) : à confirmer avec les logiciels réellement utilisés par les cabinets (Archicad, Allplan, Vectorworks, Rhino, Revit...) avant de la figer.
9. **Taille maximale** sur WebDAV : à fixer après les essais de la section 12 sur un Nextcloud et un kDrive réels, pas avant.

## 17. État d'avancement

**Implémenté (socle serveur)**, sous `/api/desktop/v1` :

| Domaine | Routes | Fichiers |
|---|---|---|
| Appareils | `POST/GET /devices`, `DELETE /devices/:id` (jeton `ds_at_`, limité à ce préfixe) | `server/desktop/deviceTokens.ts`, `server.ts` |
| Arborescence | `GET /roots`, `GET /nodes/:id`, `/children`, `/versions`, `/content` | `server/desktop/nodes.ts`, `src/lib/desktopNodes.ts` |
| Journal | `GET /changes` (curseur, plancher, 410) | `server/desktop/changes.ts`, déclencheurs SQL |
| Verrous | `POST/DELETE /nodes/:id/lock`, `/lock/renew` (modes `off`, `advisory`, `enforced`) | `server/desktop/locks.ts` |
| Dépôt | `POST /uploads`, `PUT/GET /uploads/:id`, `POST /uploads/:id/complete` | `server/desktop/uploads.ts` |
| Gestes | `PATCH`, `DELETE` (logique), `restore`, `bump-indice`, `link` | `server/routes/desktopSync.ts` |
| Règle CAO | `409 EXTERNAL_STORAGE_REQUIRED` à l'ouverture et à la fin d'un dépôt, et au renommage | `src/lib/cadFiles.ts`, `server/desktop/uploads.ts` |

**Tests** : `tests/desktopSyncDevices.test.ts`, `desktopSyncRoutes.test.ts`, `desktopSyncUploads.test.ts`, `src/lib/__tests__/cadFiles.test.ts`, `desktopNodes.test.ts`, et `tests/desktopSyncMigration.pg.test.ts` (vrai Postgres, ignoré sans `PGHOST`). Vérifié par mutation : retirer la règle CAO fait échouer 11 tests.

**Pas encore fait** :

- Clients natifs Windows (Cloud Files API) et macOS (File Provider).
- Flux SSE `/events`.
- Notification de la personne dont on rompt un verrou.
- Fait : réglage `settings.desktop_lock_mode` dans Réglages > Cabinet (carte « Synchronisation desktop : verrouillage des documents », administrateurs, valeurs `off`, `advisory`, `enforced` validées par `PUT /api/settings`).
- Fait : la règle CAO s'applique aussi au web, au cœur de `storeBusinessFile` (documents, plans, visas, DOE) : 409 `EXTERNAL_STORAGE_REQUIRED` sans espace externe actif, exemption du mode hors ligne.
- Reste : migration des CAO déjà présents dans Supabase.
- Dépôt en flux : tout fichier est relu en mémoire à la fin, d'où un plafond de 200 Mo (`DESKTOP_MAX_UPLOAD_MB`).
- Réponse `ETag` conditionnelle (`If-None-Match`) et gestion de `If-Match` sur `content`.
- Purge automatique des documents de la corbeille après 30 jours.
- Essais de gros fichiers sur un Nextcloud et un kDrive réels.
- Application de la migration à une base Supabase distante.


## 18. Accès payant — premier lot

ArchiOffice Drive est réservé aux membres autorisés d’un cabinet disposant d’un
abonnement Starter, Pro ou Entreprise actif. La date `tenants.trial_ends_at`,
réutilisée par la facturation comme fin de période payée, doit être valide et
future. Une formule seule, une date absente ou une base locale ne prouvent pas le
paiement. Les contrats Entreprise doivent donc aussi renseigner cette échéance.

- `GET /api/desktop/v1/capabilities` : `{ enabled, code, message }`, sans cache.
  Ce résultat prépare le parcours d’activation ; il ne constitue pas une licence
  hors connexion. L’interface d’activation reste à raccorder.
- Les racines gratuites/expirées sont filtrées. Les lectures et écritures Drive,
  l’enregistrement d’appareil et chaque appel de dépôt (morceau, reprise,
  finalisation) recontrôlent le cabinet actif côté serveur.
- Absence de droit : `402 DRIVE_SUBSCRIPTION_REQUIRED`. Indisponibilité de la
  vérification : `503 DRIVE_ENTITLEMENT_UNAVAILABLE`, sans autorisation implicite.
- Liste/révocation de ses appareils et libération de verrou restent accessibles
  sans abonnement ; les contrôles existants d’identité, d’adhésion et de rôle
  continuent de s’appliquer.
- Une annulation programmée ne coupe pas le droit avant la fin de période payée.
- En mode local, `402 DRIVE_ONLINE_VERIFICATION_REQUIRED` : aucune activation
  depuis les seules données locales avant implémentation d’une licence cloud
  signée et bornée. Les fonctions documentaires locales existantes restent
  indépendantes de ce garde.
- Aucune suppression de fichiers ou de sessions de dépôt n’est déclenchée par
  ce contrôle ; leur rétention existante reste applicable. Les futurs clients
  doivent préserver les modifications locales après refus, expiration ou
  révocation. La consigne d’effacement des sections 3.1/14 ne doit jamais être
  appliquée aux modifications non synchronisées ; la politique native détaillée
  reste à implémenter avant le pilote.
- Les URL de lecture signées déjà émises restent valides jusqu’à leur échéance
  existante : cette restriction ne constitue pas une révocation instantanée.

Validation : tests de contrôle d’accès et suites desktop ; aucune migration SQL
requise par ce lot. Les composants natifs, l’autorisation hors connexion et la
fiabilisation complète du renouvellement de facturation restent des lots séparés.

## 19. Préparation de l’activation et autorisations signées

Les réglages **Mon profil** affichent désormais l’éligibilité du cabinet actif et
les appareils personnels, tous cabinets confondus. La déconnexion demande une
confirmation et reste proposée si le contrôle d’abonnement échoue. L’écran
n’inscrit pas de nouvel appareil : l’inscription sera assurée par l’agent, avec
transfert du jeton directement vers son stockage sécurisé, jamais par un champ
à copier dans le navigateur.

### Socle d’autorisation hors connexion

`POST /api/desktop/v1/offline-license` exige un jeton d’appareil valide et un
cabinet sélectionné dont l’abonnement est actif. L’identité est déduite du jeton,
pas du corps de la requête. Réponse sans cache : `{ license, expiresAt, keyId }`.

- Signature Ed25519, en-tête `alg: EdDSA`, identifiant de clé `kid`.
- Émetteur `archioffice-drive`, destinataire `archioffice-drive-agent`, droit
  `archioffice_drive`, utilisateur/cabinet/appareil, dates d’émission/expiration.
- Durée maximale : 72 h, bornée aussi par la fin de période payée.
- Variables serveur : `DRIVE_LICENSE_PRIVATE_KEY` (PEM PKCS#8 Ed25519),
  `DRIVE_LICENSE_KEY_ID` (1–64 caractères alphanumériques, `_` ou `-`). La clé doit
  être créée et conservée dans le gestionnaire de secrets du déploiement ; elle
  n’est ni générée au démarrage, ni envoyée aux clients, ni committée.
- Sans clé correctement configurée : `503 DRIVE_LICENSE_UNAVAILABLE` ; le reste
  de Drive reste indépendant de cette configuration.
- `verifyOfflineLicense` vérifie la signature, les identités, l’émetteur, le
  destinataire et les bornes temporelles. Le registre des clés publiques doit
  être provisionné indépendamment dans le client, jamais fourni par la licence.
  La rotation conserve les anciennes clés publiques jusqu’à expiration des
  autorisations déjà émises, ou les retire explicitement pour les invalider.

**État livré : protocole d’émission et vérificateur testés, pas encore une
activation hors connexion de bout en bout.** Le client natif doit encore stocker
la licence dans le coffre système, épingler les clés publiques, conserver une
heure de référence protégée contre le recul de l’horloge, renouveler la licence
en ligne et gérer son expiration sans perdre les modifications. Aucun garde
local de la section 18 n’est levé dans ce lot.

Un poste déconnecté ne peut pas apprendre immédiatement une révocation : la
licence constitue au plus 72 h de tolérance. À la reconnexion, les refus serveur
font foi. Les modifications non synchronisées doivent rester récupérables.

## 20. Raccordement au client Electron : activation locale et renouvellement

Le panneau Mon profil propose « Connecter ce poste » sur un client de bureau
configuré et relié au compte cloud. Les clés et jetons ne passent pas par le
navigateur. Les routes locales d’activation sont authentifiées par la session
locale et vérifient le couple utilisateur/cabinet contre le lien cloud terminé :

- `POST /api/desktop/v1/local/connect` restaure la session cloud en interne,
  inscrit le poste auprès du serveur et demande sa licence signée.
- `POST /api/desktop/v1/local/refresh` renouvelle une inscription existante,
  sans inscrire automatiquement un poste non activé.
- `GET /capabilities` vérifie la signature, le compte, le cabinet, le poste et
  les dates ; le plan dans la base locale ne donne aucun droit.
- En mode local, `/devices` expose uniquement l’inscription de ce poste, sans
  secret. Une déconnexion bloque le poste avant l’appel réseau ; si celui-ci
  échoue, la révocation distante reste en attente dans le coffre chiffré.
- Une boucle toutes les 15 minutes et au démarrage renouvelle seulement une
  inscription existante. Elle s’arrête avec le serveur Electron : elle ne
  constitue pas encore l’agent autonome.

### Stockage et conditions de sécurité

Le jeton d’appareil, la licence et l’heure de référence sont stockés ensemble
par écriture atomique dans `drive-state.enc`, sous OFFLINE_DATA_DIR. Le contenu
est chiffré via le pont IPC Electron safeStorage (DPAPI sous Windows, mécanisme
système sous macOS), avec permissions restrictives. Il n’existe aucun repli en
clair en cas d’indisponibilité du coffre. Les opérations sont sérialisées dans
le serveur local pour éviter les inscriptions concurrentes et les écrasements
d’état. Les futurs processus natifs devront passer par un seul propriétaire
du coffre, sans écrire concurremment ce fichier.

Une erreur réseau/5xx ne prolonge jamais la licence existante. Un refus
401/402/403/404 reçu du serveur invalide immédiatement l’autorisation locale.
Une signature invalide ne permet aucun repli sur une ancienne licence. Aucune
branche de ce mécanisme ne supprime de document ni de modification locale.
L’API de signature elle-même est refusée en mode local.

Le processus utilise une horloge monotone en plus de l’horloge système et garde
une borne de temps chiffrée. Un recul de plus d’une seconde depuis cette borne
est refusé. Cette protection détecte le recul ordinaire et le gel d’horloge en
session ; elle n’est pas une attestation matérielle contre un administrateur
restaurant simultanément un ancien disque, son coffre et l’horloge. Ne pas
présenter cette limite comme une garantie absolue.

### Configuration nécessaire avant publication du client

`electron/driveTrust.json` est une configuration **publique embarquée au build** :
`cloudOrigin` est l’origine HTTPS du serveur ArchiOffice, sans chemin, identifiant
ni redirection ; `publicKeys` associe chaque identifiant de clé à sa clé publique
Ed25519 PEM. La configuration embarquée utilise `https://www.archioffice.fr` et la clé publique
Ed25519 `drive-2026-10-29-01`, générée le 29 octobre 2026. La clé privée correspondante
doit être configurée uniquement dans les secrets du serveur. Les clés privées restent
uniquement dans les secrets du serveur de signature (section 19).

Tant que l’origine et les clés ne sont pas provisionnées dans une nouvelle
version du client, `DRIVE_TRUST_UNCONFIGURED` empêche l’activation locale. Les
requêtes utilisateur ne peuvent modifier ni l’origine ni les clés de confiance.
Les appels réseau sont limités en durée et en taille de réponse, sans suivi de
redirection. Le jeton cloud de renouvellement est conservé chiffré après rotation.
Les versions anciennes d’un client ne reçoivent pas automatiquement de nouvelles
clés : la rotation de confiance doit accompagner les mises à jour du client.

### État et validation

Le cycle d’autorisation local est raccordé et testé avec doubles du réseau et du
pont cryptographique. La vérification sur un vrai poste Windows/macOS, avec le
serveur déployé et les clés configurées, reste obligatoire avant le pilote.
L’accès aux documents sur disque continue d’utiliser les mécanismes locaux
existants ; cette livraison n’ajoute ni placeholders, ni cache de fichiers
à la demande, ni montage CFAPI/File Provider, ni agent persistant après fermeture.

## 21. Socle de file de transferts de l’agent

`server/desktop/agent/transferQueue.ts` fournit une file persistante d’envois,
scopée à un utilisateur et un cabinet. Chaque enregistrement capture une copie
locale distincte du fichier et son SHA-256 ; une modification ultérieure du
fichier de travail ne modifie pas la version déjà en attente. Les copies sont
privées (0600), le répertoire de file est créé en 0700, les métadonnées sont
écrites par remplacement atomique avec synchronisation du fichier journal.
Les jetons d’appareil et de session ne sont jamais écrits dans ce journal.

Le moteur conserve la session de dépôt, relit les plages reçues côté serveur,
puis n’envoie que les octets manquants. Après une réponse de finalisation perdue,
il redemande la fin de la même session au lieu de créer automatiquement un autre
document. Cette reprise dépend des garanties de finalisation du serveur ; elle
ne remplace pas une transaction serveur entre document, historique et session.

États : queued, uploading, retry, conflict, blocked, done. Les erreurs réseau et
5xx/429 sont reprises avec délai croissant ; les refus d’accès sont bloqués. Un
409 VERSION_CONFLICT conserve la copie et attend une résolution explicite avec
une nouvelle version de base ou une destination de conflit. Une session expirée
ou disparue est bloquée, sans recréation automatique pouvant dupliquer un
document déjà enregistré. Le fichier de travail et les copies terminées restent
conservés ; la rétention et la purge devront être des actions séparées.

`uploadTransport.ts` implémente le protocole HTTP existant, en HTTPS, sans suivi
de redirection, avec réponses bornées et délais d’attente. Le propriétaire du
coffre doit fournir le jeton via une fonction d’autorisation appelée à chaque
requête. Le moteur ne reçoit ni clé privée ni clé Supabase privilégiée.

**Périmètre de ce lot : moteur d’envoi utilisable et testé, pas un démon activé.**
Aucun répertoire utilisateur n’est surveillé et aucun transfert n’est lancé au
démarrage par ce code. Il reste à raccorder le propriétaire du coffre, les
adaptateurs natifs et la sélection explicite des fichiers. La file doit avoir
un seul propriétaire écrivain par répertoire ; la synchronisation entre plusieurs
processus n’est pas fournie. La limite initiale de copie est 200 Mo, cohérente
avec la limite serveur actuelle. Les téléchargements/hydratations, la détection
des enregistrements CAO, le cache et le processus autonome sont des lots suivants.

Tests : copies indépendantes du fichier de travail, reprise après redémarrage,
finalisation perdue, conflits, refus d’accès, corruption, isolation cabinet,
transport HTTP et envoi à travers les vraies routes desktop avec backend de test.
Les garanties de survie à une coupure électrique brutale ou de concurrence entre
processus devront faire l’objet de tests sur les OS cibles avant activation.

## 22. Processus de transfert et coffre conservé dans Electron

Le build desktop produit maintenant deux exécutables Node embarqués : le
serveur local et `dist-server/drive-agent.cjs`. Le second tourne dans un processus
séparé, surveillé par `electron/driveAgent.cjs`, et traite la file d’envoi toutes
les dix secondes. Les reprises après incident sont limitées à trois
redémarrages du processus par lancement de l’application. Les files appartiennent
au profil local et sont séparées par empreinte du couple utilisateur/cabinet.
Une seule instance de l’application est autorisée par profil Electron.

Le worker ne lit pas le coffre et n’hérite pas des secrets de l’application.
Avant chaque requête de transfert, il demande une autorisation sur un canal Node
IPC privé. Le processus principal transmet la demande au serveur local, qui
vérifie la licence dans son coffre via safeStorage et rend le jeton d’appareil.
La réponse ne traverse jamais le preload ou une route HTTP. Ni clé privée de
signature ni clé Supabase privilégiée n’est transmise au worker. Les variables
réseau/proxy et les certificats nécessaires sont conservés dans son environnement.

### Premier parcours d’envoi

Dans Mon profil, un client Electron autorisé affiche « Envoyer un fichier vers
À classer ». Le processus principal ouvre une boîte de dialogue native ; aucun
chemin choisi par le renderer n’est accepté. Le fichier sélectionné est copié
dans la file, puis envoyé vers la boîte À classer du cabinet lié au coffre.
Les compteurs distinguent attente, blocage et conflit. « Réessayer les envois
bloqués » est une action explicite ; les conflits ne sont pas remis en envoi
par ce bouton. La résolution détaillée des conflits reste à ajouter.

### Fermeture et arrêt

Avec un accès Drive vérifié et une icône de zone de notification créée, fermer
la fenêtre laisse Electron, son coffre et le worker actifs. La zone de
notification permet de rouvrir ArchiOffice ou de quitter l’application et
arrêter Drive. Sans icône disponible, le maintien en arrière-plan n’est pas
activé sur Windows, pour éviter un processus sans commande d’arrêt visible.
L’arrêt explicite ou la fermeture de session arrête le worker ; il n’est pas un
service système indépendant d’Electron. Les opérations en cours restent dans
la file pour reprise au prochain lancement, sans suppression du fichier de
travail. Un arrêt forcé peut laisser une copie partielle sans journal, qui ne
sera pas envoyée automatiquement.

### Vérifications et limites

Tests : lancement réel d’un processus Node, pause sur refus du coffre, arrêt,
filtrage de l’environnement, corrélation IPC, file persistante, pont de sélection
native simulé et compteur d’envois. Les comportements de Tray, de safeStorage et
de fermeture de fenêtre doivent encore être validés sur des installations
Windows/macOS réelles. Ce lot ne fournit ni démarrage automatique à l’ouverture
de session, ni placeholders CFAPI/File Provider, ni surveillance de fichiers CAO,
ni téléchargement à la demande. Il prépare ces intégrations sur un processus
séparé tout en gardant un seul propriétaire du coffre.

## 23. Téléchargement repris et cache interne de versions

Le worker dispose de `keepOffline(nodeId)` pour préparer une version locale et
de `cachedVersion(metadata)` pour consulter une copie vérifiée après contrôle de
la licence par le coffre. Ces méthodes restent privées : aucun nouveau bouton,
commande preload ou montage natif ne les expose dans ce lot. Elles constituent
le socle de l’hydratation et de la conservation hors connexion à raccorder aux
adaptateurs Windows/macOS et au parcours documentaire.

### Version et intégrité

`downloadTransport.ts` charge le nœud puis demande explicitement sa version
technique au point d’accès de contenu. Les documents importés dont la version
courante n’a pas encore de ligne d’historique restent téléchargeables : cette
version utilise la référence du document courant ; les versions plus anciennes
exigent toujours leur ligne d’historique. Une taille ancienne absente peut être
obtenue par une requête de sonde, sinon le téléchargement est refusé proprement.

Le cache écrit les octets dans un fichier partiel, reprend les plages manquantes
et compare le SHA-256 à celui du serveur lorsqu’il existe. Si le stockage ignore
Range et renvoie le fichier entier, la partie incomplète repart de zéro plutôt
que d’ajouter un second fichier à la suite. Une empreinte erronée, une réponse
trop volumineuse ou une version incohérente empêche la publication.

Pour les anciens documents sans empreinte serveur, les réponses ne sont jamais
assemblées et le préfixe n’est pas repris après coupure : le fichier est repris
en une seule réponse complète. Son empreinte locale est conservée et contrôlée
aux lectures ultérieures, mais `verifiedAgainstRemote: false` distingue cette
intégrité locale d’une comparaison avec une empreinte distante. Une empreinte
locale déjà connue ne peut pas être remplacée silencieusement par d’autres
octets sous le même numéro de version.

### Cache séparé des fichiers de travail

`downloadCache.ts` dérive ses noms de fichiers d’une empreinte du compte, du
cabinet, du document et de la version. Aucun nom ni chemin renvoyé par le serveur
n’est interprété comme un chemin disque. Une publication exclusive conserve les
versions déjà présentes ; le journal permet de terminer la validation après une
interruption entre publication et enregistrement de l’état. Les anciennes
versions et les fichiers de travail ne sont ni écrasés ni supprimés. La limite
initiale est 200 Mo par fichier. Une future politique de rétention devra prévoir
explicitement la gestion du volume total et des fichiers partiels bloqués.

### Redirections et accès

Les connexions HTTPS passent par le garde DNS public épinglé existant, afin de
refuser les destinations privées et le rebinding DNS. L’option de redirection
manuelle ajoutée au transport partagé ne change pas le comportement par défaut
des connecteurs WebDAV existants. Le jeton d’appareil n’est envoyé que sur la
requête initiale à l’API documentaire : il n’est jamais transmis aux URL de
stockage signées, même si une redirection reste sur la même origine. Les liens
signés ne sont pas écrits dans les journaux de cache. L’autorisation est revérifiée
avant chaque connexion ; la lecture locale exige aussi une licence valide.

### Validation et limites

Tests : reprise après interruption/redémarrage, réponse ignorant Range,
checksum invalide, conservation des anciennes versions, corruption locale,
isolation de compte, documents historiques, métadonnées UTF-8, redirections et
absence de fuite du jeton vers le stockage. Les tests du transport utilisent des
doubles réseau ; aucun fournisseur de stockage réel ni OS natif n’est validé
par ce lot. L’export, la copie de travail modifiable, l’éviction, les références
CAO, la détection des modifications, le montage et l’hydratation native restent
à raccorder. La lecture directe du cache comme fichier de travail n’est pas le
parcours retenu : une copie de travail séparée sera nécessaire.
