// Dépose une remise d'entreprise sur l'espace de stockage du cabinet.
//
// Même mécanique que storeBusinessFile (server/externalStorage/), SANS sa
// branche Supabase : ici il n'y a pas de repli. Si le drive du cabinet ne
// répond pas, le dépôt échoue en 502 et l'entreprise est invitée à réessayer,
// plutôt que d'enregistrer des offres chez nous et de remplir le quota que le
// cabinet cherche justement à épargner.
import { sanitizeExternalFileName } from '../externalStorage/folderNaming';
import { buildExternalRef } from '../externalStorage/externalRef';
import {
  recordConnectionError,
  recordConnectionSuccess,
  type ExternalStorageConnection,
} from '../externalStorage/externalConnection';
import { ensureFolderPath, folderKeyFor, invalidateFolderSubtree } from '../externalStorage/externalFolders';
import { createProvider } from '../externalStorage/providerFactory';
import { ExternalFolderMissingError, ExternalStorageError } from '../externalStorage/provider';

export interface FichierADeposer {
  tenantId: string;
  connection: ExternalStorageConnection;
  /** Chemin DANS la racine du cabinet (buildConsultationFolderPath). */
  folderPath: string[];
  fileName: string;
  buffer: Buffer;
  mimetype: string;
}

export interface FichierDepose {
  fileUrl: string;
  fileName: string;
  sizeBytes: number;
}

export async function deposerFichierConsultation(supabaseAdmin: any, f: FichierADeposer): Promise<FichierDepose> {
  const provider = createProvider(f.connection);
  const fileName = sanitizeExternalFileName(f.fileName);

  const tentative = async () => {
    const folderId = await ensureFolderPath(supabaseAdmin, f.tenantId, f.connection, provider, f.folderPath);
    return provider.uploadFile(folderId, fileName, f.buffer, f.mimetype);
  };

  try {
    let result;
    try {
      result = await tentative();
    } catch (err) {
      if (!(err instanceof ExternalFolderMissingError)) throw err;
      // Dossier renommé ou mis à la corbeille depuis le drive : on oublie le
      // sous-arbre mémorisé et on rejoue UNE fois.
      await invalidateFolderSubtree(supabaseAdmin, f.connection.id, folderKeyFor(f.connection, f.folderPath));
      result = await tentative();
    }
    recordConnectionSuccess(supabaseAdmin, f.connection).catch(() => {});
    return {
      fileUrl: buildExternalRef({
        provider: f.connection.provider,
        connectionId: f.connection.id,
        externalId: result.externalId,
        fileName,
      }),
      fileName,
      sizeBytes: result.sizeBytes || f.buffer.length,
    };
  } catch (err) {
    await recordConnectionError(supabaseAdmin, f.connection, err);
    const wrapped: any = new Error("Le dépôt n'a pas pu être enregistré sur l'espace de stockage du cabinet.");
    wrapped.status = err instanceof ExternalStorageError ? err.status : 502;
    wrapped.cause = err;
    throw wrapped;
  }
}
