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
} from '@tabler/icons-react';
import { ArchiOfficeLogo } from './ArchiOfficeLogo';
import { useUser } from '../UserContext';
import { useSettings } from '../hooks/useSettings';

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
  { name: 'gantt', path: '/gantt', icon: IconChartBar },
  { name: 'kanban', path: '/kanban', icon: IconLayoutKanban },
  { name: 'reunions', path: '/reunions', icon: IconMessages },
  { name: 'team', path: '/team', icon: IconUsers },
  { name: 'contacts', path: '/contacts', icon: IconAddressBook },
  { name: 'templates', path: '/templates', icon: IconFileSpreadsheet },
  { name: 'settings', path: '/settings', icon: IconSettings },
  { name: 'billing', path: '/billing', icon: IconCreditCard },
  { name: 'gantt',          path: '/gantt',          icon: IconChartBar },
  { name: 'kanban',         path: '/kanban',         icon: IconLayoutKanban },
  { name: 'team',           path: '/team',           icon: IconUsers },
  { name: 'contacts',       path: '/contacts',       icon: IconAddressBook },
  { name: 'templates',      path: '/templates',      icon: IconFileSpreadsheet },
  { name: 'settings',       path: '/settings',       icon: IconSettings },
  { name: 'billing',        path: '/billing',        icon: IconCreditCard },
];

// ── Tabler sidebar navigation with section groupings
const NAV_SECTIONS = [
  {
    label: 'Gestion',
    items: [
      { name: 'dashboard',  path: '/',          icon: IconLayoutDashboard },
      { name: 'projects',   path: '/projects',  icon: IconBriefcase },
      { name: 'references', path: '/references',icon: IconArchive },
      { name: 'documents',  path: '/documents', icon: IconFiles },
    ],
  },
  {
    label: 'Finances',
    items: [
      { name: 'proposals', path: '/proposals', icon: IconFileSpreadsheet },
      { name: 'invoices',  path: '/invoices',  icon: IconFileInvoice },
      { name: 'tenders',   path: '/tenders',   icon: IconClipboardCheck },
    ],
  },
  {
    label: 'Outils',
    items: [
      { name: 'specifications', path: '/specifications', icon: IconFileText },
      { name: 'gantt',          path: '/gantt',          icon: IconChartBar },
      { name: 'kanban',         path: '/kanban',         icon: IconLayoutKanban },
      { name: 'contacts',       path: '/contacts',       icon: IconAddressBook },
    ],
  },
  {
    label: 'Administration',
    items: [
      { name: 'team',      path: '/team',      icon: IconUsers },
      { name: 'templates', path: '/templates', icon: IconFileSpreadsheet },
      { name: 'settings',  path: '/settings',  icon: IconSettings },
      { name: 'billing',   path: '/billing',   icon: IconCreditCard },
    ],
  },
];

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { tenantPlan, isTrialExpired, trialEndsAt } = useUser();
  const { settings } = useSettings();

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
          <ArchiOfficeLogo size={28} />
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
      <nav className="flex-1 py-3 px-2 space-y-4 overflow-y-auto">
        {NAV_SECTIONS.map(section => (
          <div key={section.label}>
            {/* Section label */}
            <div
              className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'var(--tblr-muted)' }}
            >
              {section.label}
            </div>

            {/* Section items */}
            <div className="space-y-0.5">
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
            </div>
          </div>
        ))}
      </nav>

      {/* Trial / expired banner */}
      {(isTrialExpired || (tenantPlan === 'trial' && daysLeft !== null && daysLeft <= 7)) && (
        <div className="p-3 border-t shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
          <Link
            to="/billing"
            className="flex items-center gap-2 px-3 py-2 rounded text-[12px] font-medium transition-colors"
            style={{
              background: isTrialExpired ? '#ffe3e3' : '#fff3bf',
              color: isTrialExpired ? '#c92a2a' : '#e67700',
              border: `1px solid ${isTrialExpired ? '#ffc9c9' : '#ffe066'}`,
            }}
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
