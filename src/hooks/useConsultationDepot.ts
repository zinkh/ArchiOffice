import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { DepotKind, DepotStatut, SaisieOffre } from '../lib/consultationDepot';

export interface EligibiliteDepot {
  eligible: boolean;
  code?: string;
  message?: string;
  stockage?: { provider: string; nom: string | null };
}

/** Une remise telle que la rend le serveur ; sous plis scellés, seul l'en-tête est présent. */
export interface DepotRecu {
  id: string;
  invite_id: string;
  entreprise_id: string;
  entreprise_nom: string;
  lot_id: string | null;
  kind: DepotKind;
  version: number;
  status: DepotStatut;
  hors_delai: boolean;
  received_at: string;
  reviewed_at: string | null;
  scelle: boolean;
  file_name?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  sha256?: string | null;
  payload?: SaisieOffre | null;
  note?: string | null;
}

export interface ReglagesDepotCabinet {
  deadline_at: string | null;
  sealed: boolean;
  instructions: string;
  published_document_ids: string[];
  plis_scelles_actifs: boolean;
}

interface ReponseDepots { scelle: boolean; deadline_at: string | null; depots: DepotRecu[] }

/**
 * Espace de dépôt des offres d'une consultation (module ACT) : éligibilité du
 * cabinet, remises reçues et gestes de traitement. Une seule lecture groupée
 * par écran ; rafraîchie au retour sur l'onglet, puisque les remises arrivent
 * pendant que l'architecte travaille ailleurs.
 */
export function useConsultationDepot(projectId: string) {
  const [eligibilite, setEligibilite] = useState<EligibiliteDepot | null>(null);
  const [donnees, setDonnees] = useState<ReponseDepots>({ scelle: false, deadline_at: null, depots: [] });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [e, d] = await Promise.all([
        apiFetch<EligibiliteDepot>(`/api/projects/${projectId}/depot/eligibility`),
        apiFetch<ReponseDepots>(`/api/projects/${projectId}/depots`),
      ]);
      setEligibilite(e);
      setDonnees(d);
    } catch {
      // Facultatif : sans réponse, la consultation fonctionne comme avant.
      setEligibilite({ eligible: false, message: 'Espace de dépôt indisponible.' });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const onFocus = () => { void reload(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  /** Date de la remise à traiter la plus récente, par entreprise : alimente le statut « Offre déposée ». */
  const depotRecuLe = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of donnees.depots) {
      if (d.status !== 'recu') continue;
      if (!m[d.entreprise_id] || d.received_at > m[d.entreprise_id]) m[d.entreprise_id] = d.received_at;
    }
    return m;
  }, [donnees.depots]);

  const aTraiter = useMemo(() => donnees.depots.filter(d => d.status === 'recu').length, [donnees.depots]);

  const urlFichier = useCallback(async (depotId: string) => {
    const { url } = await apiFetch<{ url: string }>(`/api/depots/${depotId}/url`);
    return url;
  }, []);

  const ouvrir = useCallback(async (depotId: string) => {
    const url = await urlFichier(depotId);
    window.open(url, '_blank', 'noopener');
  }, [urlFichier]);

  /** Le fichier lui-même, pour le rejouer dans un import existant (bordereau, acte d'engagement). */
  const telecharger = useCallback(async (depot: DepotRecu): Promise<File> => {
    const url = await urlFichier(depot.id);
    const res = await ((window as any)._originalFetch || window.fetch)(url);
    if (!res.ok) throw new Error('Le fichier n’a pas pu être récupéré depuis l’espace de stockage du cabinet.');
    return new File([await res.blob()], depot.file_name || 'depot', { type: depot.mime_type || undefined });
  }, [urlFichier]);

  const marquer = useCallback(async (depotId: string, statut: 'integrer' | 'rejeter', note?: string) => {
    await apiFetch(`/api/depots/${depotId}/${statut === 'integrer' ? 'integrer' : 'rejeter'}`, {
      method: 'POST', body: JSON.stringify(note ? { note } : {}),
    });
    await reload();
  }, [reload]);

  return {
    eligibilite, depots: donnees.depots, scelle: donnees.scelle, deadlineAt: donnees.deadline_at,
    loading, reload, depotRecuLe, aTraiter, ouvrir, telecharger, marquer,
  };
}
