// La couche de politique : « ce fichier métier va-t-il chez nous ou chez le
// cabinet ? ». C'est le seul endroit qui tranche.
//
// Elle se pose AU-DESSUS de uploadToStorage/deleteFromStorage (server.ts), qui
// ne changent ni de signature ni de comportement : les dix autres modules de
// routes (logos, CV, photos de réunion, pièces jointes de messagerie, du flux
// et du support) continuent de les appeler tels quels, sans rien savoir de tout
// ceci. Seuls documents.ts, plans.ts et visas.ts — le périmètre retenu, celui
// qui pèse réellement — passent par ici.
//
// Un choix important : on ÉCHOUE BRUYAMMENT, jamais de repli silencieux sur
// Supabase quand le drive du cabinet ne répond pas. Un repli remplirait
// précisément le quota que le cabinet cherche à éviter, et rendrait « où est mon
// fichier ? » insoluble, deux fichiers de la même affaire pouvant vivre à deux
// endroits sans que rien ne l'explique. Mieux vaut un message clair et un dépôt
// à refaire.
import { isCadFileName } from '../../src/lib/cadFiles';
import { sanitizeExternalFileName } from './folderNaming';
import { buildExternalRef, isExternalRef, parseExternalRef } from './externalRef';
import {
  getActiveConnection,
  getConnectionById,
  recordConnectionError,
  recordConnectionSuccess,
  type ExternalStorageConnection,
} from './externalConnection';
import { ensureFolderPath, folderKeyFor, invalidateFolderSubtree } from './externalFolders';
import { createProvider } from './providerFactory';
import { ExternalFolderMissingError, ExternalStorageError } from './provider';
import { LAST_NUMBERED_ATTEMPT, isDuplicateUploadError, readableObjectPath } from './localTreePath';

export type BusinessBucket = 'documents' | 'plans';

export interface BusinessFileTarget {
  tenantId: string;
  bucket: BusinessBucket;
  /** Chemin DANS la racine : ['26014 - Villa Martin', 'DCE']. */
  folderPath: string[];
  /** Nom affiché dans le drive du cabinet, accents conservés. */
  fileName: string;
  /** Chemin Supabase, INCHANGÉ, utilisé si le cabinet n'a pas branché d'espace. */
  supabasePath: string;
}

export interface StoredFileRef {
  /** Ce qui part dans file_url : référence Supabase ou archioffice+external://. */
  fileUrl: string;
  sizeBytes: number;
  storageBackend: 'supabase' | 'external';
}

export type StoreBusinessFile = (
  target: BusinessFileTarget,
  buffer: Buffer,
  mimetype: string,
) => Promise<StoredFileRef>;

export type RemoveBusinessFile = (
  tenantId: string,
  bucket: BusinessBucket,
  fileUrl: string,
) => Promise<void>;

export interface BusinessFileStoreDeps {
  supabaseAdmin: any;
  uploadToStorage: (bucket: string, path: string, buf: Buffer, mime: string) => Promise<string>;
  deleteFromStorage: (bucket: string, fileUrl: string) => Promise<void>;
  checkStorageQuota: (tenantId: string, incomingBytes: number) => Promise<void>;
}

/** Le mode hors ligne du client Electron sert déjà les fichiers depuis le poste
 *  du cabinet (server/offlineGateway.ts) : y ajouter un drive distant n'aurait
 *  aucun sens, et le poste n'a pas forcément de réseau. */
function offlineMode(): boolean {
  return process.env.OFFLINE_MODE === 'true';
}

