import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconMail, IconPlus, IconUsers, IconSearch, IconShield, IconUserPlus, IconArrowUpRight, IconX, IconCheck } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { getAllUsers, updateUserRole, createUser, UserProfile } from '../services/userService';
import { useUser } from '../UserContext';

export default function Team() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [team, setTeam] = useState<UserProfile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newUser, setNewUser] = useState<Omit<UserProfile, 'id'>>({
    name: '',
    email: '',
    system_role: 'user',
    role: 'Member'
  });

  useEffect(() => {
    getAllUsers().then(setTeam).catch(console.error);
  }, []);

  const handleRoleChange = async (id: string, newRole: 'admin' | 'pm' | 'user') => {
    try {
      await updateUserRole(id, newRole);
      setTeam(team.map(member => member.id === id ? { ...member, system_role: newRole } : member));
    } catch (err) {
      console.error(err);
      alert('Failed to update role.');
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const result = await createUser(newUser) as any;
      setTeam([...team, result]);
      setIsModalOpen(false);
      setNewUser({ name: '', email: '', system_role: 'user', role: 'Member' });
      
      if (result.emailSent) {
        alert('User created successfully. Credentials have been sent by email.');
      } else {
        alert(`User created successfully, but email could not be sent: ${result.emailError || 'Unknown error'}. Please provide the credentials manually.`);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to create user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAdmin = currentUser?.system_role === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('personnel_directory')}</h2>
          <p className="text-zinc-500 dark:text-zinc-400">{t('team_subtitle')}</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-blue-500/20"
          >
            <IconUserPlus size={18} />
            {t('team_add_member_btn')}
          </button>
        )}
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
            <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-zinc-400 mb-4">
              {member.avatar ? (
                <img src={member.avatar} alt={member.name} className="w-full h-full rounded-full object-cover" />
              ) : (
                <IconUsers size={32} />
              )}
            </div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">{member.name}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">{member.role}</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">{member.email}</p>
            
            <div className="w-full pt-4 border-t border-zinc-100 dark:border-zinc-700">
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">{t('team_system_access')}</label>
              {isAdmin ? (
                <select
                  value={member.system_role}
                  onChange={(e) => handleRoleChange(member.id, e.target.value as any)}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white text-sm"
                >
                  <option value="user">{t('team_role_user')}</option>
                  <option value="pm">{t('team_role_pm')}</option>
                  <option value="admin">{t('team_role_admin')}</option>
                </select>
              ) : (
                <div className="px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 text-xs font-medium border border-zinc-100 dark:border-zinc-800">
                  {member.system_role.toUpperCase()}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">{t('team_add_member_title')}</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                  <IconX size={20} />
                </button>
              </div>
              <form onSubmit={handleAddUser} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">{t('team_full_name_label')}</label>
                  <input
                    type="text"
                    required
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                    placeholder={t('team_full_name_placeholder')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">{t('team_email_label')}</label>
                  <input
                    type="email"
                    required
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                    placeholder={t('team_email_placeholder')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">{t('team_job_title_label')}</label>
                  <input
                    type="text"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                    placeholder={t('team_job_title_placeholder')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">{t('team_system_access_level')}</label>
                  <select
                    value={newUser.system_role}
                    onChange={(e) => setNewUser({ ...newUser, system_role: e.target.value as any })}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                  >
                    <option value="user">{t('team_role_user')}</option>
                    <option value="pm">{t('team_role_pm')}</option>
                    <option value="admin">{t('team_role_admin')}</option>
                  </select>
                </div>
                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 font-bold rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {t('btn_cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <IconCheck size={18} />
                    )}
                    {t('team_create_user_btn')}
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

