// Fiches techniques rattachées aux postes du CCTP / DPGF (fiche produit d'un
// fabricant, avis technique, PV d'essai...). Comme les illustrations, la fiche
// est un document de l'affaire (onglet Documents, catégorie « Fiches
// techniques ») ; le poste n'en garde que la référence. Logique pure : l'envoi
// des fichiers est dans `envoyerFicheTechnique`.
import type { FicheTechnique, Ligne } from '../types/dpgf';
import { getAccessToken } from './authToken';

export const CATEGORIE_FICHE_TECHNIQUE = 'Fiches techniques';
export const MAX_FICHES_PAR_POSTE = 20;

export const fichesDeLigne = (l: Pick<Ligne, 'fichesTechniques'>): FicheTechnique[] => l.fichesTechniques ?? [];

/** Ajoute des fiches sans doublon (même document) et dans la limite par poste. */
export function ajouterFiches(actuelles: FicheTechnique[] | undefined, nouvelles: FicheTechnique[]): FicheTechnique[] {
  const out = [...(actuelles ?? [])];
  for (const f of nouvelles) {
    if (out.length >= MAX_FICHES_PAR_POSTE) break;
    if (out.some(x => (f.documentId && x.documentId === f.documentId) || x.fileUrl === f.fileUrl)) continue;
    out.push(f);
  }
  return out;
}

export function retirerFiche(fiches: FicheTechnique[] | undefined, id: string): FicheTechnique[] {
  return (fiches ?? []).filter(f => f.id !== id);
}

/** Noms des fiches d'un poste, pour les exports (« Fiches techniques : a.pdf, b.pdf »). */
export const nomsFiches = (l: Pick<Ligne, 'fichesTechniques'>): string[] => fichesDeLigne(l).map(f => f.nom).filter(Boolean);

/** Dépose le fichier comme document de l'affaire, tel quel (PDF, Word, image...). */
export async function envoyerFicheTechnique(projectId: string, fichier: File): Promise<FicheTechnique> {
  const form = new FormData();
  form.append('file', fichier);
  form.append('project_id', projectId);
  form.append('name', fichier.name);
  form.append('category', CATEGORIE_FICHE_TECHNIQUE);
  const token = await getAccessToken();
  const res = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Échec de l'envoi de « ${fichier.name} ».`);
  return { id: crypto.randomUUID(), documentId: data.id, fileUrl: data.file_url, nom: fichier.name };
}
