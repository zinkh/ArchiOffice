import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArchiOfficeLogo } from '../components/ArchiOfficeLogo';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { t } = useTranslation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/public/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors de l\'envoi.');
      }
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505]">
      <div className="w-full max-w-md p-8 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex justify-center mb-6">
          <ArchiOfficeLogo size={48} />
        </div>
        <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-1">
          {t('forgot_password_title')}
        </h2>
        <p className="text-sm text-center text-zinc-500 dark:text-zinc-400 mb-6">
          {t('forgot_password_subtitle')}
        </p>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-center text-green-600 dark:text-green-400">
              {t('forgot_password_sent')}
            </p>
            <Link
              to="/login"
              className="block w-full text-center py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              {t('forgot_password_back_to_login')}
            </Link>
          </div>
        ) : (
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
            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {loading ? t('forgot_password_sending') : t('forgot_password_submit')}
            </button>
            <p className="text-center text-sm text-zinc-500 dark:text-zinc-400 pt-2">
              <Link to="/login" className="text-blue-600 hover:underline font-medium">
                {t('forgot_password_back_to_login')}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
