import React, { useState, FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { IconMail, IconPhone, IconPlus } from '@tabler/icons-react';
import type { Contact } from '../types';
import { fetchJson } from '../lib/api';

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (contact: Contact) => void;
  initialCategory?: string;
}

export function ContactModal({ isOpen, onClose, onSuccess, initialCategory }: ContactModalProps) {
  const { t } = useTranslation();
  const [newContact, setNewContact] = useState<Partial<Contact>>({
    category: initialCategory || ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    category: initialCategory || '',
    notes: '',
    birthday: '',
    website: '',
    created_at: '',
    created_by: '',
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    const contactData = {
      ...newContact,
      id: `c${Date.now()}`,
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
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contact)
      });
      
      if (res.ok) {
        const savedContact = await res.json();
        onSuccess(savedContact);
        onClose();
        setNewContact({ category: initialCategory || '' });
      } else {
        let errorMsg = `Server returned ${res.status}`;
        try {
          const errorData = await res.json();
          errorMsg = errorData.error || errorMsg;
        } catch (e) {
          // non-JSON response
        }
        console.error('Failed to save contact:', errorMsg);
        alert(`Failed to save contact: ${errorMsg}`);
      }
    } catch (err) {
      console.error('Error submitting contact:', err);
      alert('Failed to save contact. Please check the console for details.');
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
        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {/* Identité Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-700 pb-2">Identité</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Prefix</label>
                <input 
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                  value={newContact.prefix || ''}
                  onChange={e => setNewContact({...newContact, prefix: e.target.value})}
                  placeholder="M., Mme, Dr..."
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{t('first_name')} *</label>
                <input 
                  required
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                  value={newContact.first_name || ''}
                  onChange={e => setNewContact({...newContact, first_name: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Middle Name</label>
                <input 
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                  value={newContact.middle_name || ''}
                  onChange={e => setNewContact({...newContact, middle_name: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{t('last_name')} *</label>
                <input 
                  required
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                  value={newContact.last_name || ''}
                  onChange={e => setNewContact({...newContact, last_name: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Suffix</label>
                <input 
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                  value={newContact.suffix || ''}
                  onChange={e => setNewContact({...newContact, suffix: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Nickname</label>
                <input 
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                  value={newContact.nickname || ''}
                  onChange={e => setNewContact({...newContact, nickname: e.target.value})}
                />
              </div>
            </div>
          </div>

          {/* Organisation Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-700 pb-2">Organisation</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Société</label>
                <input 
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                  value={newContact.company_name || ''}
                  onChange={e => setNewContact({...newContact, company_name: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Fonction</label>
                <input 
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                  value={newContact.job_title || ''}
                  onChange={e => setNewContact({...newContact, job_title: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Service</label>
                <input 
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                  value={newContact.department || ''}
                  onChange={e => setNewContact({...newContact, department: e.target.value})}
                />
              </div>
            </div>
          </div>

          {/* Coordonnées Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-700 pb-2">Coordonnées</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h5 className="text-[10px] font-bold text-zinc-400 uppercase">Emails</h5>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <IconMail size={16} className="text-zinc-400" />
                    <input 
                      type="email"
                      placeholder="Travail"
                      className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                      value={newContact.email_work || ''}
                      onChange={e => setNewContact({...newContact, email_work: e.target.value})}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <h5 className="text-[10px] font-bold text-zinc-400 uppercase">Téléphones</h5>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center gap-2">
                    <IconPhone size={16} className="text-zinc-400" />
                    <input 
                      placeholder="Mobile"
                      className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                      value={newContact.phone_mobile || ''}
                      onChange={e => setNewContact({...newContact, phone_mobile: e.target.value})}
                    />
                  </div>
                </div>
              </div>
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
