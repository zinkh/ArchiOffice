import { useState, useEffect, FormEvent, useMemo, ChangeEvent } from 'react';
import { IconPlus, IconSearch, IconUser, IconPhone, IconMail, IconMapPin, IconBuilding, IconTag, IconCalendar, IconSignature, IconSettings, IconTrash, IconWorld, IconBriefcase, IconFileText, IconEdit, IconChevronUp, IconChevronDown, IconFilter } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { Contact, ContactCategory, Project, Tender } from '../types';
import { fetchJson } from '../lib/api';

type SortField = 'prefix' | 'last_name' | 'first_name' | 'company_name' | 'ca_amount' | 'city' | 'job_title';
type SortOrder = 'asc' | 'desc';

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
  
  // Search, Filter, Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [sortConfig, setSortConfig] = useState<{ field: SortField; order: SortOrder }>({ field: 'last_name', order: 'asc' });

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    fetchContacts();
    fetchCategories();
    fetchProjects();
    fetchTenders();
  }, []);

  const fetchContacts = () => {
    fetchJson('/api/contacts')
      .then(setContacts)
      .catch(err => console.error('Error fetching contacts:', err));
  };

  const fetchCategories = () => {
    fetchJson('/api/contact-categories')
      .then(setCategories)
      .catch(err => console.error('Error fetching categories:', err));
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
    } catch (err) {
      console.error('Error submitting contact:', err);
      alert('Failed to save contact. Please check the console for details.');
    }
  };

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      const res = await fetch('/api/contact-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), name: newCategoryName })
      });

      if (res.ok) {
        setNewCategoryName('');
        fetchCategories();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) return;
    try {
      const res = await fetch(`/api/contact-categories/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchCategories();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEdit = (contact: Contact) => {
    setNewContact(contact);
    setIsEditing(true);
    setEditingId(contact.id);
    setIsModalOpen(true);
  };

  const handleDeleteContact = async (id: string) => {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchContacts();
      }
    } catch (err) {
      console.error(err);
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
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
          <h2 className="text-xl font-semibold mb-4">Mapper les champs</h2>
          <div className="grid grid-cols-2 gap-4">
            {contactFields.map(field => (
              <div key={field} className="flex flex-col">
                <label className="text-sm font-medium text-gray-700">{field}</label>
                <select 
                  className="border rounded p-2"
                  onChange={(e) => setMapping({...mapping, [field]: e.target.value})}
                  value={mapping[field] || ''}
                >
                  <option value="">Sélectionner une colonne</option>
                  {importData.headers.map(header => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-4">
            <button className="px-4 py-2 bg-gray-200 rounded" onClick={() => setIsMappingModalOpen(false)}>Annuler</button>
            <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={handleConfirm}>Importer</button>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('contacts')}</h2>
          <p className="text-zinc-500 dark:text-zinc-400">Manage your professional network and leads.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => document.getElementById('file-upload')?.click()}
            className="flex items-center gap-1 md:gap-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shadow-sm"
          >
            <IconFileText size={14} className="md:size-[18px]" />
            <span className="hidden md:inline">Import</span>
          </button>
          <input id="file-upload" type="file" className="hidden" accept=".vcf,.xlsx,.xls,.csv,.xml" onChange={handleImport} />
          <button 
            onClick={handleExport}
            className="flex items-center gap-1 md:gap-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shadow-sm"
          >
            <IconFileText size={14} className="md:size-[18px]" />
            <span className="hidden md:inline">Export</span>
          </button>
          <button 
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center gap-1 md:gap-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shadow-sm"
          >
            <IconSettings size={14} className="md:size-[18px]" />
            <span className="hidden md:inline">Categories</span>
          </button>
          <button 
            onClick={() => {
              setIsEditing(false);
              setEditingId(null);
              setNewContact({});
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1 md:gap-2 bg-blue-600 text-white px-2 py-1 md:px-4 md:py-2 rounded-md text-xs md:text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <IconPlus size={14} className="md:size-[18px]" />
            <span className="hidden md:inline">{t('add_contact')}</span>
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text"
            placeholder="Search contacts..."
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <IconFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
            <select
              className="pl-10 pr-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white appearance-none min-w-[180px]"
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.name}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400 font-medium border-b border-zinc-200 dark:border-zinc-700">
              <tr>
                <th className="px-6 py-4 cursor-pointer hover:text-zinc-900 dark:hover:text-white transition-colors" onClick={() => handleSort('prefix')}>
                  <div className="flex items-center gap-1">
                    Prefix
                    {sortConfig.field === 'prefix' && (sortConfig.order === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
                  </div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-zinc-900 dark:hover:text-white transition-colors" onClick={() => handleSort('last_name')}>
                  <div className="flex items-center gap-1">
                    {t('last_name')}
                    {sortConfig.field === 'last_name' && (sortConfig.order === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
                  </div>
                </th>
                <th className="px-6 py-4">{t('first_name')}</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">{t('phone')}</th>
                <th className="px-6 py-4">{t('email')}</th>
                <th className="px-6 py-4 cursor-pointer hover:text-zinc-900 dark:hover:text-white transition-colors" onClick={() => handleSort('city')}>
                  <div className="flex items-center gap-1">
                    {t('city')}
                    {sortConfig.field === 'city' && (sortConfig.order === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
                  </div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-zinc-900 dark:hover:text-white transition-colors text-right" onClick={() => handleSort('ca_amount')}>
                  <div className="flex items-center justify-end gap-1">
                    {t('ca_amount')}
                    {sortConfig.field === 'ca_amount' && (sortConfig.order === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
                  </div>
                </th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {filteredAndSortedContacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors">
                  <td className="px-6 py-4 font-medium text-zinc-900 dark:text-white">
                    <div>{contact.prefix}</div>
                    {contact.company_name && <div className="text-[10px] text-zinc-500 font-normal">{contact.company_name}</div>}
                  </td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{contact.last_name}</td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{contact.first_name}</td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">
                    {contact.category && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        {contact.category}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{contact.phone}</td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{contact.email}</td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{contact.city}</td>
                  <td className="px-6 py-4 font-mono text-zinc-600 dark:text-zinc-300 text-right">
                    {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(contact.ca_amount)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleEdit(contact)}
                        className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <IconEdit size={16} />
                      </button>
                      <button 
                        onClick={() => handleDeleteContact(contact.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
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
                  <td colSpan={9} className="px-6 py-12 text-center text-zinc-500 dark:text-zinc-400">
                    <div className="flex flex-col items-center gap-2">
                      <IconUser size={32} className="opacity-20" />
                      <p>{searchQuery || filterCategory ? 'No contacts match your filters' : t('no_contacts')}</p>
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
            className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
                {isEditing ? 'Edit Contact' : t('add_contact')}
              </h3>
              <button 
                onClick={() => {
                  setIsModalOpen(false);
                  setIsEditing(false);
                  setEditingId(null);
                }} 
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
                      <div className="flex items-center gap-2">
                        <IconMail size={16} className="text-zinc-400" />
                        <input 
                          type="email"
                          placeholder="Personnel"
                          className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                          value={newContact.email_home || ''}
                          onChange={e => setNewContact({...newContact, email_home: e.target.value})}
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
                      <div className="flex items-center gap-2">
                        <IconPhone size={16} className="text-zinc-400" />
                        <input 
                          placeholder="Travail"
                          className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
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
                <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-700 pb-2">Adresses</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h5 className="text-[10px] font-bold text-zinc-400 uppercase">Travail</h5>
                    <input 
                      placeholder="Rue"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                      value={newContact.address_work_street || ''}
                      onChange={e => setNewContact({...newContact, address_work_street: e.target.value})}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input 
                        placeholder="Code Postal"
                        className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                        value={newContact.address_work_zip || ''}
                        onChange={e => setNewContact({...newContact, address_work_zip: e.target.value})}
                      />
                      <input 
                        placeholder="Ville"
                        className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                        value={newContact.address_work_city || ''}
                        onChange={e => setNewContact({...newContact, address_work_city: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h5 className="text-[10px] font-bold text-zinc-400 uppercase">Domicile</h5>
                    <input 
                      placeholder="Rue"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                      value={newContact.address_home_street || ''}
                      onChange={e => setNewContact({...newContact, address_home_street: e.target.value})}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input 
                        placeholder="Code Postal"
                        className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                        value={newContact.address_home_zip || ''}
                        onChange={e => setNewContact({...newContact, address_home_zip: e.target.value})}
                      />
                      <input 
                        placeholder="Ville"
                        className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                        value={newContact.address_home_city || ''}
                        onChange={e => setNewContact({...newContact, address_home_city: e.target.value})}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Autres Section */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-700 pb-2">Autres & App Spécifique</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Catégorie</label>
                      <select
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                        value={newContact.category || ''}
                        onChange={e => setNewContact({...newContact, category: e.target.value})}
                      >
                        <option value="">Sélectionner une catégorie</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.name}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Labels (Tags)</label>
                      <input 
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                        value={newContact.tags || ''}
                        onChange={e => setNewContact({...newContact, tags: e.target.value})}
                        placeholder="Client, Prospect, Ami..."
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Notes</label>
                      <textarea 
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white h-24"
                        value={newContact.notes || ''}
                        onChange={e => setNewContact({...newContact, notes: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">SIRET</label>
                        <input 
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                          value={newContact.siret || ''}
                          onChange={e => setNewContact({...newContact, siret: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">TVA</label>
                        <input 
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                          value={newContact.vat_number || ''}
                          onChange={e => setNewContact({...newContact, vat_number: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">CA Annuel (€)</label>
                      <input 
                        type="number"
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                        value={newContact.ca_amount ?? ''}
                        onChange={e => setNewContact({...newContact, ca_amount: Number(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Anniversaire</label>
                      <input 
                        type="date"
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
                        value={newContact.birthday || ''}
                        onChange={e => setNewContact({...newContact, birthday: e.target.value})}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-100 dark:border-zinc-700">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{t('affaires')} (Projects)</label>
                  <select
                    multiple
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white h-24"
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
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{t('candidatures')} (Tenders)</label>
                  <select
                    multiple
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white h-24"
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
              
              <div className="flex justify-end gap-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <button 
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setIsEditing(false);
                    setEditingId(null);
                  }}
                  className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {isEditing ? 'Update Contact' : 'Save Contact'}
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
            className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Manage Categories</h3>
              <button onClick={() => setIsCategoryModalOpen(false)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                ✕
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              <form onSubmit={handleAddCategory} className="flex gap-2 mb-6">
                <input 
                  className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="New category name"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                />
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Add
                </button>
              </form>
              <div className="space-y-2">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-100 dark:border-zinc-700/50">
                    <span className="text-zinc-700 dark:text-zinc-300">{cat.name}</span>
                    <button 
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="text-zinc-400 hover:text-red-500 transition-colors"
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
    </div>
  );
}
