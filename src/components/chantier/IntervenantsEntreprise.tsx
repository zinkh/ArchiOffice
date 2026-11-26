import React, { useMemo, useState } from 'react';
import { IconAlertTriangle, IconCheck, IconPlus, IconSearch, IconTrash, IconUser, IconUserPlus, IconX } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { isContactIncomplete } from '../../lib/contactIncomplete';
import type { Contact } from '../../types';

export interface LotIntervenant {
  id: string; lot_id: string; entreprise: string; nom: string;
  role?: string | null; telephone?: string | null; email?: string | null;
  contact_id?: string | null; contact?: Contact | null;
}

const ROLES_COURANTS = ['Conducteur de travaux', 'Chef de chantier', 'Chef d’équipe', 'Responsable d’affaires', 'Dirigeant', 'Responsable sécurité', 'Bureau d’études'];
const LISTE_ROLES = 'chantier-roles-intervenants';
const MAX_SUGGESTIONS = 8;

/** Liste des rôles courants, proposée en suggestion dans les champs « Rôle » (à monter une fois par écran). */
export function RolesSuggestions() {
  return <datalist id={LISTE_ROLES}>{ROLES_COURANTS.map(r => <option key={r} value={r} />)}</datalist>;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
const nomContact = (c: Pick<Contact, 'first_name' | 'last_name' | 'company_name'>) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company_name || 'Sans nom';

interface NouveauContact { first_name: string; last_name: string; company_name: string; job_title: string; phone_mobile: string; email: string; role: string }
const vide = (entreprise: string): NouveauContact => ({ first_name: '', last_name: '', company_name: entreprise, job_title: '', phone_mobile: '', email: '', role: '' });

interface Props {
  lotId: string;
  entreprise: string;
  /** Intervenants de cette entreprise sur ce lot. */
  liste: LotIntervenant[];
  /** Contacts déjà intervenants sur ce lot (toutes entreprises) : ils ne sont plus proposés. */
  dejaSurLot: Set<string>;
  /** Annuaire de l'agence, lu à la première ouverture de la recherche. */
  contacts: Contact[];
  chargerContacts: () => void;
  onContactCree: (c: Contact) => void;
  onChange: (fn: (prev: LotIntervenant[]) => LotIntervenant[]) => void;
  onErreur: (m: string | null) => void;
}

/**
 * Intervenants d'une entreprise sur un lot : on choisit un contact existant de l'agence ou on en crée
 * un (comme pour les intervenants d'une réunion). La fiche reste LE contact : nom, téléphone et e-mail
 * se corrigent dans les contacts ; ici ne se règle que le rôle, propre à ce lot.
 */
export default function IntervenantsEntreprise({ lotId, entreprise, liste, dejaSurLot, contacts, chargerContacts, onContactCree, onChange, onErreur }: Props) {
  const [mode, setMode] = useState<null | 'recherche' | 'nouveau'>(null);
  const [requete, setRequete] = useState('');
  const [nouveau, setNouveau] = useState<NouveauContact>(() => vide(entreprise));
  const [occupe, setOccupe] = useState(false);
  const [roleEdite, setRoleEdite] = useState<string | null>(null);
  const [roleValeur, setRoleValeur] = useState('');

  const ouvrir = (m: 'recherche' | 'nouveau') => {
    onErreur(null);
    if (m === 'recherche') chargerContacts();
    setMode(m);
  };
  const fermer = () => { setMode(null); setRequete(''); setNouveau(vide(entreprise)); };

  const propositions = useMemo(() => {
    const q = norm(requete);
    const libres = contacts.filter(c => !dejaSurLot.has(c.id));
    // Sans saisie : les personnes de la fiche société de cette entreprise d'abord.
    const retenus = q
      ? libres.filter(c => [c.first_name, c.last_name, c.company_name, c.email].some(v => norm(v).includes(q)))
      : libres.filter(c => norm(c.company_name) === norm(entreprise));
    return retenus.slice(0, MAX_SUGGESTIONS);
  }, [contacts, dejaSurLot, requete, entreprise]);

  const ajouter = async (corps: Record<string, unknown>, contactCree?: boolean) => {
    if (occupe) return;
    setOccupe(true);
    try {
      const cree = await apiFetch<LotIntervenant>(`/api/lots/${lotId}/intervenants`, { method: 'POST', body: JSON.stringify({ entreprise, ...corps }) });
      onChange(prev => [...prev, cree]);
      if (contactCree && cree.contact) onContactCree(cree.contact);
      fermer();
    } catch (e: any) {
      onErreur(e?.message || 'Enregistrement impossible.');
    } finally { setOccupe(false); }
  };

  const creer = () => {
    if (!nouveau.first_name.trim() && !nouveau.last_name.trim()) return;
    const { role, ...contact } = nouveau;
    void ajouter({ role, new_contact: contact }, true);
  };

  const enregistrerRole = async (id: string) => {
    setOccupe(true);
    try {
      const maj = await apiFetch<LotIntervenant>(`/api/lot-intervenants/${id}`, { method: 'PUT', body: JSON.stringify({ role: roleValeur }) });
      onChange(prev => prev.map(i => (i.id === id ? maj : i)));
      setRoleEdite(null);
    } catch (e: any) {
      onErreur(e?.message || 'Enregistrement impossible.');
    } finally { setOccupe(false); }
  };

  const retirer = async (id: string) => {
    setOccupe(true);
    try {
      await apiFetch(`/api/lot-intervenants/${id}`, { method: 'DELETE' });
      onChange(prev => prev.filter(i => i.id !== id));
    } catch (e: any) {
      onErreur(e?.message || 'Suppression impossible.');
    } finally { setOccupe(false); }
  };

  const champ = (k: keyof NouveauContact, label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      className="tblr-input w-full" aria-label={label} placeholder={label} value={nouveau[k]}
      onChange={e => setNouveau({ ...nouveau, [k]: e.target.value })}
      onKeyDown={e => { if (e.key === 'Enter') creer(); if (e.key === 'Escape') fermer(); }}
      {...extra}
    />
  );
  const contactIncomplet = !nouveau.phone_mobile.trim() || !nouveau.email.trim();

  return (
    <div className="flex flex-col gap-1.5">
      {liste.length > 0 && <div className="text-[0.6875rem] font-semibold text-[var(--tblr-muted)]">{entreprise}</div>}
      {liste.map(i => (
        <div key={i.id} className="flex items-start gap-2">
          <IconUser size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--tblr-muted)]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="text-[var(--tblr-text)]">{i.nom}</span>
              {i.contact?.job_title && <span className="text-[0.6875rem] text-[var(--tblr-muted)]">{i.contact.job_title}</span>}
              {i.contact && isContactIncomplete(i.contact) && (
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold bg-[var(--tblr-warning-lt)] text-[var(--tblr-warning)]">
                  <IconAlertTriangle size={11} aria-hidden="true" /> À compléter
                </span>
              )}
            </div>
            {roleEdite === i.id ? (
              <div className="mt-1 flex items-center gap-1">
                <input
                  className="tblr-input min-w-0 flex-1" aria-label={`Rôle de ${i.nom}`} placeholder="Rôle…" list={LISTE_ROLES} maxLength={120}
                  value={roleValeur} autoFocus onChange={e => setRoleValeur(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void enregistrerRole(i.id); if (e.key === 'Escape') setRoleEdite(null); }}
                />
                <button type="button" className="btn btn-ghost" aria-label="Enregistrer le rôle" disabled={occupe} onClick={() => { void enregistrerRole(i.id); }}><IconCheck size={16} /></button>
                <button type="button" className="btn btn-ghost" aria-label="Annuler la modification du rôle" onClick={() => setRoleEdite(null)}><IconX size={16} /></button>
              </div>
            ) : (
              <button
                type="button" disabled={occupe}
                className="mt-0.5 text-left text-[0.6875rem] text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"
                aria-label={i.role ? `Modifier le rôle de ${i.nom} : ${i.role}` : `Ajouter un rôle pour ${i.nom}`}
                onClick={() => { setRoleEdite(i.id); setRoleValeur(i.role ?? ''); }}
              >
                {i.role || <span className="italic">+ Rôle</span>}
              </button>
            )}
            {(i.telephone || i.email) && (
              <div className="break-words text-[0.6875rem] text-[var(--tblr-muted)]">
                {i.telephone && <a href={`tel:${i.telephone.replace(/\s/g, '')}`} className="hover:underline">{i.telephone}</a>}
                {i.telephone && i.email ? ' · ' : ''}
                {i.email && <a href={`mailto:${i.email}`} className="hover:underline">{i.email}</a>}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-ghost shrink-0" aria-label={`Retirer ${i.nom} de ce lot`} disabled={occupe} onClick={() => { void retirer(i.id); }}>
            <IconTrash size={16} />
          </button>
        </div>
      ))}

      {!mode && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-secondary" onClick={() => ouvrir('recherche')}><IconSearch size={14} aria-hidden="true" /> Contact existant</button>
          <button type="button" className="btn btn-secondary" onClick={() => ouvrir('nouveau')}><IconUserPlus size={14} aria-hidden="true" /> Nouveau contact</button>
        </div>
      )}

      {mode === 'recherche' && (
        <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
          <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
            <IconSearch size={14} aria-hidden="true" className="shrink-0 text-[var(--tblr-muted)]" />
            <input className="tblr-input min-w-0 flex-1" aria-label="Rechercher un contact" placeholder="Rechercher un contact…" value={requete} autoFocus
              onChange={e => setRequete(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') fermer(); }} />
            <button type="button" className="btn btn-ghost" aria-label="Fermer la recherche de contact" onClick={fermer}><IconX size={16} /></button>
          </div>
          {propositions.length === 0 ? (
            <p className="px-3 py-2 text-[0.75rem] italic text-[var(--tblr-muted)]">{requete ? 'Aucun contact trouvé' : 'Tapez un nom pour rechercher'}</p>
          ) : propositions.map((c, idx) => (
            <button key={c.id} type="button" disabled={occupe} onClick={() => { void ajouter({ contact_id: c.id }); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--tblr-surface-2)]"
              style={idx > 0 ? { borderTop: '1px solid var(--tblr-border)' } : undefined}>
              <IconUser size={14} aria-hidden="true" className="shrink-0 text-[var(--tblr-muted)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--tblr-text)]">{nomContact(c)}</span>
                {(c.job_title || c.company_name) && (
                  <span className="block truncate text-[0.6875rem] text-[var(--tblr-muted)]">{[c.job_title, c.company_name].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              {isContactIncomplete(c) && <IconAlertTriangle size={14} aria-label="À compléter" className="shrink-0 text-[var(--tblr-warning)]" />}
            </button>
          ))}
        </div>
      )}

      {mode === 'nouveau' && (
        <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
          <div className="flex items-center justify-between px-3 py-1" style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
            <span className="text-[0.75rem] font-semibold text-[var(--tblr-muted)]">Nouveau contact</span>
            <button type="button" className="btn btn-ghost" aria-label="Fermer le formulaire de nouveau contact" onClick={fermer}><IconX size={16} /></button>
          </div>
          <div className="flex flex-col gap-1.5 p-2">
            {champ('first_name', 'Prénom', { autoFocus: true, maxLength: 100 })}
            {champ('last_name', 'Nom *', { maxLength: 100, 'aria-required': true })}
            {champ('company_name', 'Entreprise', { maxLength: 200 })}
            {champ('job_title', 'Fonction', { maxLength: 120 })}
            {champ('phone_mobile', 'Portable / Téléphone', { type: 'tel', maxLength: 40 })}
            {champ('email', 'E-mail', { type: 'email', maxLength: 254 })}
            {champ('role', 'Rôle sur ce lot', { list: LISTE_ROLES, maxLength: 120 })}
            {(nouveau.first_name.trim() || nouveau.last_name.trim()) && contactIncomplet && (
              <div role="status" className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[0.75rem] bg-[var(--tblr-warning-lt)] text-[var(--tblr-warning)]">
                <IconAlertTriangle size={14} aria-hidden="true" /> Ce contact sera marqué « À compléter » dans votre carnet d'adresses.
              </div>
            )}
            <div className="flex gap-1.5">
              <button type="button" className="btn btn-primary flex-1" disabled={occupe || (!nouveau.first_name.trim() && !nouveau.last_name.trim())} onClick={creer}>
                <IconPlus size={14} aria-hidden="true" /> Créer et ajouter
              </button>
              <button type="button" className="btn btn-secondary" onClick={fermer}>Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
