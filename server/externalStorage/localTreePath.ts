// Chemin d'un fichier métier dans le dossier de stockage du client Electron :
//
//     <cabinet>/<code affaire> - <nom affaire>/<phase>/<fichier>
//
// C'est ce que l'architecte voit dans l'Explorateur Windows (ou sur son NAS), à
// la place de l'ancien <cabinet>/<affaire>/<phase>/<identifiant>/<fichier>.
//
// Trois contraintes, qui décident de tout le reste :
//
//  1. ASCII seulement. Le chemin local est aussi la clé d'objet envoyée au cloud
//     par l'export initial (server/initialExport.ts), et Supabase Storage refuse
//     toute clé hors ASCII (« Invalid key ») sans que l'export le dise : les
//     accents sont donc retirés (« Réhabilitation » devient « Rehabilitation »).
//     Les espaces, tirets, points, parenthèses et apostrophes restent : ils sont
//     acceptés par Supabase ET lisibles.
//  2. Valide sous Windows et sur un partage réseau : pas de caractères réservés,
//     pas de point ou d'espace final, pas de nom réservé (CON, NUL, COM1...).
//  3. Court. Windows limite un chemin à 260 caractères et la racine du NAS en
//     consomme une quarantaine : le chemin relatif reste sous MAX_RELATIVE_PATH.
//
// Aucun nom n'est garanti unique : l'appelant essaie `attempt` = 1, 2, 3... tant
// que la passerelle répond « existe déjà » (server/offlineGateway.ts, création
// exclusive), ce qui donne « plan.pdf », « plan (2).pdf », « plan (3).pdf ».
import { safeSegment } from '../storageKey';

const MAX_FOLDER_SEGMENT = 50;
const MAX_FILE_NAME = 80;
const MAX_RELATIVE_PATH = 190;
const MAX_NUMBERED_ATTEMPTS = 50;
// Un point suivi de 1 à 10 caractères alphanumériques : sinon ce n'est pas une extension.
const EXTENSION = /\.([A-Za-z0-9]{1,10})$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Retire les accents et ramène la ponctuation typographique à de l'ASCII. */
function fold(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'Oe')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .replace(/[‘’‚]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/&/g, ' et ');
}

/** Un segment : lettres, chiffres, espace, `. _ ( ) ' -`, le reste devient une espace. */
function cleanSegment(value: string): string {
  return fold(value)
    .replace(/[^A-Za-z0-9 ._()'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
}

function avoidReserved(stem: string): string {
  return WINDOWS_RESERVED.test(stem) ? `${stem}_` : stem;
}

/** Un dossier (affaire, phase). Jamais vide, jamais « . » ni « .. ». */
export function readableFolderSegment(name: string | null | undefined, fallback = 'Sans nom'): string {
  const cut = cleanSegment(String(name ?? '')).slice(0, MAX_FOLDER_SEGMENT).replace(/[.\s]+$/, '');
  return avoidReserved(cut) || fallback;
}

/**
 * Un nom de fichier, extension préservée à la troncature (un « .pdf » perdu rend le
 * fichier inouvrable d'un double-clic). `attempt` >= 2 ajoute « (n) » avant l'extension.
 */
export function readableFileName(
  name: string | null | undefined,
  attempt = 1,
  maxLength = MAX_FILE_NAME,
): string {
  const cleaned = cleanSegment(String(name ?? ''));
  const match = cleaned.match(EXTENSION);
  const ext = match && cleaned.length > match[0].length ? match[0] : '';
  const stemRaw = ext ? cleaned.slice(0, -ext.length) : cleaned;

  const suffix = attempt <= 1 ? '' : attempt <= MAX_NUMBERED_ATTEMPTS ? ` (${attempt})` : ` (${Date.now()})`;
  const room = Math.max(8, maxLength - ext.length - suffix.length);
  const stem = avoidReserved(stemRaw.slice(0, room).replace(/[.\s]+$/, '')) || 'fichier';
  return `${stem}${suffix}${ext}`;
}

export interface ReadablePathInput {
  tenantId: string;
  /** Chemin DANS le cabinet : ['26014 - Villa Martin', 'DCE']. */
  folderPath: string[];
  fileName: string;
}

/**
 * Le chemin d'objet complet (relatif au dossier du bucket). Le cabinet reste le
 * premier segment : l'export cloud initial ne parcourt que `<bucket>/<cabinet>/`.
 */
export function readableObjectPath(input: ReadablePathInput, attempt = 1): string {
  const folders = input.folderPath.map((segment) => readableFolderSegment(segment));
  const prefix = [safeSegment(input.tenantId, 'cabinet'), ...folders].join('/');
  // Le dossier est déjà borné ; si le total dépasse quand même, c'est le nom du
  // fichier qui s'efface, jamais un dossier (qui changerait l'arborescence).
  const room = Math.max(12, Math.min(MAX_FILE_NAME, MAX_RELATIVE_PATH - prefix.length - 1));
  return `${prefix}/${readableFileName(input.fileName, attempt, room)}`;
}

/** Vrai pour l'erreur que la passerelle renvoie quand l'objet existe déjà. */
export function isDuplicateUploadError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? '');
  return /already exists|duplicate|\b409\b/i.test(text);
}

/** Nombre d'essais numérotés avant de passer à l'horodatage. */
export const LAST_NUMBERED_ATTEMPT = MAX_NUMBERED_ATTEMPTS;
