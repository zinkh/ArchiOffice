// ── Dossier de consultation en une seule archive (portail public de dépôt) ───
// Rassemble tout ce que l'entreprise peut déjà télécharger pièce par pièce (les pièces du DCE de
// ses lots et les documents publiés), rangé en un dossier par pièce. Rien de plus que ce qu'elle
// voit sur sa page : la liste des entrées est établie par la route, jamais déduite d'ici.
//
// L'archive se construit en mémoire : un plafond de taille et de nombre de fichiers la borne, et
// un compteur limite les constructions simultanées (voir `reserverConstruction`).
import JSZip from 'jszip';
import { lireFichierStocke } from '../doe/storage';

export const MAX_ARCHIVE_OCTETS = 150 * 1024 * 1024;
export const MAX_FICHIERS_ARCHIVE = 300;
/** Constructions d'archives simultanées sur le serveur : au-delà, on demande de réessayer. */
export const MAX_ARCHIVES_SIMULTANEES = 2;

export const DOSSIER_COMPLEMENTAIRE = 'Documents complémentaires';

export interface EntreeArchive {
  id: string;
  /** Nom du fichier tel qu'il apparaît dans l'affaire. */
  nom: string;
  /** Dossier de l'archive (la pièce du DCE, ou « Documents complémentaires »). */
  dossier: string;
  fileUrl: string | null;
}

export interface LienArchive { dossier: string; libelle: string; url: string }

/** Un nom de fichier ou de dossier sûr pour une archive : accents conservés, rien de réservé. */
export function segmentArchive(nom: string, repli = 'Sans nom'): string {
  const propre = String(nom ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[\s.]+$/g, '')
    .slice(0, 120)
    .trim();
  return propre || repli;
}

/** Chemins `dossier/fichier` sans doublon : un nom déjà pris reçoit « (2) », « (3) » avant son extension. */
export function cheminsUniques(entrees: Array<Pick<EntreeArchive, 'nom' | 'dossier'>>): string[] {
  const pris = new Set<string>();
  return entrees.map(e => {
    const dossier = segmentArchive(e.dossier, 'Dossier');
    const nom = segmentArchive(e.nom, 'Fichier');
    const point = nom.lastIndexOf('.');
    const [base, ext] = point > 0 ? [nom.slice(0, point), nom.slice(point)] : [nom, ''];
    let chemin = `${dossier}/${nom}`;
    for (let n = 2; pris.has(chemin.toLowerCase()); n += 1) chemin = `${dossier}/${base} (${n})${ext}`;
    pris.add(chemin.toLowerCase());
    return chemin;
  });
}

/** Nom du fichier .zip proposé au téléchargement, et sa version ASCII pour les navigateurs anciens. */
export function nomArchive(operation: string | null | undefined): { utf8: string; ascii: string } {
  const utf8 = `${segmentArchive(operation || 'Consultation', 'Consultation')} - Dossier de consultation.zip`;
  const ascii = utf8.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return { utf8, ascii };
}

export type ResultatArchive =
  | { ok: true; buffer: Buffer; nbFichiers: number; manquants: string[] }
  | { ok: false; raison: 'vide' | 'trop_de_fichiers' | 'trop_volumineux' };

let enCours = 0;
/** Réserve une place de construction ; rend la fonction qui la libère, ou null si le serveur est occupé. */
export function reserverConstruction(): (() => void) | null {
  if (enCours >= MAX_ARCHIVES_SIMULTANEES) return null;
  enCours += 1;
  let libere = false;
  return () => { if (!libere) { libere = true; enCours -= 1; } };
}

const texteLiens = (liens: LienArchive[]) => [
  'Liens externes du dossier de consultation',
  '',
  ...liens.map(l => `${l.dossier} : ${l.libelle}\n${l.url}\n`),
].join('\n');

const texteManquants = (noms: string[]) => [
  'Ces fichiers n\'ont pas pu être ajoutés à l\'archive (introuvables ou trop volumineux).',
  'Téléchargez-les un par un depuis la page de dépôt ou demandez-les au cabinet.',
  '',
  ...noms.map(n => `- ${n}`),
].join('\n');

/**
 * Construit l'archive. Un fichier illisible n'arrête pas tout : il est listé dans « Fichiers non
 * ajoutés.txt ». Le plafond de taille, lui, refuse l'archive entière plutôt que de la tronquer.
 */
export async function construireArchive(
  supabaseAdmin: any, tenantId: string, entrees: EntreeArchive[], liens: LienArchive[],
): Promise<ResultatArchive> {
  if (entrees.length === 0 && liens.length === 0) return { ok: false, raison: 'vide' };
  if (entrees.length > MAX_FICHIERS_ARCHIVE) return { ok: false, raison: 'trop_de_fichiers' };
  const chemins = cheminsUniques(entrees);
  const zip = new JSZip();
  const manquants: string[] = [];
  let total = 0;
  let ajoutes = 0;
  for (let i = 0; i < entrees.length; i += 1) {
    const buffer = await lireFichierStocke(supabaseAdmin, tenantId, entrees[i].fileUrl, MAX_ARCHIVE_OCTETS - total);
    if (!buffer) { manquants.push(chemins[i]); continue; }
    total += buffer.length;
    if (total > MAX_ARCHIVE_OCTETS) return { ok: false, raison: 'trop_volumineux' };
    zip.file(chemins[i], buffer);
    ajoutes += 1;
  }
  if (liens.length) zip.file('Liens externes.txt', texteLiens(liens));
  if (manquants.length) zip.file('Fichiers non ajoutés.txt', texteManquants(manquants));
  if (ajoutes === 0 && liens.length === 0) return { ok: false, raison: 'vide' };
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
  return { ok: true, buffer, nbFichiers: ajoutes, manquants };
}
