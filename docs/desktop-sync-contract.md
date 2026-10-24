# Contrat d'API de synchronisation desktop (Windows et macOS)

Statut : **proposition, rien n'est implémenté.** Ce document fixe l'interface entre le serveur ArchiOffice et les deux composants natifs qui exposent les documents dans l'Explorateur Windows (Cloud Files API) et dans le Finder (File Provider). Le même contrat sert aux deux systèmes : seul le client natif diffère.

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
    { "seq": 10232, "type": "delete", "id": "doc:77c1...", "parentId": "phase:p_123:APD" },
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
- **Indication de temps réel** (optionnelle) : `GET /events` en flux SSE n'envoie que `{ "hint": "changes" }`. Le client rappelle `/changes`. Si le flux est coupé, un sondage toutes les 60 s suffit (même principe que la file `notification_outbox` des notifications desktop).
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
| `DELETE /nodes/{id}/lock?force=true` | Rupture par un administrateur ou un manager. Journalisée, la personne est notifiée (`notifyUsers`). |

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

Contrôles à l'ouverture (avant tout octet) : affaire non archivée (409 `PROJECT_ARCHIVED`), droit d'écriture, verrou (423 `LOCKED` en mode `enforced`), **extension et type refusés** (400 `FILE_TYPE_REFUSED`, mêmes listes que `documentUpload.ts`), quota (503 neutre), `baseVersion` égal à la version courante (409 `VERSION_CONFLICT`, voir 9). Un document approuvé répond 409 `DOCUMENT_APPROVED`.

### 8.2 Envoyer

`PUT /uploads/{uploadId}` avec `Content-Range: bytes 0-8388607/4821937` et corps binaire. `204` si le morceau est accepté. Les morceaux peuvent arriver dans le désordre mais pas se chevaucher différemment. `GET /uploads/{uploadId}` rend `{ received: [[0, 8388607], ...] }` pour reprendre après une coupure. Une session non terminée expire au bout de 24 h et ses morceaux sont purgés.

### 8.3 Terminer

`POST /uploads/{uploadId}/complete` avec `{ "sha256": "..." }` (recontrôle de bout en bout). Le serveur :

1. recompose et vérifie la taille et l'empreinte (`422 CHECKSUM_MISMATCH` sinon) ;
2. **contrôle le contenu** (`looksDangerous`) sur les premiers octets ;
3. stocke par la couche existante (`storeBusinessFile`, qui choisit Supabase ou l'espace du cabinet) ;
4. crée la version : `documents.version + 1`, ligne `document_versions`, `indice` **inchangé sauf `bumpIndice: true`** ;
5. répond `{ node, version, etag }` (nœud complet).

Idempotent : un second `complete` de la même session rend le même résultat. Journal d'activité alimenté comme aujourd'hui (`logActivity`).

### 8.4 Création depuis l'Explorateur

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
| `POST /nodes/{id}/link` | Rend un lien profond `archioffice://document/<id>` et son équivalent web. |

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

À appliquer par migration **via le MCP Supabase** lors de l'implémentation (rien n'a été appliqué). Brouillon, à relire avant toute application :

```sql
-- Journal de changements : séquence globale, filtrée par cabinet à la lecture.
CREATE TABLE IF NOT EXISTS desktop_changes (
  seq BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('upsert','delete','lock','unlock','scope')),
  node_id TEXT NOT NULL,
  project_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_desktop_changes_tenant_seq ON desktop_changes(tenant_id, seq);

CREATE TABLE IF NOT EXISTS document_locks (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  device_id TEXT,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS desktop_devices (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('windows','macos')),
  app_version TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS desktop_uploads (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  target JSONB NOT NULL,
  base_version INTEGER,
  bump_indice BOOLEAN NOT NULL DEFAULT false,
  name TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  received JSONB NOT NULL DEFAULT '[]',
  temp_path TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conflict_of TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS desktop_lock_mode TEXT NOT NULL DEFAULT 'advisory'
  CHECK (desktop_lock_mode IN ('off','advisory','enforced'));
```

Points à décider avant la migration :

- Les **déclencheurs** qui alimentent `desktop_changes` ne sont pas écrits ici ; ils doivent couvrir `INSERT`, `UPDATE` et `DELETE` de `documents` et `document_versions`, ainsi que `project_lots` et `projects` (changement d'archivage ou de nom, qui renomme tout un dossier).
- `documents.id` est un `TEXT` (UUID généré par l'application) et non un `UUID` : les clés étrangères ci-dessus le respectent.
- Les tables doivent rester **hors `SYNC_TABLES`** (poste local) : un poste Electron ne synchronise pas les jetons d'appareil.
- Une instance non migrée répond `503 DESKTOP_SYNC_UNAVAILABLE` sur `/api/desktop/v1/*` sans toucher au reste de l'API, comme les autres modules facultatifs.

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
