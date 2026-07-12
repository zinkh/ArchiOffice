import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { IconCommand, IconCloud, IconDeviceDesktop } from '@tabler/icons-react';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { isOfflineBuild } from '../lib/authToken';
import { checkLocalStatus, localSetup, localSignIn } from '../lib/localAuth';
import { checkCloudLinkStatus, cloudLink } from '../lib/cloudSync';

function getSubdomain(): string | null {
  const host = window.location.hostname;
  const parts = host.split('.');
  if (parts.length >= 3 && parts[0] !== 'www') return parts[0];
  return null;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

type FirstRunMode = 'choice' | 'local-setup' | 'cloud-link';

function LocalLoginShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505]">
      <div className="w-full max-w-md p-8 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-blue-600 rounded flex items-center justify-center text-white">
            <IconCommand size={32} />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function FirstRunChoice({ onChoose }: { onChoose: (mode: FirstRunMode) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-1">
        {t('login_choice_title')}
      </h2>
      <div className="space-y-3 mt-6">
        <button
          type="button"
          onClick={() => onChoose('local-setup')}
          className="w-full flex items-start gap-3 p-4 border border-zinc-300 dark:border-zinc-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 text-left transition-colors"
        >
          <IconDeviceDesktop size={22} className="mt-0.5 flex-shrink-0 text-blue-600" />
          <div>
            <div className="font-medium text-zinc-900 dark:text-white">{t('login_choice_local_title')}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">{t('login_choice_local_desc')}</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onChoose('cloud-link')}
          className="w-full flex items-start gap-3 p-4 border border-zinc-300 dark:border-zinc-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 text-left transition-colors"
        >
          <IconCloud size={22} className="mt-0.5 flex-shrink-0 text-blue-600" />
          <div>
            <div className="font-medium text-zinc-900 dark:text-white">{t('login_choice_cloud_title')}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">{t('login_choice_cloud_desc')}</div>
          </div>
        </button>
      </div>
    </>
  );
}

function LocalSetupForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [agencyName, setAgencyName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError(t('login_local_setup_password_hint'));
      return;
    }
    setLoading(true);
    try {
      await localSetup(agencyName, password);
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-1">
        {t('login_local_setup_title')}
      </h2>
      <p className="text-sm text-center text-zinc-500 dark:text-zinc-400 mb-6">
        {t('login_local_setup_subtitle')}
      </p>
      <form onSubmit={handleSetup} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('login_local_setup_agency_label')}
          </label>
          <input
            type="text"
            value={agencyName}
            onChange={(e) => setAgencyName(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            minLength={8}
            required
          />
          <p className="text-xs text-zinc-400 mt-1">{t('login_local_setup_password_hint')}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('password')}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            minLength={8}
            required
          />
        </div>
        {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          {t('login_local_setup_submit')}
        </button>
        <button type="button" onClick={onBack} className="w-full text-sm text-zinc-500 hover:underline">
          {t('login_choice_back')}
        </button>
      </form>
    </>
  );
}

function CloudLinkForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localPassword, setLocalPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await cloudLink(email, password, localPassword);
      navigate(`/cloud-import-progress?jobId=${result.importJobId}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-1">
        {t('cloud_link_title')}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4 mt-6">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('cloud_link_email_label')}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('password')}</label>
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
            {t('cloud_link_local_password_label')}
          </label>
          <input
            type="password"
            value={localPassword}
            onChange={(e) => setLocalPassword(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            minLength={8}
            required
          />
          <p className="text-xs text-zinc-400 mt-1">{t('cloud_link_local_password_hint')}</p>
        </div>
        {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          {t('cloud_link_submit')}
        </button>
        <button type="button" onClick={onBack} className="w-full text-sm text-zinc-500 hover:underline">
          {t('login_choice_back')}
        </button>
      </form>
    </>
  );
}

function LocalLogin() {
  const { t } = useTranslation();
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [firstRunMode, setFirstRunMode] = useState<FirstRunMode>('choice');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([checkLocalStatus(), checkCloudLinkStatus()])
      .then(([localStatus, cloudStatus]) => {
        // A cloud-linked install also has a local account (provisioned
        // during cloud-link) — either flag being true means first-run is over.
        setConfigured(localStatus.configured || cloudStatus.linked);
      })
      .catch(() => setConfigured(false))
      .finally(() => setCheckingStatus(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await localSignIn(password);
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (checkingStatus) return null;

  if (configured) {
    return (
      <LocalLoginShell>
        <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-8">
          {t('login_local_title')}
        </h2>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              required
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            {t('login_local_submit')}
          </button>
        </form>
      </LocalLoginShell>
    );
  }

  return (
    <LocalLoginShell>
      {firstRunMode === 'choice' && <FirstRunChoice onChoose={setFirstRunMode} />}
      {firstRunMode === 'local-setup' && <LocalSetupForm onBack={() => setFirstRunMode('choice')} />}
      {firstRunMode === 'cloud-link' && <CloudLinkForm onBack={() => setFirstRunMode('choice')} />}
    </LocalLoginShell>
  );
}

export default function Login() {
  if (isOfflineBuild()) return <LocalLogin />;
  return <CloudLogin />;
}

function CloudLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [tenantBranding, setTenantBranding] = useState<{ name: string; logoUrl: string | null } | null>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    const slug = getSubdomain();
    if (!slug) return;
    fetch(`/api/public/tenant/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setTenantBranding({ name: data.name, logoUrl: data.logoUrl }); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      navigate('/');
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });

    if (authError) {
      setError(authError.message);
      setGoogleLoading(false);
    }
    // Pas de navigate() ici — Supabase redirige vers Google puis revient sur l'app
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505]">
      <div className="w-full max-w-md p-8 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex justify-center mb-6">
          {tenantBranding?.logoUrl ? (
            <img src={tenantBranding.logoUrl} alt={tenantBranding.name} className="h-14 max-w-[200px] object-contain" />
          ) : (
            <div className="w-12 h-12 bg-blue-600 rounded flex items-center justify-center text-white">
              <IconCommand size={32} />
            </div>
          )}
        </div>
        <h2 className={`text-2xl font-bold text-center text-zinc-900 dark:text-white ${tenantBranding ? 'mb-1' : 'mb-8'}`}>
          {tenantBranding ? tenantBranding.name : t('login_welcome')}
        </h2>
        {tenantBranding && (
          <p className="text-sm text-center text-zinc-500 dark:text-zinc-400 mb-6">Connectez-vous à votre espace</p>
        )}

        {/* Bouton Google */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 text-zinc-700 dark:text-zinc-200 font-medium rounded-lg transition-colors mb-4"
        >
          <GoogleIcon />
          {googleLoading ? 'Redirection...' : 'Continuer avec Google'}
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
          <span className="text-xs text-zinc-400">ou</span>
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        </div>

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
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>
          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || googleLoading}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            {loading ? 'Connexion...' : t('login_enter')}
          </button>

          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400 pt-2">
            Pas encore de compte ?{' '}
            <Link to="/register" className="text-blue-600 hover:underline font-medium">
              Créer votre cabinet
            </Link>
          </p>
        </form>
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-600 mt-6">
          <Link to="/privacy" className="hover:underline">Politique de confidentialité</Link>
          {' · '}
          <Link to="/terms" className="hover:underline">Conditions d'utilisation</Link>
        </p>
      </div>
    </div>
  );
}
