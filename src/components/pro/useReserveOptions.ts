import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';

export interface ReserveLotSource { id: string; lot_number?: string; lot_title: string; contact_id?: string; contact_name?: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Lots et entreprises proposés pour une réserve, partagés par la fiche (ReserveDetail) et les actions
 * en masse du suivi (ReserveTracker) : une seule source, donc les mêmes choix dans les deux écrans.
 *
 * Les lots sont classés par numéro (« 2 » avant « 10 », « 01A » après « 01 ») ; la valeur enregistrée
 * reste l'intitulé. Les entreprises viennent de la fiche des lots ET des marchés de travaux : la fiche
 * du lot n'a souvent pas d'entreprise renseignée (elle se désigne par l'ACT puis le marché).
 */
export function useReserveOptions(projectId: string, lotsList?: ReserveLotSource[]) {
  const [marches, setMarches] = useState<{ nom: string; contactId?: string }[]>([]);
  const marcheEntreprises = useMemo(() => marches.map(m => m.nom), [marches]);
  useEffect(() => {
    let vivant = true;
    apiFetch<{ entreprise_nom?: string | null; contact_id?: string | null; type_marche?: string | null; statut?: string | null }[]>(`/api/marches-entreprises/${projectId}`)
      .then(rows => {
        if (!vivant || !Array.isArray(rows)) return;
        setMarches(rows
          .filter(r => r.entreprise_nom && r.type_marche !== 'subsequent' && r.statut !== 'resilie')
          .map(r => ({ nom: r.entreprise_nom as string, contactId: r.contact_id || undefined })));
      })
      .catch(() => { /* les entreprises des lots restent proposées */ });
    return () => { vivant = false; };
  }, [projectId]);

  const lotOptions = useMemo(() => [...(lotsList || [])]
    .sort((a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? '', 'fr', { numeric: true }))
    .map(l => ({ value: l.lot_title, label: l.lot_number ? `${l.lot_number} · ${l.lot_title}` : l.lot_title })), [lotsList]);

  const entrepriseOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...(lotsList || []).map(l => l.contact_name), ...marcheEntreprises]
      .filter((nom): nom is string => !!nom && !seen.has(nom.trim().toLowerCase()) && !!seen.add(nom.trim().toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map(nom => ({ value: nom, label: nom }));
  }, [lotsList, marcheEntreprises]);

  /**
   * L'entreprise responsable d'un lot, désigné par son intitulé : celle de la fiche du lot, à défaut l'entreprise
   * du marché rattachée au même contact (la fiche du lot n'a souvent que l'identifiant du contact). `null` si aucune.
   */
  const entrepriseDuLot = useCallback((titre: string): string | null => {
    const lot = (lotsList || []).find(l => l.lot_title === titre) ?? (lotsList || []).find(l => norm(l.lot_title) === norm(titre));
    if (!lot) return null;
    const nom = lot.contact_name?.trim();
    if (nom) return nom;
    if (lot.contact_id) return marches.find(m => m.contactId === lot.contact_id)?.nom ?? null;
    return null;
  }, [lotsList, marches]);

  return { lotOptions, entrepriseOptions, entrepriseDuLot };
}
