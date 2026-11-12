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
}): Promise<string> {
  const form = new FormData();
  form.append('file', new File([opts.blob], opts.nomFichier, { type: 'application/pdf' }));
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
