import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  IconArrowLeft, 
  IconBuildingSkyscraper, 
  IconUsers, 
  IconCalendar, 
  IconCurrencyEuro,
  IconPlus,
  IconTrash,
  IconUserPlus
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import { fetchJson } from '../lib/api';
import { Tender, Contact, Milestone } from '../types';
import { db } from '../db';
import { getOfflineFirst } from '../lib/offline';
import { OrgChart, OrgNode } from '../components/OrgChart';
import { formatCurrency, cn } from '../lib/utils';

export default function TenderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tender, setTender] = useState<Tender | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // State for dynamic Org Chart
  const [orgData, setOrgData] = useState<OrgNode>({
    id: 'my-org',
    name: 'Mon Agence d\'Architecture',
    title: 'Organisation Principale',
    department: 'Management',
    salary: 'Total Budget: €250,000',
    children: [
      {
        id: 'team-1',
        name: 'Équipe Interne',
        title: 'Salariés',
        department: 'Architecture',
        salary: 'Budget: €150,000',
        children: [
          { id: 'emp-1', name: 'Jean Dupont', title: 'Architecte Senior', department: 'Architecture', salary: '€65,000' },
          { id: 'emp-2', name: 'Marie Curie', title: 'Dessinatrice', department: 'Architecture', salary: '€45,000' },
        ]
      },
      {
        id: 'cotraitants-root',
        name: 'Cotraitants',
        title: 'Partenaires Externes',
        department: 'Technique',
        salary: 'Budget: €100,000',
        children: [] // This will be dynamic
      }
    ]
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        // Load contacts via offline-first helper
        getOfflineFirst(db.contacts, '/api/contacts', setContacts);

        // Load single tender: fallback to Dexie cache, then sync from server if online
        const numericId = Number(id);
        const cachedTender = await db.tenders.get(numericId);
        if (cachedTender) {
          setTender(cachedTender);
        }
        if (navigator.onLine) {
          const tenderData = await fetchJson<Tender>(`/api/tenders/${id}`);
          await db.tenders.put(tenderData);
          setTender(tenderData);
        }
      } catch (err) {
        console.error('Failed to load tender details:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [id]);

  const addCotraitant = (contact: Contact) => {
    const newNode: OrgNode = {
      id: `cot-${contact.id}-${Date.now()}`,
      name: `${contact.first_name} ${contact.last_name}`,
      title: contact.job_title || 'Cotraitant',
      department: contact.category || 'Technique',
      salary: 'Honoraires: €15,000', // Mock salary
    };

    setOrgData(prev => {
      const newChildren = [...(prev.children || [])];
      const cotIndex = newChildren.findIndex(c => c.id === 'cotraitants-root');
      if (cotIndex !== -1) {
        const cotRoot = { ...newChildren[cotIndex] };
        cotRoot.children = [...(cotRoot.children || []), newNode];
        newChildren[cotIndex] = cotRoot;
      }
      return { ...prev, children: newChildren };
    });
  };

  const removeCotraitant = (nodeId: string) => {
    setOrgData(prev => {
      const newChildren = [...(prev.children || [])];
      const cotIndex = newChildren.findIndex(c => c.id === 'cotraitants-root');
      if (cotIndex !== -1) {
        const cotRoot = { ...newChildren[cotIndex] };
        cotRoot.children = (cotRoot.children || []).filter(c => c.id !== nodeId);
        newChildren[cotIndex] = cotRoot;
      }
      return { ...prev, children: newChildren };
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!tender) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Tender not found</h2>
        <button onClick={() => navigate('/tenders')} className="mt-4 text-blue-600 hover:underline">
          Back to Tenders
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <button 
          onClick={() => navigate('/tenders')}
          className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors w-fit"
        >
          <IconArrowLeft size={18} />
          Back to Tenders
        </button>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">{tender.title}</h1>
            <p className="text-zinc-500 dark:text-zinc-400 flex items-center gap-2 mt-1">
              <IconBuildingSkyscraper size={16} />
              {tender.client}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn(
              "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
              tender.status === 'Won' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
              tender.status === 'Lost' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
              "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
            )}>
              {tender.status}
            </span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400">
              <IconCurrencyEuro size={24} />
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Valuation</p>
              <p className="text-xl font-bold text-zinc-900 dark:text-white">{formatCurrency(tender.value)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-50 dark:bg-purple-900/20 rounded-xl flex items-center justify-center text-purple-600 dark:text-purple-400">
              <IconCalendar size={24} />
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Deadline</p>
              <p className="text-xl font-bold text-zinc-900 dark:text-white">
                {new Date(tender.submission_deadline).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-50 dark:bg-green-900/20 rounded-xl flex items-center justify-center text-green-600 dark:text-green-400">
              <IconUsers size={24} />
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Team Size</p>
              <p className="text-xl font-bold text-zinc-900 dark:text-white">
                {orgData.children?.reduce((acc, curr) => acc + (curr.children?.length || 0), 0) || 0} Members
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Org Chart Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconUsers size={24} className="text-blue-600" />
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Organisation du Projet</h2>
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-950 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-8 overflow-hidden">
          <OrgChart data={orgData} />
        </div>
      </div>

      {/* Management Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Cotraitants Management */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <IconUserPlus size={20} className="text-blue-500" />
              Gérer les Cotraitants
            </h3>
          </div>
          
          <div className="space-y-4">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Ajoutez des partenaires externes à l'organigramme du projet.
            </p>
            
            <div className="max-h-64 overflow-y-auto pr-2 space-y-2 scrollbar-thin">
              {contacts.filter(c => c.category !== 'Client').map(contact => (
                <div key={contact.id} className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs">
                      {contact.first_name[0]}{contact.last_name[0]}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-white">{contact.first_name} {contact.last_name}</p>
                      <p className="text-[10px] text-zinc-500 uppercase">{contact.category || 'Contact'}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => addCotraitant(contact)}
                    className="p-2 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  >
                    <IconPlus size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Current Team List */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
          <h3 className="font-bold text-zinc-900 dark:text-white mb-6 flex items-center gap-2">
            <IconUsers size={20} className="text-purple-500" />
            Membres Actuels (Cotraitants)
          </h3>
          
          <div className="space-y-3">
            {orgData.children?.find(c => c.id === 'cotraitants-root')?.children?.map(node => (
              <div key={node.id} className="flex items-center justify-between p-3 border border-zinc-100 dark:border-zinc-800 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400 font-bold text-xs">
                    {node.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{node.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase">{node.department}</p>
                  </div>
                </div>
                <button 
                  onClick={() => removeCotraitant(node.id)}
                  className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                >
                  <IconTrash size={18} />
                </button>
              </div>
            )) || (
              <p className="text-center py-8 text-zinc-400 text-sm italic">Aucun cotraitant ajouté.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
