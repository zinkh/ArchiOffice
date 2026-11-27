import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ContactAutocomplete } from './ContactAutocomplete';
import { ContactModal } from './ContactModal';
import type { Contact } from '../types';

/** Nom d'affichage d'un contact : la personne, avec sa société quand elle en a une. */
export function contactDisplayName(c: Contact): string {
  const person = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  if (person && c.company_name) return `${person} (${c.company_name})`;
  return person || c.company_name || c.email || '';
}

/**
 * Choix d'un destinataire dans les contacts du cabinet : liste déroulante avec recherche, et une première
 * ligne « Créer un nouveau contact » qui ouvre la fiche sans quitter l'écran. Règle de l'application :
 * toute coordonnée (nom, e-mail, téléphone) se prend dans les contacts plutôt que de se ressaisir à la main.
 * Le contact choisi ou créé est remis à l'écran appelant, qui renseigne ses propres champs.
 */
export function ContactRecipientPicker({ onPick, placeholder = 'Choisir dans les contacts de l\'agence…', initialCategory, className }: {
  onPick: (contact: Contact) => void;
  placeholder?: string;
  initialCategory?: string;
  className?: string;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [createWith, setCreateWith] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<any>('/api/contacts')
      .then(r => { if (!cancelled) setContacts(Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const pick = (c: Contact) => { onPick(c); setPickerKey(k => k + 1); };

  return (
    <>
      <ContactAutocomplete
        key={pickerKey}
        className={className}
        contacts={contacts}
        value=""
        onChange={id => { const c = contacts.find(x => x.id === id); if (c) pick(c); }}
        onAddNew={query => setCreateWith(query)}
        placeholder={placeholder}
        addNewLabel="Créer un nouveau contact"
      />
      <ContactModal
        isOpen={createWith !== null}
        onClose={() => setCreateWith(null)}
        initialCategory={initialCategory}
        initialData={createWith ? { last_name: createWith } : undefined}
        onSuccess={c => { setContacts(prev => [c, ...prev.filter(x => x.id !== c.id)]); setCreateWith(null); pick(c); }}
      />
    </>
  );
}