export function createBusinessFileStore(deps: BusinessFileStoreDeps): {
  storeBusinessFile: StoreBusinessFile;
  removeBusinessFile: RemoveBusinessFile;
} {
  const { supabaseAdmin, uploadToStorage, deleteFromStorage, checkStorageQuota } = deps;

  async function uploadExternally(
    connection: ExternalStorageConnection,
    target: BusinessFileTarget,
    buffer: Buffer,
    mimetype: string,
  ): Promise<StoredFileRef> {
    const provider = createProvider(connection);
    const fileName = sanitizeExternalFileName(target.fileName);

    const attempt = async () => {
      const folderId = await ensureFolderPath(
        supabaseAdmin,
        target.tenantId,
        connection,
        provider,
        target.folderPath,
      );
      return provider.uploadFile(folderId, fileName, buffer, mimetype);
    };

    let result;
    try {
      result = await attempt();
    } catch (err) {
      if (!(err instanceof ExternalFolderMissingError)) throw err;
      // Le dossier mémorisé a été renommé ou mis à la corbeille depuis le drive.
      // On oublie le sous-arbre et on rejoue UNE fois — pas de boucle : un second
      // échec est un vrai problème, pas un cache périmé.
      await invalidateFolderSubtree(
        supabaseAdmin,
        connection.id,
        folderKeyFor(connection, target.folderPath),
      );
      result = await attempt();
    }

    return {
      fileUrl: buildExternalRef({
        provider: connection.provider,
        connectionId: connection.id,
        externalId: result.externalId,
        fileName,
      }),
      sizeBytes: result.sizeBytes || buffer.length,
      storageBackend: 'external',
    };
  }

  const storeBusinessFile: StoreBusinessFile = async (target, buffer, mimetype) => {
    const connection = offlineMode() ? null : await getActiveConnection(supabaseAdmin, target.tenantId);

    if (connection) {
      try {
        const stored = await uploadExternally(connection, target, buffer, mimetype);
        recordConnectionSuccess(supabaseAdmin, connection).catch(() => {});
        return stored;
      } catch (err) {
        await recordConnectionError(supabaseAdmin, connection, err);
        const detail = err instanceof Error ? err.message : String(err);
        const wrapped: any = new Error(
          `Impossible d'enregistrer le fichier sur l'espace de stockage du cabinet : ${detail}`,
        );
        wrapped.status = err instanceof ExternalStorageError ? err.status : 502;
        throw wrapped;
      }
    }

    // Branche Supabase. Le contrôle de quota vit ICI et non dans les routes :
    // elles l'appelaient avant de savoir où le fichier irait, et auraient donc
    // refusé pour cause de quota un dépôt qui ne consomme rien chez nous.
    // Règle CAO : les octets d'un fichier CAO, BIM ou 3D ne vont jamais dans
    // Supabase Storage. Sans espace externe actif, le dépôt est refusé (409),
    // sans repli. Le poste Electron (mode hors ligne) garde ses octets sur place.
    if (!offlineMode() && isCadFileName(target.fileName)) {
      const refused: any = new Error(
        "Les fichiers CAO, BIM et 3D ne sont pas stockés sur ArchiOffice : connectez l'espace de stockage du cabinet (Réglages) pour les déposer.",
      );
      refused.status = 409;
      refused.code = 'EXTERNAL_STORAGE_REQUIRED';
      throw refused;
    }
    await checkStorageQuota(target.tenantId, buffer.length);
    if (offlineMode()) return storeInReadableTree(target, buffer, mimetype);
    const fileUrl = await uploadToStorage(target.bucket, target.supabasePath, buffer, mimetype);
    return { fileUrl, sizeBytes: buffer.length, storageBackend: 'supabase' };
  };

  /**
   * Poste Electron : le fichier est rangé dans une arborescence lisible
   * (`<cabinet>/<affaire>/<phase>/<fichier>`, voir localTreePath.ts) au lieu du
   * chemin Supabase à identifiants. Il reste dans le même dossier de stockage
   * (éventuellement un partage réseau) et garde la forme `/object/public/...`,
   * donc rien d'autre ne change pour les lecteurs de `file_url`.
   *
   * Deux fichiers de même nom dans la même phase sont normaux (deux indices d'un
   * plan) : la passerelle refuse d'écraser (création exclusive) et on réessaie
   * sous « nom (2) », « nom (3) »... Jamais d'écrasement silencieux.
   */
  async function storeInReadableTree(
    target: BusinessFileTarget,
    buffer: Buffer,
    mimetype: string,
  ): Promise<StoredFileRef> {
    for (let attempt = 1; attempt <= LAST_NUMBERED_ATTEMPT + 1; attempt += 1) {
      const objectPath = readableObjectPath(
        { tenantId: target.tenantId, folderPath: target.folderPath, fileName: target.fileName },
        attempt,
      );
      try {
        const fileUrl = await uploadToStorage(target.bucket, objectPath, buffer, mimetype);
        return { fileUrl, sizeBytes: buffer.length, storageBackend: 'supabase' };
      } catch (err) {
        if (!isDuplicateUploadError(err) || attempt > LAST_NUMBERED_ATTEMPT) throw err;
      }
    }
    // Inatteignable : la dernière tentative lève ou retourne.
    throw new Error("Impossible de trouver un nom libre pour ce fichier.");
  }

  const removeBusinessFile: RemoveBusinessFile = async (tenantId, bucket, fileUrl) => {
    if (!isExternalRef(fileUrl)) {
      await deleteFromStorage(bucket, fileUrl);
      return;
    }
    const ref = parseExternalRef(fileUrl);
    if (!ref) return;
    // Par identifiant de connexion, pas par connexion active : un fichier déposé
    // avant une déconnexion doit rester supprimable.
    const connection = await getConnectionById(supabaseAdmin, tenantId, ref.connectionId);
    if (!connection) return;
    await createProvider(connection).deleteFile(ref.externalId);
  };

  return { storeBusinessFile, removeBusinessFile };
}
