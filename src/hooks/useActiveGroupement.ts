import { useEffect, useMemo, useState } from 'react';
import { loadCotraitantLogos, setActiveGroupementLogos, type GroupementMember } from '../lib/pdfLetterhead';

/**
 * Déclare le groupement (cotraitants) de l'affaire affichée : tant que l'écran
 * est monté, tous les exports (PDF, Word, Excel) portent leurs logos sous
 * l'en-tête du cabinet. Retiré au démontage, pour qu'un document sans rapport
 * avec l'affaire n'en hérite pas.
 */
export function useActiveGroupement(members: GroupementMember[] | null | undefined): void {
  const key = useMemo(
    () => [...new Set((members ?? []).map(m => m.contact_id).filter(Boolean))].sort().join(','),
    [members],
  );
  useEffect(() => {
    let vivant = true;
    setActiveGroupementLogos([]);
    if (key) {
      loadCotraitantLogos(key.split(',').map(contact_id => ({ contact_id })))
        .then(logos => { if (vivant) setActiveGroupementLogos(logos); });
    }
    return () => { vivant = false; setActiveGroupementLogos([]); };
  }, [key]);
}

/**
 * Variante pour un écran qui connaît seulement l'identifiant de l'affaire :
 * lit les cotraitants de son contrat MOE (le signé, à défaut le premier).
 */
export function useProjectGroupement(projectId: string | null | undefined): void {
  const [membres, setMembres] = useState<GroupementMember[]>([]);
  useEffect(() => {
    let vivant = true;
    setMembres([]);
    if (!projectId) return;
    fetch('/api/contrats_moe')
      .then(r => (r.ok ? r.json() : []))
      .then((tous: any[]) => {
        const lies = (tous || []).filter(c => c.project_id === projectId);
        const contrat = lies.find(c => c.status === 'Signé') || lies[0];
        if (vivant) setMembres(contrat?.cotraitants ?? []);
      })
      .catch(() => {});
    return () => { vivant = false; };
  }, [projectId, setMembres]);
  useActiveGroupement(membres);
}
