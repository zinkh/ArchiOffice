import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { loadContactsForAttendees } from '../../lib/meetingAttendeesOffline';
import type { Contact, Observation, ProjectLot } from '../../types';
import IntervenantsEntreprise, { RolesSuggestions, type LotIntervenant } from './IntervenantsEntreprise';

export type { LotIntervenant };

interface MarcheLu { id: string; lot_numero?: string | null; act_lot_id?: string | null; entreprise_nom?: string | null; type_marche?: string | null; statut?: string | null }
interface SousTraitantLu { id: string; marche_id: string; nom: string; objet?: string | null }

const normaliserNumeroLot = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

/**
 * Entreprise de chaque lot : la fiche du lot, à défaut l'attribution de l'ACT,
 * à défaut le marché de travaux du lot. Les sous-traitants viennent des marchés (onglet RDT).
 * Les intervenants (personnes, avec leur rôle) se saisissent ici, par entreprise.
 */
export default function EntreprisesTab({ projectId, lots_list, observations }: { projectId: string; lots_list: ProjectLot[]; observations: Observation[] }) {
  const [marches, setMarches] = useState<MarcheLu[]>([]);
  const [sousTraitants, setSousTraitants] = useState<SousTraitantLu[]>([]);
  const [attributions, setAttributions] = useState<{ lot_id: string; entreprise_id: string }[]>([]);
  const [entreprisesAct, setEntreprisesAct] = useState<{ id: string; nom?: string }[]>([]);
  const [intervenants, setIntervenants] = useState<LotIntervenant[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  // Annuaire de l'agence : lu une seule fois, à la première ouverture d'une recherche de contact.
  const [contacts, setContacts] = useState<Contact[]>([]);
  const contactsDemandes = useRef(false);
  const chargerContacts = useCallback(() => {
    if (contactsDemandes.current) return;
    contactsDemandes.current = true;
    void loadContactsForAttendees().then(setContacts).catch(() => { contactsDemandes.current = false; });
  }, []);
  const ajouterContact = useCallback((c: Contact) => setContacts(prev => (prev.some(x => x.id === c.id) ? prev : [...prev, c])), []);

  useEffect(() => {
    let vivant = true;
    Promise.all([
      apiFetch<MarcheLu[]>(`/api/marches-entreprises/${projectId}`).catch(() => []),
      apiFetch<SousTraitantLu[]>(`/api/projects/${projectId}/sous-traitants`).catch(() => []),
      apiFetch<any>(`/api/projects/${projectId}/act`).catch(() => null),
      apiFetch<LotIntervenant[]>(`/api/projects/${projectId}/lot-intervenants`).catch(() => []),
    ]).then(([m, st, act, iv]) => {
      if (!vivant) return;
      setMarches(Array.isArray(m) ? m : []);
      setSousTraitants(Array.isArray(st) ? st : []);
      setAttributions(Array.isArray(act?.consultation?.attributions) ? act.consultation.attributions : []);
      setEntreprisesAct(Array.isArray(act?.consultation?.entreprises) ? act.consultation.entreprises : []);
      setIntervenants(Array.isArray(iv) ? iv : []);
    });
    return () => { vivant = false; };
  }, [projectId]);

  const marchesExecutables = marches.filter(m => m.type_marche !== 'accord_cadre' && m.statut !== 'resilie');

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <RolesSuggestions />
      {erreur && <p role="alert" className="px-4 py-2 text-sm text-red-600 dark:text-red-400">{erreur}</p>}
      <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
          <tr>
            <th className="px-4 py-3 text-left">Lot</th>
            <th className="px-4 py-3 text-left">Entreprise</th>
            <th className="px-4 py-3 text-left">Intervenants</th>
            <th className="px-4 py-3 text-left">Sous-traitants</th>
            <th className="px-4 py-3 text-center">Observations (total)</th>
            <th className="px-4 py-3 text-center">À lever (ouvertes)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--tblr-border)]">
          {lots_list.map(lot => {
            const lotObs = observations.filter(o => o.lot_id === lot.id);
            const openReserves = lotObs.filter(o => o.type === 'reserve' && o.statut !== 'Levée').length;
            const marchesLot = marchesExecutables.filter(m =>
              m.act_lot_id === lot.id
              || (!m.act_lot_id && normaliserNumeroLot(m.lot_numero) !== '' && normaliserNumeroLot(m.lot_numero) === normaliserNumeroLot(lot.lot_number)));
            const attribution = attributions.find(a => a.lot_id === lot.id);
            const nomAct = attribution ? entreprisesAct.find(e => e.id === attribution.entreprise_id)?.nom : undefined;
            const entreprises = [...new Set([
              lot.contact_name || nomAct || '',
              ...marchesLot.map(m => m.entreprise_nom || ''),
            ].map(n => n.trim()).filter(Boolean))];
            const st = sousTraitants.filter(x => marchesLot.some(m => m.id === x.marche_id));
            const intervenantsLot = intervenants.filter(i => i.lot_id === lot.id);
            // Une entreprise renommée ou retirée du lot garde ses intervenants, visibles sous leur ancien nom.
            const groupes = [...new Set([...entreprises, ...intervenantsLot.map(i => i.entreprise)])];
            const dejaSurLot = new Set(intervenantsLot.map(i => i.contact_id).filter((v): v is string => !!v));
            return (
              <tr key={lot.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors align-top">
                <td className="px-4 py-3 font-semibold text-[var(--tblr-text)]">{lot.lot_number} — {lot.lot_title}</td>
                <td className="px-4 py-3 text-[var(--tblr-text)]">
                  {entreprises.length > 0 ? entreprises.map(n => <div key={n}>{n}</div>) : <span className="text-[var(--tblr-muted)]">—</span>}
                </td>
                <td className="px-4 py-3 min-w-[16rem]">
                  {groupes.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {groupes.map(nom => (
                        <IntervenantsEntreprise
                          key={nom} lotId={lot.id} entreprise={nom}
                          liste={intervenantsLot.filter(i => i.entreprise === nom)}
                          dejaSurLot={dejaSurLot}
                          contacts={contacts} chargerContacts={chargerContacts} onContactCree={ajouterContact}
                          onChange={setIntervenants} onErreur={setErreur}
                        />
                      ))}
                    </div>
                  ) : <span className="text-[var(--tblr-muted)]">—</span>}
                </td>
                <td className="px-4 py-3 text-[var(--tblr-muted)]">
                  {st.length > 0
                    ? st.map(x => <div key={x.id}>{x.nom}{x.objet ? <span className="text-[0.6875rem]"> · {x.objet}</span> : null}</div>)
                    : '—'}
                </td>
                <td className="px-4 py-3 text-center">{lotObs.length}</td>
                <td className="px-4 py-3 text-center">
                  {openReserves > 0 ? <span className="text-red-600 dark:text-red-400 font-bold">{openReserves}</span> : '—'}
                </td>
              </tr>
            );
          })}
          {lots_list.length === 0 && (
            <tr><td colSpan={6} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucun lot renseigné pour ce projet.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
