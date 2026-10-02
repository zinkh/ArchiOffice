import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconCheck, IconPlus, IconX } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { lotsCorrespondants } from '../lib/actEntreprises';
import type { Contact, ProjectLot } from '../types';
import { EntrepriseAutocomplete } from './EntrepriseAutocomplete';
import { MultiSelectDropdown, type MultiSelectOption } from './MultiSelectDropdown';

/** Ce que le formulaire remet à la consultation : tout ce qu'une ligne du tableau porte. */
export interface NouvelleEntreprise {
  contact_id: string;
  nom: string;
  email: string;
  corps_etat_codes: string[];
  lots_ids: string[];
  envoyer_dce: boolean;
  dce_transmis_le?: string;
  relance_le?: string;
  offre_recue_le?: string;
}

interface Props {
  contacts: Contact[];
  lots: ProjectLot[];
  corpsEtatOptions: MultiSelectOption[];
  lotOptions: MultiSelectOption[];
  corpsEtatCodesFromContact: (contact: Contact) => string[];
  /** Libellés de la nomenclature pour des codes donnés, pour proposer les lots correspondants. */
  libellesDeCodes: (codes: string[]) => string[];
  /** Fiche tout juste créée depuis « Créer dans les contacts » : à sélectionner d'office. */
  ficheCreee: Contact | null;
  onFicheConsommee: () => void;
  onCreateContact: (name: string) => void;
  onSave: (entreprise: NouvelleEntreprise, continuer: boolean) => void;
  onCancel: () => void;
}

const FIELD = 'text-xs border border-[var(--tblr-border)] rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';
const LABEL = 'flex flex-col gap-1 min-w-0';
const LABEL_TEXT = 'text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]';

const nomDe = (c: Contact) => c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();

/**
 * Mini formulaire d'ajout d'une entreprise à la consultation, au-dessus du
 * tableau : tout se renseigne d'un coup, la ligne est ensuite classée par son
 * lot (ou « Sans lot assigné »). Remplace l'ancienne ligne vide ajoutée tout en
 * bas du tableau, qu'il fallait aller chercher puis remplir cellule par cellule.
 */
