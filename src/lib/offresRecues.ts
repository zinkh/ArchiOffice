// Offres remises HORS plateforme (e-mail, clé USB, courrier numérisé) : documents PDF isolés ou dossier ZIP
// complet transmis par une entreprise. Logique pure : lecture sûre des archives, recherche d'entreprise
// à la frappe, enregistrement dans la consultation (jsonb `offres_recues_fichiers`, aucune migration).
import JSZip from 'jszip';

/** Formats acceptés pour une pièce d'offre remise hors plateforme. */
export const EXTENSIONS_PIECES = ['pdf', 'docx', 'xlsx', 'xls', 'ods', 'odt', 'csv'] as const;
export const EXTENSIONS_TABLEURS = ['xlsx', 'xls', 'ods', 'csv'] as const;

/** Catégorie des documents de l'affaire créés par ce dépôt ; la route de lecture des montants n'accepte que celle-là. */
export const CATEGORIE_OFFRES_RECUES = 'Consultation - offres reçues';

/** Formats dont le texte se lit côté serveur (PDF, Word, Excel, ODS, ODT) : les seuls pour « Lire les montants ». */
export const EXTENSIONS_LISIBLES = ['pdf', 'docx', 'xlsx', 'ods', 'odt'] as const;

export const TAILLE_MAX_PIECE = 50 * 1024 * 1024;
export const TAILLE_MAX_ARCHIVE = 200 * 1024 * 1024;
/** Taille totale décompressée : borne les archives piégées (zip bomb). */
export const TAILLE_MAX_DECOMPRESSEE = 400 * 1024 * 1024;
export const NB_MAX_PIECES = 100;

export interface PieceRecue {
  /** Nom d'affichage : chemin dans l'archive, sinon nom du fichier. */
  chemin: string;
  file: File;
  /** Fichier extrait d'une archive ZIP (nom de l'archive). */
  archive?: string;
}

export interface PieceIgnoree { nom: string; motif: string }

export interface LectureDepot { pieces: PieceRecue[]; ignorees: PieceIgnoree[] }

/** Une pièce d'offre reçue hors plateforme, telle qu'enregistrée dans la consultation. */
export interface OffreFichierRecu {
  id: string;
  entreprise_id?: string;
  entreprise_nom: string;
  lots_ids: string[];
  /** Document de l'affaire (référence de stockage, jamais une URL directe). */
  document_id: string;
  file_url: string;
  nom: string;
  chemin?: string;
  archive?: string;
  taille: number;
  recu_le: string;
  statut: 'recu' | 'traite';
  origine: 'hors_plateforme';
}

export const extensionDe = (nom: string): string => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(nom);
  return m ? m[1].toLowerCase() : '';
};

export const estTableur = (nom: string): boolean => (EXTENSIONS_TABLEURS as readonly string[]).includes(extensionDe(nom));
export const estArchive = (nom: string): boolean => extensionDe(nom) === 'zip';
export const estLisible = (nom: string): boolean => (EXTENSIONS_LISIBLES as readonly string[]).includes(extensionDe(nom));
const estPiece = (nom: string): boolean => (EXTENSIONS_PIECES as readonly string[]).includes(extensionDe(nom));

/** Chemin d'une entrée d'archive jugé sûr : ni remontée (`..`), ni chemin absolu ni lecteur. */
export function cheminSur(chemin: string): string | null {
  const net = chemin.replace(/\\/g, '/');
  if (!net || net.startsWith('/') || /^[A-Za-z]:/.test(net)) return null;
  const segments = net.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some(s => s === '..' || s === '.')) return null;
  return segments.join('/');
}

/** Entrées parasites des archives créées sous macOS ou Windows. */
const estParasite = (chemin: string): boolean =>
  chemin.split('/').some(s => s === '__MACOSX' || s.startsWith('.') || s.toLowerCase() === 'thumbs.db' || s.toLowerCase() === 'desktop.ini' || s.startsWith('~$'));

