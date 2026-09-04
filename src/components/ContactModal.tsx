import React, { useState, useEffect, useCallback, FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { IconMail, IconPhone, IconAlertTriangle } from '@tabler/icons-react';
import type { Contact, ContactCategory } from '../types';
import { apiFetch, fetchJson } from '../lib/api';
import { resolveCategoryName, sameCategory } from '../lib/contactCategories';

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

const NEW_CATEGORY = '__new__';

export function ContactModal({ isOpen, onClose, onSuccess, initialCategory }: ContactModalProps) {
  const { t } = useTranslation();
  const [newContact, setNewContact] = useState<Partial<Contact>>({ category: initialCategory || '' });
  const [categories, setCategories] = useState<ContactCategory[]>([]);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass = "w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white";
  const labelClass = "text-[10px] font-bold text-zinc-400 uppercase tracking-wider";
  const sectionClass = "text-sm font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-700 pb-2";

  const set = useCallback(<K extends keyof Contact>(key: K, value: Contact[K]) => {
    setNewContact(prev => ({ ...prev, [key]: value }));
  }, []);

  // Le composant reste monté entre deux ouvertures dans toutes les pages qui
  // l'utilisent : sans cette remise à zéro, le formulaire garderait la saisie
  // précédente et surtout la catégorie du champ précédent.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setIsCreatingCategory(false);
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
      const category = contact.category || '';
      if (category && !categories.some(c => sameCategory(c.name, category))) {
        try {
          await apiFetch('/api/contact-categories', {
            method: 'POST',
            body: JSON.stringify({ id: crypto.randomUUID(), name: category }),
          });
        } catch (catErr) {
          // Un doublon (course entre deux onglets) ne doit pas empêcher
          // l'enregistrement du contact lui-même.
          console.error('Failed to create contact category:', catErr);
        }
      }

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

  const currentCategory = newContact.category || '';
  const knownCategory = categories.some(c => c.name === currentCategory);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
          <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
            {t('add_contact')}
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
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
          {/* Catégorie — en tête de formulaire : c'est elle qui décide dans
              quelles listes le contact apparaîtra ensuite. */}
          <div className="space-y-4">
            <h4 className={sectionClass}>{t('contacts_category_label')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className={labelClass}>{t('contacts_category_label')}</label>
                <select
                  className={inputClass}
                  value={isCreatingCategory ? NEW_CATEGORY : currentCategory}
                  onChange={e => {
                    if (e.target.value === NEW_CATEGORY) {
                      setIsCreatingCategory(true);
                      set('category', '');
                    } else {
                      setIsCreatingCategory(false);
                      set('category', e.target.value);
                    }
                  }}
                >
                  <option value="">{t('contacts_select_category')}</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                  ))}
                  {/* Catégorie suggérée par le champ appelant, pas encore
                      créée chez ce cabinet : elle le sera à l'enregistrement. */}
                  {!knownCategory && currentCategory && !isCreatingCategory && (
                    <option value={currentCategory}>{currentCategory}</option>
                  )}
                  <option value={NEW_CATEGORY}>{t('contacts_category_new_option')}</option>
                </select>
              </div>
              {isCreatingCategory && (
                <div className="space-y-1">
                  <label className={labelClass}>{t('contacts_new_category_placeholder')}</label>
                  <input
                    autoFocus
                    className={inputClass}
                    value={currentCategory}
                    onChange={e => set('category', e.target.value)}
                    placeholder={t('contacts_new_category_placeholder')}
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className={labelClass}>{t('contacts_tags_label')}</label>
                <input
                  className={inputClass}
                  value={newContact.tags || ''}
                  onChange={e => set('tags', e.target.value)}
                  placeholder={t('contacts_tags_placeholder')}
                />
              </div>
            </div>
          </div>

          {/* Identité Section */}
          <div className="space-y-4">
            <h4 className={sectionClass}>{t('contacts_section_identity')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className={labelClass}>{t('contacts_prefix_label')}</label>
                <input
                  className={inputClass}
                  value={newContact.prefix || ''}
                  onChange={e => set('prefix', e.target.value)}
                  placeholder={t('contacts_prefix_placeholder')}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>{t('first_name')} {!newContact.company_name?.trim() && '*'}</label>
                <input
                  required={!newContact.company_name?.trim()}
                  className={inputClass}
                  value={newContact.first_name || ''}
                  onChange={e => set('first_name', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>{t('contacts_middle_name_label')}</label>
                <input
                  className={inputClass}
                  value={newContact.middle_name || ''}
                  onChange={e => set('middle_name', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>{t('last_name')} {!newContact.company_name?.trim() && '*'}</label>
                <input
                  required={!newContact.company_name?.trim()}
                  className={inputClass}
                  value={newContact.last_name || ''}
                  onChange={e => set('last_name', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>{t('contacts_suffix_label')}</label>
                <input
                  className={inputClass}
                  value={newContact.suffix || ''}
                  onChange={e => set('suffix', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>{t('contacts_nickname_label')}</label>
                <input
                  className={inputClass}
                  value={newContact.nickname || ''}
                  onChange={e => set('nickname', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Organisation Section */}
          <div className="space-y-4">
            <h4 className={sectionClass}>{t('contacts_section_organisation')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className={labelClass}>{t('contacts_company_name_label')}</label>
                <input
                  className={inputClass}
                  value={newContact.company_name || ''}
                  onChange={e => set('company_name', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>{t('contacts_job_title_label')}</label>
                <input
                  className={inputClass}
                  value={newContact.job_title || ''}
                  onChange={e => set('job_title', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>{t('contacts_department_label')}</label>
                <input
                  className={inputClass}
                  value={newContact.department || ''}
                  onChange={e => set('department', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Coordonnées Section */}
          <div className="space-y-4">
            <h4 className={sectionClass}>{t('contacts_section_contact_info')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h5 className="text-[10px] font-bold text-zinc-400 uppercase">{t('contacts_emails_label')}</h5>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <IconMail size={16} className="text-zinc-400" />
                    <input
                      type="email"
                      placeholder={t('contacts_email_work_placeholder')}
                      className={`flex-1 ${inputClass}`}
                      value={newContact.email_work || ''}
                      onChange={e => set('email_work', e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <IconMail size={16} className="text-zinc-400" />
                    <input
                      type="email"
                      placeholder={t('contacts_email_personal_placeholder')}
                      className={`flex-1 ${inputClass}`}
                      value={newContact.email_home || ''}
                      onChange={e => set('email_home', e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <h5 className="text-[10px] font-bold text-zinc-400 uppercase">{t('contacts_phones_label')}</h5>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center gap-2">
                    <IconPhone size={16} className="text-zinc-400" />
                    <input
                      placeholder={t('contacts_phone_mobile_placeholder')}
                      className={`flex-1 ${inputClass}`}
                      value={newContact.phone_mobile || ''}
                      onChange={e => set('phone_mobile', e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <IconPhone size={16} className="text-zinc-400" />
                    <input
                      placeholder={t('contacts_phone_work_placeholder')}
                      className={`flex-1 ${inputClass}`}
                      value={newContact.phone_work || ''}
                      onChange={e => set('phone_work', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Adresses Section */}
          <div className="space-y-4">
            <h4 className={sectionClass}>{t('contacts_section_addresses')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h5 className="text-[10px] font-bold text-zinc-400 uppercase">{t('contacts_address_work_label')}</h5>
                <input
                  placeholder={t('contacts_street_placeholder')}
                  className={inputClass}
                  value={newContact.address_work_street || ''}
                  onChange={e => set('address_work_street', e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    placeholder={t('contacts_postal_code_placeholder')}
                    className={inputClass}
                    value={newContact.address_work_zip || ''}
                    onChange={e => set('address_work_zip', e.target.value)}
                  />
                  <input
                    placeholder={t('contacts_city_placeholder')}
                    className={inputClass}
                    value={newContact.address_work_city || ''}
                    onChange={e => set('address_work_city', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <h5 className="text-[10px] font-bold text-zinc-400 uppercase">{t('contacts_address_home_label')}</h5>
                <input
                  placeholder={t('contacts_street_placeholder')}
                  className={inputClass}
                  value={newContact.address_home_street || ''}
                  onChange={e => set('address_home_street', e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    placeholder={t('contacts_postal_code_placeholder')}
                    className={inputClass}
                    value={newContact.address_home_zip || ''}
                    onChange={e => set('address_home_zip', e.target.value)}
                  />
                  <input
                    placeholder={t('contacts_city_placeholder')}
                    className={inputClass}
                    value={newContact.address_home_city || ''}
                    onChange={e => set('address_home_city', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Autres Section */}
          <div className="space-y-4">
            <h4 className={sectionClass}>{t('contacts_section_other')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className={labelClass}>{t('contacts_siret_label')}</label>
                    <input
                      className={inputClass}
                      value={newContact.siret || ''}
                      onChange={e => set('siret', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>{t('contacts_vat_label')}</label>
                    <input
                      className={inputClass}
                      value={newContact.vat_number || ''}
                      onChange={e => set('vat_number', e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>{t('contacts_website_label')}</label>
                  <input
                    className={inputClass}
                    value={newContact.website || ''}
                    onChange={e => set('website', e.target.value)}
                    placeholder="https://"
                  />
                </div>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className={labelClass}>{t('contacts_annual_turnover_label')}</label>
                    <input
                      type="number"
                      className={inputClass}
                      value={newContact.ca_amount ?? ''}
                      onChange={e => set('ca_amount', Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>{t('contacts_birthday_label')}</label>
                    <input
                      type="date"
                      className={inputClass}
                      value={newContact.birthday || ''}
                      onChange={e => set('birthday', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>{t('contacts_notes_label')}</label>
              <textarea
                className={`${inputClass} h-24`}
                value={newContact.notes || ''}
                onChange={e => set('notes', e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? '...' : t('save')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
