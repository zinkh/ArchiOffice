import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMail, IconPhone, IconBrandLinkedin } from '@tabler/icons-react';
import type { Contact, ContactCategory } from '../types';
import { AddressAutocomplete } from './AddressAutocomplete';
import { CompanyAutocomplete } from './CompanyAutocomplete';
import { frenchVatNumber, streetWithoutCity } from '../lib/siren';

/**
 * Corps commun des deux formulaires de contact : la fiche complète de la page
 * Contacts et le modal de création rapide ouvert depuis un projet, un appel
 * d'offres, un devis, un contrat ou une référence. Les deux divergeaient
 * (le modal n'avait que six champs), si bien qu'un contact créé depuis un
 * projet arrivait vide et sans catégorie.
 */

interface ContactFormFieldsProps {
  contact: Partial<Contact>;
  /** Applique une modification partielle : le parent garde la propriété de l'état. */
  onChange: (patch: Partial<Contact>) => void;
  categories: ContactCategory[];
}

const NEW_CATEGORY = '__new__';

const inputStyle: React.CSSProperties = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };
const inputClass = "w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20";
const labelClass = "text-[10px] font-bold uppercase tracking-wider";
const labelStyle: React.CSSProperties = { color: 'var(--tblr-muted)' };
const sectionClass = "text-sm font-bold uppercase tracking-widest pb-2";
const sectionStyle: React.CSSProperties = { color: 'var(--tblr-primary)', borderBottom: '1px solid var(--tblr-border)' };

const HOME_ADDRESS_KEYS = ['address_home_street', 'address_home_zip', 'address_home_city', 'address_home_state', 'address_home_country'] as const;
const WORK_ADDRESS_KEYS = ['address_work_street', 'address_work_zip', 'address_work_city', 'address_work_state', 'address_work_country'] as const;

/** L'adresse personnelle recopie-t-elle déjà l'adresse professionnelle ? */
function homeMirrorsWork(c: Partial<Contact>): boolean {
  const hasHome = HOME_ADDRESS_KEYS.some(k => (c[k] || '').trim());
  if (!hasHome) return false;
  return WORK_ADDRESS_KEYS.every((wk, i) => (c[wk] || '').trim() === (c[HOME_ADDRESS_KEYS[i]] || '').trim());
}

function workToHome(c: Partial<Contact>): Partial<Contact> {
  return {
    address_home_street: c.address_work_street || '',
    address_home_zip: c.address_work_zip || '',
    address_home_city: c.address_work_city || '',
    address_home_state: c.address_work_state || '',
    address_home_country: c.address_work_country || '',
  };
}

