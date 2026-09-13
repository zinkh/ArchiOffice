// Assainissement des noms de dossiers et de fichiers créés sur l'espace de
// stockage du cabinet.
//
// Volontairement DISTINCT de server/sanitizeFilename.ts, qu'il ne faut surtout
// pas réutiliser ici : sa règle `[^a-zA-Z0-9._-] → _` transforme « Général » en
// « G_n_ral » et « Villa Martin » en « Villa_Martin ». C'est acceptable pour un
// chemin d'objet Supabase, que personne ne regarde jamais ; ça ne l'est pas
// pour une arborescence que l'architecte ouvre dans son propre Drive. Les
// accents, les espaces et les tirets sont donc conservés, et seuls les
// caractères que les trois fournisseurs (et Windows, côté client de
// synchronisation) refusent réellement sont retirés.
//
// sanitizeFilename reste utilisé pour construire le chemin Supabase de repli :
// les chemins d'objets existants ne changent pas d'un caractère.

// Union des interdits de Windows et de WebDAV, plus les caractères de contrôle.
// Google Drive et Dropbox sont plus permissifs, mais un cabinet qui synchronise
// son drive sur un poste Windows ne doit pas se retrouver avec des dossiers
// impossibles à ouvrir.
const FORBIDDEN = new RegExp('[/\\\\:*?"<>|\\u0000-\\u001f\\u007f]', 'g');

const MAX_SEGMENT = 80;
const MAX_FILENAME = 120;

function collapse(value: string): string {
  return value.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim();
}

/** Retire les points et espaces de fin : Windows les supprime silencieusement,
 *  et certaines implémentations WebDAV refusent la création. */
function trimTrailing(value: string): string {
  return value.replace(/[.\s]+$/, '');
}

/** Un segment de chemin (nom d'affaire, phase). Accents, espaces et tirets conservés. */
export function sanitizeFolderSegment(name: string | null | undefined): string {
  const cleaned = trimTrailing(collapse(String(name ?? ''))).slice(0, MAX_SEGMENT);
  return trimTrailing(cleaned) || 'Sans nom';
}

/** Un nom de fichier. Même règle, mais l'extension est préservée à la troncature :
 *  un « .pdf » perdu rend le fichier inouvrable d'un double-clic. */
export function sanitizeExternalFileName(name: string | null | undefined): string {
  const cleaned = collapse(String(name ?? ''));
  if (!cleaned) return 'fichier';
  if (cleaned.length <= MAX_FILENAME) return trimTrailing(cleaned) || 'fichier';

  const dot = cleaned.lastIndexOf('.');
  // Un point en tout début de nom, ou suivi de plus de dix caractères, n'est pas
  // une extension — on tronque alors sans précaution particulière.
  if (dot <= 0 || cleaned.length - dot > 11) return cleaned.slice(0, MAX_FILENAME);

  const ext = cleaned.slice(dot);
  const stem = cleaned.slice(0, dot).slice(0, MAX_FILENAME - ext.length);
  return `${trimTrailing(stem) || 'fichier'}${ext}`;
}
