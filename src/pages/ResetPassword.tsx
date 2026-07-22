import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { ArchiOfficeLogo } from '../components/ArchiOfficeLogo';

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [validLink, setValidLink] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    // Le client Supabase traite automatiquement le lien de récupération contenu
    // dans l'URL (detectSessionInUrl) et déclenche l'événement PASSWORD_RECOVERY
    // avec une session temporaire permettant de changer le mot de passe.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setValidLink(true);
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setValidLink(true);
      setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t('reset_password_too_short'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('reset_password_mismatch'));
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    await supabase.auth.signOut();
    setTimeout(() => navigate('/login'), 2500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505]">
      <div className="w-full max-w-md p-8 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex justify-center mb-6">
          <ArchiOfficeLogo size={48} />
        </div>
        <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-1">
          {t('reset_password_title')}
        </h2>
        <p className="text-sm text-center text-zinc-500 dark:text-zinc-400 mb-6">
          {t('reset_password_subtitle')}
        </p>

        {!ready ? null : success ? (
          <p className="text-sm text-center text-green-600 dark:text-green-400">
            {t('reset_password_success')}
          </p>
        ) : !validLink ? (
          <div className="space-y-4">
            <p className="text-sm text-center text-red-500">{t('reset_password_invalid_link')}</p>
            <Link
              to="/forgot-password"
              className="block w-full text-center py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              {t('reset_password_request_new')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('reset_password_new_label')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('reset_password_confirm_label')}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
              {loading ? t('reset_password_submitting') : t('reset_password_submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