export function ContactFormFields({ contact, onChange, categories }: ContactFormFieldsProps) {
  const { t } = useTranslation();
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [sameAddress, setSameAddress] = useState(() => homeMirrorsWork(contact));

  // Le formulaire est réutilisé pour un autre contact (édition depuis la liste)
  // sans être démonté : la case « adresse identique » doit refléter la fiche
  // affichée, pas la précédente.
  useEffect(() => {
    setSameAddress(homeMirrorsWork(contact));
    setIsCreatingCategory(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id]);

  /** Écrit dans l'adresse professionnelle, en recopiant sur le domicile si la case est cochée. */
  const setWorkAddress = (patch: Partial<Contact>) => {
    const merged = { ...contact, ...patch };
    onChange(sameAddress ? { ...patch, ...workToHome(merged) } : patch);
  };

  const toggleSameAddress = (checked: boolean) => {
    setSameAddress(checked);
    if (checked) onChange(workToHome(contact));
  };

  /**
   * LinkedIn n'expose pas d'API publique permettant de lire une fiche : le
   * bouton ouvre une recherche pré-remplie dans un nouvel onglet, à charge de
   * l'utilisateur de recopier ce qu'il y trouve.
   */
  const linkedInQuery = [contact.first_name, contact.last_name, contact.company_name]
    .map(v => (v || '').trim())
    .filter(Boolean)
    .join(' ');

  const currentCategory = contact.category || '';
  const knownCategory = categories.some(c => c.name === currentCategory);

  return (
    <>
      {/* Identité */}
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-4 border-b pb-2" style={{ borderColor: 'var(--tblr-border)' }}>
          <h4 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--tblr-primary)' }}>{t('contacts_section_identity')}</h4>
          <a
            href={`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(linkedInQuery)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${linkedInQuery ? 'hover:underline' : 'pointer-events-none opacity-40'}`}
            style={{ color: 'var(--tblr-primary)' }}
            title={t('contacts_linkedin_hint')}
          >
            <IconBrandLinkedin size={16} />
            {t('contacts_linkedin_search')}
          </a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className={labelClass} style={labelStyle}>{t('contacts_prefix_label')}</label>
            <input
              className={inputClass}
              style={inputStyle}
              value={contact.prefix || ''}
              onChange={e => onChange({ prefix: e.target.value })}
              placeholder={t('contacts_prefix_placeholder')}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} style={labelStyle}>{t('first_name')} {!contact.company_name?.trim() && '*'}</label>
            <input
              required={!contact.company_name?.trim()}
              className={inputClass}
              style={inputStyle}
              value={contact.first_name || ''}
              onChange={e => onChange({ first_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} style={labelStyle}>{t('contacts_middle_name_label')}</label>
            <input
              className={inputClass}
              style={inputStyle}
              value={contact.middle_name || ''}
              onChange={e => onChange({ middle_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} style={labelStyle}>{t('last_name')} {!contact.company_name?.trim() && '*'}</label>
            <input
              required={!contact.company_name?.trim()}
              className={inputClass}
              style={inputStyle}
              value={contact.last_name || ''}
              onChange={e => onChange({ last_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} style={labelStyle}>{t('contacts_suffix_label')}</label>
            <input
              className={inputClass}
              style={inputStyle}
              value={contact.suffix || ''}
              onChange={e => onChange({ suffix: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} style={labelStyle}>{t('contacts_nickname_label')}</label>
            <input
              className={inputClass}
              style={inputStyle}
              value={contact.nickname || ''}
              onChange={e => onChange({ nickname: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Organisation — la saisie interroge la base SIRENE et remplit le reste */}
      <div className="space-y-4">
        <h4 className={sectionClass} style={sectionStyle}>{t('contacts_section_organisation')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className={labelClass} style={labelStyle}>{t('contacts_company_name_label')}</label>
            <CompanyAutocomplete
              value={contact.company_name || ''}
              placeholder={t('contacts_company_search_placeholder')}
              inputStyle={inputStyle}
              onChange={(value, details) => {
                if (!details) {
                  onChange({ company_name: value });
                  return;
                }
                // Un champ déjà renseigné à la main n'est pas écrasé par la
                // fiche SIRENE : elle complète, elle ne corrige pas.
                const zip = details.zipcode || '';
                const city = details.city || '';
                const patch: Partial<Contact> = { company_name: value };
                if (details.siret && !contact.siret?.trim()) patch.siret = details.siret;
                const vat = frenchVatNumber(details.siren);
                if (vat && !contact.vat_number?.trim()) patch.vat_number = vat;
                if (!contact.address_work_street?.trim()) patch.address_work_street = streetWithoutCity(details.address, zip, city);
                if (zip && !contact.address_work_zip?.trim()) patch.address_work_zip = zip;
                if (city && !contact.address_work_city?.trim()) patch.address_work_city = city;
                setWorkAddress(patch);
              }}
            />
            <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_company_search_hint')}</p>
          </div>
          <div className="space-y-1">
            <label className={labelClass} style={labelStyle}>{t('contacts_job_title_label')}</label>
            <input
              className={inputClass}
              style={inputStyle}
              value={contact.job_title || ''}
              onChange={e => onChange({ job_title: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} style={labelStyle}>{t('contacts_department_label')}</label>
            <input
              className={inputClass}
              style={inputStyle}
              value={contact.department || ''}
              onChange={e => onChange({ department: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Coordonnées */}
      <div className="space-y-4">
        <h4 className={sectionClass} style={sectionStyle}>{t('contacts_section_contact_info')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h5 className="text-[10px] font-bold uppercase" style={labelStyle}>{t('contacts_emails_label')}</h5>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <IconMail size={16} style={labelStyle} />
                <input
                  type="email"
                  placeholder={t('contacts_email_work_placeholder')}
                  className={`flex-1 ${inputClass}`}
                  style={inputStyle}
                  value={contact.email_work || ''}
                  onChange={e => onChange({ email_work: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <IconMail size={16} style={labelStyle} />
                <input
                  type="email"
                  placeholder={t('contacts_email_personal_placeholder')}
                  className={`flex-1 ${inputClass}`}
                  style={inputStyle}
                  value={contact.email_home || ''}
                  onChange={e => onChange({ email_home: e.target.value })}
                />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <h5 className="text-[10px] font-bold uppercase" style={labelStyle}>{t('contacts_phones_label')}</h5>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center gap-2">
                <IconPhone size={16} style={labelStyle} />
                <input
                  placeholder={t('contacts_phone_mobile_placeholder')}
                  className={`flex-1 ${inputClass}`}
                  style={inputStyle}
                  value={contact.phone_mobile || ''}
                  onChange={e => onChange({ phone_mobile: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <IconPhone size={16} style={labelStyle} />
                <input
                  placeholder={t('contacts_phone_work_placeholder')}
                  className={`flex-1 ${inputClass}`}
                  style={inputStyle}
                  value={contact.phone_work || ''}
                  onChange={e => onChange({ phone_work: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Adresses — saisie assistée par la Base Adresse Nationale */}
      <div className="space-y-4">
        <h4 className={sectionClass} style={sectionStyle}>{t('contacts_section_addresses')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h5 className="text-[10px] font-bold uppercase" style={labelStyle}>{t('contacts_address_work_label')}</h5>
            <AddressAutocomplete
              value={contact.address_work_street || ''}
              placeholder={t('contacts_street_placeholder')}
              inputStyle={inputStyle}
              onChange={value => setWorkAddress({ address_work_street: value })}
              onSelect={d => setWorkAddress({
                address_work_street: streetWithoutCity(d.fullAddress, d.zipcode, d.city),
                address_work_zip: d.zipcode || '',
                address_work_city: d.city || '',
              })}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder={t('contacts_postal_code_placeholder')}
                className={inputClass}
                style={inputStyle}
                value={contact.address_work_zip || ''}
                onChange={e => setWorkAddress({ address_work_zip: e.target.value })}
              />
              <input
                placeholder={t('contacts_city_placeholder')}
                className={inputClass}
                style={inputStyle}
                value={contact.address_work_city || ''}
                onChange={e => setWorkAddress({ address_work_city: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 className="text-[10px] font-bold uppercase" style={labelStyle}>{t('contacts_address_home_label')}</h5>
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={labelStyle}>
                <input
                  type="checkbox"
                  checked={sameAddress}
                  onChange={e => toggleSameAddress(e.target.checked)}
                />
                {t('contacts_same_as_work_address')}
              </label>
            </div>
            <AddressAutocomplete
              value={contact.address_home_street || ''}
              placeholder={t('contacts_street_placeholder')}
              inputStyle={inputStyle}
              disabled={sameAddress}
              onChange={value => onChange({ address_home_street: value })}
              onSelect={d => onChange({
                address_home_street: streetWithoutCity(d.fullAddress, d.zipcode, d.city),
                address_home_zip: d.zipcode || '',
                address_home_city: d.city || '',
              })}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder={t('contacts_postal_code_placeholder')}
                className={`${inputClass} disabled:opacity-60`}
                style={inputStyle}
                disabled={sameAddress}
                value={contact.address_home_zip || ''}
                onChange={e => onChange({ address_home_zip: e.target.value })}
              />
              <input
                placeholder={t('contacts_city_placeholder')}
                className={`${inputClass} disabled:opacity-60`}
                style={inputStyle}
                disabled={sameAddress}
                value={contact.address_home_city || ''}
                onChange={e => onChange({ address_home_city: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Autres */}
      <div className="space-y-4">
        <h4 className={sectionClass} style={sectionStyle}>{t('contacts_section_other')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className={labelClass} style={labelStyle}>{t('contacts_category_label')}</label>
              <select
                className={inputClass}
                style={inputStyle}
                value={isCreatingCategory ? NEW_CATEGORY : currentCategory}
                onChange={e => {
                  if (e.target.value === NEW_CATEGORY) {
                    setIsCreatingCategory(true);
                    onChange({ category: '' });
                  } else {
                    setIsCreatingCategory(false);
                    onChange({ category: e.target.value });
                  }
                }}
              >
                <option value="">{t('contacts_select_category')}</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.name}>{cat.name}</option>
                ))}
                {/* Catégorie proposée par le champ appelant, pas encore créée
                    chez ce cabinet : elle le sera à l'enregistrement. */}
                {!knownCategory && currentCategory && !isCreatingCategory && (
                  <option value={currentCategory}>{currentCategory}</option>
                )}
                <option value={NEW_CATEGORY}>{t('contacts_category_new_option')}</option>
              </select>
              {isCreatingCategory && (
                <input
                  autoFocus
                  className={`${inputClass} mt-2`}
                  style={inputStyle}
                  value={currentCategory}
                  onChange={e => onChange({ category: e.target.value })}
                  placeholder={t('contacts_new_category_placeholder')}
                />
              )}
            </div>
            <div className="space-y-1">
              <label className={labelClass} style={labelStyle}>{t('contacts_tags_label')}</label>
              <input
                className={inputClass}
                style={inputStyle}
                value={contact.tags || ''}
                onChange={e => onChange({ tags: e.target.value })}
                placeholder={t('contacts_tags_placeholder')}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass} style={labelStyle}>{t('contacts_notes_label')}</label>
              <textarea
                className={`${inputClass} h-24`}
                style={inputStyle}
                value={contact.notes || ''}
                onChange={e => onChange({ notes: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className={labelClass} style={labelStyle}>{t('contacts_siret_label')}</label>
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={contact.siret || ''}
                  onChange={e => onChange({ siret: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass} style={labelStyle}>{t('contacts_vat_label')}</label>
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={contact.vat_number || ''}
                  onChange={e => onChange({ vat_number: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className={labelClass} style={labelStyle}>{t('contacts_website_label')}</label>
              <input
                className={inputClass}
                style={inputStyle}
                value={contact.website || ''}
                onChange={e => onChange({ website: e.target.value })}
                placeholder="https://"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className={labelClass} style={labelStyle}>{t('contacts_annual_turnover_label')}</label>
                <input
                  type="number"
                  className={inputClass}
                  style={inputStyle}
                  value={contact.ca_amount ?? ''}
                  onChange={e => onChange({ ca_amount: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass} style={labelStyle}>{t('contacts_birthday_label')}</label>
                <input
                  type="date"
                  className={inputClass}
                  style={inputStyle}
                  value={contact.birthday || ''}
                  onChange={e => onChange({ birthday: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
