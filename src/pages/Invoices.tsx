import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconPlus, IconFileInvoice, IconCircleCheck, IconClock, IconX, IconTrash, IconDeviceFloppy, IconSearch, IconFilter, IconAlertTriangle, IconEdit, IconFileCode } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import type { Invoice, Project } from '../types';
import { useTranslation } from 'react-i18next';
import { InvoiceGenerator } from '../components/InvoiceGenerator';

export default function Invoices() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newInvoice, setNewInvoice] = useState<Partial<Invoice>>({
    project_id: '',
    amount: 0,
    description: '',
    status: 'Draft',
    due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });

  useEffect(() => {
    fetchInvoices();
    fetchProjects();
  }, []);

  const fetchInvoices = async () => {
    try {
      const res = await fetch('/api/invoices');
      if (res.ok) setInvoices(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) setProjects(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInvoice)
      });
      if (res.ok) {
        const saved = await res.json();
        setInvoices([saved, ...invoices]);
        setIsModalOpen(false);
        setNewInvoice({ 
          project_id: '', 
          amount: 0, 
          description: '', 
          status: 'Draft', 
          due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] 
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateStatus = async (invoice: Invoice, newStatus: Invoice['status']) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...invoice, status: newStatus })
      });
      if (res.ok) {
        const updated = await res.json();
        setInvoices(invoices.map(i => i.id === updated.id ? updated : i));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenGenerator = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsGeneratorOpen(true);
  };

  const filteredInvoices = invoices.filter(i => 
    i.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.project_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight">Invoices</h1>
          <p className="text-zinc-500 dark:text-zinc-400">Track project billing and payment status</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
        >
          <IconPlus size={20} />
          Create Invoice
        </button>
      </div>

      <div className="flex items-center gap-4 bg-white dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text" 
            placeholder="Search invoices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-white"
          />
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Invoice / Project</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Due Date</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {filteredInvoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg">
                        <IconFileInvoice size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-zinc-900 dark:text-white">{invoice.project_name || 'General'}</p>
                        <p className="text-xs text-zinc-500 truncate max-w-[200px]">{invoice.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-zinc-900 dark:text-white">
                    {formatCurrency(invoice.amount)}
                  </td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">
                    <div className="flex items-center gap-1.5">
                      <IconClock size={14} className="text-zinc-400" />
                      {new Date(invoice.due_date).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                      invoice.status === 'Paid' ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800" :
                      invoice.status === 'Overdue' ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800" :
                      invoice.status === 'Sent' ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800" :
                      "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
                    )}>
                      {invoice.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleOpenGenerator(invoice)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title="Generate Factur-X"
                      >
                        <IconFileCode size={20} />
                      </button>
                      {invoice.status !== 'Paid' && (
                        <button 
                          onClick={() => handleUpdateStatus(invoice, 'Paid')}
                          className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                          title="Mark as Paid"
                        >
                          <IconCircleCheck size={20} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                    No invoices found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isGeneratorOpen && selectedInvoice && (
          <InvoiceGenerator 
            onClose={() => setIsGeneratorOpen(false)}
            onSave={(updated) => {
              setInvoices(invoices.map(i => i.id === updated.id ? updated : i));
              setIsGeneratorOpen(false);
            }}
            initialData={selectedInvoice}
            project={projects.find(p => p.id === selectedInvoice.project_id)}
          />
        )}

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white">New Invoice</h2>
                <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                  <IconX size={24} />
                </button>
              </div>
              <form onSubmit={handleCreateInvoice} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Project</label>
                  <select 
                    required
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white"
                    value={newInvoice.project_id}
                    onChange={e => setNewInvoice({...newInvoice, project_id: e.target.value})}
                  >
                    <option value="">Select Project</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Amount</label>
                  <input 
                    type="number"
                    required
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white"
                    value={newInvoice.amount}
                    onChange={e => setNewInvoice({...newInvoice, amount: Number(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Due Date</label>
                  <input 
                    type="date"
                    required
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white"
                    value={newInvoice.due_date}
                    onChange={e => setNewInvoice({...newInvoice, due_date: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
                  <textarea 
                    className="w-full h-32 px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white resize-none"
                    value={newInvoice.description ?? ''}
                    onChange={e => setNewInvoice({...newInvoice, description: e.target.value})}
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-xl font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-500/20"
                  >
                    Create Invoice
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
