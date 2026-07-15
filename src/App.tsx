import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate, Navigate, Outlet } from 'react-router-dom';
import {
  IconSearch,
  IconBell,
  IconSettings,
  IconMenu2,
  IconSun,
  IconMoon,
  IconCloudOff,
  IconCloudUpload,
  IconCheck,
  IconLogout,
  IconMessageCircle,
  IconUser,
} from '@tabler/icons-react';
import { ArchiOfficeLogo } from './components/ArchiOfficeLogo';
import { UpdateBanner } from './components/UpdateBanner';
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { useTranslation } from 'react-i18next';
import { ThemeProvider, useTheme } from './components/theme-provider';
import { UserProvider, useUser } from './UserContext';
import { Sidebar, NAV_ITEMS } from './components/Sidebar';
import { apiFetch } from './lib/api';
import { isOfflineBuild } from './lib/authToken';
import { getSyncStatus, triggerSyncNow, SyncStatusResponse } from './lib/cloudSync';
import './i18n';

// Pages — lazy-loaded so each route's JS is only fetched when it's visited,
// instead of every page (ProjectDetail alone is ~270KB) landing in one
// upfront bundle.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Projects = lazy(() => import('./pages/Projects'));
const Proposals = lazy(() => import('./pages/Proposals'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Tenders = lazy(() => import('./pages/Tenders'));
const Specifications = lazy(() => import('./pages/Specifications'));
const Team = lazy(() => import('./pages/Team'));
const Gantt = lazy(() => import('./pages/Gantt'));
const Kanban = lazy(() => import('./pages/Kanban'));
const Contacts = lazy(() => import('./pages/Contacts'));
const ProjectTemplates = lazy(() => import('./pages/ProjectTemplates'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const References = lazy(() => import('./pages/References'));
const Documents = lazy(() => import('./pages/Documents'));
const Settings = lazy(() => import('./pages/Settings'));
const Billing = lazy(() => import('./pages/Billing'));
const TenderDetail = lazy(() => import('./pages/TenderDetail'));
const ProposalModule = lazy(() => import('./components/ProposalModule'));
const Login = lazy(() => import('./pages/Login'));
const CloudImportProgress = lazy(() => import('./pages/CloudImportProgress'));
const Register = lazy(() => import('./pages/Register'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const AgencySetup = lazy(() => import('./pages/AgencySetup'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfUse = lazy(() => import('./pages/TermsOfUse'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Profile = lazy(() => import('./pages/Profile'));
const Messages = lazy(() => import('./pages/Messages'));
const Reunions = lazy(() => import('./pages/Reunions'));
const OrdresDeService = lazy(() => import('./pages/OrdresDeService'));
const Contrats = lazy(() => import('./pages/Contrats'));
const GoogleAuthCallback = lazy(() => import('./pages/GoogleAuthCallback'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const MafDeclaration = lazy(() => import('./pages/MafDeclaration'));
const SuperPDPPortal = lazy(() => import('./pages/SuperPDPPortal'));
const ChorusProPortal = lazy(() => import('./pages/ChorusProPortal'));
// Agent UI — @zinkh/archioffice-agents (licence propriétaire)
import { AgentChatProvider, Agents, AgentConfig } from '@zinkh/archioffice-agents/client';

function SyncStatus() {
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [cloudStatus, setCloudStatus] = useState<SyncStatusResponse | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Only the offline desktop build has anything to poll here — the regular
  // cloud web app keeps the simple navigator.onLine indicator below unchanged.
  useEffect(() => {
    if (!isOfflineBuild()) return;
    let cancelled = false;
    const poll = () => { getSyncStatus().then((s) => { if (!cancelled) setCloudStatus(s); }); };
    poll();
    const interval = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (isOfflineBuild() && cloudStatus?.linked) {
    const handleSyncNow = async () => {
      setSyncing(true);
      try {
        await triggerSyncNow();
        setCloudStatus(await getSyncStatus());
      } finally {
        setSyncing(false);
      }
    };
    const statusLabel = cloudStatus.pendingPushCount > 0
      ? t('sync_status_pending', { count: cloudStatus.pendingPushCount })
      : t('sync_status_last_sync', {
          time: cloudStatus.lastSyncAt ? new Date(cloudStatus.lastSyncAt).toLocaleTimeString() : '—',
        });
    return (
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded"
          style={cloudStatus.isOnline
            ? { background: '#d3f9d8', color: '#2f9e44', border: '1px solid #b2f2bb' }
            : { background: '#fff4e6', color: '#f76707', border: '1px solid #ffd8a8' }}
        >
          {cloudStatus.isOnline ? <IconCheck size={13} /> : <IconCloudOff size={13} />}
          {statusLabel}
        </div>
        <button
          type="button"
          onClick={handleSyncNow}
          disabled={syncing}
          title={t('sync_status_now_btn')}
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          <IconCloudUpload size={16} />
        </button>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded"
        style={{ background: '#fff4e6', color: '#f76707', border: '1px solid #ffd8a8' }}
      >
        <IconCloudOff size={13} />
        {t('sync_offline')}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded"
      style={{ background: '#d3f9d8', color: '#2f9e44', border: '1px solid #b2f2bb' }}
    >
      <IconCheck size={13} />
      {t('sync_online')}
    </div>
  );
}

function Header() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { currentUser, headerTitle, setHeaderTitle, signOut } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ projects: any[]; contacts: any[]; tenders: any[]; invoices: any[] }>({ projects: [], contacts: [], tenders: [], invoices: [] });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const item = NAV_ITEMS.find(i => i.path === location.pathname);
    if (item) {
      setHeaderTitle(t(item.name));
    }
    // Reset unread count when visiting notifications page
    if (location.pathname === '/notifications') {
      setUnreadCount(0);
    }
    if (location.pathname === '/messages') {
      setUnreadMessages(0);
    }
  }, [location.pathname, t, setHeaderTitle]);

  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const data = await apiFetch<{ count: number }>('/api/notifications/unread-count');
        setUnreadCount(data.count || 0);
      } catch {
        // ignore
      }
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchUnreadMessages = async () => {
      try {
        const data = await apiFetch<{ count: number }>('/api/messages/unread-count');
        setUnreadMessages(data.count || 0);
      } catch {
        // ignore
      }
    };
    fetchUnreadMessages();
    const interval = setInterval(fetchUnreadMessages, 30000);
    return () => clearInterval(interval);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults({ projects: [], contacts: [], tenders: [], invoices: [] });
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Escape / Ctrl+K keyboard shortcuts and outside click
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
        setSearchQuery('');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => document.getElementById('global-search-input')?.focus(), 50);
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, []);

  /* ── Tabler navbar: opaque, 56px, border-bottom ── */
  return (
    <>
    <header
      className="sticky top-0 z-40 w-full border-b"
      style={{
        background: 'var(--tblr-surface)',
        borderColor: 'var(--tblr-border)',
        height: 'var(--tblr-navbar-h)',
        boxShadow: 'var(--tblr-shadow)',
      }}
    >
      <div className="h-full px-4 flex items-center justify-between gap-4">

        {/* Left: hamburger (mobile) + page title (desktop) */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            className="md:hidden p-1 rounded transition-colors"
            style={{ color: 'var(--tblr-muted)' }}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <IconMenu2 size={20} />
          </button>
          <Link
            to="/"
            className="md:hidden flex items-center gap-2 font-bold text-sm"
            style={{ color: 'var(--tblr-text)' }}
          >
            <ArchiOfficeLogo size={24} />
            ArchiOffice
          </Link>
          <h1
            className="hidden md:block text-sm font-semibold truncate"
            style={{ color: 'var(--tblr-text)' }}
          >
            {headerTitle}
          </h1>
        </div>

        {/* Right: sync, search, theme, notifications, avatar */}
        <div className="flex items-center gap-1">

          {/* Sync status */}
          <div className="hidden lg:flex mr-2">
            <SyncStatus />
          </div>

          {/* Search */}
          <div ref={searchRef} className="relative hidden md:flex">
            <div className="relative">
              <IconSearch
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--tblr-muted)' }}
              />
              <input
                id="global-search-input"
                type="text"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setIsSearchOpen(true); }}
                onFocus={() => setIsSearchOpen(true)}
                placeholder={`${t('search_placeholder')} (Ctrl+K)`}
                style={{
                  background: 'var(--tblr-surface-2)',
                  border: '1px solid var(--tblr-border)',
                  color: 'var(--tblr-text)',
                  borderRadius: 'var(--tblr-radius)',
                  fontSize: '13px',
                }}
                className="pl-8 pr-3 py-1.5 w-52 outline-none transition-[width,border-color,box-shadow] focus:w-72 focus:border-[var(--tblr-primary)] focus:shadow-[0_0_0_3px_var(--tblr-primary-lt)]"
              />
              {isSearching && (
                <div
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }}
                />
              )}
            </div>

            {/* Search dropdown — Tabler card style */}
            {isSearchOpen && searchQuery.length >= 2 && (
              <div
                className="absolute top-full mt-1 left-0 w-96 z-50 overflow-hidden max-h-[70vh] overflow-y-auto"
                style={{
                  background: 'var(--tblr-surface)',
                  border: '1px solid var(--tblr-border)',
                  borderRadius: 'var(--tblr-radius)',
                  boxShadow: '0 4px 16px rgba(0,0,0,.12)',
                }}
              >
                {Object.entries(searchResults).every(([, arr]) => (arr as any[]).length === 0) && !isSearching ? (
                  <div className="p-4 text-sm text-center" style={{ color: 'var(--tblr-muted)' }}>
                    Aucun résultat pour «&nbsp;{searchQuery}&nbsp;»
                  </div>
                ) : (
                  <div>
                    {([
                      { key: 'projects',  label: 'Projets',         path: (id: string) => `/projects/${id}`, color: '#206bc4', letter: 'P' },
                      { key: 'contacts',  label: 'Contacts',        path: () => '/contacts',                 color: '#2fb344', letter: 'C' },
                      { key: 'tenders',   label: "Appels d'offres", path: (id: string) => `/tenders/${id}`,  color: '#f76707', letter: 'A' },
                      { key: 'invoices',  label: 'Factures',        path: () => '/invoices',                 color: '#ae3ec9', letter: 'F' },
                    ] as const).map(({ key, label, path, color, letter }) => {
                      const items = (searchResults as any)[key] as any[];
                      if (!items?.length) return null;
                      return (
                        <div key={key}>
                          <div
                            className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b"
                            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', borderColor: 'var(--tblr-border)' }}
                          >
                            {label}
                          </div>
                          {items.map((item: any) => (
                            <Link
                              key={item.id}
                              to={path(item.id)}
                              onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }}
                              className="flex items-center gap-3 px-3 py-2.5 transition-colors"
                              style={{ borderBottom: '1px solid var(--tblr-border)' }}
                              onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                              onMouseOut={e => (e.currentTarget.style.background = '')}
                            >
                              <span
                                className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold text-white shrink-0"
                                style={{ background: color }}
                              >
                                {letter}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium truncate" style={{ color: 'var(--tblr-text)' }}>
                                  {item._label}
                                </p>
                                {(item.client || item.email) && (
                                  <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>
                                    {item.client || item.email}
                                  </p>
                                )}
                              </div>
                            </Link>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--tblr-muted)' }}
            onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
            onMouseOut={e => (e.currentTarget.style.background = '')}
            title={theme === 'dark' ? t('theme_light') : t('theme_dark')}
          >
            {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>

          {/* Messages */}
          <button
            onClick={() => navigate('/messages')}
            className="p-1.5 rounded transition-colors relative"
            style={{ color: 'var(--tblr-muted)' }}
            onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
            onMouseOut={e => (e.currentTarget.style.background = '')}
            title="Messages"
          >
            <IconMessageCircle size={18} />
            {unreadMessages > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none"
                style={{ background: 'var(--tblr-danger)' }}
              >
                {unreadMessages > 99 ? '99+' : unreadMessages}
              </span>
            )}
          </button>

          {/* Notifications */}
          <button
            onClick={() => navigate('/notifications')}
            className="p-1.5 rounded transition-colors relative"
            style={{ color: 'var(--tblr-muted)' }}
            onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
            onMouseOut={e => (e.currentTarget.style.background = '')}
            title="Notifications"
          >
            <IconBell size={18} />
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none"
                style={{ background: 'var(--tblr-danger)' }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Avatar + user menu */}
          <div className="relative ml-1">
            <button
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center gap-2 p-1 rounded transition-colors"
              onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
              onMouseOut={e => (e.currentTarget.style.background = '')}
            >
              <div className="w-7 h-7 rounded-full overflow-hidden border" style={{ borderColor: 'var(--tblr-border)' }}>
                <img
                  src={currentUser?.avatar || 'https://picsum.photos/seed/arch/32/32'}
                  alt="User"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            </button>

            <AnimatePresence>
              {isUserMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 mt-1 w-52 z-50 overflow-hidden"
                    style={{
                      background: 'var(--tblr-surface)',
                      border: '1px solid var(--tblr-border)',
                      borderRadius: 'var(--tblr-radius)',
                      boxShadow: '0 4px 16px rgba(0,0,0,.12)',
                    }}
                  >
                    <div className="p-3 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                          <img
                            src={currentUser?.avatar || 'https://picsum.photos/seed/arch/32/32'}
                            alt={currentUser?.name}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>
                            {currentUser?.name}
                          </p>
                          <p className="text-[11px] truncate" style={{ color: 'var(--tblr-muted)' }}>
                            {currentUser?.email}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="p-1">
                      <button
                        onClick={() => { navigate('/profile'); setIsUserMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded text-[13px] transition-colors"
                        style={{ color: 'var(--tblr-text)' }}
                        onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                        onMouseOut={e => (e.currentTarget.style.background = '')}
                      >
                        <IconUser size={15} style={{ color: 'var(--tblr-muted)' }} />
                        Mon profil
                      </button>
                      <button
                        onClick={() => { navigate('/settings'); setIsUserMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded text-[13px] transition-colors"
                        style={{ color: 'var(--tblr-text)' }}
                        onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                        onMouseOut={e => (e.currentTarget.style.background = '')}
                      >
                        <IconSettings size={15} style={{ color: 'var(--tblr-muted)' }} />
                        {t('account_settings')}
                      </button>
                      <button
                        onClick={() => { signOut(); setIsUserMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded text-[13px] transition-colors"
                        style={{ color: 'var(--tblr-danger)' }}
                        onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                        onMouseOut={e => (e.currentTarget.style.background = '')}
                      >
                        <IconLogout size={15} />
                        Déconnexion
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

    </header>

      {/* Mobile nav drawer — slides in from left */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 md:hidden"
              style={{ background: 'rgba(0,0,0,0.45)' }}
              onClick={() => setIsMobileMenuOpen(false)}
            />
            {/* Drawer */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed inset-y-0 left-0 z-50 w-72 md:hidden flex flex-col overflow-y-auto"
              style={{ background: 'var(--tblr-surface)', borderRight: '1px solid var(--tblr-border)' }}
            >
              {/* Drawer header */}
              <div
                className="flex items-center gap-2.5 px-4 py-4 border-b shrink-0"
                style={{ borderColor: 'var(--tblr-border)' }}
              >
                <ArchiOfficeLogo size={28} />
                <span className="font-bold text-sm" style={{ color: 'var(--tblr-text)' }}>ArchiOffice</span>
              </div>
              {/* Nav items */}
              <nav className="flex flex-col p-2 gap-0.5 flex-1">
                {NAV_ITEMS.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded text-[13px] font-medium transition-colors',
                        isActive
                          ? 'text-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)]'
                          : 'text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]'
                      )}
                    >
                      <item.icon size={18} />
                      <span>{t(item.name)}</span>
                    </Link>
                  );
                })}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function PageLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--tblr-bg)' }}>
      <div
        className="animate-spin w-7 h-7 border-2 border-t-transparent rounded-full"
        style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }}
      />
    </div>
  );
}

function ProtectedLayout() {
  const { currentUser, isLoading } = useUser();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--tblr-bg)' }}>
        <div
          className="animate-spin w-7 h-7 border-2 border-t-transparent rounded-full"
          style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }}
        />
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Cloud accounts (OAuth signup, or a join-request awaiting approval) can
  // reach this point with no agency attached yet — send them to agency
  // setup instead of into a workspace with no tenant. Offline desktop
  // accounts always have a tenant from local-setup, and tenantId is left
  // `undefined` (not `null`) until /api/me actually answers, so this only
  // fires once we're sure there's really no agency.
  if (!isOfflineBuild() && currentUser.tenantId === null) {
    return <Navigate to="/agency-setup" replace />;
  }

  return (
    <AgentChatProvider>
    <div
      className="flex min-h-screen font-sans overflow-x-hidden"
      style={{ background: 'var(--tblr-bg)', color: 'var(--tblr-text)' }}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />

        <main className="flex-1 min-h-0 px-3 py-4 sm:px-6 sm:py-6 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>

        <footer
          className="border-t mt-auto py-4 px-6"
          style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
        >
          <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row justify-between items-center gap-2 text-[12px]" style={{ color: 'var(--tblr-muted)' }}>
            <div>{t('footer_rights')}</div>
            <div className="flex gap-4">
              <Link to="/privacy" className="hover:underline" style={{ color: 'var(--tblr-muted)' }}>{t('footer_privacy')}</Link>
              <Link to="/terms" className="hover:underline" style={{ color: 'var(--tblr-muted)' }}>{t('footer_terms')}</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
    </AgentChatProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <UserProvider>
        <UpdateBanner />
        <Router>
          <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/cloud-import-progress" element={<CloudImportProgress />} />
            <Route path="/register" element={<Register />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/agency-setup" element={<AgencySetup />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfUse />} />
            <Route path="/auth/google/callback" element={<GoogleAuthCallback />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/references" element={<References />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/proposals" element={<Proposals />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/tenders" element={<Tenders />} />
              <Route path="/tenders/:id" element={<TenderDetail />} />
              <Route path="/specifications" element={<Specifications />} />
              <Route path="/specifications/:specId" element={<Specifications />} />
              <Route path="/team" element={<Team />} />
              <Route path="/gantt" element={<Gantt />} />
              <Route path="/kanban" element={<Kanban />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/templates" element={<ProjectTemplates />} />
              <Route path="/proposal-generator" element={<ProposalModule />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/:userId" element={<Profile />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/reunions" element={<Reunions />} />
              <Route path="/ordres-de-service" element={<OrdresDeService />} />
              <Route path="/contrats" element={<Contrats />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/agents/:id/edit" element={<AgentConfig />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/maf-declaration" element={<MafDeclaration />} />
              <Route path="/superpdp" element={<SuperPDPPortal />} />
              <Route path="/chorus-pro" element={<ChorusProPortal />} />
            </Route>
          </Routes>
          </Suspense>
        </Router>
      </UserProvider>
    </ThemeProvider>
  );
}
