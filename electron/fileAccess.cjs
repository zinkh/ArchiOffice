// Accès d'Electron aux fichiers du cabinet : « Afficher dans l'Explorateur » et
// « Ouvrir ».
//
// Le renderer ne transmet JAMAIS un chemin de disque. Il désigne un fichier par sa
// clé de stockage (`{ bucket, path }`, rendue par GET /api/storage/local-file après
// vérification que le fichier appartient au cabinet), et c'est ICI que le chemin réel
// est reconstruit, à partir du dossier de stockage que seul le processus principal
// connaît. Même principe que `openDataFolder`, qui ne reçoit qu'un type de dossier.
//
// Ce module ne fait que deux choses :
//  - retrouver, sous le dossier de stockage, un fichier désigné par une clé, en
//    refusant tout ce qui en sortirait (`..`, chemin absolu, lecteur Windows, flux
//    de données alternatif, lien symbolique) ;
//  - dire si un fichier peut être ouvert directement par son application associée.
//
// Ouvrir un fichier lance un programme. Un fichier déposé dans les documents peut
// venir d'une entreprise (dépôt DOE, pièce de mail) : un .exe, un .bat, un .lnk ou
// un document à macros ne doit JAMAIS s'exécuter d'un clic sur « Ouvrir ». D'où une
// liste d'extensions sûres, et non une liste d'interdits : un type inconnu est
// refusé, et reste consultable par « Afficher dans l'Explorateur », qui ne lance rien.
'use strict';

const fs = require('fs');
const path = require('path');

/** Les seuls buckets dont Electron ouvre des fichiers. */
const OPENABLE_BUCKETS = new Set(['documents', 'plans']);

/** Documents, images et plans courants d'un cabinet. Aucun format exécutable, aucun
 *  format à macros (docm, xlsm, pptm), aucun raccourci, aucune archive. */
const OPENABLE_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv', 'md',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg',
  'dwg', 'dxf', 'skp', 'ifc', 'rvt', 'rfa', 'pln', 'dgn',
]);

const normalizeCase = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

/**
 * Le chemin réel d'un fichier désigné par sa clé de stockage, ou null.
 * Jamais d'exception : toute entrée douteuse donne simplement null.
 */
function resolveStorageFile(storageRoot, bucket, objectPath) {
  if (typeof storageRoot !== 'string' || !storageRoot) return null;
  if (!OPENABLE_BUCKETS.has(bucket)) return null;
  if (typeof objectPath !== 'string' || !objectPath || objectPath.includes('\0')) return null;

  const segments = objectPath.split('/');
  // Un segment vide couvre le chemin absolu (« /etc ») et les « // » ; « : » couvre
  // « C:\... » et les flux de données alternatifs NTFS (« fichier.pdf:flux ») ;
  // « \ » est un séparateur sous Windows.
  const dangerous = segments.some((s) => s === '' || s === '.' || s === '..' || /[\\:]/.test(s));
  if (dangerous) return null;

  let root;
  let candidate;
  try {
    root = fs.realpathSync(path.join(storageRoot, bucket));
    // realpath suit les liens symboliques : un lien posé dans le dossier de stockage et
    // pointant ailleurs est détecté par la comparaison qui suit.
    candidate = fs.realpathSync(path.join(root, ...segments));
  } catch {
    return null;
  }

  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!normalizeCase(candidate).startsWith(normalizeCase(rootWithSep))) return null;

  try {
    if (!fs.statSync(candidate).isFile()) return null;
  } catch {
    return null;
  }
  return candidate;
}

/** Vrai si l'application associée à ce fichier peut être lancée sans risque d'exécuter
 *  un programme. */
function isSafeToOpen(filePath) {
  const ext = path.extname(String(filePath || '')).slice(1).toLowerCase();
  return OPENABLE_EXTENSIONS.has(ext);
}

module.exports = { resolveStorageFile, isSafeToOpen, OPENABLE_BUCKETS, OPENABLE_EXTENSIONS };
