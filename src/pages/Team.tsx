import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconMail, IconPlus, IconUsers, IconSearch, IconShield, IconUserPlus, IconArrowUpRight, IconX } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { getAllUsers, updateUserRole, UserProfile } from '../services/userService';
import { useUser } from '../UserContext';

export default function Team() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [team, setTeam] = useState<UserProfile[]>([]);

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

  const isAdmin = currentUser?.system_role === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('personnel_directory')}</h2>
          <p className="text-zinc-500 dark:text-zinc-400">Manage design team members and external consultants.</p>
        </div>
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
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">{member.name}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{member.email}</p>
            <div className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">
              {member.system_role}
            </div>
            
            {isAdmin ? (
              <select 
                value={member.system_role}
                onChange={(e) => handleRoleChange(member.id, e.target.value as any)}
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
              >
                <option value="user">User</option>
                <option value="pm">Project Manager</option>
                <option value="admin">Administrator</option>
              </select>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{member.system_role}</p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

