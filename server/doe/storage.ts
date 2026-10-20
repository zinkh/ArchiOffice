// Stockage des fichiers du DOE. Un document reçu est une ligne de `documents`
// (doc_type = 'DOE') : il passe par storeBusinessFile et va donc, selon le
// cabinet, dans Supabase Storage ou sur son espace (Drive, Dropbox, Nextcloud,
// kDrive), avec le même contrôle de quota que le reste de la GED.
//
// Rangement sur l'espace du cabinet :
//   <racine>/<code> - <affaire>/AOR/DOE/<entreprise>/<fichier>
import crypto from 'crypto';
import { sanitizeFilename } from '../sanitizeFilename';
import { parseStorageRef } from '../storagePaths';
import { isOwnStorageRef, parseExternalRef } from '../externalStorage/externalRef';
import { getConnectionById } from '../externalStorage/externalConnection';
import { createProvider } from '../externalStorage/providerFactory';
import { buildDocumentFolderPath, type FolderProject } from '../externalStorage/businessFolderPath';
import { sanitizeFolderSegment } from '../externalStorage/folderNaming';
import type { RemoveBusinessFile, StoreBusinessFile } from '../externalStorage/storeBusinessFile';
import type { DoePieceKey } from '../../src/lib/doeAtelier';

/**
 * Les octets d'un fichier du cabinet (Supabase ou espace externe), ou null s'il
 * est introuvable, appartient à un autre cabinet ou dépasse `maxOctets`.
 */
export async function lireFichierStocke(
  supabaseAdmin: any, tenantId: string, fileUrl: string | null | undefined, maxOctets = 100 * 1024 * 1024,
): Promise<Buffer | null> {
  if (!fileUrl) return null;
  try {
    const externe = parseExternalRef(fileUrl);
    if (externe) {
      const connexion = await getConnectionById(supabaseAdmin, tenantId, externe.connectionId);
      if (!connexion) return null;
      const flux = await createProvider(connexion).openReadStream(externe.externalId);
      const morceaux: Buffer[] = [];
      let total = 0;
      for await (const m of flux.body) {
        const b = Buffer.from(m as any);
        total += b.length;
        if (total > maxOctets) return null;
        morceaux.push(b);
      }
      return Buffer.concat(morceaux);
    }
    const ref = parseStorageRef(fileUrl);
    if (!ref || !ref.path.startsWith(`${tenantId}/`)) return null;
    const { data, error } = await supabaseAdmin.storage.from(ref.bucket).download(ref.path);
    if (error || !data) return null;
    const buffer = Buffer.from(await data.arrayBuffer());
    return buffer.length > maxOctets ? null : buffer;
  } catch (err: any) {
    console.error('[doe] Lecture du fichier impossible :', err?.message);
    return null;
  }
}

export interface DepsStockageDoe {
  supabaseAdmin: any;
  storeBusinessFile: StoreBusinessFile;
}

export interface DepotDoe {
  tenantId: string;
  project: FolderProject & { id: string };
  entrepriseKey: string;
  entrepriseNom: string;
  lotId?: string | null;
  piece?: DoePieceKey | null;
  requestId?: string | null;
  source: 'entreprise' | 'cabinet';
  /** Nom affiché comme auteur du dépôt. */
  deposePar: string;
  fichier: { originalname: string; buffer: Buffer; mimetype: string };
}

/** Dossier logique d'un document DOE sur l'espace du cabinet. */
export function dossierDoe(project: FolderProject, entrepriseNom: string): string[] {
  return [...buildDocumentFolderPath(project, 'AOR'), 'DOE', sanitizeFolderSegment(entrepriseNom || 'Sans entreprise')];
}

/** Enregistre un fichier du DOE : stockage, ligne `documents` et première version. */
export async function enregistrerDocumentDoe(deps: DepsStockageDoe, d: DepotDoe): Promise<any> {
  const { supabaseAdmin, storeBusinessFile } = deps;
  const id = crypto.randomUUID();
  const stored = await storeBusinessFile({
    tenantId: d.tenantId,
    bucket: 'documents',
    folderPath: dossierDoe(d.project, d.entrepriseNom),
    fileName: d.fichier.originalname,
    supabasePath: `${d.tenantId}/${d.project.id}/AOR/${id}/${sanitizeFilename(d.fichier.originalname)}`,
  }, d.fichier.buffer, d.fichier.mimetype);
  const uploadedAt = new Date().toISOString();
  const ligne = {
    id, tenant_id: d.tenantId, project_id: d.project.id, resource_type: 'projects', resource_id: d.project.id,
    name: d.fichier.originalname, category: 'DOE', phase: 'AOR', version: 1,
    file_url: stored.fileUrl, storage_backend: stored.storageBackend, mime_type: d.fichier.mimetype,
    size_bytes: stored.sizeBytes, uploaded_by: d.deposePar, uploaded_at: uploadedAt,
    description: null, indice: 'A', doc_statut: 'en_cours', doc_type: 'DOE',
    contact_id: d.entrepriseKey, contact_name: d.entrepriseNom, validation_status: 'pending',
    doe_piece: d.piece ?? null, doe_lot_id: d.lotId ?? null, doe_request_id: d.requestId ?? null, doe_source: d.source,
  };
  const { error } = await supabaseAdmin.from('documents').insert(ligne);
  if (error) throw error;
  await supabaseAdmin.from('document_versions').insert({
    id: crypto.randomUUID(), tenant_id: d.tenantId, document_id: id, version: 1, file_url: stored.fileUrl,
    storage_backend: stored.storageBackend, uploaded_by: d.deposePar, uploaded_at: uploadedAt,
    description: null, size_bytes: stored.sizeBytes,
  });
  return ligne;
}

/** Supprime un document du DOE, sa version et son fichier (meilleur effort pour le fichier). */
export async function supprimerDocumentDoe(
  deps: { supabaseAdmin: any; removeBusinessFile: RemoveBusinessFile }, tenantId: string, doc: { id: string; file_url?: string | null },
): Promise<void> {
  const { supabaseAdmin, removeBusinessFile } = deps;
  await supabaseAdmin.from('document_versions').delete().eq('document_id', doc.id).eq('tenant_id', tenantId);
  const { error } = await supabaseAdmin.from('documents').delete().eq('id', doc.id).eq('tenant_id', tenantId);
  if (error) throw error;
  if (doc.file_url && isOwnStorageRef(doc.file_url, 'documents')) {
    removeBusinessFile(tenantId, 'documents', doc.file_url).catch(() => {});
  }
}
