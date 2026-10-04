import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { parContact, type Qualification } from '../lib/qualifications';

/**
 * Qualifications de toutes les entreprises du cabinet, groupées par fiche
 * contact. Une seule lecture pour tout un tableau : une requête par ligne
 * serait la même charge que le fan-out retiré des listes de projets.
 */
export function useQualifications() {
  const [liste, setListe] = useState<Qualification[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setListe(await apiFetch<Qualification[]>('/api/qualifications'));
    } catch {
      // Facultatif : sans qualifications, les écrans retombent sur « aucune ».
      setListe([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const parContactId = useMemo(() => parContact(liste), [liste]);
  return { qualifications: liste, parContactId, loading, reload };
}
