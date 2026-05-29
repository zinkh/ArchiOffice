import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { db } from '../db';
import { useTranslation } from 'react-i18next';
import { useUser } from '../UserContext';
import {
  IconCircleCheck, IconLoader2, IconPlugConnected, IconPlugConnectedX,
  IconExternalLink, IconPuzzle, IconCamera, IconChevronDown, IconChevronUp,
  IconRefresh, IconSearch
} from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { IconLanguage } from '@tabler/icons-react';

// ─── Plugin registry ──────────────────────────────────────────────────────────

type PluginCategory = 'all' | 'accounting' | 'storage' | 'crm' | 'communication';
type PluginStatus = 'active' | 'coming_soon';

interface PluginDef {
  id: string;
  name: string;
  vendor: string;
  description: string;
  category: Exclude<PluginCategory, 'all'>;
  status: PluginStatus;
  iconBg: string;
  iconColor: string;
  iconLabel: string;
}

const PLUGIN_REGISTRY: PluginDef[] = [
  {
    id: 'zoho_invoice',
    name: 'Zoho Invoice',
    vendor: 'Zoho Corporation',
    description: 'Synchronisez vos factures ArchiOffice avec Zoho Invoice. Importez clients et exportez factures automatiquement.',
    category: 'accounting',
    status: 'active',
    iconBg: 'bg-orange-50 dark:bg-orange-900/20',
    iconColor: 'text-orange-600 dark:text-orange-400',
    iconLabel: 'ZI',
  },
  {
    id: 'zoho_books',
    name: 'Zoho Books',
    vendor: 'Zoho Corporation',
    description: 'Comptabilité complète : synchronisez devis, factures, dépenses et plan comptable avec Zoho Books.',
    category: 'accounting',
    status: 'active',
    iconBg: 'bg-orange-50 dark:bg-orange-900/20',
    iconColor: 'text-orange-600 dark:text-orange-400',
    iconLabel: 'ZB',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    vendor: 'Stripe Inc.',
    description: 'Acceptez des paiements en ligne directement depuis vos factures ArchiOffice.',
    category: 'accounting',
    status: 'coming_soon',
    iconBg: 'bg-violet-50 dark:bg-violet-900/20',
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconLabel: 'St',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    vendor: 'Intuit',
    description: 'Synchronisez votre comptabilité avec QuickBooks Online.',
    category: 'accounting',
    status: 'coming_soon',
    iconBg: 'bg-green-50 dark:bg-green-900/20',
    iconColor: 'text-green-600 dark:text-green-400',
    iconLabel: 'QB',
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    vendor: 'Google',
    description: 'Sauvegardez et partagez vos plans et documents directement sur Google Drive.',
    category: 'storage',
    status: 'coming_soon',
    iconBg: 'bg-blue-50 dark:bg-blue-900/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconLabel: 'GD',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    vendor: 'Dropbox',
    description: 'Stockez vos plans et documents ArchiOffice directement sur Dropbox.',
    category: 'storage',
    status: 'coming_soon',
    iconBg: 'bg-blue-50 dark:bg-blue-900/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconLabel: 'Db',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    vendor: 'Salesforce',
    description: 'Synchronisez vos contacts et clients ArchiOffice avec Salesforce CRM.',
    category: 'crm',
    status: 'coming_soon',
    iconBg: 'bg-sky-50 dark:bg-sky-900/20',
    iconColor: 'text-sky-600 dark:text-sky-400',
    iconLabel: 'SF',
  },
  {
    id: 'slack',
    name: 'Slack',
    vendor: 'Salesforce',
    description: 'Recevez des notifications ArchiOffice dans vos canaux Slack.',
    category: 'communication',
    status: 'coming_soon',
    iconBg: 'bg-pink-50 dark:bg-pink-900/20',
    iconColor: 'text-pink-600 dark:text-pink-400',
    iconLabel: 'Sl',
  },
  {
    id: 'microsoft_teams',
    name: 'Microsoft Teams',
    vendor: 'Microsoft',
    description: 'Notifications et rappels de projets directement dans Microsoft Teams.',
    category: 'communication',
    status: 'coming_soon',
    iconBg: 'bg-indigo-50 dark:bg-indigo-900/20',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    iconLabel: 'MT',
  },
];

