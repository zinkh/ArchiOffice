import React, { useEffect, useState } from 'react';
import { IconPlus, IconTrash, IconPencil, IconCheck, IconX } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import type { Observation, ProjectLot } from '../../types';

interface MarcheLu { id: string; lot_numero?: string | null; act_lot_id?: string | null; entreprise_nom?: string | null; type_marche?: string | null; statut?: string | null }
interface SousTraitantLu { id: string; marche_id: string; nom: string; objet?: string | null }
export interface LotIntervenant {
  id: string; lot_id: string; entreprise: string; nom: string;
  role?: string | null; telephone?: string | null; email?: string | null;
}
type Brouillon = { nom: string; role: string; telephone: string; email: string };
const BROUILLON_VIDE: Brouillon = { nom: '', role: '', telephone: '', email: '' };
const ROLES_COURANTS = ['Conducteur de travaux', 'Chef de chantier', 'Chef d’équipe', 'Responsable d’affaires', 'Dirigeant', 'Responsable sécurité', 'Bureau d’études'];
const LISTE_ROLES = 'chantier-roles-intervenants';

const normaliserNumeroLot = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

/** Formulaire d'un intervenant : nom et rôle, téléphone et e-mail facultatifs. */
function IntervenantForm({ valeur, onChange, onValider, onAnnuler, occupe }: {
  valeur: Brouillon; onChange: (v: Brouillon) => void; onValider: () => void; onAnnuler: () => void; occupe: boolean;
}) {
  const champ = (k: keyof Brouillon, label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      className="tblr-input w-full" aria-label={label} placeholder={label} value={valeur[k]}
      onChange={e => onChange({ ...valeur, [k]: e.target.value })}
      onKeyDown={e => { if (e.key === 'Enter') onValider(); if (e.key === 'Escape') onAnnuler(); }}
      {...extra}
    />
  );
  return (
    <div className="flex flex-col gap-1.5 rounded-lg p-2" style={{ border: '1px solid var(--tblr-border)' }}>
      {champ('nom', 'Nom', { autoFocus: true, maxLength: 200 })}
      {champ('role', 'Rôle', { list: LISTE_ROLES, maxLength: 120 })}
      {champ('telephone', 'Téléphone', { type: 'tel', maxLength: 40 })}
      {champ('email', 'E-mail', { type: 'email', maxLength: 200 })}
      <div className="flex justify-end gap-1">
        <button type="button" className="btn btn-ghost" onClick={onAnnuler} disabled={occupe} aria-label="Annuler"><IconX size={16} /></button>
        <button type="button" className="btn btn-primary" onClick={onValider} disabled={occupe || !valeur.nom.trim()} aria-label="Enregistrer l’intervenant"><IconCheck size={16} /></button>
      </div>
    </div>
  );
}

/**
 * Intervenants d'une entreprise sur un lot : plusieurs personnes, chacune avec son rôle.
 * Rattachés au lot et au nom de l'entreprise (qui vient de la fiche du lot, de l'ACT ou du marché).
 */
function IntervenantsEntreprise({ lotId, entreprise, liste, onChange, onErreur }: {
  lotId: string; entreprise: string; liste: LotIntervenant[];
  onChange: (fn: (prev: LotIntervenant[]) => LotIntervenant[]) => void; onErreur: (m: string | null) => void;
}) {
  const [edition, setEdition] = useState<string | 'nouveau' | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_VIDE);
  const [occupe, setOccupe] = useState(false);

  const ouvrir = (cible: string | 'nouveau', depart: Brouillon) => { onErreur(null); setBrouillon(depart); setEdition(cible); };
  const fermer = () => { setEdition(null); setBrouillon(BROUILLON_VIDE); };

  const valider = async () => {
    if (!brouillon.nom.trim() || occupe) return;
    setOccupe(true);
    try {
      if (edition === 'nouveau') {
        const cree = await apiFetch<LotIntervenant>(`/api/lots/${lotId}/intervenants`, { method: 'POST', body: JSON.stringify({ ...brouillon, entreprise }) });
        onChange(prev => [...prev, cree]);
      } else if (edition) {
        const maj = await apiFetch<LotIntervenant>(`/api/lot-intervenants/${edition}`, { method: 'PUT', body: JSON.stringify(brouillon) });
        onChange(prev => prev.map(i => (i.id === maj.id ? maj : i)));
      }
      fermer();
    } catch (e: any) {
      onErreur(e?.message || 'Enregistrement impossible.');
    } finally { setOccupe(false); }
  };

  const supprimer = async (id: string) => {
    setOccupe(true);
    try {
      await apiFetch(`/api/lot-intervenants/${id}`, { method: 'DELETE' });
      onChange(prev => prev.filter(i => i.id !== id));
    } catch (e: any) {
      onErreur(e?.message || 'Suppression impossible.');
    } finally { setOccupe(false); }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {liste.length > 0 && <div className="text-[0.6875rem] font-semibold text-[var(--tblr-muted)]">{entreprise}</div>}
      {liste.map(i => (edition === i.id ? (
        <IntervenantForm key={i.id} valeur={brouillon} onChange={setBrouillon} onValider={() => { void valider(); }} onAnnuler={fermer} occupe={occupe} />
      ) : (
        <div key={i.id} className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[var(--tblr-text)]">{i.nom}{i.role ? <span className="text-[0.6875rem] text-[var(--tblr-muted)]"> · {i.role}</span> : null}</div>
            {(i.telephone || i.email) && (
              <div className="text-[0.6875rem] text-[var(--tblr-muted)] break-words">
                {i.telephone && <a href={`tel:${i.telephone.replace(/\s/g, '')}`} className="hover:underline">{i.telephone}</a>}
                {i.telephone && i.email ? ' · ' : ''}
                {i.email && <a href={`mailto:${i.email}`} className="hover:underline">{i.email}</a>}
              </div>
            )}
          </div>
          <div className="flex shrink-0">
            <button type="button" className="btn btn-ghost" aria-label={`Modifier ${i.nom}`} disabled={occupe}
              onClick={() => ouvrir(i.id, { nom: i.nom, role: i.role ?? '', telephone: i.telephone ?? '', email: i.email ?? '' })}><IconPencil size={16} /></button>
            <button type="button" className="btn btn-ghost" aria-label={`Supprimer ${i.nom}`} disabled={occupe}
              onClick={() => { void supprimer(i.id); }}><IconTrash size={16} /></button>
          </div>
        </div>
      )))}
      {edition === 'nouveau' ? (
        <IntervenantForm valeur={brouillon} onChange={setBrouillon} onValider={() => { void valider(); }} onAnnuler={fermer} occupe={occupe} />
      ) : (
        <button type="button" className="btn btn-ghost self-start" onClick={() => ouvrir('nouveau', BROUILLON_VIDE)}>
          <IconPlus size={16} /> Intervenant
        </button>
      )}
    </div>
  );
}

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
      <datalist id={LISTE_ROLES}>{ROLES_COURANTS.map(r => <option key={r} value={r} />)}</datalist>
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
