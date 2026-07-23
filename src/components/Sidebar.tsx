import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import {
  IconLayoutDashboard,
  IconBriefcase,
  IconFileText,
  IconUsers,
  IconChartBar,
  IconClipboardCheck,
  IconAddressBook,
  IconFileInvoice,
  IconFileSpreadsheet,
  IconFiles,
  IconSettings,
  IconArchive,
  IconCreditCard,
  IconLayoutKanban,
  IconMessages,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconClipboardList,
  IconCalendarWeek,
  IconContract,
  IconRobot,
  IconShieldLock,
  IconShieldCheck,
  IconCloudUpload,
  IconBuildingBank,
} from '@tabler/icons-react';
import { BrandLogo } from './ArchiOfficeLogo';
import { useUser } from '../UserContext';
import { useSettings } from '../hooks/useSettings';
import { apiFetch } from '../lib/api';

// ── All nav items (still exported for Header mobile menu)
export const NAV_ITEMS = [
  { name: 'dashboard',      path: '/',              icon: IconLayoutDashboard },
  { name: 'projects',       path: '/projects',       icon: IconBriefcase },
  { name: 'references',     path: '/references',     icon: IconArchive },
  { name: 'documents',      path: '/documents',      icon: IconFiles },
  { name: 'proposals',      path: '/proposals',      icon: IconFileSpreadsheet },
  { name: 'invoices',       path: '/invoices',       icon: IconFileInvoice },
  { name: 'tenders',        path: '/tenders',        icon: IconClipboardCheck },
  { name: 'specifications', path: '/specifications', icon: IconFileText },
  { name: 'gantt',          path: '/gantt',          icon: IconChartBar },
  { name: 'calendar',       path: '/calendar',       icon: IconCalendarWeek },
  { name: 'kanban',         path: '/kanban',         icon: IconLayoutKanban },
  { name: 'reunions',       path: '/reunions',        icon: IconMessages },
  { name: 'ordres_de_service', path: '/ordres-de-service', icon: IconClipboardList },
  { name: 'agents',         path: '/agents',         icon: IconRobot },
  { name: 'team',           path: '/team',           icon: IconUsers },
  { name: 'contacts',       path: '/contacts',       icon: IconAddressBook },
  { name: 'templates',      path: '/templates',      icon: IconFileSpreadsheet },
  { name: 'settings',       path: '/settings',       icon: IconSettings },
  { name: 'billing',        path: '/billing',        icon: IconCreditCard },
  { name: 'contrats',       path: '/contrats',       icon: IconContract },
  { name: 'maf_declaration', path: '/maf-declaration', icon: IconShieldCheck },
];

