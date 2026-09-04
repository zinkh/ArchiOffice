import { useState, useEffect, FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { Contact, ContactCategory } from '../types';
import { apiFetch, fetchJson } from '../lib/api';
import { ContactFormFields } from './ContactFormFields';
import { ensureContactCategory, resolveCategoryName } from '../lib/contactCategories';

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (contact: Contact) => void;
  /**
   * Catégorie pré-sélectionnée, d'après le champ depuis lequel le modal a été
   * ouvert (client d'un projet, entreprise d'un lot, cotraitant...). Sans elle
   * le contact partait sans catégorie et disparaissait aussitôt des listes
   * filtrées par catégorie — y compris de celle qui venait de le créer.
   */
  initialCategory?: string;
}

export function ContactModal({ isOpen, onClose, onSuccess, initialCategory }: ContactModalProps) {
  const { t } = useTranslation();
  const [newContact, setNewContact] = useState<Partial<Contact>>({ category: initialCategory || '' });
  const [categories, setCategories] = useState<ContactCategory[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le composant reste monté entre deux ouvertures dans toutes les pages qui
  // l'utilisent : sans cette remise à zéro, le formulaire garderait la saisie
  // précédente et surtout la catégorie du champ précédent.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setNewContact({ category: initialCategory || '' });
    let cancelled = false;
    fetchJson<ContactCategory[]>('/api/contact-categories')
      .then(data => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setCategories(list);
        // Une catégorie déjà présente chez le cabinet est réutilisée telle
        // quelle (accents et casse compris) plutôt que dupliquée. Seul ce
        // champ est réécrit : la saisie faite pendant le chargement reste.
        setNewContact(prev => (
          prev.category === (initialCategory || '')
            ? { ...prev, category: resolveCategoryName(initialCategory, list) }
            : prev
        ));
      })
      .catch(err => console.error('Failed to fetch contact categories:', err));
    return () => { cancelled = true; };
  }, [isOpen, initialCategory]);

  const defaultContact: Contact = {
    id: '',
    prefix: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    suffix: '',
    nickname: '',
    company_name: '',
    job_title: '',
    department: '',
    email_work: '',
    email_home: '',
    email_other: '',
    email: '',
    phone_mobile: '',
    phone_work: '',
    phone_home: '',
    phone_main: '',
    phone_fax_work: '',
    phone_fax_home: '',
    phone_pager: '',
    phone_other: '',
    phone: '',
    address_work_street: '',
    address_work_city: '',
    address_work_state: '',
    address_work_zip: '',
    address_work_country: '',
    address_home_street: '',
    address_home_city: '',
    address_home_state: '',
    address_home_zip: '',
    address_home_country: '',
    address: '',
    zip: '',
    city: '',
    state: '',
    country: '',
    siret: '',
    vat_number: '',
    candidatures: '',
    affaires: '',
    logo: '',
    ca_amount: 0,
    electronic_signature: '',
    contact_references: '',
    tags: '',
    category: '',
    notes: '',
    birthday: '',
    website: '',
    created_at: '',
    created_by: '',
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const contactData = {
      ...newContact,
      category: (newContact.category || '').trim(),
      id: `c${Date.now()}-${Math.random()}`,
      created_at: new Date().toISOString(),
      created_by: 'Current User',
    };

    const cleanContactData = Object.fromEntries(
      Object.entries(contactData).filter(([_, v]) => v !== undefined && v !== null)
    );

    const contact: Contact = {
      ...defaultContact,
      ...cleanContactData,
      ca_amount: Number(newContact.ca_amount) || 0,
      email: newContact.email_work || newContact.email_home || newContact.email_other || newContact.email || '',
      phone: newContact.phone_mobile || newContact.phone_work || newContact.phone_home || newContact.phone || '',
      address: newContact.address_work_street || newContact.address || '',
      city: newContact.address_work_city || newContact.city || '',
      zip: newContact.address_work_zip || newContact.zip || '',
      state: newContact.address_work_state || newContact.state || '',
      country: newContact.address_work_country || newContact.country || '',
    };

    try {
      // Une catégorie saisie ici (ou proposée par le champ appelant) qui
      // n'existe pas encore est créée, sinon elle n'apparaîtrait dans aucun
      // filtre de la page Contacts.
      await ensureContactCategory(contact.category, categories);

      await apiFetch('/api/contacts', { method: 'POST', body: JSON.stringify(contact) });
      onSuccess(contact);
      onClose();
      setNewContact({ category: initialCategory || '' });
    } catch (err: any) {
      console.error('Error submitting contact:', err);
      setError(err?.message || 'Échec de la sauvegarde du contact.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
      >
        <div className="p-6 flex justify-between items-center" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>
            {t('add_contact')}
          </h3>
          <button
            onClick={onClose}
            style={{ color: 'var(--tblr-muted)' }}
          >
            ✕
          </button>
        </div>
        {error && (
          <div className="mx-6 mt-4 px-3 py-2 rounded-lg border text-sm flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400">
            <IconAlertTriangle size={16} className="shrink-0" />
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          <ContactFormFields
            contact={newContact}
            categories={categories}
            onChange={patch => setNewContact(prev => ({ ...prev, ...patch }))}
          />

          <div className="flex justify-end gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 rounded-lg font-medium transition-colors"
              style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
            >
              {isSubmitting ? '...' : t('save')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
