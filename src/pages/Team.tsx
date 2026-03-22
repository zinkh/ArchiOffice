import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconMail, IconPlus, IconUsers, IconSearch, IconShield, IconUserPlus, IconArrowUpRight, IconX } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import type { TeamMember } from '../types';
import { useTranslation } from 'react-i18next';

export default function Team() {
  const { t } = useTranslation();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', role: '', email: '', system_role: 'user' as 'admin' | 'pm' | 'user' });

  useEffect(() => {
    fetch('/api/team')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch team');
        return res.json();
      })
      .then(setTeam)
      .catch(err => console.error(err));
  }, []);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const newMember: TeamMember = {
      id: `tm${Date.now()}`,
      ...inviteForm
    };
    setTeam([...team, newMember]);
    setIsInviteModalOpen(false);
    setInviteForm({ name: '', role: '', email: '', system_role: 'user' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('personnel_directory')}</h2>
          <p className="text-zinc-500 dark:text-zinc-400">Manage design team members and external consultants.</p>
        </div>
        <button 
          onClick={() => setIsInviteModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <IconPlus size={18} />
          {t('invite_member')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {team.map((member, i) => (
          <motion.div
            key={member.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 flex flex-col items-center text-center shadow-sm hover:shadow-md transition-shadow group relative overflow-hidden"
          >
             <div className="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
              <button className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
                <IconArrowUpRight size={16} />
              </button>
            </div>

            <div className="w-24 h-24 rounded-full overflow-hidden mb-4 ring-4 ring-zinc-50 dark:ring-zinc-900 group-hover:ring-blue-50 dark:group-hover:ring-blue-900/20 transition-all">
              <img 
                src={member.avatar || `https://picsum.photos/seed/${member.id}/200`} 
                alt={member.name} 
                className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                referrerPolicy="no-referrer"
              />
            </div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">{member.name}</h3>
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">{member.role}</p>
            <div className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">
              {member.system_role}
            </div>
            
            <div className="w-full pt-4 border-t border-zinc-100 dark:border-zinc-700 mt-auto flex gap-2">
              <a 
                href={`mailto:${member.email}`}
                className="flex-1 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-sm font-medium flex items-center justify-center gap-2"
              >
                <IconMail size={16} />
                {t('mail')}
              </a>
              <button className="flex-1 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-white transition-colors text-sm font-medium flex items-center justify-center gap-2">
                <IconShield size={16} />
                {t('auth')}
              </button>
            </div>
          </motion.div>
        ))}
        
        <button 
          onClick={() => setIsInviteModalOpen(true)}
          className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 p-6 flex flex-col items-center justify-center text-center hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all group min-h-[300px]"
        >
          <div className="w-16 h-16 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform">
            <IconUserPlus size={32} className="text-zinc-400 group-hover:text-blue-500 transition-colors" />
          </div>
          <span className="font-medium text-zinc-600 dark:text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">{t('invite_member')}</span>
        </button>
      </div>

      <AnimatePresence>
        {isInviteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white">{t('invite_member')}</h3>
                <button onClick={() => setIsInviteModalOpen(false)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                  <IconX size={20} />
                </button>
              </div>
              <form onSubmit={handleInvite} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                  <input 
                    required
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                    value={inviteForm.name}
                    onChange={e => setInviteForm({...inviteForm, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Role</label>
                  <input 
                    required
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                    value={inviteForm.role}
                    onChange={e => setInviteForm({...inviteForm, role: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
                  <input 
                    required
                    type="email"
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                    value={inviteForm.email}
                    onChange={e => setInviteForm({...inviteForm, email: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">System Role</label>
                  <select 
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                    value={inviteForm.system_role}
                    onChange={e => setInviteForm({...inviteForm, system_role: e.target.value as any})}
                  >
                    <option value="user">User</option>
                    <option value="pm">Project Manager</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors mt-4"
                >
                  Send Invitation
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

