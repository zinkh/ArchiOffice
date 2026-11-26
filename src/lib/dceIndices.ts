// ── DCE : fichiers joints et tableau d'indices ───────────────────────────────
// Chaque pièce du DCE (RC, CCAP, plans...) peut regrouper plusieurs documents de
// l'affaire. Le tableau d'indices dit, pour chacun, quel indice de révision et
// quelle date l'entreprise reçoit : c'est ce qui permet de savoir, à la remise des
// offres, sur quelle version elle a chiffré. L'indice et la date viennent de la
// fiche du document (jamais ressaisis ici) ; rien n'est inventé.

/** Document de l'affaire, tel que le rend GET /api/documents. */
export interface DocumentDce {
  id: string;
  name: string;
  file_url: string;
  mime_type?: string | null;
  indice?: string | null;
  version?: number | null;
  uploaded_at?: string | null;
}

/** Une pièce du DCE avec les documents qu'elle regroupe. */
export interface PieceDceFichiers {
  libelle: string;
  tous_lots: boolean;
  lots_ids: string[];
  document_ids?: string[];
}

export interface LigneIndice {
  numero: string;
  designation: string;
  fichier: string;
  indice: string;
  date: string;
  /** Pièce sans fichier rattaché (ou fichier supprimé) : à joindre avant l'envoi. */
  manquant: boolean;
}

/** Pièces qui concernent une entreprise : celles de tous les lots, ou d'un de ses lots. */
export function piecesDeEntreprise<P extends { tous_lots: boolean; lots_ids: string[] }>(
  pieces: P[], lotsIds: string[],
): P[] {
  return pieces.filter(p => p.tous_lots || p.lots_ids.some(id => lotsIds.includes(id)));
}

export function dateFr(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
}

/** Une ligne par fichier ; « 3 » pour un fichier unique, « 3.1 », « 3.2 » pour plusieurs. */
export function lignesIndices(pieces: PieceDceFichiers[], documents: DocumentDce[]): LigneIndice[] {
  const parId = new Map(documents.map(d => [d.id, d]));
  return pieces.flatMap<LigneIndice>((piece, i) => {
    const fichiers = (piece.document_ids ?? []).map(id => parId.get(id)).filter((d): d is DocumentDce => !!d);
    if (fichiers.length === 0) {
      return [{ numero: `${i + 1}`, designation: piece.libelle, fichier: '', indice: '', date: '', manquant: true }];
    }
    return fichiers.map((d, j) => ({
      numero: fichiers.length > 1 ? `${i + 1}.${j + 1}` : `${i + 1}`,
      designation: piece.libelle,
      fichier: d.name,
      indice: (d.indice ?? '').trim(),
      date: dateFr(d.uploaded_at),
      manquant: false,
    }));
  });
}

/** Documents à joindre au message, sans doublon (un même plan peut servir à deux pièces). */
export function documentsAJoindre(pieces: PieceDceFichiers[], documents: DocumentDce[]): DocumentDce[] {
  const parId = new Map(documents.map(d => [d.id, d]));
  const vus = new Set<string>();
  const retenus: DocumentDce[] = [];
  for (const piece of pieces) {
    for (const id of piece.document_ids ?? []) {
      const d = parId.get(id);
      if (d && !vus.has(id)) { vus.add(id); retenus.push(d); }
    }
  }
  return retenus;
}
