// Une « fiche » d'un poste peut être une photo (de l'existant, d'un produit posé, d'une étiquette) que l'IA
// DÉCRIT pour alimenter le texte du poste, au lieu d'un document dont elle lit le texte. Reconnue par
// l'extension du fichier. Module pur et sans dépendance : il sert aussi bien à l'écran, à l'export du
// CCTP (une photo n'est ni rappelée ni jointe comme fiche technique) qu'au serveur.
const EXTENSIONS_PHOTO = /\.(jpe?g|png|webp|heic|heif)$/i;

export const estPhoto = (nom: string | undefined | null): boolean => EXTENSIONS_PHOTO.test(String(nom ?? '').trim());

/** Type MIME lisible par les modèles de vision (JPEG, PNG, WebP) ; null sinon (HEIC non lu côté serveur). */
export function mimePhotoLisible(contentType: string | undefined | null, nom: string): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const t = String(contentType ?? '').toLowerCase();
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp') return t;
  const n = nom.toLowerCase();
  if (/\.jpe?g$/.test(n)) return 'image/jpeg';
  if (/\.png$/.test(n)) return 'image/png';
  if (/\.webp$/.test(n)) return 'image/webp';
  return null;
}
