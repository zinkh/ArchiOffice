import { useEffect, useMemo, useState } from 'react';
import {
  loadGroupementHeader, setActiveGroupementLogos, setActiveMandataire, type GroupementMemberMandataire,
} from '../lib/pdfLetterhead';

/**
 * Déclare le groupement (cotraitants) de l'affaire affichée : tant que l'écran
 * est monté, tous les exports (PDF, Word, Excel) portent leurs logos sous
 * l'en-tête du cabinet. Retiré au démontage, pour qu'un document sans rapport
 * avec l'affaire n'en hérite pas.
 */
export function useActiveGroupement(members: GroupementMemberMandataire[] | null | undefined): void {
  // Le mandataire fait partie de la clé : en changer redessine l'en-tête.
  const key = useMemo(
    () => [...new Set((members ?? []).map(m => m.contact_id ? `${m.contact_id}${m.mandataire ? '*' : ''}` : '').filter(Boolean))].sort().join(','),
    [members],
  );
  useEffect(() => {
    let vivant = true;
    const reinitialiser = () => { setActiveGroupementLogos([]); setActiveMandataire(null); };
    reinitialiser();
    if (key) {
      loadGroupementHeader(key.split(',').map(k => ({ contact_id: k.replace('*', ''), mandataire: k.endsWith('*') })))
        .then(({ mandataire, partnerLogos }) => {
          if (!vivant) return;
          setActiveGroupementLogos(partnerLogos);
          setActiveMandataire(mandataire);
        });
    }
    return () => { vivant = false; reinitialiser(); };
  }, [key]);
}

/**
 * Variante pour un écran qui connaît seulement l'identifiant de l'affaire :
 * lit les cotraitants de son contrat MOE (le signé, à défaut le premier).
 */
export function useProjectGroupement(projectId: string | null | undefined): void {
  const [membres, setMembres] = useState<GroupementMemberMandataire[]>([]);
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
