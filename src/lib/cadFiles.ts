// Fichiers CAO, BIM et 3D, et noms de fichiers que le client desktop ignore.
//
// Une SEULE liste, partagée par le serveur (server/desktop/uploads.ts) et, le moment
// venu, par la route web de dépôt de documents. Voir docs/desktop-sync-contract.md,
// section 8.4 : les octets d'un fichier CAO ne vont jamais dans Supabase Storage, ils
// exigent l'espace de stockage du cabinet.

/** Extensions CAO, BIM et 3D, en minuscules et sans point. */
export const CAD_EXTENSIONS: readonly string[] = [
  'dwg', 'dxf', 'dwt', 'dwf', // AutoCAD
  'rvt', 'rfa', 'rte', // Revit
  'ifc', 'ifczip', // BIM ouvert
  'skp', // SketchUp
  'pln', 'pla', 'mod', // Archicad
  'dgn', // MicroStation
  'vwx', // Vectorworks
  '3dm', 'rhl', // Rhino
];

const CAD_SET = new Set(CAD_EXTENSIONS);

/** Extension en minuscules sans point ; chaîne vide s'il n'y en a pas (« .gitignore » n'en a pas). */
export function fileExtension(name: string | null | undefined): string {
  const base = String(name ?? '').trim();
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isCadFileName(name: string | null | undefined): boolean {
  return CAD_SET.has(fileExtension(name));
}

// Fichiers que Word, AutoCAD, Archicad, l'Explorateur et le Finder créent à côté du
// document : ils ne sont jamais des documents d'affaire.
const IGNORED_EXACT = new Set(['thumbs.db', '.ds_store', 'desktop.ini', 'ehthumbs.db', '.localized']);

/** Vrai pour un fichier temporaire ou système : verrou Office (`~$`), `.tmp`, `.bak`, `._` (AppleDouble)... */
export function isIgnoredFileName(name: string | null | undefined): boolean {
  const base = String(name ?? '').trim();
  if (!base) return false;
  const lower = base.toLowerCase();
  if (IGNORED_EXACT.has(lower)) return true;
  if (base.startsWith('~$') || base.startsWith('._')) return true;
  const ext = fileExtension(base);
  return ext === 'tmp' || ext === 'bak' || ext === 'dwl' || ext === 'dwl2' || ext === 'part';
}