export function EntrepriseAddForm({
  contacts, lots, corpsEtatOptions, lotOptions, corpsEtatCodesFromContact, libellesDeCodes,
  ficheCreee, onFicheConsommee, onCreateContact, onSave, onCancel,
}: Props) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [email, setEmail] = useState('');
  const [corps, setCorps] = useState<string[]>([]);
  const [lotsIds, setLotsIds] = useState<string[]>([]);
  // Tant que les lots n'ont pas été touchés à la main, ils suivent le corps d'état.
  const [lotsTouches, setLotsTouches] = useState(false);
  const [envoyerDce, setEnvoyerDce] = useState(true);
  const [dceLe, setDceLe] = useState('');
  const [relanceLe, setRelanceLe] = useState('');
  const [offreLe, setOffreLe] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [derniere, setDerniere] = useState<string | null>(null);
  const racine = useRef<HTMLFormElement>(null);

  const lotsPourCorps = useMemo(
    () => (codes: string[]) => lotsCorrespondants(libellesDeCodes(codes), lots),
    [libellesDeCodes, lots],
  );

  const choisir = (c: Contact) => {
    const codes = corpsEtatCodesFromContact(c);
    setContact(c);
    setEmail(c.email_work || c.email || '');
    setCorps(codes);
    if (!lotsTouches) setLotsIds(lotsPourCorps(codes));
    setErreur(null);
  };

  // Une fiche créée dans la fenêtre des contacts arrive ici déjà choisie.
  useEffect(() => {
    if (!ficheCreee) return;
    choisir(ficheCreee);
    onFicheConsommee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ficheCreee]);

  const changerCorps = (next: string[]) => {
    setCorps(next);
    if (!lotsTouches) setLotsIds(lotsPourCorps(next));
  };

  const enregistrer = (continuer: boolean) => {
    if (!contact) {
      setErreur("Choisissez une entreprise dans la liste, ou créez sa fiche : « Créer … dans les contacts ».");
      return;
    }
    onSave({
      contact_id: contact.id,
      nom: nomDe(contact),
      email: email.trim(),
      corps_etat_codes: corps,
      lots_ids: lotsIds,
      envoyer_dce: envoyerDce,
      dce_transmis_le: dceLe || undefined,
      relance_le: relanceLe || undefined,
      offre_recue_le: offreLe || undefined,
    }, continuer);
    setDerniere(nomDe(contact));
    setErreur(null);
    if (continuer) {
      // On garde les lots : on ajoute couramment plusieurs entreprises à la suite sur le même lot.
      setContact(null); setEmail(''); setCorps([]); setDceLe(''); setRelanceLe(''); setOffreLe(''); setEnvoyerDce(true);
      racine.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    }
  };

  const lotsAffiches = lotsIds
    .map(id => lots.find(l => l.id === id))
    .filter((l): l is ProjectLot => !!l);

  return (
    <form
      ref={racine}
      aria-label="Ajouter une entreprise à la consultation"
      className="px-5 py-4 border-b border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] space-y-3"
      onSubmit={e => { e.preventDefault(); enregistrer(false); }}
      onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-[var(--tblr-text)] flex items-center gap-1.5">
          <IconPlus size={13} /> Nouvelle entreprise
        </h4>
        <button type="button" onClick={onCancel} aria-label="Fermer le formulaire" className="p-1 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]">
          <IconX size={14} />
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className={cn(LABEL, 'xl:col-span-2')}>
          <span className={LABEL_TEXT}>Entreprise *</span>
          <EntrepriseAutocomplete
            autoFocus
            contacts={contacts}
            contactId={contact?.id}
            onSelect={choisir}
            onCreate={name => onCreateContact(name)}
          />
        </div>
        <label className={cn(LABEL, 'xl:col-span-2')}>
          <span className={LABEL_TEXT}>Email</span>
          <input type="email" className={FIELD} value={email} onChange={e => setEmail(e.target.value)} placeholder="email@entreprise.fr" />
        </label>

        <div className={cn(LABEL, 'xl:col-span-2')}>
          <span className={LABEL_TEXT}>Corps d'état</span>
          <MultiSelectDropdown options={corpsEtatOptions} selected={corps} onChange={changerCorps}
            placeholder="Non classé" maxChips={2} tone="green" searchable ariaLabel="Corps d'état de la nouvelle entreprise" />
        </div>
        <div className={cn(LABEL, 'xl:col-span-2')}>
          <span className={LABEL_TEXT}>Lots assignés</span>
          <MultiSelectDropdown options={lotOptions} selected={lotsIds}
            onChange={next => { setLotsIds(next); setLotsTouches(true); }}
            placeholder="Aucun lot" maxChips={4} tone="blue" bulkActions ariaLabel="Lots de la nouvelle entreprise" />
          {!lotsTouches && lotsIds.length > 0 && (
            <span className="text-[0.6875rem] text-[var(--tblr-muted)]">Proposés d'après le corps d'état, modifiables.</span>
          )}
        </div>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>DCE transmis le</span>
          <input type="date" className={FIELD} value={dceLe} onChange={e => setDceLe(e.target.value)} />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Relance le</span>
          <input type="date" className={FIELD} value={relanceLe} onChange={e => setRelanceLe(e.target.value)} />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Offre reçue le</span>
          <input type="date" className={FIELD} value={offreLe} onChange={e => setOffreLe(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--tblr-text)] md:pt-5">
          <input type="checkbox" className="w-4 h-4 rounded accent-blue-600" checked={envoyerDce} onChange={e => setEnvoyerDce(e.target.checked)} />
          DCE à envoyer
        </label>
      </div>

      {erreur && <p role="alert" className="text-xs rounded-md px-3 py-2 text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300">{erreur}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <button type="submit" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition">
          <IconCheck size={13} /> Enregistrer
        </button>
        <button type="button" onClick={() => enregistrer(true)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--tblr-border)] bg-white dark:bg-zinc-900 hover:bg-zinc-50 transition">
          Enregistrer et ajouter une autre
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--tblr-muted)] hover:underline">
          Annuler
        </button>
        <span role="status" aria-live="polite" className="text-[0.6875rem] text-[var(--tblr-muted)]">
          {derniere && !contact
            ? `« ${derniere} » ajoutée${lotsAffiches.length ? ` au lot ${lotsAffiches.map(l => l.lot_number).join(', ')}` : ' (sans lot assigné)'}.`
            : contact && lotsAffiches.length === 0 ? 'Sans lot, l\'entreprise sera classée dans « Sans lot assigné ».' : ''}
        </span>
      </div>
    </form>
  );
}
