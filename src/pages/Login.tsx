import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconCommand } from '@tabler/icons-react';
import { useUser } from '../UserContext';
import { useTranslation } from 'react-i18next';

export default function Login() {
  const [email, setEmail] = useState('sektaoui.khaldoun@gmail.com');
  const navigate = useNavigate();
  const { setCurrentUser } = useUser();
  const { t } = useTranslation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentUser({
      id: 'admin-user',
      email: email,
      name: 'Admin User',
      system_role: 'admin',
      role: 'admin',
      avatar: 'https://picsum.photos/seed/admin/32/32'
    });
    navigate('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505]">
      <div className="w-full max-w-md p-8 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded flex items-center justify-center text-white">
            <IconCommand size={32} />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-8">
          {t('login_welcome')}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            {t('login_enter')}
          </button>

          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400 mt-4">
            {t('login_local_info')}
          </p>
        </form>
      </div>
    </div>
  );
}
