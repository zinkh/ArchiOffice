// ── Verser un document généré au DCE ─────────────────────────────────────────
// Un PDF produit par l'application (RC, CCAP, acte d'engagement, CCTP ou DPGF
// d'un lot) devient un document de l'affaire (catégorie « DCE ») rattaché à une
// pièce du DCE. Les pièces cochées pour les lots d'une entreprise partent alors
// d'office avec son mail d'invitation. Déjà versé : nouvelle version du même
// document (indice suivant), jamais un doublon.
import type { DocumentDce } from './dceIndices';

export type TypePieceDce = 'RC' | 'CCAP' | 'CCTP' | 'DPGF' | 'Autre';

/** Ce qui identifie une pièce du DCE à alimenter. */
export interface SpecPieceDce {
  typeDoc: TypePieceDce;
  /** Intitulé de la pièce (« CCTP - Lot 02 Gros œuvre »). */
  nom: string;
  /** Une seule pièce de ce type dans le DCE (RC, CCAP) : retrouvée par son type, quel que soit son intitulé. */
  unique?: boolean;
  /** Lots concernés ; absent : tous les lots. */
  lotsIds?: string[];
}

export interface EntreePieceDce {
  id: string;
  nom: string;
  type_doc: string;
  tous_lots: boolean;
  lots_ids: string[];
  document_ids?: string[];
}

const memeEntree = (d: EntreePieceDce, spec: SpecPieceDce) =>
  d.type_doc === spec.typeDoc && (spec.unique || d.nom === spec.nom);

/** Document déjà versé pour cette pièce et ce nom de fichier, s'il existe encore dans l'affaire. */
export function documentDejaVerse(
  dce: EntreePieceDce[], documents: DocumentDce[], spec: SpecPieceDce, nomFichier: string,
): DocumentDce | undefined {
  const ids = new Set(dce.filter(d => memeEntree(d, spec)).flatMap(d => d.document_ids ?? []));
  return documents.find(d => ids.has(d.id) && d.name === nomFichier);
}

/**
 * Document déjà rattaché à cette pièce du DCE (le plus récemment rattaché qui existe encore dans l'affaire).
 * Le nom de fichier portant l'indice (`..._B.pdf`), il change à chaque version : la pièce, pas le nom, dit
 * quel document reçoit la nouvelle version.
 */
export function documentDeLaPiece(
  dce: EntreePieceDce[], documents: DocumentDce[], spec: SpecPieceDce,
): DocumentDce | undefined {
  const ids = dce.filter(d => memeEntree(d, spec)).flatMap(d => d.document_ids ?? []);
  const parId = new Map(documents.map(d => [d.id, d]));
  for (let i = ids.length - 1; i >= 0; i--) {
    const d = parId.get(ids[i]);
    if (d) return d;
  }
  return undefined;
}

/** Indice de la version suivante d'un document : A, B, C... (A pour un premier versement). Même règle que le serveur. */
export function indiceSuivant(indiceActuel?: string | null): string {
  const c = (indiceActuel ?? '').trim().toUpperCase().charAt(0);
  return c >= 'A' && c < 'Z' ? String.fromCharCode(c.charCodeAt(0) + 1) : 'A';
}

/** Un morceau de nom de fichier : sans accents ni espaces, les mots séparés par « - ». */
const morceau = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Nom systématique d'un fichier du DCE : `Code_Pièce_NumLot-NomLot-Indice.pdf`
 * (« 2419_CCTP_05-Menuiseries-interieures-B.pdf »). Une pièce commune à tous les lots
 * (RC, CCAP, acte d'engagement) n'a pas de lot : `Code_Pièce-Indice.pdf`.
 * Le type de pièce est dans le nom : le CCTP et le DPGF d'un même lot ne se confondent pas au téléchargement.
 */
export function nomFichierDce(opts: {
  code: string; piece: string; lot?: { numero: string; titre: string }; indice: string; ext?: string;
}): string {
  const code = morceau(opts.code) || 'Affaire';
  const piece = morceau(opts.piece);
  const indice = morceau(opts.indice);
  const lot = opts.lot ? morceau(`${opts.lot.numero} ${opts.lot.titre}`) : '';
  const corps = lot ? `${code}_${piece}_${lot}-${indice}` : `${code}_${piece}-${indice}`;
  return `${corps}.${opts.ext ?? 'pdf'}`;
}

/** Rattache les documents versés à leur pièce du DCE, créée si elle n'existe pas. Rend un nouveau tableau. */
export function rattacherPieces<D extends EntreePieceDce>(
  dce: D[], versements: Array<{ spec: SpecPieceDce; documentId: string }>, nouvelId: () => string = () => crypto.randomUUID(),
): D[] {
  let suite = dce;
  for (const { spec, documentId } of versements) {
    const i = suite.findIndex(d => memeEntree(d, spec));
    if (i >= 0) {
      suite = suite.map((d, j) => (j === i ? { ...d, document_ids: [...new Set([...(d.document_ids ?? []), documentId])] } : d));
    } else {
      suite = [...suite, {
        id: nouvelId(), nom: spec.nom, type_doc: spec.typeDoc,
        tous_lots: !spec.lotsIds?.length, lots_ids: spec.lotsIds ?? [], document_ids: [documentId],
      } as D];
    }
  }
  return suite;
}

/** Dépose le PDF dans les documents de l'affaire (nouveau document, ou nouvelle version) et rend son identifiant. */
export async function deposerFichierDce(opts: {
  projectId: string; nomFichier: string; blob: Blob; existantId?: string;
  /** Type du fichier déposé ; PDF par défaut (le DPGF Excel passe le type du classeur). */
  mimeType?: string;
}): Promise<string> {
  const form = new FormData();
  form.append('file', new File([opts.blob], opts.nomFichier, { type: opts.mimeType ?? 'application/pdf' }));
  form.append('name', opts.nomFichier);
  form.append('category', 'DCE');
  form.append('phase', 'ACT');
  form.append('description', opts.existantId ? 'Nouvelle version versée depuis la consultation' : 'Pièce du DCE générée depuis la consultation');
  if (!opts.existantId) { form.append('project_id', opts.projectId); form.append('uploaded_by', 'ACT'); }
  // Chargé à la demande : les fonctions pures de ce module ne doivent pas tirer le client Supabase.
  const { getAccessToken } = await import('./authToken');
  const token = await getAccessToken();
  const r = await fetch(opts.existantId ? `/api/documents/${encodeURIComponent(opts.existantId)}` : '/api/documents', {
    method: opts.existantId ? 'PUT' : 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form,
  });
  const doc = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(doc?.error || 'Le dépôt du document a échoué.');
  return opts.existantId ?? doc.id;
}