export const formatOctets = (o: number) => (o < 1024 * 1024 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / (1024 * 1024)).toFixed(1)} Mo`);

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odt: 'application/vnd.oasis.opendocument.text',
  csv: 'text/csv',
};

/**
 * Lit les fichiers déposés : les ZIP sont ouverts (sous-dossiers compris), les autres gardés tels quels.
 * Seule l'extension est contrôlée ici ; le serveur revérifie à l'envoi. Rien n'est écrit sur disque :
 * les entrées sont lues en mémoire et bornées (taille, nombre, taille décompressée).
 */
export async function lireDepot(fichiers: File[]): Promise<LectureDepot> {
  const pieces: PieceRecue[] = [];
  const ignorees: PieceIgnoree[] = [];
  let decompresse = 0;

  const ajouter = (piece: PieceRecue): void => {
    if (pieces.length >= NB_MAX_PIECES) { ignorees.push({ nom: piece.chemin, motif: `limite de ${NB_MAX_PIECES} pièces atteinte` }); return; }
    if (pieces.some(p => p.chemin === piece.chemin && p.file.size === piece.file.size)) { ignorees.push({ nom: piece.chemin, motif: 'doublon' }); return; }
    pieces.push(piece);
  };

  for (const f of fichiers) {
    if (estArchive(f.name)) {
      if (f.size > TAILLE_MAX_ARCHIVE) { ignorees.push({ nom: f.name, motif: `archive de plus de ${formatOctets(TAILLE_MAX_ARCHIVE)}` }); continue; }
      let zip: JSZip;
      try { zip = await JSZip.loadAsync(f); } catch { ignorees.push({ nom: f.name, motif: 'archive illisible ou protégée par un mot de passe' }); continue; }
      const entrees = Object.values(zip.files).filter(e => !e.dir);
      for (const e of entrees) {
        const chemin = cheminSur(e.name);
        if (!chemin) { ignorees.push({ nom: e.name, motif: 'chemin non sûr' }); continue; }
        if (estParasite(chemin)) continue;
        if (!estPiece(chemin)) { ignorees.push({ nom: chemin, motif: 'format non accepté' }); continue; }
        const blob = await e.async('blob');
        decompresse += blob.size;
        if (decompresse > TAILLE_MAX_DECOMPRESSEE) { ignorees.push({ nom: chemin, motif: "contenu de l'archive trop volumineux" }); break; }
        if (blob.size > TAILLE_MAX_PIECE) { ignorees.push({ nom: chemin, motif: `plus de ${formatOctets(TAILLE_MAX_PIECE)}` }); continue; }
        const nom = chemin.split('/').pop()!;
        ajouter({ chemin, archive: f.name, file: new File([blob], nom, { type: MIME[extensionDe(nom)] || blob.type }) });
      }
      continue;
    }
    if (!estPiece(f.name)) { ignorees.push({ nom: f.name, motif: 'format non accepté (PDF, Word, Excel, ODS, ODT, CSV ou ZIP)' }); continue; }
    if (f.size > TAILLE_MAX_PIECE) { ignorees.push({ nom: f.name, motif: `plus de ${formatOctets(TAILLE_MAX_PIECE)}` }); continue; }
    ajouter({ chemin: f.name, file: f });
  }
  return { pieces, ignorees };
}

// ── Recherche d'entreprise à la frappe ─────────────────────────────────────

/** Minuscules sans accents, ponctuation ramenée à des espaces : « Hadol-Carrelage » = « hadol carrelage ». */
export const normaliser = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Entreprises qui correspondent au texte tapé : chaque mot saisi doit se retrouver dans le nom (début de mot
 * en premier, puis n'importe où). Texte vide : toutes, dans l'ordre alphabétique.
 */
export function rechercherEntreprises<T extends { nom: string }>(liste: T[], texte: string, limite = 50): T[] {
  const mots = normaliser(texte).split(' ').filter(Boolean);
  const alpha = (a: T, b: T) => a.nom.localeCompare(b.nom, 'fr');
  if (mots.length === 0) return [...liste].sort(alpha).slice(0, limite);
  const scores: Array<{ e: T; score: number }> = [];
  for (const e of liste) {
    const nom = normaliser(e.nom);
    const motsNom = nom.split(' ');
    let score = 0;
    let ok = true;
    for (const m of mots) {
      if (motsNom.some(x => x.startsWith(m))) score += 2;
      else if (nom.includes(m)) score += 1;
      else { ok = false; break; }
    }
    if (ok) scores.push({ e, score: score + (nom.startsWith(mots[0]) ? 1 : 0) });
  }
  return scores.sort((a, b) => b.score - a.score || alpha(a.e, b.e)).slice(0, limite).map(s => s.e);
}

// ── Consultation ───────────────────────────────────────────────────────────

export interface ConsultationAvecOffresRecues { offres_recues_fichiers?: OffreFichierRecu[] }

export const offresRecues = (c: ConsultationAvecOffresRecues): OffreFichierRecu[] =>
  Array.isArray(c.offres_recues_fichiers) ? c.offres_recues_fichiers : [];

export function ajouterOffresRecues<C extends ConsultationAvecOffresRecues>(c: C, nouvelles: OffreFichierRecu[]): C {
  if (nouvelles.length === 0) return c;
  return { ...c, offres_recues_fichiers: [...offresRecues(c), ...nouvelles] };
}

export function marquerOffreRecue<C extends ConsultationAvecOffresRecues>(c: C, id: string, statut: OffreFichierRecu['statut']): C {
  return { ...c, offres_recues_fichiers: offresRecues(c).map(o => (o.id === id ? { ...o, statut } : o)) };
}

/** Retire la pièce de la consultation ; le document reste dans les documents de l'affaire. */
export function retirerOffreRecue<C extends ConsultationAvecOffresRecues>(c: C, id: string): C {
  return { ...c, offres_recues_fichiers: offresRecues(c).filter(o => o.id !== id) };
}
