// Segments de clé Supabase Storage.
//
// Supabase Storage refuse toute clé d'objet hors ASCII (« Invalid key »). Un
// libellé saisi dans l'interface (la phase « Général », un nom de fichier
// « Plan d'étage n°2.pdf » partagé depuis Android) ne doit donc jamais entrer
// tel quel dans un chemin de stockage : chaque segment passe par safeSegment().
//
// Ne concerne QUE la clé d'objet, que personne ne lit : le nom d'origine reste
// dans `documents.name` (affichage), et l'arborescence créée sur l'espace du
// cabinet garde ses accents (server/externalStorage/folderNaming.ts).

const MAX_SEGMENT = 100;

/** Un segment de chemin réduit à [a-zA-Z0-9._-] : accents retirés, tout autre
 *  caractère remplacé par « - », tirets fusionnés et retirés aux extrémités.
 *  « Général » → « General ». Jamais vide, jamais « . » ni « .. ». */
export function safeSegment(value: string | null | undefined, fallback = 'sans-nom'): string {
  const cleaned = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SEGMENT)
    .replace(/-+$/, '');
  return cleaned && !/^\.+$/.test(cleaned) ? cleaned : fallback;
}

/** Un nom de fichier : comme safeSegment(), mais l'extension est gardée à
 *  part pour survivre à la troncature. */
export function safeFileName(name: string | null | undefined): string {
  const raw = String(name ?? '');
  const dot = raw.lastIndexOf('.');
  const hasExt = dot > 0 && dot < raw.length - 1;
  const ext = hasExt ? safeSegment(raw.slice(dot + 1), '').replace(/\./g, '').slice(0, 10) : '';
  const base = safeSegment(hasExt ? raw.slice(0, dot) : raw, 'fichier')
    .slice(0, MAX_SEGMENT - (ext ? ext.length + 1 : 0))
    .replace(/[-.]+$/, '') || 'fichier';
  return ext ? `${base}.${ext}` : base;
}
