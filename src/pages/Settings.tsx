import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { db } from '../db';
import { useTranslation } from 'react-i18next';
import { useUser } from '../UserContext';
import {
  IconCircleCheck, IconLoader2, IconPlugConnected, IconPlugConnectedX,
  IconExternalLink, IconPuzzle, IconCamera, IconChevronDown, IconChevronUp,
  IconRefresh, IconSearch, IconTrash, IconTag, IconAlertTriangle, IconDownload,
  IconArchive
} from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { IconLanguage } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { changeLanguageLazy } from '../i18n';
import type { ProjectCategory } from '../types';

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
  {
    id: 'superpdp',
    name: 'Super PDP',
    vendor: 'Super PDP SAS',
    description: 'Envoyez vos factures électroniques au Portail Public de Facturation (PPF) via Super PDP, Partenaire de Dématérialisation agréé. Conformité réforme française de la facturation électronique.',
    category: 'accounting',
    status: 'active',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-700',
    iconLabel: 'PDP',
  },
  {
    id: 'chorus_pro',
    name: 'Chorus Pro',
    vendor: 'AIFE — Ministère de l\'Économie',
    description: "Transmettez vos factures de maîtrise d'œuvre et de travaux aux maîtrises d'ouvrage publiques via Chorus Pro, le portail de facturation électronique obligatoire pour le secteur public (B2G).",
    category: 'accounting',
    status: 'active',
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-700',
    iconLabel: 'CP',
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

// Catégories d'activité du flux — tenu en phase avec CATEGORY_COLORS dans
// src/components/ActivityFeed.tsx et CATEGORY_STYLES dans src/pages/Notifications.tsx
// (server/notificationArchiver.ts a la même liste côté back).
const ACTIVITY_ARCHIVE_CATEGORIES = [
  'Projets', 'Factures', "Appels d'offres", 'Messages', 'Contacts', 'Documents',
  'CCTP', 'Devis', 'Réunions', 'Ordres de service', 'Tâches', 'Situations/DPGF',
  'Notes de site', 'Réserves/Observations', 'Intégrations',
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
    numPrefixAffaire: '',
    defaultLeaveDaysCongesPayes: 25,
    defaultLeaveDaysRtt: 0,
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
    superpdp_client_id: '',
    superpdp_client_secret: '',
    superpdp_sandbox: true,
    chorus_pro_piste_client_id: '',
    chorus_pro_piste_client_secret: '',
    chorus_pro_technical_login: '',
    chorus_pro_technical_password: '',
    chorus_pro_sandbox: true,
    notificationArchiveDays: {} as Record<string, number>,
  });

  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  // Per-section save status (Informations du cabinet, SMTP, each Marketplace
  // plugin, ...) — every section saves independently via its own PUT
  // /api/settings carrying only its own fields, so a bad value or a DB column
  // missing for one section (e.g. a pending migration on a Zoho field) can
  // never block or fail saving an unrelated section.
  const [sectionStatus, setSectionStatus] = useState<Record<string, { saving: boolean; error: string | null; success: boolean }>>({});

  // Zoho Invoice
  const [zohoStatus, setZohoStatus] = useState<{ connected: boolean; has_credentials: boolean } | null>(null);
  const [zohoCallbackUrl, setZohoCallbackUrl] = useState('');
  // Books redirects to /api/zoho-books/callback, a different path from Zoho
  // Invoice's — showing Invoice's URL here sent admins to register the wrong
  // one, and Zoho then rejected the consent with "Invalid Redirect Uri".
  const [zohoBooksCallbackUrl, setZohoBooksCallbackUrl] = useState('');
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

  // SuperPDP
  const [superpdpStatus, setSuperpdpStatus] = useState<{ connected: boolean; sandbox?: boolean } | null>(null);
  const [isTestingSuperpdp, setIsTestingSuperpdp] = useState(false);
  const [isDisconnectingSuperpdp, setIsDisconnectingSuperpdp] = useState(false);
  const [superpdpNotice, setSuperpdpNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // RGPD — fermeture de cabinet (Zone dangereuse)
  const [tenantDeletion, setTenantDeletion] = useState<{ deletion_requested_at: string | null; grace_period_days: number } | null>(null);
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);
  const [isCancelingDeletion, setIsCancelingDeletion] = useState(false);
  const [isExportingTenant, setIsExportingTenant] = useState(false);

  // Chorus Pro
  const [chorusProStatus, setChorusProStatus] = useState<{ connected: boolean; sandbox?: boolean } | null>(null);
  const [isTestingChorusPro, setIsTestingChorusPro] = useState(false);
  const [isDisconnectingChorusPro, setIsDisconnectingChorusPro] = useState(false);
  const [chorusProNotice, setChorusProNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Zoho Books (shares same OAuth token as Invoice)
  const [zohoBooksStatus, setZohoBooksStatus] = useState<{ connected: boolean; has_credentials: boolean } | null>(null);
  const [isSyncingZohoBooks, setIsSyncingZohoBooks] = useState(false);
  const [zohoBooksNotice, setZohoBooksNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Marketplace UI
  const [categoryFilter, setCategoryFilter] = useState<PluginCategory>('all');
  const [pluginSearch, setPluginSearch] = useState('');
  const [openPlugin, setOpenPlugin] = useState<string | null>(null);

  // Domaines et catégories (projets / références)
  const [projectCategories, setProjectCategories] = useState<ProjectCategory[]>([]);
  const [newProjectCategoryName, setNewProjectCategoryName] = useState('');

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
        .then(s => setZohoStatus(s))
        .catch(() => {});
      // Books has its own status: it used to be filled from /api/zoho/status,
      // so connecting Zoho Invoice made Books claim to be connected too and
      // hid its Connect button behind a token with no ZohoBooks scope.
      apiFetch('/api/zoho-books/status')
        .then(s => setZohoBooksStatus(s))
        .catch(() => {});
      apiFetch('/api/zoho/callback-url')
        .then((d: any) => setZohoCallbackUrl(d.url))
        .catch(() => {});
      apiFetch('/api/zoho-books/callback-url')
        .then((d: any) => setZohoBooksCallbackUrl(d.url))
        .catch(() => {});
      apiFetch('/api/ragic/status')
        .then(s => setRagicStatus(s))
        .catch(() => {});
      apiFetch('/api/odoo/status')
        .then(s => setOdooStatus(s))
        .catch(() => {});
      apiFetch('/api/superpdp/status')
        .then(s => setSuperpdpStatus(s))
        .catch(() => {});
      apiFetch('/api/chorus-pro/status')
        .then(s => setChorusProStatus(s))
        .catch(() => {});
      apiFetch('/api/settings/tenant-deletion')
        .then((s: any) => setTenantDeletion(s))
        .catch(() => {});
      fetchProjectCategories();
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

  // The OAuth callbacks now forward Zoho's own error code instead of a bare
  // "1" (see server/routes/zohoInvoice.ts). Translate the ones an admin can
  // actually act on; anything else falls back to the generic message with the
  // raw code appended, so a support request can at least quote it.
  const zohoConnectErrorMessage = (code: string): string => {
    switch (code) {
      case 'invalid_client':
      case 'invalid_client_secret':
        return 'Zoho a refusé le Client ID ou le Client Secret. Vérifiez-les dans la console API Zoho.';
      case 'redirect_uri_mismatch':
      case 'invalid_redirect_uri':
        return "L'URL de redirection ci-dessous n'est pas enregistrée à l'identique dans votre application Zoho.";
      case 'invalid_code':
      case 'expired_state':
        return 'La demande de connexion a expiré. Relancez la connexion.';
      case 'access_denied':
        return "L'accès a été refusé sur l'écran de consentement Zoho.";
      case 'no_code':
        return 'Zoho est revenu sans code d’autorisation. Relancez la connexion.';
      case '1':
        return t('zoho_connect_error');
      default:
        return `${t('zoho_connect_error')} (${code})`;
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const zohoError = params.get('zoho_error');
    const booksError = params.get('zoho_books_error');
    if (params.get('zoho_connected') === '1') {
      setZohoStatus(prev => ({ ...prev!, connected: true }));
      setZohoNotice({ type: 'success', message: t('zoho_connected_success') });
      setOpenPlugin('zoho_invoice');
      window.history.replaceState({}, '', '/settings');
    } else if (zohoError) {
      setZohoNotice({ type: 'error', message: zohoConnectErrorMessage(zohoError) });
      setOpenPlugin('zoho_invoice');
      window.history.replaceState({}, '', '/settings');
    // The Books callback has always redirected with these two params, but
    // nothing read them: a successful connect gave no feedback and left the
    // query string in the address bar, and a failure was completely silent.
    } else if (params.get('zoho_books_connected') === '1') {
      setZohoBooksStatus(prev => ({ ...prev!, connected: true }));
      setZohoBooksNotice({ type: 'success', message: 'Connexion à Zoho Books réussie.' });
      setOpenPlugin('zoho_books');
      window.history.replaceState({}, '', '/settings');
    } else if (booksError) {
      setZohoBooksNotice({ type: 'error', message: zohoConnectErrorMessage(booksError) });
      setOpenPlugin('zoho_books');
      window.history.replaceState({}, '', '/settings');
    }
  }, [location.search, t]);

  const fetchProjectCategories = async () => {
    const localData = await db.projectCategories.toArray();
    if (localData.length > 0) setProjectCategories(localData);
    if (navigator.onLine) {
      try {
        const data = await apiFetch<ProjectCategory[]>('/api/project_categories');
        await db.projectCategories.clear();
        await db.projectCategories.bulkPut(data);
        setProjectCategories(data);
      } catch (err) { console.error('Failed to fetch project categories:', err); }
    }
  };

  // Empty input clears the override for that category (falls back to
  // `default`, or never-archived if `default` is also unset — see
  // server/notificationArchiver.ts).
  const setArchiveDays = (category: string, value: string) => {
    setSettings(prev => {
      const next = { ...(prev.notificationArchiveDays || {}) };
      if (value.trim() === '') delete next[category];
      else next[category] = Math.max(0, parseInt(value, 10) || 0);
      return { ...prev, notificationArchiveDays: next };
    });
  };

  const handleAddProjectCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectCategoryName.trim()) return;
    try {
      await apiFetch('/api/project_categories', {
        method: 'POST',
        body: JSON.stringify({ id: crypto.randomUUID(), name: newProjectCategoryName.trim() }),
      });
      setNewProjectCategoryName('');
      fetchProjectCategories();
    } catch (err) { console.error('Failed to add project category:', err); }
  };

  const handleDeleteProjectCategory = async (id: string) => {
    if (!confirm(t('settings_categories_delete_confirm'))) return;
    try {
      await apiFetch(`/api/project_categories/${id}`, { method: 'DELETE' });
      fetchProjectCategories();
    } catch (err) { console.error('Failed to delete project category:', err); }
  };

  const ragicFields = () => ({
    ragic_api_key: (settings as any).ragic_api_key,
    ragic_account: (settings as any).ragic_account,
    ragic_sheet_contacts: (settings as any).ragic_sheet_contacts,
    ragic_sheet_projects: (settings as any).ragic_sheet_projects,
    ragic_sheet_invoices: (settings as any).ragic_sheet_invoices,
    ragic_sheet_proposals: (settings as any).ragic_sheet_proposals,
  });

  const handleRagicSync = async () => {
    setIsSyncingRagic(true);
    setRagicNotice(null);
    try {
      const saveErr = await saveSection('ragic', ragicFields());
      if (saveErr) { setRagicNotice({ type: 'error', message: saveErr }); return; }
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

  const odooFields = () => ({
    odoo_url: (settings as any).odoo_url,
    odoo_db: (settings as any).odoo_db,
    odoo_username: (settings as any).odoo_username,
    odoo_api_key: (settings as any).odoo_api_key,
  });

  const handleOdooTest = async () => {
    setIsTestingOdoo(true);
    setOdooNotice(null);
    try {
      const saveErr = await saveSection('odoo', odooFields());
      if (saveErr) { setOdooNotice({ type: 'error', message: saveErr }); return; }
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
      const saveErr = await saveSection('odoo', odooFields());
      if (saveErr) { setOdooNotice({ type: 'error', message: saveErr }); return; }
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

  const superpdpFields = () => ({
    superpdp_client_id: (settings as any).superpdp_client_id,
    superpdp_client_secret: (settings as any).superpdp_client_secret,
    superpdp_sandbox: (settings as any).superpdp_sandbox,
  });

  const handleSuperpdpTest = async () => {
    setIsTestingSuperpdp(true);
    try {
      // /api/superpdp/test reads credentials from the persisted settings row,
      // not from the request body — must be saved first.
      const saveErr = await saveSection('superpdp', superpdpFields());
      if (saveErr) { setSuperpdpNotice({ type: 'error', message: saveErr }); return; }
      const res = await apiFetch<{ connected: boolean; company?: string; error?: string }>('/api/superpdp/test', { method: 'POST' });
      if (res.connected) {
        setSuperpdpStatus({ connected: true });
        setSuperpdpNotice({ type: 'success', message: `Connecté${res.company ? ` — ${res.company}` : ''}.` });
      } else {
        setSuperpdpNotice({ type: 'error', message: res.error || 'Connexion échouée.' });
      }
    } catch (e: any) {
      setSuperpdpNotice({ type: 'error', message: e.message });
    } finally {
      setIsTestingSuperpdp(false);
    }
  };

  const handleSuperpdpDisconnect = async () => {
    setIsDisconnectingSuperpdp(true);
    try {
      await apiFetch('/api/superpdp/disconnect', { method: 'DELETE' });
      setSuperpdpStatus({ connected: false });
      setSettings((prev: any) => ({ ...prev, superpdp_client_id: '', superpdp_client_secret: '' }));
      setSuperpdpNotice({ type: 'success', message: 'Super PDP déconnecté avec succès.' });
    } catch {
      setSuperpdpNotice({ type: 'error', message: 'Erreur lors de la déconnexion.' });
    } finally {
      setIsDisconnectingSuperpdp(false);
    }
  };

  const chorusProFields = () => ({
    chorus_pro_piste_client_id: (settings as any).chorus_pro_piste_client_id,
    chorus_pro_piste_client_secret: (settings as any).chorus_pro_piste_client_secret,
    chorus_pro_technical_login: (settings as any).chorus_pro_technical_login,
    chorus_pro_technical_password: (settings as any).chorus_pro_technical_password,
    chorus_pro_sandbox: (settings as any).chorus_pro_sandbox,
  });

  const handleChorusProTest = async () => {
    setIsTestingChorusPro(true);
    try {
      // /api/chorus-pro/test reads credentials from the persisted settings
      // row, not from the request body — must be saved first.
      const saveErr = await saveSection('chorus_pro', chorusProFields());
      if (saveErr) { setChorusProNotice({ type: 'error', message: saveErr }); return; }
      const res = await apiFetch<{ connected: boolean; sandbox?: boolean; error?: string }>('/api/chorus-pro/test', { method: 'POST' });
      if (res.connected) {
        setChorusProStatus({ connected: true, sandbox: res.sandbox });
        setChorusProNotice({ type: 'success', message: `Connecté${res.sandbox ? ' (environnement sandbox/qualification)' : ' (environnement production)'}.` });
      } else {
        setChorusProNotice({ type: 'error', message: res.error || 'Connexion échouée.' });
      }
    } catch (e: any) {
      setChorusProNotice({ type: 'error', message: e.message });
    } finally {
      setIsTestingChorusPro(false);
    }
  };

  const handleChorusProDisconnect = async () => {
    setIsDisconnectingChorusPro(true);
    try {
      await apiFetch('/api/chorus-pro/disconnect', { method: 'DELETE' });
      setChorusProStatus({ connected: false });
      setSettings((prev: any) => ({ ...prev, chorus_pro_piste_client_id: '', chorus_pro_piste_client_secret: '', chorus_pro_technical_login: '', chorus_pro_technical_password: '' }));
      setChorusProNotice({ type: 'success', message: 'Chorus Pro déconnecté avec succès.' });
    } catch {
      setChorusProNotice({ type: 'error', message: 'Erreur lors de la déconnexion.' });
    } finally {
      setIsDisconnectingChorusPro(false);
    }
  };

  const handleExportTenantData = async () => {
    setIsExportingTenant(true);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/settings/tenant-export', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Échec de l'export (${res.status}).`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] || `archioffice-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.message || "Échec de l'export des données du cabinet.");
    } finally {
      setIsExportingTenant(false);
    }
  };

  const handleRequestTenantDeletion = async () => {
    if (!window.confirm(
      "Demander la fermeture du cabinet ? Toutes les données du cabinet (projets, factures, documents, contacts...) seront " +
      "définitivement supprimées automatiquement dans 30 jours, sauf annulation d'ici là. " +
      "Avez-vous utilisé le bouton « Exporter toutes les données du cabinet » ci-dessus ? La loi française impose la " +
      "conservation des documents comptables pendant 10 ans, indépendamment de cette suppression."
    )) return;
    setIsRequestingDeletion(true);
    try {
      const res = await apiFetch<{ deletion_requested_at: string }>('/api/settings/tenant-deletion', { method: 'POST' });
      setTenantDeletion(prev => ({ deletion_requested_at: res.deletion_requested_at, grace_period_days: prev?.grace_period_days || 30 }));
    } catch (err: any) {
      alert(err?.message || "Échec de la demande de fermeture.");
    } finally {
      setIsRequestingDeletion(false);
    }
  };

  const handleCancelTenantDeletion = async () => {
    setIsCancelingDeletion(true);
    try {
      await apiFetch('/api/settings/tenant-deletion', { method: 'DELETE' });
      setTenantDeletion(prev => ({ deletion_requested_at: null, grace_period_days: prev?.grace_period_days || 30 }));
    } catch (err: any) {
      alert(err?.message || "Échec de l'annulation.");
    } finally {
      setIsCancelingDeletion(false);
    }
  };

  const handleZohoDisconnect = async () => {
    setIsDisconnectingZoho(true);
    try {
      await apiFetch('/api/zoho/disconnect', { method: 'DELETE' });
      setZohoStatus(prev => ({ ...prev!, connected: false }));
      setZohoNotice({ type: 'success', message: t('zoho_disconnected') });
    } catch {
      setZohoNotice({ type: 'error', message: t('zoho_connect_error') });
    } finally {
      setIsDisconnectingZoho(false);
    }
  };

  // The Books panel used to call handleZohoDisconnect, which hits Zoho
  // Invoice's endpoint — so "Déconnecter" under Zoho Books disconnected the
  // wrong integration and left Books connected.
  const handleZohoBooksDisconnect = async () => {
    setIsDisconnectingZoho(true);
    try {
      await apiFetch('/api/zoho-books/disconnect', { method: 'DELETE' });
      setZohoBooksStatus(prev => ({ ...prev!, connected: false }));
      setZohoBooksNotice({ type: 'success', message: 'Déconnecté de Zoho Books.' });
    } catch {
      setZohoBooksNotice({ type: 'error', message: t('zoho_connect_error') });
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
      // The endpoint returns { pushed, pulled, errors } — reading `data.synced`
      // meant this always reported "0 entrées synchronisées" after a successful sync.
      setZohoBooksNotice({ type: 'success', message: `Synchronisation Zoho Books réussie — ${data.pushed ?? 0} envoyées, ${data.pulled ?? 0} importées.` });
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

  // Shared by every section's save action below. Races the request against a
  // 30s deadline and aborts it if that fires — otherwise a save that's merely
  // slow keeps running in the background after the user is told it "failed",
  // and can land moments later with no visible confirmation, silently
  // desyncing what's shown from what's actually stored (and setting up a
  // retry to clobber/duplicate it).
  //
  // The deadline only counts time the tab is actually visible: configuring an
  // integration typically means tabbing away to the provider's console to
  // copy a Client ID/Secret, then back to paste and hit Save. A plain
  // wall-clock timer keeps running while the tab is hidden, so it can fire the
  // instant the user returns — reporting (and, worse, aborting) a save that
  // was actually about to succeed in well under a second, with nothing slow
  // or broken on the server at all.
  //
  // 45s (not 30s): apiFetch's own getAccessToken() budgets up to
  // AUTH_TIMEOUT_MS (src/lib/authToken.ts) twice in the worst case
  // (getSession() then refreshSession()) before falling back to an
  // unauthenticated request — on a slow network (e.g. a corporate VPN, seen
  // in production) that alone can approach 30s, leaving no room for the
  // actual save. 45s gives a legitimately slow-but-working network a
  // realistic chance instead of cutting it off mid-auth-check.
  const apiPutWithDeadline = async <T,>(url: string, body: any): Promise<T> => {
    let settled = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let rejectDeadline!: (err: Error) => void;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const armDeadline = () => {
      clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => {
        controller.abort();
        rejectDeadline(new Error('Délai dépassé (45s). Vérifiez votre connexion et réessayez.'));
      }, 45_000);
    };
    const onVisibilityChange = () => {
      if (settled) return;
      if (document.hidden) clearTimeout(deadlineTimer);
      else armDeadline();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    armDeadline();
    try {
      return await Promise.race([
        apiFetch<T>(url, { method: 'PUT', body: JSON.stringify(body), signal: controller.signal }),
        deadline,
      ]);
    } finally {
      settled = true;
      clearTimeout(deadlineTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };

  // PUTs only the given subset of tenant settings fields — never the whole
  // `settings` object — so saving e.g. the Zoho panel can never be blocked by,
  // or block, an unrelated section such as SMTP or Informations du cabinet.
  const putSettingsFields = async (fields: Record<string, any>) => {
    await apiPutWithDeadline('/api/settings', fields);
    db.settings.put({ ...settings, ...fields }).catch(() => {});
  };

  // Generic per-section save: updates `sectionStatus[key]` for the section's
  // own "Enregistrer" button, and returns the error message on failure (or
  // null on success) so callers that need to chain another step (e.g.
  // "Connecter Zoho" saving credentials before starting the OAuth redirect)
  // can bail out cleanly without depending on a stale state closure.
  const saveSection = async (key: string, fields: Record<string, any>): Promise<string | null> => {
    setSectionStatus(prev => ({ ...prev, [key]: { saving: true, error: null, success: false } }));
    try {
      await putSettingsFields(fields);
      setSectionStatus(prev => ({ ...prev, [key]: { saving: false, error: null, success: true } }));
      setTimeout(() => setSectionStatus(prev => ({ ...prev, [key]: { ...prev[key], success: false } })), 3000);
      return null;
    } catch (err: any) {
      const message = err?.message || 'Erreur lors de la sauvegarde.';
      console.error(`[Settings save:${key}]`, err);
      setSectionStatus(prev => ({ ...prev, [key]: { saving: false, error: message, success: false } }));
      return message;
    }
  };

  // Renders a small self-contained "Enregistrer" button + status for one
  // section, reading/writing `sectionStatus[key]`.
  const renderSaveButton = (key: string, onSave: () => void, label = 'Enregistrer') => {
    const status = sectionStatus[key] || { saving: false, error: null, success: false };
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" disabled={status.saving} onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-60"
          style={status.success ? { background: 'var(--tblr-success)', color: '#fff' } : { background: 'var(--tblr-primary)', color: '#fff' }}>
          {status.saving ? <IconLoader2 size={13} className="animate-spin" /> : status.success ? <IconCircleCheck size={13} /> : null}
          {status.saving ? 'Enregistrement...' : status.success ? 'Enregistré' : label}
        </button>
        {status.error && <span className="text-xs font-medium" style={{ color: 'var(--tblr-danger)' }}>{status.error}</span>}
      </div>
    );
  };

  // Profile fields (avatar, phone, job title, "my email settings", ...) live
  // on the user's own profile row, entirely separate from tenant `settings` —
  // its own endpoint and its own section, so it can never be affected by (or
  // affect) any tenant-settings section above.
  const saveProfile = async () => {
    if (!currentUser) return;
    setSectionStatus(prev => ({ ...prev, profile: { saving: true, error: null, success: false } }));
    try {
      await apiPutWithDeadline(`/api/team/${currentUser.id}`, userSettings);
      setCurrentUser({ ...currentUser, ...userSettings } as any);
      setSectionStatus(prev => ({ ...prev, profile: { saving: false, error: null, success: true } }));
      setTimeout(() => setSectionStatus(prev => ({ ...prev, profile: { ...prev.profile, success: false } })), 3000);
    } catch (err: any) {
      console.error('[Settings save:profile]', err);
      setSectionStatus(prev => ({ ...prev, profile: { saving: false, error: err?.message || 'Erreur lors de la sauvegarde.', success: false } }));
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
    if (id === 'superpdp') return !!(superpdpStatus?.connected);
    if (id === 'chorus_pro') return !!(chorusProStatus?.connected);
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

  const zohoSharedFields = () => ({
    zoho_client_id: settings.zoho_client_id,
    zoho_client_secret: settings.zoho_client_secret,
    zoho_data_center: settings.zoho_data_center,
  });

  // GET /api/settings never echoes the actual secret back (see SECRET_COLS,
  // server/routes/settings.ts) — only whether one is already stored, via
  // zoho_client_secretSet. Without this, settings.zoho_client_secret is
  // always blank right after a page load even when a secret is already
  // saved, permanently disabling "Connecter Zoho" until the user retypes it.
  const hasZohoSecret = !!settings.zoho_client_secret || !!(settings as any).zoho_client_secretSet;

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
          {renderSaveButton('zoho_invoice', () => saveSection('zoho_invoice', { ...zohoSharedFields(), zoho_org_id: settings.zoho_org_id }))}
          <a href="https://api-console.zoho.com/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
            <IconExternalLink size={13} /> Console API Zoho
          </a>
          {!zohoStatus?.connected ? (
            <button
              type="button"
              disabled={!settings.zoho_client_id || !hasZohoSecret || !settings.zoho_org_id}
              onClick={async () => {
                // window.location.href = '/api/zoho/auth' used to navigate straight to our
                // own route — a bare browser navigation carries no JWT, so it 401'd before
                // ever reaching Zoho. apiFetch attaches the JWT; the server returns the
                // consent URL as JSON, and we navigate to Zoho ourselves.
                const saveErr = await saveSection('zoho_invoice', { ...zohoSharedFields(), zoho_org_id: settings.zoho_org_id });
                if (saveErr) { setZohoNotice({ type: 'error', message: saveErr }); return; }
                try {
                  const data = await apiFetch<{ url: string }>('/api/zoho/auth');
                  window.location.href = data.url;
                } catch (err: any) {
                  setZohoNotice({ type: 'error', message: err.message || 'Erreur lors de la connexion à Zoho' });
                }
              }}
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
            {zohoBooksCallbackUrl || `${window.location.origin}/api/zoho-books/callback`}
          </code>
          <p className="mt-1 opacity-75">URL <strong>différente</strong> de celle de Zoho Invoice : ajoutez les deux comme « Authorized Redirect URIs » dans votre app Zoho, ainsi que le scope <code className="font-mono px-1 rounded" style={{ background: 'var(--tblr-primary-lt)' }}>ZohoBooks.fullaccess.all</code>.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {renderSaveButton('zoho_books', () => saveSection('zoho_books', { ...zohoSharedFields(), zoho_books_org_id: settings.zoho_books_org_id }))}
          <a href="https://api-console.zoho.com/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
            <IconExternalLink size={13} /> Console API Zoho
          </a>
          {!zohoBooksStatus?.connected ? (
            <button
              type="button"
              disabled={!settings.zoho_client_id || !hasZohoSecret || !(settings.zoho_books_org_id || settings.zoho_org_id)}
              onClick={async () => {
                const saveErr = await saveSection('zoho_books', { ...zohoSharedFields(), zoho_books_org_id: settings.zoho_books_org_id });
                if (saveErr) { setZohoBooksNotice({ type: 'error', message: saveErr }); return; }
                try {
                  const data = await apiFetch<{ url: string }>('/api/zoho-books/auth');
                  window.location.href = data.url;
                } catch (err: any) {
                  setZohoBooksNotice({ type: 'error', message: err.message || 'Erreur lors de la connexion à Zoho Books' });
                }
              }}
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
              <button type="button" onClick={handleZohoBooksDisconnect} disabled={isDisconnectingZoho}
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
        {renderSaveButton('maf', () => saveSection('maf', {
          maf_enabled: (settings as any).maf_enabled,
          maf_numero_adherent: (settings as any).maf_numero_adherent,
          maf_taux_contrat_permil: (settings as any).maf_taux_contrat_permil,
          maf_declaration_year: (settings as any).maf_declaration_year,
        }))}
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
          {renderSaveButton('odoo', () => saveSection('odoo', odooFields()))}
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
          {renderSaveButton('ragic', () => saveSection('ragic', ragicFields()))}
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

    if (pluginId === 'superpdp') return (
      <div className="space-y-4">
        {superpdpNotice && (
          <div className="text-sm p-3 rounded-lg border" style={superpdpNotice.type === 'success'
            ? { background: '#d3f9d8', borderColor: '#a9e9b0', color: '#2f9e44' }
            : { background: '#ffe0e0', borderColor: '#fca5a5', color: '#c92a2a' }}>
            {superpdpNotice.message}
          </div>
        )}
        <div className="p-3 rounded-lg text-xs" style={{ background: '#e7f5ff', border: '1px solid #a5d8ff', color: '#1971c2' }}>
          <p className="font-bold mb-1">Réforme française de la facturation électronique</p>
          <p>Super PDP est un Partenaire de Dématérialisation (PDP) agréé par la DGFiP. Il transmet vos factures B2B au Portail Public de Facturation (PPF) selon la norme EN 16931. Créez un compte sur <strong>superpdp.tech</strong>, puis récupérez votre <strong>Client ID</strong> et <strong>Client Secret</strong> dans votre espace client.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Client ID OAuth2</label>
            <input
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="votre-client-id"
              value={(settings as any).superpdp_client_id || ''}
              onChange={e => setSettings({ ...settings, superpdp_client_id: e.target.value } as any)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Client Secret OAuth2</label>
            <input
              type="password"
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="••••••••"
              value={(settings as any).superpdp_client_secret || ''}
              onChange={e => setSettings({ ...settings, superpdp_client_secret: e.target.value } as any)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="superpdp_sandbox"
            checked={(settings as any).superpdp_sandbox ?? true}
            onChange={e => setSettings({ ...settings, superpdp_sandbox: e.target.checked } as any)}
            className="rounded"
          />
          <label htmlFor="superpdp_sandbox" className="text-sm" style={{ color: 'var(--tblr-text)' }}>
            Mode sandbox (test) — décochez pour passer en production
          </label>
        </div>
        <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
          <p className="font-bold mb-1">Champs utilisés pour le vendeur (depuis vos Paramètres)</p>
          <p>Nom agence · Adresse · Email · SIRET · N° TVA. Complétez ces champs dans l'onglet <strong>Général</strong> avant d'envoyer des factures.</p>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {renderSaveButton('superpdp', () => saveSection('superpdp', superpdpFields()))}
          <button
            type="button"
            disabled={isTestingSuperpdp}
            onClick={handleSuperpdpTest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#e7f5ff', color: '#1971c2' }}>
            {isTestingSuperpdp ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnected size={13} />} Tester la connexion
          </button>
          {superpdpStatus?.connected && (
            <button
              type="button"
              disabled={isDisconnectingSuperpdp}
              onClick={handleSuperpdpDisconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{ background: '#ffe0e0', color: 'var(--tblr-danger)' }}>
              {isDisconnectingSuperpdp ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnectedX size={13} />} Déconnecter
            </button>
          )}
        </div>
      </div>
    );

    if (pluginId === 'chorus_pro') return (
      <div className="space-y-4">
        {chorusProNotice && (
          <div className="text-sm p-3 rounded-lg border" style={chorusProNotice.type === 'success'
            ? { background: '#d3f9d8', borderColor: '#a9e9b0', color: '#2f9e44' }
            : { background: '#ffe0e0', borderColor: '#fca5a5', color: '#c92a2a' }}>
            {chorusProNotice.message}
          </div>
        )}
        <div className="p-3 rounded-lg text-xs" style={{ background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4338ca' }}>
          <p className="font-bold mb-1">Facturation électronique du secteur public (B2G)</p>
          <p>Chorus Pro est obligatoire pour toute facture de maîtrise d'œuvre ou de travaux adressée à une maîtrise d'ouvrage publique. Créez une <strong>habilitation API OAuth2</strong> sur <strong>piste.gouv.fr</strong> (Client ID / Client Secret) puis un <strong>compte technique</strong> dans votre espace Chorus Pro (Raccordements → API), et renseignez les deux ci-dessous.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Client ID PISTE (OAuth2)</label>
            <input
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="votre-client-id-piste"
              value={(settings as any).chorus_pro_piste_client_id || ''}
              onChange={e => setSettings({ ...settings, chorus_pro_piste_client_id: e.target.value } as any)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Client Secret PISTE (OAuth2)</label>
            <input
              type="password"
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="••••••••"
              value={(settings as any).chorus_pro_piste_client_secret || ''}
              onChange={e => setSettings({ ...settings, chorus_pro_piste_client_secret: e.target.value } as any)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Identifiant compte technique Chorus Pro</label>
            <input
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="TECH_1_xxxxx@cpro.fr"
              value={(settings as any).chorus_pro_technical_login || ''}
              onChange={e => setSettings({ ...settings, chorus_pro_technical_login: e.target.value } as any)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Mot de passe compte technique</label>
            <input
              type="password"
              className="w-full p-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              placeholder="••••••••"
              value={(settings as any).chorus_pro_technical_password || ''}
              onChange={e => setSettings({ ...settings, chorus_pro_technical_password: e.target.value } as any)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="chorus_pro_sandbox"
            checked={(settings as any).chorus_pro_sandbox ?? true}
            onChange={e => setSettings({ ...settings, chorus_pro_sandbox: e.target.checked } as any)}
            className="rounded"
          />
          <label htmlFor="chorus_pro_sandbox" className="text-sm" style={{ color: 'var(--tblr-text)' }}>
            Mode sandbox (environnement de qualification) — décochez pour passer en production
          </label>
        </div>
        <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
          <p className="font-bold mb-1">Champs utilisés pour le fournisseur (depuis vos Paramètres)</p>
          <p>Nom agence · Adresse · Email · SIRET · N° TVA. Complétez ces champs dans l'onglet <strong>Général</strong>. Le SIRET du destinataire (structure publique), le code du service exécutant et le numéro d'engagement sont demandés à l'envoi de chaque facture, depuis la page <strong>Factures</strong>.</p>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {renderSaveButton('chorus_pro', () => saveSection('chorus_pro', chorusProFields()))}
          <button
            type="button"
            disabled={isTestingChorusPro}
            onClick={handleChorusProTest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#eef2ff', color: '#4338ca' }}>
            {isTestingChorusPro ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnected size={13} />} Tester la connexion
          </button>
          {chorusProStatus?.connected && (
            <button
              type="button"
              disabled={isDisconnectingChorusPro}
              onClick={handleChorusProDisconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{ background: '#ffe0e0', color: 'var(--tblr-danger)' }}>
              {isDisconnectingChorusPro ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlugConnectedX size={13} />} Déconnecter
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
            {renderSaveButton('agency', () => saveSection('agency', {
              agencyName: settings.agencyName, address: settings.address, phone: settings.phone,
              email: settings.email, siret: settings.siret, vatNumber: settings.vatNumber,
              seller_iban: settings.seller_iban, seller_bic: settings.seller_bic, currency: settings.currency,
              logoUrl: settings.logoUrl,
            }))}
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
              { label: 'Numéro d\'affaire (projets)', key: 'numPrefixAffaire' as const, presets: ['AFF', 'PROJ', ''] },
            ] as const).map(({ label, key, presets }) => {
              const year = new Date().getFullYear();
              const prefix = settings[key] || presets[0];
              // Le numéro d'affaire (project_code) suit son propre format
              // PRÉFIXE-AA-NNN (année sur 2 chiffres, voir server/routes/projects.ts) —
              // il sert aussi de base à la référence par affaire des factures
              // d'acompte (ex: 26014-ACO-02, voir Invoices.tsx).
              const preview = key === 'numPrefixAffaire'
                ? (prefix ? `${prefix}-${String(year).slice(-2)}-001` : `${String(year).slice(-2)}001`)
                : `${prefix}-${year}-001`;
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
            {renderSaveButton('numbering', () => saveSection('numbering', {
              numPrefixDevis: settings.numPrefixDevis, numPrefixFacture: settings.numPrefixFacture,
              numPrefixHonoraires: settings.numPrefixHonoraires, numPrefixAffaire: settings.numPrefixAffaire,
            }))}
          </div>

          {/* ── RH : congés par défaut ── */}
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>RH — Congés par défaut</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>
                Allocation annuelle par défaut appliquée aux employés sans solde personnalisé. Basé sur la convention collective nationale des entreprises d'architecture (IDCC 2332) : 2,5 jours ouvrables/mois de congés payés (30j/an max) ; les RTT dépendent de l'horaire hebdomadaire contractuel (0 à 35h, jusqu'à 23j à 39h) et se règlent par employé dans la page Congés.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Congés payés (jours/an)</label>
                <input type="number" className="w-full p-2 rounded-lg text-sm"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  value={settings.defaultLeaveDaysCongesPayes}
                  onChange={e => setSettings({ ...settings, defaultLeaveDaysCongesPayes: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>RTT par défaut (jours/an)</label>
                <input type="number" className="w-full p-2 rounded-lg text-sm"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  value={settings.defaultLeaveDaysRtt}
                  onChange={e => setSettings({ ...settings, defaultLeaveDaysRtt: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            {renderSaveButton('leave', () => saveSection('leave', {
              defaultLeaveDaysCongesPayes: settings.defaultLeaveDaysCongesPayes,
              defaultLeaveDaysRtt: settings.defaultLeaveDaysRtt,
            }))}
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
              <div className="flex items-center gap-2 flex-wrap">
                {renderSaveButton('smtp', () => saveSection('smtp', {
                  smtpHost: settings.smtpHost, smtpPort: settings.smtpPort, smtpUser: settings.smtpUser, smtpPass: settings.smtpPass,
                }))}
                <button type="button" onClick={handleTestSmtp}
                  disabled={isTestingSmtp || !settings.smtpHost || !settings.smtpUser || !settings.smtpPass}
                  className="w-fit flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
                  {isTestingSmtp ? <><IconLoader2 className="w-4 h-4 animate-spin" />{t('settings_smtp_testing')}</> : t('settings_smtp_test_btn')}
                </button>
              </div>
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
            {renderSaveButton('email', () => saveSection('email', {
              senderOption: settings.senderOption, defaultEmailTemplate: settings.defaultEmailTemplate,
            }))}
          </div>

          {/* ── Domaines et catégories ── */}
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="flex items-center gap-2">
              <IconTag size={16} style={{ color: 'var(--tblr-muted)' }} />
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('settings_categories_title')}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('settings_categories_desc')}</p>
              </div>
            </div>
            <form onSubmit={handleAddProjectCategory} className="flex gap-2">
              <input
                className="flex-1 p-2 rounded-lg text-sm"
                style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                placeholder={t('settings_categories_placeholder')}
                value={newProjectCategoryName}
                onChange={e => setNewProjectCategoryName(e.target.value)}
              />
              <button type="submit" className="px-4 py-2 rounded-lg text-sm font-bold transition-colors" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
                {t('btn_add')}
              </button>
            </form>
            <div className="space-y-1.5">
              {projectCategories.length === 0 && (
                <p className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('settings_categories_empty')}</p>
              )}
              {projectCategories.map(cat => (
                <div key={cat.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                  <span className="text-sm" style={{ color: 'var(--tblr-text)' }}>{cat.name}</span>
                  <button type="button" onClick={() => handleDeleteProjectCategory(cat.id)} className="p-1 rounded hover:bg-red-50 transition-colors" style={{ color: 'var(--tblr-danger)' }}>
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Archivage automatique des notifications ── */}
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="flex items-center gap-2">
              <IconArchive size={16} style={{ color: 'var(--tblr-muted)' }} />
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('settings_notif_archive_title')}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('settings_notif_archive_desc')}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('settings_notif_archive_default_label')}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number" min={0}
                    className="w-20 p-1.5 rounded-lg text-sm text-right"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    placeholder={t('settings_notif_archive_never')}
                    value={settings.notificationArchiveDays.default ?? ''}
                    onChange={e => setArchiveDays('default', e.target.value)}
                  />
                  <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('settings_notif_archive_days_unit')}</span>
                </div>
              </div>
              {ACTIVITY_ARCHIVE_CATEGORIES.map(cat => (
                <div key={cat} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                  <span className="text-sm" style={{ color: 'var(--tblr-text)' }}>{cat}</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={0}
                      className="w-20 p-1.5 rounded-lg text-sm text-right"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      placeholder={t('settings_notif_archive_never')}
                      value={settings.notificationArchiveDays[cat] ?? ''}
                      onChange={e => setArchiveDays(cat, e.target.value)}
                    />
                    <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('settings_notif_archive_days_unit')}</span>
                  </div>
                </div>
              ))}
            </div>
            {renderSaveButton('notifications', () => saveSection('notifications', {
              notificationArchiveDays: settings.notificationArchiveDays,
            }))}
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

          {/* ── Archivage — RGPD : export complet de l'activité du cabinet ── */}
          <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Archivage</h2>
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
              Téléchargez une archive ZIP contenant toute l'activité du cabinet dans un format exploitable : un fichier CSV
              par table de données (projets, factures, contacts, documents, réunions...) et l'ensemble des fichiers déposés
              (documents, plans, CV, photos, pièces jointes). Utile pour vos archives légales — notamment comptables,
              conservation obligatoire de 10 ans en droit français — indépendamment de toute suppression de compte.
            </p>
            <button
              type="button"
              onClick={handleExportTenantData}
              disabled={isExportingTenant}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
            >
              {isExportingTenant ? <IconLoader2 size={13} className="animate-spin" /> : <IconDownload size={13} />}
              {isExportingTenant ? 'Génération de l\'archive...' : 'Exporter toutes les données du cabinet'}
            </button>
          </div>

          {/* ── Zone dangereuse — RGPD : fermeture du cabinet ── */}
          <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-danger, #e03131)', boxShadow: 'var(--tblr-shadow)' }}>
            <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--tblr-danger, #e03131)' }}>
              <IconAlertTriangle size={15} /> Zone dangereuse
            </h2>
            {tenantDeletion?.deletion_requested_at ? (
              <div className="space-y-2">
                <p className="text-sm" style={{ color: 'var(--tblr-text)' }}>
                  Fermeture du cabinet demandée le {new Date(tenantDeletion.deletion_requested_at).toLocaleDateString('fr-FR')}.
                  Toutes les données seront définitivement supprimées le{' '}
                  {new Date(new Date(tenantDeletion.deletion_requested_at).getTime() + tenantDeletion.grace_period_days * 86400000).toLocaleDateString('fr-FR')}
                  {' '}sauf annulation avant cette date.
                </p>
                <button
                  type="button"
                  onClick={handleCancelTenantDeletion}
                  disabled={isCancelingDeletion}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                  style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
                >
                  {isCancelingDeletion ? <IconLoader2 size={13} className="animate-spin" /> : null} Annuler la fermeture
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                  Supprime définitivement le cabinet et toutes ses données (projets, factures, documents, contacts, comptes utilisateurs...)
                  après un délai de grâce de 30 jours, annulable à tout moment d'ici là. Utilisez le bouton « Exporter toutes les données
                  du cabinet » ci-dessus au préalable : la loi française impose la conservation des documents comptables pendant 10 ans,
                  indépendamment de cette suppression.
                </p>
                <button
                  type="button"
                  onClick={handleRequestTenantDeletion}
                  disabled={isRequestingDeletion}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors disabled:opacity-50"
                  style={{ background: 'var(--tblr-danger, #e03131)' }}
                >
                  {isRequestingDeletion ? <IconLoader2 size={13} className="animate-spin" /> : <IconTrash size={13} />} Demander la fermeture du cabinet
                </button>
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
            <button type="button" onClick={() => changeLanguageLazy('fr')}
              className="px-5 py-2 text-sm font-medium transition-colors"
              style={i18n.language.startsWith('fr')
                ? { background: 'var(--tblr-primary)', color: '#fff' }
                : { background: 'var(--tblr-surface)', color: 'var(--tblr-muted)' }}>
              Français
            </button>
            <button type="button" onClick={() => changeLanguageLazy('en')}
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

      {/* Informations utilisateur + Mes paramètres email share the same profile
          row (PUT /api/team/:id) — one save action for both, entirely separate
          from every tenant-settings section above. */}
      {renderSaveButton('profile', () => saveProfile())}
    </div>
  );
}
