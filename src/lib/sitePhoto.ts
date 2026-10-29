// Préparation d'une photo de chantier AVANT son envoi : réduite sur l'appareil.
//
// Une photo d'iPad fait 3 à 8 Mo (12 Mpx). Le serveur la ramène de toute façon à
// 1600 px (`MEETING_PHOTO_MAX_DIMENSION`, server/imageUpload.ts), mais seulement
// APRÈS avoir reçu tous les octets : sur un réseau de chantier, c'est l'envoi du
// fichier d'origine qui prenait des minutes et occupait la connexion pendant que
// la liste attendait ses miniatures. Réduire ici donne le même résultat stocké
// (même côté maximal, même qualité) pour un dixième du trafic, et c'est aussi ce
// petit fichier que la file hors ligne garde dans IndexedDB.
import { photoToJpeg } from './feasibilityPhoto';

/** Même plafond que le serveur : réduire davantage dégraderait les photos, réduire moins n'apporterait rien. */
export const SITE_PHOTO_MAX_SIDE = 1600;
export const SITE_PHOTO_JPEG_QUALITY = 0.82;
/** Un JPEG déjà sous ce poids part tel quel : le ré-encoder n'apporterait rien. */
export const SITE_PHOTO_KEEP_BELOW_BYTES = 450 * 1024;

/** Vrai quand la photo est assez légère pour partir sans être ré-encodée. */
export function isAlreadyLight(file: { size: number; type: string }): boolean {
  return file.type === 'image/jpeg' && file.size <= SITE_PHOTO_KEEP_BELOW_BYTES;
}

/** Nom du fichier réduit : même nom de base, extension .jpg. */
export function jpegName(name: string | undefined): string {
  const base = (name || 'photo').replace(/\.[^.]+$/, '').trim() || 'photo';
  return `${base}.jpg`;
}

/**
 * Réduit une photo pour l'envoi. Ne lève jamais : si le navigateur ne sait pas la décoder, ou si
 * le résultat n'est pas plus léger, la photo d'origine est renvoyée (le serveur la traitera comme avant).
 */
export async function prepareSitePhoto(file: File): Promise<File> {
  if (typeof document === 'undefined' || !file.type.startsWith('image/') || isAlreadyLight(file)) return file;
  try {
    const blob = await photoToJpeg(file, SITE_PHOTO_MAX_SIDE, SITE_PHOTO_JPEG_QUALITY);
    if (blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } catch (error) {
    console.warn("[sitePhoto] réduction impossible, envoi de la photo d'origine", error);
    return file;
  }
}