const CATEGORIES: { id: PluginCategory; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'accounting', label: 'Comptabilité' },
  { id: 'storage', label: 'Stockage' },
  { id: 'crm', label: 'CRM' },
  { id: 'communication', label: 'Communication' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { currentUser, setCurrentUser } = useUser();
  const location = useLocation();
  const [settings, setSettings] = useState({
    id: 'general',
    agencyName: '',
    address: '',
    phone: '',
    email: '',
    siret: '',
    vatNumber: '',
    seller_iban: '',
    seller_bic: '',
    currency: 'EUR',
    language: 'fr',
    senderOption: 'agency' as 'agency' | 'personal',
    defaultEmailTemplate: '',
    logoUrl: '',
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPass: '',
    zoho_client_id: '',
    zoho_client_secret: '',
    zoho_org_id: '',
    zoho_data_center: 'com',
    zoho_books_org_id: '',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Zoho Invoice
  const [zohoStatus, setZohoStatus] = useState<{ connected: boolean; has_credentials: boolean } | null>(null);
  const [zohoCallbackUrl, setZohoCallbackUrl] = useState('');
  const [isDisconnectingZoho, setIsDisconnectingZoho] = useState(false);
  const [zohoNotice, setZohoNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSyncingZoho, setIsSyncingZoho] = useState(false);

  // Zoho Books (shares same OAuth token as Invoice)
  const [zohoBooksStatus, setZohoBooksStatus] = useState<{ connected: boolean; has_credentials: boolean } | null>(null);
  const [isSyncingZohoBooks, setIsSyncingZohoBooks] = useState(false);
  const [zohoBooksNotice, setZohoBooksNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Marketplace UI
  const [categoryFilter, setCategoryFilter] = useState<PluginCategory>('all');
  const [pluginSearch, setPluginSearch] = useState('');
  const [openPlugin, setOpenPlugin] = useState<string | null>(null);

  const [userSettings, setUserSettings] = useState({
    senderOption: 'agency' as 'agency' | 'personal',
    defaultEmailTemplate: '',
    phone: '',
    address: '',
    jobTitle: '',
    department: '',
    avatar: '',
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height, 256);
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
        setUserSettings(prev => ({ ...prev, avatar: canvas.toDataURL('image/jpeg', 0.85) }));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    fetch('/api/settings')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(s => {
        if (s && !s.error) {
          setSettings(prev => ({ ...prev, ...s }));
          db.settings.put(s).catch(() => {});
        }
      })
      .catch(() => {});
    if (currentUser?.system_role === 'admin') {
      fetch('/api/zoho/status')
        .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .then(s => { setZohoStatus(s); setZohoBooksStatus(s); })
        .catch(() => {});
      fetch('/api/zoho/callback-url')
        .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .then(d => setZohoCallbackUrl(d.url))
        .catch(() => {});
    }
    if (currentUser) {
      setUserSettings({
        senderOption: currentUser.senderOption || 'agency',
        defaultEmailTemplate: currentUser.defaultEmailTemplate || '',
        phone: currentUser.phone || '',
        address: currentUser.address || '',
        jobTitle: currentUser.jobTitle || '',
        department: currentUser.department || '',
        avatar: currentUser.avatar || '',
      });
    }
  }, [currentUser]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('zoho_connected') === '1') {
      setZohoStatus(prev => ({ ...prev!, connected: true }));
      setZohoBooksStatus(prev => ({ ...prev!, connected: true }));
      setZohoNotice({ type: 'success', message: t('zoho_connected_success') });
      setOpenPlugin('zoho_invoice');
      window.history.replaceState({}, '', '/settings');
    } else if (params.get('zoho_error') === '1') {
      setZohoNotice({ type: 'error', message: t('zoho_connect_error') });
      window.history.replaceState({}, '', '/settings');
    }
  }, [location.search, t]);

  const handleZohoDisconnect = async () => {
    setIsDisconnectingZoho(true);
    try {
      await fetch('/api/zoho/disconnect', { method: 'DELETE' });
      setZohoStatus(prev => ({ ...prev!, connected: false }));
      setZohoBooksStatus(prev => ({ ...prev!, connected: false }));
      setZohoNotice({ type: 'success', message: t('zoho_disconnected') });
    } catch {
      setZohoNotice({ type: 'error', message: t('zoho_connect_error') });
    } finally {
      setIsDisconnectingZoho(false);
    }
  };

  const handleZohoSync = async () => {
    setIsSyncingZoho(true);
    setZohoNotice(null);
    try {
      const res = await fetch('/api/zoho/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setZohoNotice({ type: 'success', message: `Synchronisation réussie — ${data.pushed ?? 0} envoyées, ${data.pulled ?? 0} importées.` });
      } else {
        setZohoNotice({ type: 'error', message: data.error || 'Erreur de synchronisation.' });
      }
    } catch {
      setZohoNotice({ type: 'error', message: 'Erreur de synchronisation.' });
    } finally {
      setIsSyncingZoho(false);
    }
  };

  const handleZohoBooksSync = async () => {
    setIsSyncingZohoBooks(true);
    setZohoBooksNotice(null);
    try {
      const res = await fetch('/api/zoho-books/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setZohoBooksNotice({ type: 'success', message: `Synchronisation Zoho Books réussie — ${data.synced ?? 0} entrées synchronisées.` });
      } else {
        setZohoBooksNotice({ type: 'error', message: data.error || 'Erreur de synchronisation Zoho Books.' });
      }
    } catch {
      setZohoBooksNotice({ type: 'error', message: 'Erreur de synchronisation Zoho Books.' });
    } finally {
      setIsSyncingZohoBooks(false);
    }
  };

  const handleTestSmtp = async () => {
    setIsTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch('/api/test-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smtpHost: settings.smtpHost, smtpPort: settings.smtpPort, smtpUser: settings.smtpUser, smtpPass: settings.smtpPass })
      });
      const data = await res.json();
      if (res.ok) {
        setSmtpTestResult({ success: true, message: 'Test email sent successfully to ' + settings.smtpUser });
      } else {
        let msg = data.error || 'Failed to send test email';
        if (msg.includes('534-5.7.9')) msg = "Erreur Gmail : un mot de passe d'application est requis.";
        else if (msg.includes('535-5.7.8')) msg = "Erreur d'authentification : identifiants incorrects.";
        else if (msg.includes('ECONNREFUSED')) msg = "Connexion refusée : vérifiez l'hôte SMTP et le port.";
        else if (msg.includes('ETIMEDOUT')) msg = "Délai dépassé : le serveur SMTP ne répond pas.";
        setSmtpTestResult({ success: false, message: msg });
      }
    } catch (err: any) {
      setSmtpTestResult({ success: false, message: err.message });
    } finally {
      setIsTestingSmtp(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (currentUser?.system_role === 'admin') {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings)
        });
        if (!res.ok) throw new Error(`Settings save failed: ${res.status}`);
        await db.settings.put(settings);
      }
      if (currentUser) {
        const updatedUser = { ...currentUser, ...userSettings } as any;
        await fetch(`/api/team/${currentUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userSettings)
        });
        setCurrentUser(updatedUser);
      }
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const isAdmin = currentUser?.system_role === 'admin';

  // ── Marketplace helpers ────────────────────────────────────────────────────

  const getPluginConnectionState = (id: string): boolean => {
    if (id === 'zoho_invoice') return !!(zohoStatus?.connected);
    if (id === 'zoho_books') return !!(zohoBooksStatus?.connected);
    return false;
  };

  const filteredPlugins = PLUGIN_REGISTRY.filter(p => {
    const matchCat = categoryFilter === 'all' || p.category === categoryFilter;
    const matchSearch = pluginSearch === '' || p.name.toLowerCase().includes(pluginSearch.toLowerCase()) || p.vendor.toLowerCase().includes(pluginSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  const connectedCount = PLUGIN_REGISTRY.filter(p => getPluginConnectionState(p.id)).length;

  // ── Zoho shared fields ─────────────────────────────────────────────────────

  const ZohoCredentialFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Data Center</label>
        <select
          className="w-full p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white"
          value={settings.zoho_data_center}
          onChange={e => setSettings({ ...settings, zoho_data_center: e.target.value })}
        >
          <option value="com">Global (.com)</option>
          <option value="eu">Europe (.eu)</option>
          <option value="in">Inde (.in)</option>
          <option value="com.au">Australie (.com.au)</option>
          <option value="jp">Japon (.jp)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Client ID</label>
        <input
          className="w-full p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-sm font-mono text-zinc-900 dark:text-white"
          placeholder="1000.XXXXXXXXXXXXXXXXXXXX"
          value={settings.zoho_client_id}
          onChange={e => setSettings({ ...settings, zoho_client_id: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Client Secret</label>
        <input
          type="password"
          className="w-full p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-sm font-mono text-zinc-900 dark:text-white"
          placeholder="••••••••••••••••••••••••••"
          value={settings.zoho_client_secret}
          onChange={e => setSettings({ ...settings, zoho_client_secret: e.target.value })}
        />
      </div>
    </div>
  );

  // ── Plugin config panels ───────────────────────────────────────────────────

  const renderPluginConfig = (pluginId: string) => {
    if (pluginId === 'zoho_invoice') return (
      <div className="space-y-4">
        {zohoNotice && (
          <div className={cn("text-sm p-3 rounded-lg border", zohoNotice.type === 'success'
            ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400"
            : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400")}>
            {zohoNotice.message}
          </div>
        )}
        <ZohoCredentialFields />
        <div>
          <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Organisation ID (Zoho Invoice)</label>
          <input
            className="w-full p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-sm font-mono text-zinc-900 dark:text-white"
            placeholder="123456789"
            value={settings.zoho_org_id}
            onChange={e => setSettings({ ...settings, zoho_org_id: e.target.value })}
          />
        </div>
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <p className="font-bold mb-1">URL de redirection OAuth</p>
          <code className="block bg-white dark:bg-zinc-900 px-2 py-1.5 rounded border border-blue-200 dark:border-blue-800 font-mono break-all select-all">
            {zohoCallbackUrl || `${window.location.origin}/api/zoho/callback`}
          </code>
          <p className="mt-1 opacity-75">Copiez cette URL dans la console API Zoho → Authorized Redirect URIs.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href="https://api-console.zoho.com/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-lg text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors">
            <IconExternalLink size={13} /> Console API Zoho
          </a>
          {!zohoStatus?.connected ? (
            <button
              type="button"
              disabled={!settings.zoho_client_id || !settings.zoho_client_secret || !settings.zoho_org_id}
              onClick={async () => { await handleSave(); window.location.href = '/api/zoho/auth'; }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-bold hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <IconPlugConnected size={13} /> Connecter Zoho
            </button>
          ) : (
            <>
              <button type="button" onClick={handleZohoSync} disabled={isSyncingZoho}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg text-xs font-bold hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors">
                {isSyncingZoho ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />} Synchroniser
              </button>
              <button type="button" onClick={handleZohoDisconnect} disabled={isDisconnectingZoho}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                {isDisconnectingZoho ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnectedX size={13} />} Déconnecter
              </button>
            </>
          )}
        </div>
      </div>
    );

    if (pluginId === 'zoho_books') return (
      <div className="space-y-4">
        {zohoBooksNotice && (
          <div className={cn("text-sm p-3 rounded-lg border", zohoBooksNotice.type === 'success'
            ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400"
            : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400")}>
            {zohoBooksNotice.message}
          </div>
        )}
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
          <p className="font-bold mb-0.5">Credentials partagés avec Zoho Invoice</p>
          <p className="opacity-80">Zoho Books utilise la même application OAuth que Zoho Invoice. Configurez d'abord le Client ID et le Secret dans l'onglet Zoho Invoice, puis connectez ci-dessous.</p>
        </div>
        <ZohoCredentialFields />
        <div>
          <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Organisation ID (Zoho Books)</label>
          <input
            className="w-full p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-sm font-mono text-zinc-900 dark:text-white"
            placeholder="Identique à Zoho Invoice si même organisation"
            value={settings.zoho_books_org_id || settings.zoho_org_id}
            onChange={e => setSettings({ ...settings, zoho_books_org_id: e.target.value })}
          />
        </div>
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <p className="font-bold mb-1">URL de redirection OAuth</p>
          <code className="block bg-white dark:bg-zinc-900 px-2 py-1.5 rounded border border-blue-200 dark:border-blue-800 font-mono break-all select-all">
            {zohoCallbackUrl || `${window.location.origin}/api/zoho/callback`}
          </code>
          <p className="mt-1 opacity-75">Même URL que Zoho Invoice. Ajoutez le scope <code className="font-mono bg-blue-100 dark:bg-blue-900 px-1 rounded">ZohoBooks.fullaccess.all</code> dans votre app Zoho.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href="https://api-console.zoho.com/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-lg text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors">
            <IconExternalLink size={13} /> Console API Zoho
          </a>
          {!zohoBooksStatus?.connected ? (
            <button
              type="button"
              disabled={!settings.zoho_client_id || !settings.zoho_client_secret || !(settings.zoho_books_org_id || settings.zoho_org_id)}
              onClick={async () => { await handleSave(); window.location.href = '/api/zoho-books/auth'; }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-bold hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <IconPlugConnected size={13} /> Connecter Zoho Books
            </button>
          ) : (
            <>
              <button type="button" onClick={handleZohoBooksSync} disabled={isSyncingZohoBooks}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg text-xs font-bold hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors">
                {isSyncingZohoBooks ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />} Synchroniser
              </button>
              <button type="button" onClick={handleZohoDisconnect} disabled={isDisconnectingZoho}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                {isDisconnectingZoho ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnectedX size={13} />} Déconnecter
              </button>
            </>
          )}
        </div>
      </div>
    );

    return null;
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-4xl">
      {isAdmin && (
        <>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('general_settings')}</h1>

          {/* ── Agency info ── */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-5 space-y-4">
            <h2 className="text-sm font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Informations du cabinet</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('agency_name')} value={settings.agencyName} onChange={e => setSettings({...settings, agencyName: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('address')} value={settings.address} onChange={e => setSettings({...settings, address: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('phone')} value={settings.phone} onChange={e => setSettings({...settings, phone: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('email')} value={settings.email} onChange={e => setSettings({...settings, email: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('siret')} value={settings.siret} onChange={e => setSettings({...settings, siret: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('vat_number')} value={settings.vatNumber} onChange={e => setSettings({...settings, vatNumber: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm font-mono" placeholder="IBAN" value={settings.seller_iban} onChange={e => setSettings({...settings, seller_iban: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm font-mono" placeholder="BIC" value={settings.seller_bic} onChange={e => setSettings({...settings, seller_bic: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('currency')} value={settings.currency} onChange={e => setSettings({...settings, currency: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('company_logo')}</label>
              <input type="file" accept="image/*" className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg text-sm w-full dark:bg-zinc-800 dark:text-white"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => setSettings({...settings, logoUrl: reader.result as string});
                    reader.readAsDataURL(file);
                  }
                }} />
              {settings.logoUrl && <img src={settings.logoUrl} alt="Logo" className="w-24 h-24 object-contain mt-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-1" />}
            </div>
          </div>

          {/* ── SMTP ── */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('settings_smtp_title')}</h2>
              <p className="text-xs text-zinc-400 mt-1">{t('settings_smtp_explanation')}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('settings_smtp_host_placeholder')} value={settings.smtpHost} onChange={e => setSettings({...settings, smtpHost: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('settings_smtp_port_placeholder')} value={settings.smtpPort} onChange={e => setSettings({...settings, smtpPort: e.target.value})} />
              <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('settings_smtp_user_placeholder')} value={settings.smtpUser} onChange={e => setSettings({...settings, smtpUser: e.target.value})} />
              <input type="password" className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('settings_smtp_password_placeholder')} value={settings.smtpPass} onChange={e => setSettings({...settings, smtpPass: e.target.value})} />
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={handleTestSmtp}
                disabled={isTestingSmtp || !settings.smtpHost || !settings.smtpUser || !settings.smtpPass}
                className="w-fit flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white rounded-lg text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors disabled:opacity-50">
                {isTestingSmtp ? <><IconLoader2 className="w-4 h-4 animate-spin" />{t('settings_smtp_testing')}</> : t('settings_smtp_test_btn')}
              </button>
              {smtpTestResult && (
                <div className={cn("text-sm p-3 rounded-lg border", smtpTestResult.success
                  ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400"
                  : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400")}>
                  {smtpTestResult.message}
                </div>
              )}
            </div>
          </div>

          {/* ── Email preferences ── */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-5 space-y-4">
            <h2 className="text-sm font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('email_settings')}</h2>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="sender" value="agency" checked={settings.senderOption === 'agency'} onChange={() => setSettings({...settings, senderOption: 'agency'})} />
                {t('send_from_agency')}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="sender" value="personal" checked={settings.senderOption === 'personal'} onChange={() => setSettings({...settings, senderOption: 'personal'})} />
                {t('send_from_personal')}
              </label>
            </div>
            <textarea className="w-full p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg h-28 dark:bg-zinc-800 dark:text-white text-sm"
              placeholder={t('default_email_template')} value={settings.defaultEmailTemplate ?? ''}
              onChange={e => setSettings({...settings, defaultEmailTemplate: e.target.value})} />
          </div>

          {/* ══════════════════ INTEGRATIONS MARKETPLACE ══════════════════ */}
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <IconPuzzle size={20} className="text-zinc-400" />
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Marketplace de plugins</h2>
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                  Connectez ArchiOffice à vos outils métiers.
                  {connectedCount > 0 && <span className="ml-2 text-green-600 dark:text-green-400 font-medium">{connectedCount} plugin{connectedCount > 1 ? 's' : ''} actif{connectedCount > 1 ? 's' : ''}.</span>}
                </p>
              </div>
              {/* Search */}
              <div className="relative">
                <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  className="pl-8 pr-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 dark:text-white w-52 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Rechercher un plugin..."
                  value={pluginSearch}
                  onChange={e => setPluginSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Category filter */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors",
                    categoryFilter === cat.id
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Plugin cards grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPlugins.map(plugin => {
                const isConnected = getPluginConnectionState(plugin.id);
                const isOpen = openPlugin === plugin.id;
                const canConfigure = plugin.status === 'active';

                return (
                  <div
                    key={plugin.id}
                    className={cn(
                      "rounded-xl border bg-white dark:bg-zinc-800/50 overflow-hidden transition-shadow",
                      isOpen
                        ? "border-blue-400 dark:border-blue-500 shadow-md shadow-blue-100 dark:shadow-blue-900/20"
                        : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600",
                      plugin.status === 'coming_soon' && "opacity-70"
                    )}
                  >
                    {/* Card top */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        {/* Icon */}
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm", plugin.iconBg, plugin.iconColor)}>
                          {plugin.iconLabel}
                        </div>
                        {/* Status badge */}
                        {plugin.status === 'coming_soon' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                            Bientôt
                          </span>
                        ) : isConnected ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 whitespace-nowrap">
                            <IconPlugConnected size={10} /> Connecté
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                            <IconPlugConnectedX size={10} /> Non connecté
                          </span>
                        )}
                      </div>

                      <p className="font-semibold text-sm text-zinc-900 dark:text-white">{plugin.name}</p>
                      <p className="text-[11px] text-zinc-400 mb-1">{plugin.vendor}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{plugin.description}</p>
                    </div>

                    {/* Card footer */}
                    <div className="px-4 pb-4 flex items-center gap-2">
                      {canConfigure ? (
                        <button
                          type="button"
                          onClick={() => setOpenPlugin(isOpen ? null : plugin.id)}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                            isOpen
                              ? "bg-blue-600 text-white hover:bg-blue-700"
                              : "bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                          )}
                        >
                          {isOpen ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
                          {isConnected ? 'Configurer' : 'Installer'}
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-400 italic">Disponible prochainement</span>
                      )}
                      <span className={cn(
                        "text-[10px] font-medium px-2 py-0.5 rounded-full",
                        plugin.category === 'accounting' ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400" :
                        plugin.category === 'storage' ? "bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400" :
                        plugin.category === 'crm' ? "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400" :
                        "bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400"
                      )}>
                        {CATEGORIES.find(c => c.id === plugin.category)?.label}
                      </span>
                    </div>

                    {/* Config panel (accordion) */}
                    {isOpen && canConfigure && (
                      <div className="border-t border-zinc-100 dark:border-zinc-700 px-4 py-4 bg-zinc-50 dark:bg-zinc-900/40">
                        {renderPluginConfig(plugin.id)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {filteredPlugins.length === 0 && (
              <div className="text-center py-12 text-zinc-400">
                <IconPuzzle size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Aucun plugin trouvé.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── User section ── */}
      <h2 className="text-xl font-bold mt-8 text-zinc-900 dark:text-white">{t('user_information')}</h2>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-5 space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-5">
          <button type="button" onClick={() => avatarInputRef.current?.click()}
            className="relative group w-20 h-20 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-700 border-2 border-zinc-300 dark:border-zinc-600 hover:border-blue-500 transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <img src={userSettings.avatar || currentUser?.avatar || `https://picsum.photos/seed/${currentUser?.id || 'user'}/80/80`}
              alt={currentUser?.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
              <IconCamera size={18} className="text-white" />
              <span className="text-white text-[10px] font-medium">Modifier</span>
            </div>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          <div>
            <p className="font-medium text-zinc-900 dark:text-white">{currentUser?.name}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{currentUser?.email}</p>
            <button type="button" onClick={() => avatarInputRef.current?.click()}
              className="mt-1.5 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline">
              {t('change_photo') || 'Changer la photo de profil'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('phone')} value={userSettings.phone} onChange={e => setUserSettings({...userSettings, phone: e.target.value})} />
          <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('address')} value={userSettings.address} onChange={e => setUserSettings({...userSettings, address: e.target.value})} />
          <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('job_title')} value={userSettings.jobTitle} onChange={e => setUserSettings({...userSettings, jobTitle: e.target.value})} />
          <input className="p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg dark:bg-zinc-800 dark:text-white text-sm" placeholder={t('department')} value={userSettings.department} onChange={e => setUserSettings({...userSettings, department: e.target.value})} />
        </div>

        {/* Language switcher */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <IconLanguage size={16} className="text-zinc-400" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('language')}</span>
          </div>
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden w-fit">
            <button type="button" onClick={() => i18n.changeLanguage('fr')}
              className={cn("px-5 py-2 text-sm font-medium transition-colors", i18n.language.startsWith('fr') ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700")}>
              Français
            </button>
            <button type="button" onClick={() => i18n.changeLanguage('en')}
              className={cn("px-5 py-2 text-sm font-medium border-l border-zinc-200 dark:border-zinc-700 transition-colors", i18n.language.startsWith('en') ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700")}>
              English
            </button>
          </div>
        </div>
      </div>

      {/* ── User email preferences ── */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-5 space-y-4">
        <h2 className="text-sm font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('my_email_settings')}</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="userSender" value="agency" checked={userSettings.senderOption === 'agency'} onChange={() => setUserSettings({...userSettings, senderOption: 'agency'})} />
            {t('send_from_agency')}
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="userSender" value="personal" checked={userSettings.senderOption === 'personal'} onChange={() => setUserSettings({...userSettings, senderOption: 'personal'})} />
            {t('send_from_personal')}
          </label>
        </div>
        <textarea className="w-full p-2 border border-zinc-200 dark:border-zinc-600 rounded-lg h-28 dark:bg-zinc-800 dark:text-white text-sm"
          placeholder={t('default_email_template')} value={userSettings.defaultEmailTemplate ?? ''}
          onChange={e => setUserSettings({...userSettings, defaultEmailTemplate: e.target.value})} />
      </div>

      {/* Save button */}
      <button
        disabled={isSaving || showSuccess}
        className={cn("px-6 py-2.5 rounded-xl font-semibold transition-all flex items-center gap-2 text-sm",
          showSuccess ? "bg-green-600 text-white" : "bg-blue-600 text-white hover:bg-blue-700",
          (isSaving || showSuccess) && "opacity-80 cursor-not-allowed")}
        onClick={handleSave}
      >
        {isSaving ? <><IconLoader2 className="w-4 h-4 animate-spin" />{t('saving')}...</>
          : showSuccess ? <><IconCircleCheck size={18} />{t('settings_saved')}</>
          : t('save')}
      </button>
    </div>
  );
}