const NAV_SECTIONS = [
  {
    key: 'gestion',
    label: 'Gestion',
    items: [
      { name: 'dashboard',  path: '/',          icon: IconLayoutDashboard },
      { name: 'projects',   path: '/projects',  icon: IconBriefcase },
      { name: 'references', path: '/references',icon: IconArchive },
      { name: 'documents',  path: '/documents', icon: IconFiles },
    ],
  },
  {
    key: 'finances',
    label: 'Finances',
    items: [
      { name: 'proposals', path: '/proposals', icon: IconFileSpreadsheet },
      { name: 'invoices',  path: '/invoices',  icon: IconFileInvoice },
      { name: 'tenders',   path: '/tenders',   icon: IconClipboardCheck },
      { name: 'contrats',  path: '/contrats',  icon: IconContract },
    ],
  },
  {
    key: 'outils',
    label: 'Outils',
    items: [
      { name: 'specifications', path: '/specifications', icon: IconFileText },
      { name: 'gantt',          path: '/gantt',          icon: IconChartBar },
      { name: 'calendar',       path: '/calendar',       icon: IconCalendarWeek },
      { name: 'kanban',         path: '/kanban',         icon: IconLayoutKanban },
      { name: 'reunions',       path: '/reunions',        icon: IconMessages },
      { name: 'ordres_de_service', path: '/ordres-de-service', icon: IconClipboardList },
      { name: 'contacts',       path: '/contacts',       icon: IconAddressBook },
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    items: [
      { name: 'agents',    path: '/agents',    icon: IconRobot },
      { name: 'team',      path: '/team',      icon: IconUsers },
      { name: 'templates', path: '/templates', icon: IconFileSpreadsheet },
      { name: 'settings',  path: '/settings',  icon: IconSettings },
      { name: 'billing',   path: '/billing',   icon: IconCreditCard },
    ],
  },
];

const STORAGE_KEY = 'sidebar_collapsed_sections';

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { tenantPlan, isTrialExpired, trialEndsAt, currentUser } = useUser();
  const { settings } = useSettings();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [superpdpConnected, setSuperpdpConnected] = useState(false);
  const [chorusProConnected, setChorusProConnected] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed)); } catch {}
  }, [collapsed]);

  useEffect(() => {
    if (!currentUser) return;
    apiFetch<{ isAdmin: boolean }>('/api/admin/is-admin')
      .then(r => setIsSuperAdmin(r.isAdmin))
      .catch(() => setIsSuperAdmin(false));
    apiFetch<{ connected: boolean }>('/api/superpdp/status')
      .then(r => setSuperpdpConnected(!!r.connected))
      .catch(() => {});
    apiFetch<{ connected: boolean }>('/api/chorus-pro/status')
      .then(r => setChorusProConnected(!!r.connected))
      .catch(() => {});
  }, [currentUser?.email]);

  const mafEnabled = !!(settings as any)?.maf_enabled;

  const toggleSection = (key: string) => {
    setCollapsed((prev: Record<string, boolean>) => ({ ...prev, [key]: !prev[key] }));
  };

  const daysLeft = trialEndsAt && tenantPlan === 'trial'
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 border-r overflow-y-auto"
      style={{
        width: 'var(--tblr-sidebar-w)',
        background: 'var(--tblr-surface)',
        borderColor: 'var(--tblr-border)',
      }}
    >
      {/* Logo area */}
      <div
        className="flex flex-col px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--tblr-border)', minHeight: 'var(--tblr-navbar-h)' }}
      >
        <Link
          to="/"
          className="flex items-center gap-2 font-bold text-base tracking-tight"
          style={{ color: 'var(--tblr-text)' }}
        >
          <BrandLogo logoUrl={settings?.logoUrl} size={28} />
          <span>ArchiOffice</span>
        </Link>
        {settings?.agencyName && (
          <p
            className="mt-0.5 text-[11px] truncate pl-[36px]"
            style={{ color: 'var(--tblr-muted)' }}
          >
            {settings.agencyName}
          </p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {NAV_SECTIONS.map(section => {
          const isCollapsed = !!collapsed[section.key];
          const hasActive = section.items.some(item =>
            location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path))
          );
          return (
            <div key={section.key}>
              {/* Section header — clickable to collapse */}
              <button
                onClick={() => toggleSection(section.key)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-1.5 mb-0.5 rounded text-[10px] font-semibold uppercase tracking-widest transition-colors group',
                  hasActive && isCollapsed
                    ? 'text-[var(--tblr-primary)]'
                    : 'text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]'
                )}
              >
                <span>{section.label}</span>
                <span className="opacity-50 group-hover:opacity-100 transition-opacity">
                  {isCollapsed
                    ? <IconChevronRight size={11} />
                    : <IconChevronDown size={11} />}
                </span>
              </button>

              {/* Section items */}
              {!isCollapsed && (
                <div className="space-y-0.5 mb-2">
                  {section.items.map(item => {
                    const isActive = location.pathname === item.path
                      || (item.path !== '/' && location.pathname.startsWith(item.path));
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-1.5 rounded text-[13px] font-medium transition-colors',
                          isActive
                            ? 'text-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)]'
                            : 'text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]'
                        )}
                      >
                        <Icon
                          size={16}
                          className={isActive ? 'text-[var(--tblr-primary)]' : ''}
                        />
                        <span>{t(item.name)}</span>
                      </Link>
                    );
                  })}
                  {/* Super PDP portal — shown only when connected */}
                  {section.key === 'finances' && superpdpConnected && (() => {
                    const isActive = location.pathname === '/superpdp';
                    return (
                      <Link
                        key="/superpdp"
                        to="/superpdp"
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-1.5 rounded text-[13px] font-medium transition-colors',
                          isActive
                            ? 'text-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)]'
                            : 'text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]'
                        )}
                      >
                        <IconCloudUpload size={16} className={isActive ? 'text-[var(--tblr-primary)]' : ''} />
                        <span>Portail PDP</span>
                      </Link>
                    );
                  })()}
                  {/* Chorus Pro portal — shown only when connected */}
                  {section.key === 'finances' && chorusProConnected && (() => {
                    const isActive = location.pathname === '/chorus-pro';
                    return (
                      <Link
                        key="/chorus-pro"
                        to="/chorus-pro"
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-1.5 rounded text-[13px] font-medium transition-colors',
                          isActive
                            ? 'text-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)]'
                            : 'text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]'
                        )}
                      >
                        <IconBuildingBank size={16} className={isActive ? 'text-[var(--tblr-primary)]' : ''} />
                        <span>Portail Chorus Pro</span>
                      </Link>
                    );
                  })()}
                  {/* MAF declaration — shown only when plugin is enabled */}
                  {section.key === 'finances' && mafEnabled && (() => {
                    const isActive = location.pathname === '/maf-declaration';
                    return (
                      <Link
                        key="/maf-declaration"
                        to="/maf-declaration"
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-1.5 rounded text-[13px] font-medium transition-colors',
                          isActive
                            ? 'text-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)]'
                            : 'text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]'
                        )}
                      >
                        <IconShieldCheck size={16} className={isActive ? 'text-[var(--tblr-primary)]' : ''} />
                        <span>{t('maf_declaration')}</span>
                      </Link>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Super-admin link */}
      {isSuperAdmin && (
        <div className="px-2 pb-1 border-t pt-2" style={{ borderColor: 'var(--tblr-border)' }}>
          <Link
            to="/admin"
            className={cn(
              'flex items-center gap-2.5 px-3 py-1.5 rounded text-[13px] font-medium transition-colors',
              location.pathname === '/admin'
                ? 'text-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)]'
                : 'text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]'
            )}
          >
            <IconShieldLock size={16} className={location.pathname === '/admin' ? 'text-[var(--tblr-primary)]' : ''} />
            <span>Super Admin</span>
          </Link>
        </div>
      )}

      {/* Trial / expired banner */}
      {(isTrialExpired || (tenantPlan === 'trial' && daysLeft !== null && daysLeft <= 7)) && (
        <div className="p-3 border-t shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
          <Link
            to="/billing"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded text-[12px] font-medium transition-colors border',
              isTrialExpired
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
                : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
            )}
          >
            <IconAlertTriangle size={14} />
            {isTrialExpired
              ? 'Essai expiré — Mettre à niveau'
              : `Essai : ${daysLeft}j restant${daysLeft !== 1 ? 's' : ''}`}
          </Link>
        </div>
      )}
    </aside>
  );
}
