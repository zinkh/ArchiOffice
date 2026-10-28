// Import de plans en lot : nom proposé, nom retenu, doublons. Logique pure, partagée
// par la fenêtre d'import et testée sans navigateur.

export const PLAN_NAME_MAX = 200;
export const PLANS_PAR_LOT_MAX = 50;

export interface PlanImportEntry {
  key: string;
  file: File;
  name: string;
}

function extensionDe(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i > 0 && i < fileName.length - 1 ? fileName.slice(i) : '';
}

/**
 * Nom effectivement enregistré : caractères interdits et espaces superflus retirés, et
 * extension du fichier d'origine rétablie si la personne l'a effacée en renommant.
 */
export function nomPlanRetenu(saisi: string, fichier: string): string {
  const propre = saisi
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PLAN_NAME_MAX);
  if (!propre) return fichier;
  const ext = extensionDe(fichier);
  if (!ext || propre.toLowerCase().endsWith(ext.toLowerCase())) return propre;
  if (/\.[A-Za-z0-9]{2,5}$/.test(propre)) return propre;
  return `${propre.slice(0, PLAN_NAME_MAX - ext.length)}${ext}`;
}

/** Noms en double dans le lot ou déjà présents sur l'affaire, sans tenir compte de la casse. */
export function nomsEnDouble(noms: string[], existants: string[] = []): Set<string> {
  const pris = new Set(existants.map(n => n.toLowerCase()));
  const vus = new Set<string>();
  const doubles = new Set<string>();
  for (const n of noms) {
    const k = n.toLowerCase();
    if (vus.has(k) || pris.has(k)) doubles.add(k);
    vus.add(k);
  }
  return doubles;
}

/** Ajoute des fichiers au lot : vides et déjà présents écartés, plafond tenu. */
export function ajouterAuLot(
  courant: PlanImportEntry[],
  fichiers: File[],
  nouvelleCle: () => string,
): { entries: PlanImportEntry[]; ignores: number; tronque: boolean } {
  const entries = [...courant];
  let ignores = 0;
  let tronque = false;
  for (const file of fichiers) {
    if (!file.size) { ignores++; continue; }
    if (entries.some(e => e.file.name === file.name && e.file.size === file.size && e.file.lastModified === file.lastModified)) {
      ignores++;
      continue;
    }
    if (entries.length >= PLANS_PAR_LOT_MAX) { tronque = true; ignores++; continue; }
    entries.push({ key: nouvelleCle(), file, name: file.name });
  }
  return { entries, ignores, tronque };
}
