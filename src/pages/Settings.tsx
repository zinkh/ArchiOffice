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
import { apiFetch } from '../lib/api';

// ─── Plugin registry ──────────────────────────────────────────────────────────

type PluginCategory = 'all' | 'accounting' | 'storage' | 'crm' | 'communication' | 'compliance';
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
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
    iconLabel: 'ZI',
  },
  {
    id: 'zoho_books',
    name: 'Zoho Books',
    vendor: 'Zoho Corporation',
    description: 'Comptabilité complète : synchronisez devis, factures, dépenses et plan comptable avec Zoho Books.',
    category: 'accounting',
    status: 'active',
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
    iconLabel: 'ZB',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    vendor: 'Stripe Inc.',
    description: 'Acceptez des paiements en ligne directement depuis vos factures ArchiOffice.',
    category: 'accounting',
    status: 'coming_soon',
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    iconLabel: 'St',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    vendor: 'Intuit',
    description: 'Synchronisez votre comptabilité avec QuickBooks Online.',
    category: 'accounting',
    status: 'coming_soon',
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600',
    iconLabel: 'QB',
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    vendor: 'Google',
    description: 'Sauvegardez et partagez vos plans et documents directement sur Google Drive.',
    category: 'storage',
    status: 'coming_soon',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    iconLabel: 'GD',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    vendor: 'Dropbox',
    description: 'Stockez vos plans et documents ArchiOffice directement sur Dropbox.',
    category: 'storage',
    status: 'coming_soon',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    iconLabel: 'Db',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    vendor: 'Salesforce',
    description: 'Synchronisez vos contacts et clients ArchiOffice avec Salesforce CRM.',
    category: 'crm',
    status: 'coming_soon',
    iconBg: 'bg-sky-50',
    iconColor: 'text-sky-600',
    iconLabel: 'SF',
  },
  {
    id: 'slack',
    name: 'Slack',
    vendor: 'Salesforce',
    description: 'Recevez des notifications ArchiOffice dans vos canaux Slack.',
    category: 'communication',
    status: 'coming_soon',
    iconBg: 'bg-pink-50',
    iconColor: 'text-pink-600',
    iconLabel: 'Sl',
  },
  {
    id: 'microsoft_teams',
    name: 'Microsoft Teams',
    vendor: 'Microsoft',
    description: 'Notifications et rappels de projets directement dans Microsoft Teams.',
    category: 'communication',
    status: 'coming_soon',
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    iconLabel: 'MT',
  },
  {
    id: 'maf',
    name: 'Déclaration MAF',
    vendor: 'Mutuelle des Architectes Français',
    description: 'Préparez votre déclaration annuelle MAF (activités 2025, cotisation avant le 31 mars 2026). Calcul M × T × P intégré dans vos propositions.',
    category: 'compliance',
    status: 'active',
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    iconLabel: 'MAF',
  },
  {
    id: 'ragic',
    name: 'Ragic',
    vendor: 'Ragic Inc.',
    description: 'Synchronisez vos contacts, projets, factures et propositions avec vos feuilles Ragic. Synchronisation bidirectionnelle par tenant.',
    category: 'crm',
    status: 'active',
    iconBg: 'bg-teal-50',
    iconColor: 'text-teal-600',
    iconLabel: 'Ra',
  },
  {
    id: 'odoo',
    name: 'Odoo',
    vendor: 'Odoo S.A.',
    description: 'Synchronisez contacts, projets, factures et devis avec votre instance Odoo. Compatible Odoo 14+ (Community et Enterprise).',
    category: 'accounting',
    status: 'active',
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-700',
    iconLabel: 'Od',
  },
];

