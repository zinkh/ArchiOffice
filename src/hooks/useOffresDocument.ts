// Offres des entreprises sur le document de référence d'une consultation (DPGF
// ou bordereau). Ces offres vivaient dans l'état de ProTab ; la saisie, l'import
// et la comparaison se font maintenant dans l'ACT, qui les lit ici.
//
// Les offres restent dans leur colonne séparée du document (`dpgfs.offres`,
// `bpu_data.offres`) et passent par leurs propres routes : l'autosauvegarde du
// document réécrit `data` en bloc et effacerait une offre logée dedans.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { OffreDocument, PosteAjoute } from '../types/dpgf';
import type { DocumentAvecArticles } from '../lib/bpuImport';
import {
  FICHIER_SAISIE_MANUELLE, repartirSaisie, type PrixSaisi,
} from '../lib/comparatifPrix';

export type CibleDocument = 'dpgf' | 'bpu';

type OffreEnregistree = OffreDocument & { prixRemontes?: number };

export interface SaisieLot {
  entreprise: { id: string; nom: string };
  /** Lot du document (Lot.id) et ses articles. */
  lotId: string;
  idsLot: string[];
  prix: Record<string, PrixSaisi>;
  postesAjoutes: PosteAjoute[];
}

export function useOffresDocument(projectId: string, cible: CibleDocument) {
  const [document, setDocument] = useState<DocumentAvecArticles | null>(null);
  const [offres, setOffresState] = useState<OffreDocument[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const offresRef = useRef<OffreDocument[]>([]);
  // Les écritures partent l'une après l'autre : deux PUT en vol sur la même
  // colonne pourraient sinon se doubler, et la plus ancienne gagner.
  const chaine = useRef<Promise<unknown>>(Promise.resolve());

  const base = `/api/projects/${projectId}/${cible}`;

  const setOffres = useCallback((next: OffreDocument[]) => {
    offresRef.current = next;
    setOffresState(next);
  }, []);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      if (cible === 'dpgf') {
        const [doc, liste] = await Promise.all([
          apiFetch<DocumentAvecArticles>(base).catch(() => null),
          apiFetch<OffreDocument[]>(`${base}/offres`).catch(() => [] as OffreDocument[]),
        ]);
        setDocument(doc?.lots?.length ? doc : null);
        setOffres(liste ?? []);
      } else {
        const ligne = await apiFetch<{ id?: string; document?: any; offres?: OffreDocument[] } | null>(base).catch(() => null);
        const d = ligne?.document;
        setDocument(d?.lots?.length ? { id: ligne?.id ?? '', version: '', totalHT: 0, ...d } : null);
        setOffres(ligne?.offres ?? []);
      }
      setErreur(null);
    } catch (e: any) {
      setErreur(e?.message || 'Les offres n’ont pas pu être lues.');
    } finally {
      setChargement(false);
    }
  }, [base, cible, setOffres]);

  useEffect(() => { void recharger(); }, [recharger]);

  const enchainer = useCallback(<T,>(travail: () => Promise<T>): Promise<T> => {
    const suite = chaine.current.then(travail, travail);
    chaine.current = suite.catch(() => undefined);
    return suite;
  }, []);

  /** Enregistre une offre (import d'un bordereau, ou première saisie) et rend la liste à jour. */
  const enregistrer = useCallback((offre: Omit<OffreDocument, 'id' | 'importedAt'>) => enchainer(async () => {
    const saved = await apiFetch<OffreEnregistree>(`${base}/offres`, { method: 'POST', body: JSON.stringify({ offre }) });
    const next = [...offresRef.current, saved];
    setOffres(next);
    return { offres: next, saved };
  }), [base, enchainer, setOffres]);

  const supprimer = useCallback((id: string) => enchainer(async () => {
    await apiFetch(`${base}/offres/${id}`, { method: 'DELETE' });
    const next = offresRef.current.filter(o => o.id !== id);
    setOffres(next);
    return next;
  }), [base, enchainer, setOffres]);

  /**
   * Écrit la saisie poste par poste d'un lot pour une entreprise : chaque prix
   * est réécrit dans l'offre qui le porte, les prix nouveaux vont dans l'offre
   * « Saisie manuelle » (créée au besoin). Rend la liste d'offres à jour.
   */
  const ecrireSaisie = useCallback((saisie: SaisieLot) => enchainer(async () => {
    const miseAJour = repartirSaisie(
      offresRef.current, saisie.entreprise.id, saisie.lotId, saisie.idsLot, saisie.prix, saisie.postesAjoutes,
    );
    let courant = offresRef.current;
    for (const m of miseAJour) {
      if (m.id) {
        const saved = await apiFetch<OffreEnregistree>(`${base}/offres/${m.id}`, {
          method: 'PUT', body: JSON.stringify({ prix: m.prix, postesAjoutes: m.postesAjoutes }),
        });
        courant = courant.map(o => (o.id === m.id ? { ...o, ...saved } : o));
      } else {
        const aujourdhui = new Date().toISOString().slice(0, 10);
        const saved = await apiFetch<OffreEnregistree>(`${base}/offres`, {
          method: 'POST',
          body: JSON.stringify({
            offre: {
              entrepriseId: saisie.entreprise.id, entrepriseNom: saisie.entreprise.nom,
              dateReception: aujourdhui, fichierNom: FICHIER_SAISIE_MANUELLE,
              documentVersion: document?.version ?? '', prix: m.prix, anomalies: [],
              postesAjoutes: m.postesAjoutes, statut: 'validee',
            },
          }),
        });
        courant = [...courant, saved];
      }
    }
    setOffres(courant);
    return courant;
  }), [base, document?.version, enchainer, setOffres]);

  return { document, offres, chargement, erreur, recharger, enregistrer, supprimer, ecrireSaisie };
}
