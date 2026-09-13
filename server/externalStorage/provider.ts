// L'interface que doivent remplir les trois adaptateurs de stockage externe
// (Google Drive, Dropbox, WebDAV pour Nextcloud et kDrive), plus les erreurs
// typées que la couche de politique (storeBusinessFile.ts) sait rattraper.
//
// Aucun type propre à un fournisseur ne traverse cette frontière : l'identifiant
// d'un objet est une simple chaîne opaque, dont seul l'adaptateur connaît la
// nature (un `fileId` chez Google Drive, un `id:xxxx` chez Dropbox, un chemin
// relatif en WebDAV). C'est ce qui permet un format de référence unique
// (externalRef.ts) et un cache de dossiers unique (externalFolders.ts).
//
// Ce que l'interface N'EXPOSE PAS, volontairement : la résolution d'un chemin
// complet `<racine>/<affaire>/<phase>`. Elle n'offre que les deux primitives
// (chercher un dossier enfant, en créer un) ; l'orchestration et son cache
// vivent dans externalFolders.ts, partagés par les trois adaptateurs — sans
// quoi chacun réimplémenterait le même cache.

export type ExternalStorageKind = 'google_drive' | 'dropbox' | 'webdav';

export interface ExternalUploadResult {
  /** Identifiant de l'objet chez le fournisseur — ce qui part dans la référence. */
  externalId: string;
  sizeBytes: number;
  /** Lien « ouvrir dans le drive », affichable tel quel. Jamais utilisé pour lire les octets. */
  webUrl: string | null;
}

export interface ExternalReadStream {
  body: NodeJS.ReadableStream;
  contentType: string;
  contentLength: number | null;
  /** 206 seulement si l'amont a honoré un Range transmis. */
  status: 200 | 206;
  contentRange: string | null;
}

export interface ExternalStorageProvider {
  readonly kind: ExternalStorageKind;

  /** Identifiant du dossier racine configuré ; le crée s'il n'existe pas encore. */
  resolveRoot(): Promise<string>;

  /** L'identifiant du dossier `name` sous `parentExternalId`, ou null. Ne crée jamais. */
  findChildFolder(parentExternalId: string, name: string): Promise<string | null>;

  /** Idempotent : si le fournisseur signale un conflit, renvoie l'existant plutôt que d'échouer. */
  createChildFolder(parentExternalId: string, name: string): Promise<string>;

  uploadFile(
    parentExternalId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<ExternalUploadResult>;

  /** Corbeille plutôt que destruction définitive partout où le fournisseur le permet :
   *  une suppression malheureuse dans ArchiOffice ne doit pas détruire l'unique
   *  exemplaire que le cabinet possède. */
  deleteFile(externalId: string): Promise<void>;

  /** Lien temporaire du fournisseur, ou null s'il n'en produit pas (Google Drive, WebDAV).
   *  Quand il en produit un, la route de lecture redirige dessus et aucun octet ne
   *  transite par le serveur. */
  getTemporaryLink(externalId: string): Promise<string | null>;

  /** Toujours disponible — le chemin de repli quand getTemporaryLink rend null.
   *  `rangeHeader` DOIT être retransmis en amont et le 206 rejoué tel quel :
   *  pdf.js (src/components/PlanAnnotator.tsx) découpe les gros plans en
   *  requêtes Range, et un serveur qui les ignore casse l'affichage sans le dire. */
  openReadStream(externalId: string, rangeHeader?: string): Promise<ExternalReadStream>;

  /** Test de connexion, depuis les Réglages. Lève en cas d'échec. */
  probe(): Promise<void>;
}

/** Pourquoi un appel au fournisseur a échoué, traduit depuis ses propres codes
 *  pour que la couche de politique et l'UI n'aient pas à les connaître. */
export type ExternalErrorCode =
  | 'needs_reauth'    // 401 même après rafraîchissement, ou mot de passe d'application révoqué
  | 'folder_missing'  // le dossier en cache a été renommé ou supprimé côté drive
  | 'quota_exceeded'  // l'espace DU CABINET est plein
  | 'rate_limited'
  | 'unreachable'
  | 'unknown';

export class ExternalStorageError extends Error {
  readonly status: number;
  readonly code: ExternalErrorCode;
  constructor(message: string, code: ExternalErrorCode = 'unknown', status = 502) {
    super(message);
    this.name = 'ExternalStorageError';
    this.code = code;
    this.status = status;
  }
}

/** Cas particulier rattrapé par storeBusinessFile.ts : le cache de dossiers est
 *  périmé, on l'invalide et on rejoue UNE fois. */
export class ExternalFolderMissingError extends ExternalStorageError {
  constructor(message = 'Dossier introuvable sur l’espace de stockage du cabinet') {
    super(message, 'folder_missing', 502);
    this.name = 'ExternalFolderMissingError';
  }
}