const CATEGORIES: { id: PluginCategory; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'accounting', label: 'Comptabilité' },
  { id: 'compliance', label: 'Conformité' },
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
    numPrefixDevis: 'DEVIS',
    numPrefixFacture: 'FAC',
    numPrefixHonoraires: 'NH',
    maf_enabled: false,
    maf_numero_adherent: '',
    maf_taux_contrat_permil: '',
    maf_declaration_year: 2025,
    ragic_api_key: '',
    ragic_account: '',
    ragic_sheet_contacts: '',
    ragic_sheet_projects: '',
    ragic_sheet_invoices: '',
    ragic_sheet_proposals: '',
    odoo_url: '',
    odoo_db: '',
    odoo_username: '',
    odoo_api_key: '',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Zoho Invoice
  const [zohoStatus, setZohoStatus] = useState<{ connected: boolean; has_credentials: boolean } | null>(null);
  const [zohoCallbackUrl, setZohoCallbackUrl] = useState('');
  const [isDisconnectingZoho, setIsDisconnectingZoho] = useState(false);
  const [zohoNotice, setZohoNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSyncingZoho, setIsSyncingZoho] = useState(false);

  // Ragic
  const [ragicStatus, setRagicStatus] = useState<{ connected: boolean } | null>(null);
  const [isSyncingRagic, setIsSyncingRagic] = useState(false);
  const [isDisconnectingRagic, setIsDisconnectingRagic] = useState(false);
  const [ragicNotice, setRagicNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Odoo
  const [odooStatus, setOdooStatus] = useState<{ connected: boolean } | null>(null);
  const [isSyncingOdoo, setIsSyncingOdoo] = useState(false);
  const [isTestingOdoo, setIsTestingOdoo] = useState(false);
  const [isDisconnectingOdoo, setIsDisconnectingOdoo] = useState(false);
  const [odooNotice, setOdooNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
    apiFetch('/api/settings')
      .then(s => {
        if (s && !s.error) {
          setSettings((prev: any) => ({ ...prev, ...s }));
          db.settings.put(s).catch(() => {});
        }
      })
      .catch(() => {});
    if (currentUser?.system_role === 'admin') {
      apiFetch('/api/zoho/status')
        .then(s => { setZohoStatus(s); setZohoBooksStatus(s); })
        .catch(() => {});
      apiFetch('/api/zoho/callback-url')
        .then((d: any) => setZohoCallbackUrl(d.url))
        .catch(() => {});
      apiFetch('/api/ragic/status')
        .then(s => setRagicStatus(s))
        .catch(() => {});
      apiFetch('/api/odoo/status')
        .then(s => setOdooStatus(s))
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

  const handleRagicSync = async () => {
    setIsSyncingRagic(true);
    setRagicNotice(null);
    try {
      await handleSave();
      const data = await apiFetch<any>('/api/ragic/sync', { method: 'POST' });
      const r = data.results ?? {};
      const total = Object.values(r).reduce((acc: any, v: any) => ({
        pushed: acc.pushed + (v.pushed ?? 0),
        pulled: acc.pulled + (v.pulled ?? 0),
      }), { pushed: 0, pulled: 0 }) as any;
      const errors = Object.values(r).flatMap((v: any) => v.errors ?? []);
      const msg = `Synchronisation réussie — ${total.pushed} envoyés, ${total.pulled} importés.`;
      setRagicNotice({ type: errors.length > 0 ? 'error' : 'success', message: errors.length > 0 ? `${msg} Erreurs : ${errors.slice(0, 3).join(', ')}` : msg });
      setRagicStatus({ connected: true });
    } catch (e: any) {
      setRagicNotice({ type: 'error', message: e.message || 'Erreur de synchronisation Ragic.' });
    } finally {
      setIsSyncingRagic(false);
    }
  };

  const handleRagicDisconnect = async () => {
    setIsDisconnectingRagic(true);
    try {
      await apiFetch('/api/ragic/disconnect', { method: 'DELETE' });
      setRagicStatus({ connected: false });
      setSettings((prev: any) => ({
        ...prev,
        ragic_api_key: '', ragic_account: '',
        ragic_sheet_contacts: '', ragic_sheet_projects: '',
        ragic_sheet_invoices: '', ragic_sheet_proposals: '',
      }));
      setRagicNotice({ type: 'success', message: 'Ragic déconnecté avec succès.' });
    } catch {
      setRagicNotice({ type: 'error', message: 'Erreur lors de la déconnexion.' });
    } finally {
      setIsDisconnectingRagic(false);
    }
  };

  const handleOdooTest = async () => {
    setIsTestingOdoo(true);
    setOdooNotice(null);
    try {
      await handleSave();
      const data = await apiFetch<any>('/api/odoo/test', { method: 'POST' });
      setOdooStatus({ connected: true });
      setOdooNotice({ type: 'success', message: `Connexion réussie — ${data.company}` });
    } catch (e: any) {
      setOdooStatus({ connected: false });
      setOdooNotice({ type: 'error', message: e.message || 'Connexion échouée. Vérifiez vos identifiants.' });
    } finally {
      setIsTestingOdoo(false);
    }
  };

  const handleOdooSync = async () => {
    setIsSyncingOdoo(true);
    setOdooNotice(null);
    try {
      await handleSave();
      const data = await apiFetch<any>('/api/odoo/sync', { method: 'POST' });
      const r = data.results ?? {};
      const total = Object.values(r).reduce((acc: any, v: any) => ({
        pushed: acc.pushed + (v.pushed ?? 0),
        pulled: acc.pulled + (v.pulled ?? 0),
      }), { pushed: 0, pulled: 0 }) as any;
      const errors = Object.values(r).flatMap((v: any) => v.errors ?? []);
      const msg = `Synchronisation réussie — ${total.pushed} envoyés, ${total.pulled} importés.`;
      setOdooNotice({ type: errors.length > 0 ? 'error' : 'success', message: errors.length > 0 ? `${msg} Erreurs : ${errors.slice(0, 3).join(' | ')}` : msg });
      setOdooStatus({ connected: true });
    } catch (e: any) {
      setOdooNotice({ type: 'error', message: e.message || 'Erreur de synchronisation Odoo.' });
    } finally {
      setIsSyncingOdoo(false);
    }
  };

  const handleOdooDisconnect = async () => {
    setIsDisconnectingOdoo(true);
    try {
      await apiFetch('/api/odoo/disconnect', { method: 'DELETE' });
      setOdooStatus({ connected: false });
      setSettings((prev: any) => ({ ...prev, odoo_url: '', odoo_db: '', odoo_username: '', odoo_api_key: '' }));
      setOdooNotice({ type: 'success', message: 'Odoo déconnecté avec succès.' });
    } catch {
      setOdooNotice({ type: 'error', message: 'Erreur lors de la déconnexion.' });
    } finally {
      setIsDisconnectingOdoo(false);
    }
  };

  const handleZohoDisconnect = async () => {
    setIsDisconnectingZoho(true);
    try {
      await apiFetch('/api/zoho/disconnect', { method: 'DELETE' });
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
      const data = await apiFetch<any>('/api/zoho/sync', { method: 'POST' });
      setZohoNotice({ type: 'success', message: `Synchronisation réussie — ${data.pushed ?? 0} envoyées, ${data.pulled ?? 0} importées.` });
    } catch (e: any) {
      setZohoNotice({ type: 'error', message: e.message || 'Erreur de synchronisation.' });
    } finally {
      setIsSyncingZoho(false);
    }
  };

  const handleZohoBooksSync = async () => {
    setIsSyncingZohoBooks(true);
    setZohoBooksNotice(null);
    try {
      const data = await apiFetch<any>('/api/zoho-books/sync', { method: 'POST' });
      setZohoBooksNotice({ type: 'success', message: `Synchronisation Zoho Books réussie — ${data.synced ?? 0} entrées synchronisées.` });
    } catch (e: any) {
      setZohoBooksNotice({ type: 'error', message: e.message || 'Erreur de synchronisation Zoho Books.' });
    } finally {
      setIsSyncingZohoBooks(false);
    }
  };

  const handleTestSmtp = async () => {
    setIsTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      await apiFetch('/api/test-smtp', {
        method: 'POST',
        body: JSON.stringify({ smtpHost: settings.smtpHost, smtpPort: settings.smtpPort, smtpUser: settings.smtpUser, smtpPass: settings.smtpPass })
      });
      setSmtpTestResult({ success: true, message: 'Test email sent successfully to ' + settings.smtpUser });
    } catch (err: any) {
      let msg = err.message || 'Failed to send test email';
      if (msg.includes('534-5.7.9')) msg = "Erreur Gmail : un mot de passe d'application est requis.";
      else if (msg.includes('535-5.7.8')) msg = "Erreur d'authentification : identifiants incorrects.";
      else if (msg.includes('ECONNREFUSED')) msg = "Connexion refusée : vérifiez l'hôte SMTP et le port.";
      else if (msg.includes('ETIMEDOUT')) msg = "Délai dépassé : le serveur SMTP ne répond pas.";
      setSmtpTestResult({ success: false, message: msg });
    } finally {
      setIsTestingSmtp(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Délai dépassé (30s). Vérifiez votre connexion et réessayez.')), 30_000)
    );
    try {
      await Promise.race([
        (async () => {
          if (currentUser?.system_role === 'admin') {
            await apiFetch('/api/settings', {
              method: 'PUT',
              body: JSON.stringify(settings),
            });
            db.settings.put(settings).catch(() => {});
          }
          if (currentUser) {
            await apiFetch(`/api/team/${currentUser.id}`, {
              method: 'PUT',
              body: JSON.stringify(userSettings),
            });
            setCurrentUser({ ...currentUser, ...userSettings } as any);
          }
        })(),
        deadline,
      ]);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err: any) {
      console.error('[Settings save]', err);
      setSaveError(err?.message || 'Erreur lors de la sauvegarde.');
    } finally {
      setIsSaving(false);
    }
  };

  const isAdmin = currentUser?.system_role === 'admin';

  // ── Marketplace helpers ────────────────────────────────────────────────────

  const getPluginConnectionState = (id: string): boolean => {
    if (id === 'zoho_invoice') return !!(zohoStatus?.connected);
    if (id === 'zoho_books') return !!(zohoBooksStatus?.connected);
    if (id === 'maf') return !!(settings as any).maf_enabled;
    if (id === 'ragic') return !!(ragicStatus?.connected);
    if (id === 'odoo') return !!(odooStatus?.connected);
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
        <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Data Center</label>
        <select
          className="w-full p-2 rounded-lg text-sm"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
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
        <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Client ID</label>
        <input
          className="w-full p-2 rounded-lg text-sm font-mono"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          placeholder="1000.XXXXXXXXXXXXXXXXXXXX"
          value={settings.zoho_client_id}
          onChange={e => setSettings({ ...settings, zoho_client_id: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Client Secret</label>
        <input
          type="password"
          className="w-full p-2 rounded-lg text-sm font-mono"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
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
          <div className="text-sm p-3 rounded-lg border" style={zohoNotice.type === 'success'
            ? { background: '#d3f9d8', borderColor: '#a9e9b0', color: '#2f9e44' }
            : { background: '#ffe0e0', borderColor: '#fca5a5', color: '#c92a2a' }}>
            {zohoNotice.message}
          </div>
        )}
        <ZohoCredentialFields />
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Organisation ID (Zoho Invoice)</label>
          <input
            className="w-full p-2 rounded-lg text-sm font-mono"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            placeholder="123456789"
            value={settings.zoho_org_id}
            onChange={e => setSettings({ ...settings, zoho_org_id: e.target.value })}
          />
        </div>
        <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--tblr-primary-lt)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-primary)' }}>
          <p className="font-bold mb-1">URL de redirection OAuth</p>
          <code className="block px-2 py-1.5 rounded border font-mono break-all select-all" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
            {zohoCallbackUrl || `${window.location.origin}/api/zoho/callback`}
          </code>
          <p className="mt-1 opacity-75">Copiez cette URL dans la console API Zoho → Authorized Redirect URIs.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href="https://api-console.zoho.com/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
            <IconExternalLink size={13} /> Console API Zoho
          </a>
          {!zohoStatus?.connected ? (
            <button
              type="button"
              disabled={!settings.zoho_client_id || !settings.zoho_client_secret || !settings.zoho_org_id}
              onClick={async () => { await handleSave(); window.location.href = '/api/zoho/auth'; }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#f76707', color: '#fff' }}>
              <IconPlugConnected size={13} /> Connecter Zoho
            </button>
          ) : (
            <>
              <button type="button" onClick={handleZohoSync} disabled={isSyncingZoho}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                {isSyncingZoho ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />} Synchroniser
              </button>
              <button type="button" onClick={handleZohoDisconnect} disabled={isDisconnectingZoho}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                style={{ background: '#ffe0e0', color: 'var(--tblr-danger)' }}>
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
          <div className="text-sm p-3 rounded-lg border" style={zohoBooksNotice.type === 'success'
            ? { background: '#d3f9d8', borderColor: '#a9e9b0', color: '#2f9e44' }
            : { background: '#ffe0e0', borderColor: '#fca5a5', color: '#c92a2a' }}>
            {zohoBooksNotice.message}
          </div>
        )}
        <div className="p-3 rounded-lg text-xs" style={{ background: '#fff3bf', border: '1px solid #ffe066', color: '#e67700' }}>
          <p className="font-bold mb-0.5">Credentials partagés avec Zoho Invoice</p>
          <p className="opacity-80">Zoho Books utilise la même application OAuth que Zoho Invoice. Configurez d'abord le Client ID et le Secret dans l'onglet Zoho Invoice, puis connectez ci-dessous.</p>
        </div>
        <ZohoCredentialFields />
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Organisation ID (Zoho Books)</label>
          <input
            className="w-full p-2 rounded-lg text-sm font-mono"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            placeholder="Identique à Zoho Invoice si même organisation"
            value={settings.zoho_books_org_id || settings.zoho_org_id}
            onChange={e => setSettings({ ...settings, zoho_books_org_id: e.target.value })}
          />
        </div>
        <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--tblr-primary-lt)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-primary)' }}>
          <p className="font-bold mb-1">URL de redirection OAuth</p>
          <code className="block px-2 py-1.5 rounded border font-mono break-all select-all" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
            {zohoCallbackUrl || `${window.location.origin}/api/zoho/callback`}
          </code>
          <p className="mt-1 opacity-75">Même URL que Zoho Invoice. Ajoutez le scope <code className="font-mono px-1 rounded" style={{ background: 'var(--tblr-primary-lt)' }}>ZohoBooks.fullaccess.all</code> dans votre app Zoho.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href="https://api-console.zoho.com/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
            <IconExternalLink size={13} /> Console API Zoho
          </a>
          {!zohoBooksStatus?.connected ? (
            <button
              type="button"
              disabled={!settings.zoho_client_id || !settings.zoho_client_secret || !(settings.zoho_books_org_id || settings.zoho_org_id)}
              onClick={async () => { await handleSave(); window.location.href = '/api/zoho-books/auth'; }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#f76707', color: '#fff' }}>
              <IconPlugConnected size={13} /> Connecter Zoho Books
            </button>
          ) : (
            <>
              <button type="button" onClick={handleZohoBooksSync} disabled={isSyncingZohoBooks}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                {isSyncingZohoBooks ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />} Synchroniser
              </button>
              <button type="button" onClick={handleZohoDisconnect} disabled={isDisconnectingZoho}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                style={{ background: '#ffe0e0', color: 'var(--tblr-danger)' }}>
                {isDisconnectingZoho ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnectedX size={13} />} Déconnecter
              </button>
            </>
          )}
        </div>
      </div>
    );

    if (pluginId === 'maf') return (
      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>Activer le plugin MAF</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>Affiche la déclaration MAF dans le menu et le calcul dans les propositions</div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={!!(settings as any).maf_enabled}
              onChange={e => setSettings({ ...settings, maf_enabled: e.target.checked } as any)}
            />
            <div className="w-10 h-5 rounded-full peer-checked:bg-blue-600 bg-gray-300 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>N° d'adhérent MAF</label>
            <input
              className="w-full p-2 rounded-lg text-sm"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="ex. 24561"
              value={(settings as any).maf_numero_adherent || ''}
              onChange={e => setSettings({ ...settings, maf_numero_adherent: e.target.value } as any)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Taux de cotisation contractuel (‰)</label>
            <input
              type="number"
              step="0.0001"
              min="0"
              className="w-full p-2 rounded-lg text-sm"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="ex. 2.4752"
              value={(settings as any).maf_taux_contrat_permil || ''}
              onChange={e => setSettings({ ...settings, maf_taux_contrat_permil: e.target.value } as any)}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>Taux figurant sur votre contrat MAF — utilisé pour l'estimation des cotisations intercalaires jaune/vert/AMI.</p>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Année de déclaration</label>
            <input
              type="number"
              className="w-full p-2 rounded-lg text-sm"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              value={(settings as any).maf_declaration_year || 2025}
              onChange={e => setSettings({ ...settings, maf_declaration_year: parseInt(e.target.value) || 2025 } as any)}
            />
          </div>
        </div>
        <div className="p-3 rounded-lg text-xs" style={{ background: '#fff4e6', border: '1px solid #ffd8a8', color: '#c05500' }}>
          <p className="font-bold mb-1">Déclaration MAF — Activités professionnelles</p>
          <p>La déclaration annuelle doit être validée et clôturée sur <strong>maf.fr</strong> avant le 31 mars. ArchiOffice vous aide à préparer vos données et calcule vos assiettes de cotisation.</p>
        </div>
      </div>
    );

    if (pluginId === 'odoo') return (
      <div className="space-y-4">
        {odooNotice && (
          <div className="text-sm p-3 rounded-lg border" style={odooNotice.type === 'success'
            ? { background: '#d3f9d8', borderColor: '#a9e9b0', color: '#2f9e44' }
            : { background: '#ffe0e0', borderColor: '#fca5a5', color: '#c92a2a' }}>
            {odooNotice.message}
          </div>
        )}
        <div className="p-3 rounded-lg text-xs" style={{ background: '#f3f0ff', border: '1px solid #d0bfff', color: '#5f3dc4' }}>
          <p className="font-bold mb-1">Configuration Odoo</p>
          <p>Compatible Odoo 14+ (Community et Enterprise). Générez votre clé API dans Odoo → <strong>Paramètres → Technique → Clés API</strong>. La clé API remplace le mot de passe pour l'authentification.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>URL Odoo</label>
            <input
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="https://moncabinet.odoo.com"
              value={(settings as any).odoo_url || ''}
              onChange={e => setSettings({ ...settings, odoo_url: e.target.value } as any)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Base de données</label>
            <input
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="moncabinet"
              value={(settings as any).odoo_db || ''}
              onChange={e => setSettings({ ...settings, odoo_db: e.target.value } as any)}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>Nom de la base Odoo (visible dans l'URL ou dans Paramètres → Base de données)</p>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Identifiant (email)</label>
            <input
              className="w-full p-2 rounded-lg text-sm"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="admin@moncabinet.com"
              value={(settings as any).odoo_username || ''}
              onChange={e => setSettings({ ...settings, odoo_username: e.target.value } as any)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Clé API</label>
            <input
              type="password"
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="••••••••••••••••••••••••"
              value={(settings as any).odoo_api_key || ''}
              onChange={e => setSettings({ ...settings, odoo_api_key: e.target.value } as any)}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>Générée dans Odoo → Paramètres → Technique → Clés API</p>
          </div>
        </div>
        <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
          <p className="font-bold mb-1" style={{ color: 'var(--tblr-text)' }}>Correspondance des modèles Odoo</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span>Contacts → <code className="font-mono">res.partner</code></span>
            <span>Projets → <code className="font-mono">project.project</code></span>
            <span>Factures → <code className="font-mono">account.move</code></span>
            <span>Propositions → <code className="font-mono">sale.order</code></span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={!(settings as any).odoo_url || !(settings as any).odoo_api_key || !(settings as any).odoo_username || !(settings as any).odoo_db || isTestingOdoo}
            onClick={handleOdooTest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
            {isTestingOdoo ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnected size={13} />} Tester la connexion
          </button>
          <button
            type="button"
            disabled={!odooStatus?.connected || isSyncingOdoo}
            onClick={handleOdooSync}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#6741d9', color: '#fff' }}>
            {isSyncingOdoo ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />} Synchroniser maintenant
          </button>
          {odooStatus?.connected && (
            <button
              type="button"
              disabled={isDisconnectingOdoo}
              onClick={handleOdooDisconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{ background: '#ffe0e0', color: 'var(--tblr-danger)' }}>
              {isDisconnectingOdoo ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnectedX size={13} />} Déconnecter
            </button>
          )}
        </div>
      </div>
    );

    if (pluginId === 'ragic') return (
      <div className="space-y-4">
        {ragicNotice && (
          <div className="text-sm p-3 rounded-lg border" style={ragicNotice.type === 'success'
            ? { background: '#d3f9d8', borderColor: '#a9e9b0', color: '#2f9e44' }
            : { background: '#ffe0e0', borderColor: '#fca5a5', color: '#c92a2a' }}>
            {ragicNotice.message}
          </div>
        )}
        <div className="p-3 rounded-lg text-xs" style={{ background: '#e6fcf5', border: '1px solid #96f2d7', color: '#087f5b' }}>
          <p className="font-bold mb-1">Configuration Ragic</p>
          <p>Créez un compte sur <strong>ragic.com</strong>, puis allez dans <strong>Profil → Clé API</strong> pour obtenir votre clé. Pour chaque feuille, copiez le chemin depuis l'URL : <code className="font-mono px-1 rounded" style={{ background: '#c3fae8' }}>moncompte.ragic.com/<strong>onglet/index</strong></code>.</p>
          <p className="mt-1">Les colonnes de vos feuilles Ragic doivent porter les mêmes noms que les champs ArchiOffice (ex. <code className="font-mono px-1 rounded" style={{ background: '#c3fae8' }}>first_name</code>, <code className="font-mono px-1 rounded" style={{ background: '#c3fae8' }}>last_name</code>, <code className="font-mono px-1 rounded" style={{ background: '#c3fae8' }}>email</code>…).</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Clé API Ragic</label>
            <input
              type="password"
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="••••••••••••••••••••••••"
              value={(settings as any).ragic_api_key || ''}
              onChange={e => setSettings({ ...settings, ragic_api_key: e.target.value } as any)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Compte Ragic (sous-domaine)</label>
            <input
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="ex. moncabinet"
              value={(settings as any).ragic_account || ''}
              onChange={e => setSettings({ ...settings, ragic_account: e.target.value } as any)}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>Sous-domaine de votre URL Ragic : <strong>moncabinet</strong>.ragic.com</p>
          </div>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>Chemins des feuilles (laisser vide pour ignorer)</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {([
              { key: 'ragic_sheet_contacts', label: 'Contacts', placeholder: 'ex. crm/contacts/0' },
              { key: 'ragic_sheet_projects', label: 'Projets', placeholder: 'ex. projets/liste/0' },
              { key: 'ragic_sheet_invoices', label: 'Factures', placeholder: 'ex. compta/factures/0' },
              { key: 'ragic_sheet_proposals', label: 'Propositions', placeholder: 'ex. compta/devis/0' },
            ] as const).map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>{label}</label>
                <input
                  className="w-full p-2 rounded-lg text-sm font-mono"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  placeholder={placeholder}
                  value={(settings as any)[key] || ''}
                  onChange={e => setSettings({ ...settings, [key]: e.target.value } as any)}
                />
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>URL Webhook entrant</p>
          <code className="block px-2 py-1.5 rounded border text-xs font-mono break-all select-all" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
            {`${window.location.origin}/api/ragic/webhook?entity=contacts&tenant=VOTRE_TENANT_ID&secret=VOTRE_CLE_API`}
          </code>
          <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>Configurez cette URL dans Ragic → <strong>Formulaire → Webhook</strong> pour recevoir les mises à jour en temps réel. Remplacez <code className="font-mono">entity</code> par contacts, projects, invoices ou proposals.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href="https://www.ragic.com/intl/en/doc-api" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
            <IconExternalLink size={13} /> Documentation API Ragic
          </a>
          <button
            type="button"
            disabled={!(settings as any).ragic_api_key || !(settings as any).ragic_account || isSyncingRagic}
            onClick={handleRagicSync}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#0ca678', color: '#fff' }}>
            {isSyncingRagic ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />} Synchroniser maintenant
          </button>
          {ragicStatus?.connected && (
            <button
              type="button"
              disabled={isDisconnectingRagic}
              onClick={handleRagicDisconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{ background: '#ffe0e0', color: 'var(--tblr-danger)' }}>
              {isDisconnectingRagic ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnectedX size={13} />} Déconnecter
            </button>
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
          <h1 className="text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('general_settings')}</h1>

          {/* ── Agency info ── */}
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Informations du cabinet</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('agency_name')} value={settings.agencyName} onChange={e => setSettings({...settings, agencyName: e.target.value})} />
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('address')} value={settings.address} onChange={e => setSettings({...settings, address: e.target.value})} />
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('phone')} value={settings.phone} onChange={e => setSettings({...settings, phone: e.target.value})} />
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('email')} value={settings.email} onChange={e => setSettings({...settings, email: e.target.value})} />
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('siret')} value={settings.siret} onChange={e => setSettings({...settings, siret: e.target.value})} />
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('vat_number')} value={settings.vatNumber} onChange={e => setSettings({...settings, vatNumber: e.target.value})} />
              <input className="p-2 rounded-lg text-sm font-mono" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder="IBAN" value={settings.seller_iban} onChange={e => setSettings({...settings, seller_iban: e.target.value})} />
              <input className="p-2 rounded-lg text-sm font-mono" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder="BIC" value={settings.seller_bic} onChange={e => setSettings({...settings, seller_bic: e.target.value})} />
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('currency')} value={settings.currency} onChange={e => setSettings({...settings, currency: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>{t('company_logo')}</label>
              <input type="file" accept="image/*" className="p-2 rounded-lg text-sm w-full"
                style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => setSettings({...settings, logoUrl: reader.result as string});
                    reader.readAsDataURL(file);
                  }
                }} />
              {settings.logoUrl && <img src={settings.logoUrl} alt="Logo" className="w-24 h-24 object-contain mt-2 rounded-lg p-1" style={{ border: '1px solid var(--tblr-border)' }} />}
            </div>
          </div>

          {/* ── Numérotation des documents ── */}
          <div className="rounded-xl p-5 space-y-5" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Numérotation des documents</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>
                Choisissez le préfixe pour chaque type de document. Le numéro généré aura la forme <strong>PRÉFIXE-ANNÉE-NNN</strong>.
              </p>
            </div>
            {([
              { label: 'Devis / Propositions', key: 'numPrefixDevis' as const, presets: ['DEVIS', 'DEV', 'PROP'] },
              { label: 'Factures', key: 'numPrefixFacture' as const, presets: ['FAC', 'Facture', 'F'] },
              { label: 'Notes d\'honoraires', key: 'numPrefixHonoraires' as const, presets: ['NH', 'NOTE-H', 'HONOS'] },
            ] as const).map(({ label, key, presets }) => {
              const year = new Date().getFullYear();
              const prefix = settings[key] || presets[0];
              const preview = `${prefix}-${year}-001`;
              return (
                <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>{label}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {presets.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setSettings({ ...settings, [key]: p })}
                          className="px-2.5 py-1 rounded text-xs font-bold transition-colors"
                          style={settings[key] === p
                            ? { background: 'var(--tblr-primary)', color: '#fff' }
                            : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Préfixe personnalisé</label>
                    <input
                      className="w-full p-2 rounded-lg text-sm font-mono"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      placeholder="Ex: MON-PREFIX"
                      value={settings[key]}
                      onChange={e => setSettings({ ...settings, [key]: e.target.value })}
                      maxLength={20}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Aperçu</label>
                    <div className="p-2 rounded-lg text-sm font-mono font-bold" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-primary)' }}>
                      {preview}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── SMTP ── */}
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('settings_smtp_title')}</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('settings_smtp_explanation')}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('settings_smtp_host_placeholder')} value={settings.smtpHost} onChange={e => setSettings({...settings, smtpHost: e.target.value})} />
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('settings_smtp_port_placeholder')} value={settings.smtpPort} onChange={e => setSettings({...settings, smtpPort: e.target.value})} />
              <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('settings_smtp_user_placeholder')} value={settings.smtpUser} onChange={e => setSettings({...settings, smtpUser: e.target.value})} />
              <input type="password" className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('settings_smtp_password_placeholder')} value={settings.smtpPass} onChange={e => setSettings({...settings, smtpPass: e.target.value})} />
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={handleTestSmtp}
                disabled={isTestingSmtp || !settings.smtpHost || !settings.smtpUser || !settings.smtpPass}
                className="w-fit flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
                {isTestingSmtp ? <><IconLoader2 className="w-4 h-4 animate-spin" />{t('settings_smtp_testing')}</> : t('settings_smtp_test_btn')}
              </button>
              {smtpTestResult && (
                <div className="text-sm p-3 rounded-lg border" style={smtpTestResult.success
                  ? { background: '#d3f9d8', borderColor: '#a9e9b0', color: '#2f9e44' }
                  : { background: '#ffe0e0', borderColor: '#fca5a5', color: '#c92a2a' }}>
                  {smtpTestResult.message}
                </div>
              )}
            </div>
          </div>

          {/* ── Email preferences ── */}
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('email_settings')}</h2>
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
            <textarea className="w-full p-2 rounded-lg h-28 text-sm"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder={t('default_email_template')} value={settings.defaultEmailTemplate ?? ''}
              onChange={e => setSettings({...settings, defaultEmailTemplate: e.target.value})} />
          </div>

          {/* ══════════════════ INTEGRATIONS MARKETPLACE ══════════════════ */}
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <IconPuzzle size={20} style={{ color: 'var(--tblr-muted)' }} />
                  <h2 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>Marketplace de plugins</h2>
                </div>
                <p className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>
                  Connectez ArchiOffice à vos outils métiers.
                  {connectedCount > 0 && <span className="ml-2 font-medium" style={{ color: 'var(--tblr-success)' }}>{connectedCount} plugin{connectedCount > 1 ? 's' : ''} actif{connectedCount > 1 ? 's' : ''}.</span>}
                </p>
              </div>
              {/* Search */}
              <div className="relative">
                <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
                <input
                  className="pl-8 pr-3 py-1.5 text-sm rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
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
                  className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors"
                  style={categoryFilter === cat.id
                    ? { background: 'var(--tblr-primary)', color: '#fff' }
                    : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' }}
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
                    className="rounded-xl overflow-hidden transition-shadow"
                    style={{
                      background: 'var(--tblr-surface)',
                      border: isOpen ? '1px solid var(--tblr-primary)' : '1px solid var(--tblr-border)',
                      boxShadow: isOpen ? 'var(--tblr-shadow)' : undefined,
                      opacity: plugin.status === 'coming_soon' ? 0.7 : 1,
                    }}
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
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                            Bientôt
                          </span>
                        ) : isConnected ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: '#d3f9d8', color: '#2f9e44' }}>
                            <IconPlugConnected size={10} /> Connecté
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                            <IconPlugConnectedX size={10} /> Non connecté
                          </span>
                        )}
                      </div>

                      <p className="font-semibold text-sm" style={{ color: 'var(--tblr-text)' }}>{plugin.name}</p>
                      <p className="text-[11px] mb-1" style={{ color: 'var(--tblr-muted)' }}>{plugin.vendor}</p>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--tblr-muted)' }}>{plugin.description}</p>
                    </div>

                    {/* Card footer */}
                    <div className="px-4 pb-4 flex items-center gap-2">
                      {canConfigure ? (
                        <button
                          type="button"
                          onClick={() => setOpenPlugin(isOpen ? null : plugin.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                          style={isOpen
                            ? { background: 'var(--tblr-primary)', color: '#fff' }
                            : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
                        >
                          {isOpen ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
                          {isConnected ? 'Configurer' : 'Installer'}
                        </button>
                      ) : (
                        <span className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>Disponible prochainement</span>
                      )}
                      <span className={cn(
                        "text-[10px] font-medium px-2 py-0.5 rounded-full",
                        plugin.category === 'accounting' ? "bg-blue-50 text-blue-600" :
                        plugin.category === 'storage' ? "bg-teal-50 text-teal-600" :
                        plugin.category === 'crm' ? "bg-purple-50 text-purple-600" :
                        "bg-pink-50 text-pink-600"
                      )}>
                        {CATEGORIES.find(c => c.id === plugin.category)?.label}
                      </span>
                    </div>

                    {/* Config panel (accordion) */}
                    {isOpen && canConfigure && (
                      <div className="border-t px-4 py-4" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                        {renderPluginConfig(plugin.id)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {filteredPlugins.length === 0 && (
              <div className="text-center py-12" style={{ color: 'var(--tblr-muted)' }}>
                <IconPuzzle size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Aucun plugin trouvé.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── User section ── */}
      <h2 className="text-xl font-bold mt-8" style={{ color: 'var(--tblr-text)' }}>{t('user_information')}</h2>

      <div className="rounded-xl p-5 space-y-5" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        {/* Avatar */}
        <div className="flex items-center gap-5">
          <button type="button" onClick={() => avatarInputRef.current?.click()}
            className="relative group w-20 h-20 rounded-full overflow-hidden border-2 hover:border-blue-500 transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)' }}>
            <img src={userSettings.avatar || currentUser?.avatar || `https://picsum.photos/seed/${currentUser?.id || 'user'}/80/80`}
              alt={currentUser?.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
              <IconCamera size={18} className="text-white" />
              <span className="text-white text-[10px] font-medium">Modifier</span>
            </div>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          <div>
            <p className="font-medium" style={{ color: 'var(--tblr-text)' }}>{currentUser?.name}</p>
            <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{currentUser?.email}</p>
            <button type="button" onClick={() => avatarInputRef.current?.click()}
              className="mt-1.5 text-xs hover:underline" style={{ color: 'var(--tblr-primary)' }}>
              {t('change_photo') || 'Changer la photo de profil'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('phone')} value={userSettings.phone} onChange={e => setUserSettings({...userSettings, phone: e.target.value})} />
          <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('address')} value={userSettings.address} onChange={e => setUserSettings({...userSettings, address: e.target.value})} />
          <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('job_title')} value={userSettings.jobTitle} onChange={e => setUserSettings({...userSettings, jobTitle: e.target.value})} />
          <input className="p-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} placeholder={t('department')} value={userSettings.department} onChange={e => setUserSettings({...userSettings, department: e.target.value})} />
        </div>

        {/* Language switcher */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <IconLanguage size={16} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{t('language')}</span>
          </div>
          <div className="flex rounded-lg overflow-hidden w-fit" style={{ border: '1px solid var(--tblr-border)' }}>
            <button type="button" onClick={() => i18n.changeLanguage('fr')}
              className="px-5 py-2 text-sm font-medium transition-colors"
              style={i18n.language.startsWith('fr')
                ? { background: 'var(--tblr-primary)', color: '#fff' }
                : { background: 'var(--tblr-surface)', color: 'var(--tblr-muted)' }}>
              Français
            </button>
            <button type="button" onClick={() => i18n.changeLanguage('en')}
              className="px-5 py-2 text-sm font-medium transition-colors"
              style={i18n.language.startsWith('en')
                ? { background: 'var(--tblr-primary)', color: '#fff', borderLeft: '1px solid var(--tblr-border)' }
                : { background: 'var(--tblr-surface)', color: 'var(--tblr-muted)', borderLeft: '1px solid var(--tblr-border)' }}>
              English
            </button>
          </div>
        </div>
      </div>

      {/* ── User email preferences ── */}
      <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('my_email_settings')}</h2>
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
        <textarea className="w-full p-2 rounded-lg h-28 text-sm"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          placeholder={t('default_email_template')} value={userSettings.defaultEmailTemplate ?? ''}
          onChange={e => setUserSettings({...userSettings, defaultEmailTemplate: e.target.value})} />
      </div>

      {/* Save error */}
      {saveError && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {saveError}
        </div>
      )}

      {/* Save button */}
      <button
        disabled={isSaving || showSuccess}
        className="px-6 py-2.5 rounded-xl font-semibold transition-all flex items-center gap-2 text-sm disabled:opacity-80 disabled:cursor-not-allowed"
        style={showSuccess
          ? { background: 'var(--tblr-success)', color: '#fff' }
          : { background: 'var(--tblr-primary)', color: '#fff' }}
        onClick={handleSave}
      >
        {isSaving ? <><IconLoader2 className="w-4 h-4 animate-spin" />{t('saving')}...</>
          : showSuccess ? <><IconCircleCheck size={18} />{t('settings_saved')}</>
          : t('save')}
      </button>
    </div>
  );
}
