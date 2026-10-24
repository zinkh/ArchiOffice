// « Afficher dans l'Explorateur » et « Ouvrir » pour un document du cabinet, dans le
// client de bureau (Electron) seulement.
//
// Deux temps, et aucun chemin de disque ne traverse le renderer :
//   1. le serveur transforme la référence du fichier en clé de stockage locale
//      ({ bucket, path }) après avoir vérifié qu'il appartient au cabinet
//      (GET /api/storage/local-file) ;
//   2. le processus principal d'Electron reconstruit le chemin réel à partir de cette
//      clé et de son propre dossier de stockage (electron/fileAccess.cjs).
//
// La disponibilité n'est vérifiée qu'au clic : une liste de documents ne doit pas
// faire une requête par ligne.
import { apiFetch } from './api';
import i18n from '../i18n';
import { desktopBridge, type LocalFileRef } from './desktopBridge';

/** Vrai dans le client de bureau : les boutons n'ont aucun sens dans un navigateur. */
export function canUseLocalFiles(): boolean {
  return desktopBridge() !== null;
}

/** La clé de stockage locale d'un fichier, ou null s'il n'est pas sur ce poste
 *  (référence vers le Drive du cabinet, fichier absent du dossier de stockage). */
export async function resolveLocalFile(fileUrl: string): Promise<LocalFileRef | null> {
  const res = await apiFetch<{ available: boolean; bucket?: string; path?: string }>(
    `/api/storage/local-file?url=${encodeURIComponent(fileUrl)}`,
  );
  return res.available && res.bucket && res.path ? { bucket: res.bucket, path: res.path } : null;
}

/** Sélectionne le fichier dans l'Explorateur (ne lance aucun programme). */
export async function revealLocalFile(fileUrl: string): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) return;
  try {
    const ref = await resolveLocalFile(fileUrl);
    if (!ref || !(await bridge.revealFile(ref))) alert(i18n.t('local_file_unavailable'));
  } catch (err) {
    console.error('[localFiles] Failed to reveal file:', err);
    alert(i18n.t('local_file_unavailable'));
  }
}

/** Ouvre le fichier dans son application associée, sauf type pouvant lancer un programme. */
export async function openLocalFile(fileUrl: string): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) return;
  try {
    const ref = await resolveLocalFile(fileUrl);
    if (!ref) {
      alert(i18n.t('local_file_unavailable'));
      return;
    }
    const result = await bridge.openFile(ref);
    if (result === 'introuvable') alert(i18n.t('local_file_unavailable'));
    else if (result === 'type_non_ouvrable') alert(i18n.t('local_file_not_openable'));
    else if (result === 'echec') alert(i18n.t('local_file_open_failed'));
  } catch (err) {
    console.error('[localFiles] Failed to open file:', err);
    alert(i18n.t('local_file_open_failed'));
  }
}
