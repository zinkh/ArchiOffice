// ── Destination d'un fichier exporté ─────────────────────────────────────────
// Les exporteurs (PDF, Excel, Word) produisent un fichier nommé. Par défaut il
// est proposé au téléchargement ; l'export groupé du dossier PRO fournit sa
// propre sortie pour rassembler plusieurs fichiers dans un ZIP.
import { saveAs } from 'file-saver';

export type Sortie = (nom: string, blob: Blob) => void | Promise<void>;

export const telecharger: Sortie = (nom, blob) => { saveAs(blob, nom); };

/** jsPDF : sans sortie, `doc.save()` comme avant ; sinon le fichier part à la sortie. */
export async function enregistrerPdf(
  doc: { save(nom: string): unknown; output(type: 'blob'): Blob },
  nom: string,
  sortie?: Sortie,
): Promise<void> {
  if (sortie) await sortie(nom, doc.output('blob'));
  else doc.save(nom);
}

export interface FichierExporte { nom: string; blob: Blob }

/** Nom de fichier sûr : sans accent ni caractère réservé, borné. */
export function nomSur(nom: string, max = 120): string {
  const point = nom.lastIndexOf('.');
  const base = point > 0 ? nom.slice(0, point) : nom;
  const ext = point > 0 ? nom.slice(point) : '';
  const propre = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `${(propre || 'document').slice(0, max)}${ext}`;
}

/** Rend les noms uniques dans une même archive : « a.pdf », « a (2).pdf »... */
export function nomsUniques(fichiers: FichierExporte[]): FichierExporte[] {
  const vus = new Map<string, number>();
  return fichiers.map(f => {
    const cle = f.nom.toLowerCase();
    const n = (vus.get(cle) ?? 0) + 1;
    vus.set(cle, n);
    if (n === 1) return f;
    const point = f.nom.lastIndexOf('.');
    const nom = point > 0 ? `${f.nom.slice(0, point)} (${n})${f.nom.slice(point)}` : `${f.nom} (${n})`;
    return { ...f, nom };
  });
}

/** Un seul fichier part tel quel ; plusieurs sont réunis dans un ZIP. */
export async function livrer(fichiers: FichierExporte[], nomArchive: string): Promise<void> {
  if (fichiers.length === 0) return;
  if (fichiers.length === 1) { await telecharger(fichiers[0].nom, fichiers[0].blob); return; }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const f of nomsUniques(fichiers)) zip.file(f.nom, f.blob);
  const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  await telecharger(nomArchive, archive);
}
