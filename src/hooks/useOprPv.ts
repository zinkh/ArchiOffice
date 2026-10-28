// Données des PV d'OPR par lot (onglet AOR) : les PV de l'affaire, les marchés dont ils
// relèvent et les réserves qui forment leur annexe, plus les gestes (créer, modifier, signer,
// rouvrir, supprimer, ajouter ou retirer une réserve). Un geste réussi relit tout : le statut
// et les échéances se déduisent de la ligne enregistrée, l'écran ne les recalcule pas à part.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { NatureReserve, OprPv } from '../lib/oprPv';
import { lirePv } from '../lib/oprPvSanitize';
import type { ContactIdentite } from '../lib/oprPvExport';

export interface MarcheOpr {
  id: string;
  lot_numero: string | null;
  lot_titre: string | null;
  entreprise_nom: string | null;
  type_marche: string | null;
  objet: string | null;
  contact_id: string | null;
  entreprise_siret: string | null;
  date_signature: string | null;
  date_notification: string | null;
}

export interface ReserveOpr {
  id: string;
  reception_id: string | null;
  number: number | null;
  batiment: string | null;
  local: string | null;
  title: string;
  status: string | null;
  created_at: string | null;
  nature: NatureReserve | null;
}

export interface PvOpr {
  id: string;
  reference_pv: string | null;
  signed_at: string | null;
  signed_mode: 'papier' | 'electronique' | null;
  /** Lieu de signature (« Fait à », EXE5). */
  lieu: string | null;
  pv: OprPv;
}

/** Une réserve est encore à lever tant qu'elle n'est ni levée ni quittancée. */
export const STATUTS_RESERVE_LEVEE = new Set(['Levée', 'Quitus Transmis']);

export interface NouvelleReserve {
  batiment: string;
  localisation: string;
  points: string;
  /** Nature (annexes numérotées des cerfas) ; vide = non précisée. */
  nature?: NatureReserve | '';
}

const lire = async <T,>(url: string, repli: T): Promise<T> => {
  try { return (await apiFetch<T>(url)) ?? repli; } catch { return repli; }
};

export function useOprPv(projectId: string) {
  const [pvs, setPvs] = useState<PvOpr[]>([]);
  const [marches, setMarches] = useState<MarcheOpr[]>([]);
  const [reserves, setReserves] = useState<ReserveOpr[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const actif = useRef(true);
  const contacts = useRef<Map<string, ContactIdentite> | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [receptions, toutesReserves, tousMarches] = await Promise.all([
        apiFetch<any[]>(`/api/receptions?project_id=${encodeURIComponent(projectId)}`),
        lire<ReserveOpr[]>(`/api/reserves?project_id=${encodeURIComponent(projectId)}`, []),
        lire<MarcheOpr[]>(`/api/marches-entreprises/${encodeURIComponent(projectId)}`, []),
      ]);
      if (!actif.current) return;
      const lus = (receptions ?? []).flatMap((row): PvOpr[] => {
        const pv = lirePv(row);
        return pv ? [{ id: row.id, reference_pv: row.reference_pv ?? null, signed_at: row.signed_at ?? null, signed_mode: row.signed_mode ?? null, lieu: row.lieu ?? null, pv }] : [];
      });
      const ids = new Set(lus.map(p => p.id));
      setPvs(lus.sort((a, b) => (b.pv.date_opr ?? '').localeCompare(a.pv.date_opr ?? '')));
      setReserves(toutesReserves.filter(r => r.reception_id && ids.has(r.reception_id)));
      // Un accord-cadre n'a pas de PV : seuls les marchés exécutables se proposent.
      setMarches(tousMarches.filter(m => m.type_marche !== 'accord_cadre'));
      setErreur(null);
    } catch (e: any) {
      if (actif.current) setErreur(e?.message || 'Erreur');
    } finally {
      if (actif.current) setChargement(false);
    }
  }, [projectId]);

  useEffect(() => {
    actif.current = true;
    setChargement(true);
    void recharger();
    return () => { actif.current = false; };
  }, [recharger]);

  const envoyer = useCallback(async (url: string, methode: string, corps?: unknown) => {
    const rep = await apiFetch<any>(url, { method: methode, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
    await recharger();
    return rep;
  }, [recharger]);

  const creer = useCallback((corps: Record<string, unknown>) =>
    envoyer('/api/receptions', 'POST', { project_id: projectId, type: 'provisoire', date: new Date().toISOString().slice(0, 10), ...corps }), [envoyer, projectId]);
  const modifier = useCallback((id: string, corps: Record<string, unknown>) => envoyer(`/api/receptions/${id}`, 'PUT', corps), [envoyer]);
  const supprimer = useCallback((id: string) => envoyer(`/api/receptions/${id}`, 'DELETE'), [envoyer]);
  const signer = useCallback((id: string, mode: 'papier' | 'electronique', date: string) =>
    envoyer(`/api/receptions/${id}/signature`, 'POST', { mode, date }), [envoyer]);
  const rouvrir = useCallback((id: string) => envoyer(`/api/receptions/${id}/signature/rouvrir`, 'POST', {}), [envoyer]);

  /** Une réserve de l'annexe : rattachée au PV, au lot et à l'entreprise du marché. */
  const ajouterReserve = useCallback(async (pvId: string, r: NouvelleReserve, lot: string, entreprise: string) => {
    const jour = new Date().toISOString().slice(0, 10);
    await apiFetch('/api/reserves', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId, reception_id: pvId, title: r.points.trim(), batiment: r.batiment.trim() || null, local: r.localisation.trim() || null,
        status: 'A faire', lots: JSON.stringify(lot ? [lot] : []), entreprises: JSON.stringify(entreprise ? [entreprise] : []),
        created_at: jour, due_date: jour,
        ...(r.nature ? { nature: r.nature } : {}),
      }),
    });
    await recharger();
  }, [projectId, recharger]);

  /** Fiche d'un contact (titulaire, maître d'ouvrage), lue une fois pour toutes : l'annuaire du cabinet reste petit. */
  const obtenirContact = useCallback(async (id?: string | null): Promise<ContactIdentite | null> => {
    if (!id) return null;
    if (!contacts.current) {
      const liste = await lire<Array<ContactIdentite & { id: string }>>('/api/contacts', []);
      contacts.current = new Map(liste.map(c => [c.id, c]));
    }
    return contacts.current.get(id) ?? null;
  }, []);

  /** Ne change que la nature d'une réserve (le PUT d'une réserve réécrit tous ses champs). */
  const changerNatureReserve = useCallback((id: string, nature: NatureReserve | '') =>
    envoyer(`/api/reserves/${id}/nature`, 'PUT', { nature: nature || null }), [envoyer]);

  const retirerReserve = useCallback((id: string) => envoyer(`/api/reserves/${id}`, 'DELETE'), [envoyer]);

  return { pvs, marches, reserves, chargement, erreur, recharger, creer, modifier, supprimer, signer, rouvrir, ajouterReserve, retirerReserve, changerNatureReserve, obtenirContact };
}
