import { useState, useEffect, FormEvent, useMemo, ChangeEvent } from 'react';
import { IconPlus, IconSearch, IconUser, IconPhone, IconMail, IconMapPin, IconBuilding, IconTag, IconCalendar, IconSignature, IconSettings, IconTrash, IconWorld, IconBriefcase, IconFileText, IconEdit, IconChevronUp, IconChevronDown, IconFilter, IconAlertTriangle, IconRefresh, IconCloud } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { Contact, ContactCategory, Project, Tender } from '../types';
import { fetchJson, apiFetch } from '../lib/api';
import { MobileAccordionTable } from '../components/MobileAccordionTable';

type SortField = 'prefix' | 'last_name' | 'first_name' | 'company_name' | 'ca_amount' | 'city' | 'job_title';
type SortOrder = 'asc' | 'desc';

export function isContactIncomplete(c: Contact): boolean {
  const hasName = !!(c.first_name?.trim() || c.last_name?.trim());
  const hasPhone = !!(c.phone_mobile?.trim() || c.phone_work?.trim() || c.phone?.trim());
  const hasEmail = !!(c.email?.trim() || c.email_work?.trim() || c.email_home?.trim());
  return !hasName || !hasPhone || !hasEmail;
}

export default function Contacts() {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<ContactCategory[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [importData, setImportData] = useState<{ headers: string[], data: any[] } | null>(null);
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  const [newContact, setNewContact] = useState<Partial<Contact>>({});
  const [newCategoryName, setNewCategoryName] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [syncingCardDav, setSyncingCardDav] = useState(false);
  const [cardDavModal, setCardDavModal] = useState(false);
  const [cardDavUrl, setCardDavUrl] = useState('');
  const [cardDavUser, setCardDavUser] = useState('');
  const [cardDavPass, setCardDavPass] = useState('');

  // Search, Filter, Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [sortConfig, setSortConfig] = useState<{ field: SortField; order: SortOrder }>({ field: 'last_name', order: 'asc' });

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    fetchContacts();
    fetchCategories();
    fetchProjects();
    fetchTenders();
  }, []);

  const fetchContacts = () => {
    fetchJson('/api/contacts')
      .then(setContacts)
      .catch(() => showToast('Impossible de charger les contacts', 'error'));
  };

  const fetchCategories = () => {
    fetchJson('/api/contact-categories')
      .then(setCategories)
      .catch(() => showToast('Impossible de charger les catégories', 'error'));
  };

  const fetchProjects = () => {
    fetchJson('/api/projects')
      .then(setProjects)
      .catch(err => console.error('Error fetching projects:', err));
  };

  const fetchTenders = () => {
    fetchJson('/api/tenders')
      .then(setTenders)
      .catch(err => console.error('Error fetching tenders:', err));
  };

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

    const contactData = isEditing ? newContact : {
      ...newContact,
      id: `c${Date.now()}`,
      created_at: new Date().toISOString(),
      created_by: 'Current User', // Replace with actual user
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
      const url = isEditing ? `/api/contacts/${editingId}` : '/api/contacts';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contact)
      });

      if (res.ok) {
        setIsModalOpen(false);
        setIsEditing(false);
        setEditingId(null);
        setNewContact({});
        fetchContacts();
      } else {
        const text = await res.text();
        try {
          const errorData = JSON.parse(text);
          console.error('Failed to save contact:', errorData);
          alert(`Failed to save contact: ${errorData.error || 'Unknown error'}`);
        } catch (e) {
          console.error('Failed to save contact (non-JSON response):', text);
          alert(`Failed to save contact: Server returned ${res.status} ${res.statusText}`);
        }
      }
    } catch (err: any) {
      showToast(err?.message || 'Erreur lors de la sauvegarde du contact', 'error');
    }
  };

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      await apiFetch('/api/contact-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), name: newCategoryName })
      });
      setNewCategoryName('');
      fetchCategories();
      showToast('Catégorie ajoutée');
    } catch (err: any) {
      showToast(err?.message || 'Erreur lors de la création de la catégorie', 'error');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Supprimer cette catégorie ?')) return;
    try {
      await apiFetch(`/api/contact-categories/${id}`, { method: 'DELETE' });
      fetchCategories();
      showToast('Catégorie supprimée');
    } catch (err: any) {
      showToast(err?.message || 'Erreur lors de la suppression', 'error');
    }
  };

  const handleEdit = (contact: Contact) => {
    setNewContact(contact);
    setIsEditing(true);
    setEditingId(contact.id);
    setIsModalOpen(true);
  };

  const handleDeleteContact = async (id: string) => {
    if (!confirm('Supprimer ce contact ?')) return;
    try {
      await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' });
      fetchContacts();
      showToast('Contact supprimé');
    } catch (err: any) {
      showToast(err?.message || 'Erreur lors de la suppression', 'error');
    }
  };

  const handleGoogleSync = async () => {
    setSyncingGoogle(true);
    try {
      const result = await apiFetch<{ imported: number; updated: number }>('/api/sync/google-contacts', { method: 'POST' });
      fetchContacts();
      showToast(`Google Contacts : ${result.imported} importés, ${result.updated} mis à jour`);
    } catch (err: any) {
      showToast(err?.message || 'Erreur de synchronisation Google Contacts', 'error');
    } finally {
      setSyncingGoogle(false);
    }
  };

  const handleCardDavSync = async () => {
    if (!cardDavUrl || !cardDavUser) {
      showToast('URL et nom d\'utilisateur requis', 'error');
      return;
    }
    setSyncingCardDav(true);
    try {
      const result = await apiFetch<{ imported: number; updated: number }>('/api/sync/carddav', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cardDavUrl, username: cardDavUser, password: cardDavPass })
      });
      fetchContacts();
      setCardDavModal(false);
      showToast(`CardDAV : ${result.imported} importés, ${result.updated} mis à jour`);
    } catch (err: any) {
      showToast(err?.message || 'Erreur de synchronisation CardDAV', 'error');
    } finally {
      setSyncingCardDav(false);
    }
  };

  const handleSort = (field: SortField) => {
    setSortConfig(prev => ({
      field,
      order: prev.field === field && prev.order === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleExport = () => {
    import('xlsx').then(XLSX => {
      const worksheet = XLSX.utils.json_to_sheet(contacts);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Contacts');
      XLSX.writeFile(workbook, 'contacts.xlsx');
    });
  };

  const MappingModal = () => {
    const { t } = useTranslation();
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const contactFields = [
      'prefix', 'first_name', 'middle_name', 'last_name', 'suffix', 'nickname',
      'company_name', 'job_title', 'department',
      'email_work', 'email_home', 'email_other',
      'phone_mobile', 'phone_work', 'phone_home', 'phone_main', 'phone_fax_work', 'phone_fax_home', 'phone_pager', 'phone_other',
      'address_work_street', 'address_work_city', 'address_work_state', 'address_work_zip', 'address_work_country',
      'address_home_street', 'address_home_city', 'address_home_state', 'address_home_zip', 'address_home_country',
      'siret', 'vat_number', 'website', 'notes', 'birthday', 'tags', 'category'
    ];

    const handleConfirm = async () => {
      if (!importData) return;
      for (const row of importData.data) {
        const contact: Contact = {
          ...defaultContact,
          id: `c${Date.now()}-${Math.random()}`,
          created_at: new Date().toISOString(),
          created_by: 'Current User'
        };
        for (const field of contactFields) {
          if (mapping[field] && row[mapping[field]] !== undefined && row[mapping[field]] !== null) {
            (contact as any)[field] = row[mapping[field]];
          }
        }

        // Set primary email/phone if not set
        contact.email = contact.email_work || contact.email_home || contact.email_other || '';
        contact.phone = contact.phone_mobile || contact.phone_work || contact.phone_home || '';
        contact.address = contact.address_work_street || '';
        contact.city = contact.address_work_city || '';
        contact.zip = contact.address_work_zip || '';
        contact.state = contact.address_work_state || '';
        contact.country = contact.address_work_country || '';
        contact.ca_amount = Number(contact.ca_amount) || 0;

        await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(contact)
        });
      }
      fetchContacts();
      setIsMappingModalOpen(false);
      setImportData(null);
    };

    if (!isMappingModalOpen || !importData) return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--tblr-text)' }}>{t('contacts_map_fields_title')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {contactFields.map(field => (
              <div key={field} className="flex flex-col">
                <label className="text-sm font-medium mb-1" style={{ color: 'var(--tblr-muted)' }}>{field}</label>
                <select
                  className="rounded px-2 py-2"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  onChange={(e) => setMapping({...mapping, [field]: e.target.value})}
                  value={mapping[field] || ''}
                >
                  <option value="">{t('contacts_select_column')}</option>
                  {importData.headers.map(header => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-4">
            <button
              className="px-4 py-2 rounded transition-colors"
              style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
              onClick={() => setIsMappingModalOpen(false)}
            >
              {t('btn_cancel')}
            </button>
            <button
              className="px-4 py-2 rounded"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
              onClick={handleConfirm}
            >
              {t('contacts_import_btn')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const data = event.target?.result;
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
        import('xlsx').then(async XLSX => {
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          const headers = json[0] as string[];
          const rows = json.slice(1) as any[][];

          const dataRows = rows.map(row => {
            const obj: any = {};
            headers.forEach((header, index) => {
              obj[header] = row[index];
            });
            return obj;
          });

          setImportData({ headers, data: dataRows });
          setIsMappingModalOpen(true);
        });
      } else {
        alert('File format not supported yet. Please use Excel or CSV.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const filteredAndSortedContacts = useMemo(() => {
    let result = [...contacts];

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.first_name.toLowerCase().includes(query) ||
        c.last_name.toLowerCase().includes(query) ||
        c.company_name?.toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query) ||
        c.city.toLowerCase().includes(query) ||
        c.prefix?.toLowerCase().includes(query)
      );
    }

    // Filter by category
    if (filterCategory) {
      result = result.filter(c => c.category === filterCategory);
    }

    // Sort
    result.sort((a, b) => {
      const field = sortConfig.field;
      const order = sortConfig.order === 'asc' ? 1 : -1;

      const valA = (a[field as keyof Contact] || '').toString().toLowerCase();
      const valB = (b[field as keyof Contact] || '').toString().toLowerCase();

      if (field === 'ca_amount') {
        return (Number(a.ca_amount) - Number(b.ca_amount)) * order;
      }

      if (valA < valB) return -1 * order;
      if (valA > valB) return 1 * order;
      return 0;
    });

    return result;
  }, [contacts, searchQuery, filterCategory, sortConfig]);

  // Shared input style
  const inputStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };

  return (
    <div className="space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-4 right-4 z-[200] px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"
            style={{
              background: toast.type === 'error' ? 'var(--tblr-danger)' : 'var(--tblr-success)',
              color: '#fff'
            }}
          >
            {toast.type === 'error' ? <IconAlertTriangle size={16} /> : null}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('contacts')}</h2>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => document.getElementById('file-upload')?.click()}
            className="flex items-center gap-1 md:gap-2 px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium transition-colors shadow-sm"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
          >
            <IconFileText size={14} className="md:size-[18px]" />
            <span className="hidden md:inline">{t('contacts_import_label')}</span>
          </button>
          <input id="file-upload" type="file" className="hidden" accept=".vcf,.xlsx,.xls,.csv,.xml" onChange={handleImport} />
          <button
            onClick={handleExport}
            className="flex items-center gap-1 md:gap-2 px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium transition-colors shadow-sm"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
          >
            <IconFileText size={14} className="md:size-[18px]" />
            <span className="hidden md:inline">{t('contacts_export_label')}</span>
          </button>
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center gap-1 md:gap-2 px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium transition-colors shadow-sm"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
          >
            <IconSettings size={14} className="md:size-[18px]" />
            <span className="hidden md:inline">{t('contacts_categories_label')}</span>
          </button>
          <button
            onClick={handleGoogleSync}
            disabled={syncingGoogle}
            className="flex items-center gap-1 md:gap-2 px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium transition-colors shadow-sm"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
            title="Synchroniser avec Google Contacts"
          >
            {syncingGoogle ? <IconRefresh size={14} className="animate-spin md:size-[18px]" /> : <IconRefresh size={14} className="md:size-[18px]" />}
            <span className="hidden md:inline">Google Contacts</span>
          </button>
          <button
            onClick={() => setCardDavModal(true)}
            className="flex items-center gap-1 md:gap-2 px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium transition-colors shadow-sm"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
            title="Synchroniser via CardDAV (Nextcloud)"
          >
            <IconCloud size={14} className="md:size-[18px]" />
            <span className="hidden md:inline">CardDAV</span>
          </button>
          <button
            onClick={() => {
              setIsEditing(false);
              setEditingId(null);
              setNewContact({});
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1 md:gap-2 px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium transition-colors shadow-sm"
            style={{ background: 'var(--tblr-primary)', color: '#fff' }}
          >
            <IconPlus size={14} className="md:size-[18px]" />
            <span className="hidden md:inline">{t('add_contact')}</span>
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2" size={18} style={{ color: 'var(--tblr-muted)' }} />
          <input
            type="text"
            placeholder={t('contacts_search_placeholder')}
            className="w-full pl-10 pr-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20"
            style={inputStyle}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <IconFilter className="absolute left-3 top-1/2 -translate-y-1/2" size={18} style={{ color: 'var(--tblr-muted)' }} />
            <select
              className="pl-10 pr-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none w-full sm:min-w-[180px]"
              style={inputStyle}
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
            >
              <option value="">{t('contacts_all_categories')}</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.name}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        {/* Mobile accordion */}
        <div className="md:hidden">
          <MobileAccordionTable
            data={filteredAndSortedContacts}
            keyField="id"
            emptyText={searchQuery || filterCategory ? t('contacts_no_contacts_filter') : t('no_contacts')}
            columns={[
              { label: 'Nom', primary: true, render: c => (
                <div className="flex items-center gap-2">
                  <span>{c.prefix} {c.last_name} {c.first_name}</span>
                  {isContactIncomplete(c) && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: '#fff3bf', color: '#e67700' }}>
                      <IconAlertTriangle size={9} /> À compléter
                    </span>
                  )}
                </div>
              )},
              { label: t('contacts_col_category'), render: c => c.category ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>{c.category}</span> : '---' },
              { label: t('phone'), render: c => c.phone || '---' },
              { label: t('email'), render: c => c.email || '---' },
              { label: t('city'), render: c => c.city || '---' },
              { label: t('ca_amount'), render: c => <span className="font-mono">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(c.ca_amount)}</span> },
            ]}
            actions={contact => (
              <div className="flex gap-2">
                <button onClick={() => handleEdit(contact)} className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}><IconEdit size={15} /></button>
                <button onClick={() => handleDeleteContact(contact.id)} className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-danger)', background: '#ffe3e3' }}><IconTrash size={15} /></button>
              </div>
            )}
          />
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
              <tr>
                <th className="px-6 py-4 cursor-pointer transition-colors font-medium" style={{ color: 'var(--tblr-muted)' }} onClick={() => handleSort('prefix')}>
                  <div className="flex items-center gap-1">
                    {t('contacts_col_prefix')}
                    {sortConfig.field === 'prefix' && (sortConfig.order === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
                  </div>
                </th>
                <th className="px-6 py-4 cursor-pointer transition-colors font-medium" style={{ color: 'var(--tblr-muted)' }} onClick={() => handleSort('last_name')}>
                  <div className="flex items-center gap-1">
                    {t('last_name')}
                    {sortConfig.field === 'last_name' && (sortConfig.order === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
                  </div>
                </th>
                <th className="px-6 py-4 font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('first_name')}</th>
                <th className="px-6 py-4 font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_col_category')}</th>
                <th className="px-6 py-4 font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('phone')}</th>
                <th className="px-6 py-4 font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('email')}</th>
                <th className="px-6 py-4 cursor-pointer transition-colors font-medium" style={{ color: 'var(--tblr-muted)' }} onClick={() => handleSort('city')}>
                  <div className="flex items-center gap-1">
                    {t('city')}
                    {sortConfig.field === 'city' && (sortConfig.order === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
                  </div>
                </th>
                <th className="px-6 py-4 cursor-pointer transition-colors text-right font-medium" style={{ color: 'var(--tblr-muted)' }} onClick={() => handleSort('ca_amount')}>
                  <div className="flex items-center justify-end gap-1">
                    {t('ca_amount')}
                    {sortConfig.field === 'ca_amount' && (sortConfig.order === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
                  </div>
                </th>
                <th className="px-6 py-4 text-right font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedContacts.map((contact) => (
                <tr key={contact.id} className="transition-colors" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                  <td className="px-6 py-4 font-medium" style={{ color: 'var(--tblr-text)' }}>
                    <div>{contact.prefix}</div>
                    {contact.company_name && <div className="text-[10px] font-normal" style={{ color: 'var(--tblr-muted)' }}>{contact.company_name}</div>}
                  </td>
                  <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>
                    <div className="flex items-center gap-2">
                      <span>{contact.last_name}</span>
                      {isContactIncomplete(contact) && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap" style={{ background: '#fff3bf', color: '#e67700', border: '1px solid #ffe066' }} title="Informations manquantes : nom, téléphone ou email">
                          <IconAlertTriangle size={9} />
                          À compléter
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>{contact.first_name}</td>
                  <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>
                    {contact.category && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                        {contact.category}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>{contact.phone}</td>
                  <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>{contact.email}</td>
                  <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>{contact.city}</td>
                  <td className="px-6 py-4 font-mono text-right" style={{ color: 'var(--tblr-text)' }}>
                    {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(contact.ca_amount)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleEdit(contact)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-primary)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--tblr-primary-lt)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-muted)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                        title="Edit"
                      >
                        <IconEdit size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteContact(contact.id)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-danger)'; (e.currentTarget as HTMLButtonElement).style.background = '#ffe3e3'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-muted)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                        title="Delete"
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredAndSortedContacts.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center" style={{ color: 'var(--tblr-muted)' }}>
                    <div className="flex flex-col items-center gap-2">
                      <IconUser size={32} className="opacity-20" />
                      <p>{searchQuery || filterCategory ? t('contacts_no_contacts_filter') : t('no_contacts')}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Contact Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
          >
            <div className="p-6 flex justify-between items-center" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
              <h3 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>
                {isEditing ? t('contacts_edit_title') : t('add_contact')}
              </h3>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setIsEditing(false);
                  setEditingId(null);
                }}
                style={{ color: 'var(--tblr-muted)' }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-8">
              {/* Identité Section */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest pb-2" style={{ color: 'var(--tblr-primary)', borderBottom: '1px solid var(--tblr-border)' }}>{t('contacts_section_identity')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_prefix_label')}</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.prefix || ''}
                      onChange={e => setNewContact({...newContact, prefix: e.target.value})}
                      placeholder={t('contacts_prefix_placeholder')}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('first_name')} *</label>
                    <input
                      required
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.first_name || ''}
                      onChange={e => setNewContact({...newContact, first_name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_middle_name_label')}</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.middle_name || ''}
                      onChange={e => setNewContact({...newContact, middle_name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('last_name')} *</label>
                    <input
                      required
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.last_name || ''}
                      onChange={e => setNewContact({...newContact, last_name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_suffix_label')}</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.suffix || ''}
                      onChange={e => setNewContact({...newContact, suffix: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_nickname_label')}</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.nickname || ''}
                      onChange={e => setNewContact({...newContact, nickname: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              {/* Organisation Section */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest pb-2" style={{ color: 'var(--tblr-primary)', borderBottom: '1px solid var(--tblr-border)' }}>{t('contacts_section_organisation')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_company_name_label')}</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.company_name || ''}
                      onChange={e => setNewContact({...newContact, company_name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_job_title_label')}</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.job_title || ''}
                      onChange={e => setNewContact({...newContact, job_title: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_department_label')}</label>
                    <input
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.department || ''}
                      onChange={e => setNewContact({...newContact, department: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              {/* Coordonnées Section */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest pb-2" style={{ color: 'var(--tblr-primary)', borderBottom: '1px solid var(--tblr-border)' }}>{t('contacts_section_contact_info')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h5 className="text-[10px] font-bold uppercase" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_emails_label')}</h5>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <IconMail size={16} style={{ color: 'var(--tblr-muted)' }} />
                        <input
                          type="email"
                          placeholder={t('contacts_email_work_placeholder')}
                          className="flex-1 px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                          style={inputStyle}
                          value={newContact.email_work || ''}
                          onChange={e => setNewContact({...newContact, email_work: e.target.value})}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <IconMail size={16} style={{ color: 'var(--tblr-muted)' }} />
                        <input
                          type="email"
                          placeholder={t('contacts_email_personal_placeholder')}
                          className="flex-1 px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                          style={inputStyle}
                          value={newContact.email_home || ''}
                          onChange={e => setNewContact({...newContact, email_home: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h5 className="text-[10px] font-bold uppercase" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_phones_label')}</h5>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center gap-2">
                        <IconPhone size={16} style={{ color: 'var(--tblr-muted)' }} />
                        <input
                          placeholder={t('contacts_phone_mobile_placeholder')}
                          className="flex-1 px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                          style={inputStyle}
                          value={newContact.phone_mobile || ''}
                          onChange={e => setNewContact({...newContact, phone_mobile: e.target.value})}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <IconPhone size={16} style={{ color: 'var(--tblr-muted)' }} />
                        <input
                          placeholder={t('contacts_phone_work_placeholder')}
                          className="flex-1 px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                          style={inputStyle}
                          value={newContact.phone_work || ''}
                          onChange={e => setNewContact({...newContact, phone_work: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Adresses Section */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest pb-2" style={{ color: 'var(--tblr-primary)', borderBottom: '1px solid var(--tblr-border)' }}>{t('contacts_section_addresses')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h5 className="text-[10px] font-bold uppercase" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_address_work_label')}</h5>
                    <input
                      placeholder={t('contacts_street_placeholder')}
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.address_work_street || ''}
                      onChange={e => setNewContact({...newContact, address_work_street: e.target.value})}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        placeholder={t('contacts_postal_code_placeholder')}
                        className="px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newContact.address_work_zip || ''}
                        onChange={e => setNewContact({...newContact, address_work_zip: e.target.value})}
                      />
                      <input
                        placeholder={t('contacts_city_placeholder')}
                        className="px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newContact.address_work_city || ''}
                        onChange={e => setNewContact({...newContact, address_work_city: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h5 className="text-[10px] font-bold uppercase" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_address_home_label')}</h5>
                    <input
                      placeholder={t('contacts_street_placeholder')}
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                      style={inputStyle}
                      value={newContact.address_home_street || ''}
                      onChange={e => setNewContact({...newContact, address_home_street: e.target.value})}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        placeholder={t('contacts_postal_code_placeholder')}
                        className="px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newContact.address_home_zip || ''}
                        onChange={e => setNewContact({...newContact, address_home_zip: e.target.value})}
                      />
                      <input
                        placeholder={t('contacts_city_placeholder')}
                        className="px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newContact.address_home_city || ''}
                        onChange={e => setNewContact({...newContact, address_home_city: e.target.value})}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Autres Section */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest pb-2" style={{ color: 'var(--tblr-primary)', borderBottom: '1px solid var(--tblr-border)' }}>{t('contacts_section_other')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_category_label')}</label>
                      <select
                        className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newContact.category || ''}
                        onChange={e => setNewContact({...newContact, category: e.target.value})}
                      >
                        <option value="">{t('contacts_select_category')}</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.name}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_tags_label')}</label>
                      <input
                        className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newContact.tags || ''}
                        onChange={e => setNewContact({...newContact, tags: e.target.value})}
                        placeholder={t('contacts_tags_placeholder')}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_notes_label')}</label>
                      <textarea
                        className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 h-24"
                        style={inputStyle}
                        value={newContact.notes || ''}
                        onChange={e => setNewContact({...newContact, notes: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_siret_label')}</label>
                        <input
                          className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                          style={inputStyle}
                          value={newContact.siret || ''}
                          onChange={e => setNewContact({...newContact, siret: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_vat_label')}</label>
                        <input
                          className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                          style={inputStyle}
                          value={newContact.vat_number || ''}
                          onChange={e => setNewContact({...newContact, vat_number: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_annual_turnover_label')}</label>
                      <input
                        type="number"
                        className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newContact.ca_amount ?? ''}
                        onChange={e => setNewContact({...newContact, ca_amount: Number(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_birthday_label')}</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newContact.birthday || ''}
                        onChange={e => setNewContact({...newContact, birthday: e.target.value})}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('affaires')} (Projects)</label>
                  <select
                    multiple
                    className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 h-24"
                    style={inputStyle}
                    value={newContact.affaires?.split(',').filter(Boolean) || []}
                    onChange={e => {
                      const options = e.target.selectedOptions;
                      const values = [];
                      for (let i = 0; i < options.length; i++) {
                        values.push(options[i].value);
                      }
                      setNewContact({...newContact, affaires: values.join(',')});
                    }}
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('candidatures')} (Tenders)</label>
                  <select
                    multiple
                    className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 h-24"
                    style={inputStyle}
                    value={newContact.candidatures?.split(',').filter(Boolean) || []}
                    onChange={e => {
                      const options = e.target.selectedOptions;
                      const values = [];
                      for (let i = 0; i < options.length; i++) {
                        values.push(options[i].value);
                      }
                      setNewContact({...newContact, candidatures: values.join(',')});
                    }}
                  >
                    {tenders.map(t => (
                      <option key={t.id} value={t.title}>{t.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setIsEditing(false);
                    setEditingId(null);
                  }}
                  className="px-4 py-2 rounded-lg transition-colors"
                  style={{ color: 'var(--tblr-text)' }}
                >
                  {t('btn_cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg transition-colors"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                >
                  {isEditing ? t('contacts_update_btn') : t('contacts_save_btn')}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Category Management Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
          >
            <div className="p-6 flex justify-between items-center" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
              <h3 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('contacts_manage_categories')}</h3>
              <button onClick={() => setIsCategoryModalOpen(false)} style={{ color: 'var(--tblr-muted)' }}>
                ✕
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              <form onSubmit={handleAddCategory} className="flex gap-2 mb-6">
                <input
                  className="flex-1 px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  style={inputStyle}
                  placeholder={t('contacts_new_category_placeholder')}
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg transition-colors"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                >
                  {t('contacts_add_category_btn')}
                </button>
              </form>
              <div className="space-y-2">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                    <span style={{ color: 'var(--tblr-text)' }}>{cat.name}</span>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="transition-colors"
                      style={{ color: 'var(--tblr-muted)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-danger)'}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-muted)'}
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}
      <MappingModal />

      {/* CardDAV Sync Modal */}
      {cardDavModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl shadow-xl w-full max-w-md"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
          >
            <div className="p-6 flex justify-between items-center" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>Synchronisation CardDAV</h3>
              <button onClick={() => setCardDavModal(false)} style={{ color: 'var(--tblr-muted)' }}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
                Connectez votre carnet d'adresses Nextcloud ou tout serveur compatible CardDAV.
              </p>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--tblr-muted)' }}>URL du carnet d'adresses</label>
                <input
                  className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  placeholder="https://nextcloud.example.com/remote.php/dav/addressbooks/users/alice/contacts/"
                  value={cardDavUrl}
                  onChange={e => setCardDavUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--tblr-muted)' }}>Nom d'utilisateur</label>
                <input
                  className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  value={cardDavUser}
                  onChange={e => setCardDavUser(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--tblr-muted)' }}>Mot de passe / Token</label>
                <input
                  type="password"
                  className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  value={cardDavPass}
                  onChange={e => setCardDavPass(e.target.value)}
                />
              </div>
            </div>
            <div className="p-6 flex justify-end gap-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
              <button
                onClick={() => setCardDavModal(false)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
              >
                Annuler
              </button>
              <button
                onClick={handleCardDavSync}
                disabled={syncingCardDav}
                className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                style={{ background: 'var(--tblr-primary)', color: '#fff' }}
              >
                {syncingCardDav && <IconRefresh size={14} className="animate-spin" />}
                Synchroniser
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
