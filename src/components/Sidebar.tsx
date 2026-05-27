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
} from '@tabler/icons-react';
import { ArchiOfficeLogo } from './ArchiOfficeLogo';
import { useUser } from '../UserContext';

export const NAV_ITEMS = [
  { name: 'dashboard', path: '/', icon: IconLayoutDashboard },
  { name: 'projects', path: '/projects', icon: IconBriefcase },
  { name: 'references', path: '/references', icon: IconArchive },
  { name: 'documents', path: '/documents', icon: IconFiles },
  { name: 'proposals', path: '/proposals', icon: IconFileSpreadsheet },
  { name: 'invoices', path: '/invoices', icon: IconFileInvoice },
  { name: 'tenders', path: '/tenders', icon: IconClipboardCheck },
  { name: 'specifications', path: '/specifications', icon: IconFileText },
  { name: 'gantt', path: '/gantt', icon: IconChartBar },
  { name: 'kanban', path: '/kanban', icon: IconLayoutKanban },
  { name: 'team', path: '/team', icon: IconUsers },
  { name: 'contacts', path: '/contacts', icon: IconAddressBook },
  { name: 'templates', path: '/templates', icon: IconFileSpreadsheet },
  { name: 'settings', path: '/settings', icon: IconSettings },
  { name: 'billing', path: '/billing', icon: IconCreditCard },
];

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { tenantPlan, isTrialExpired, trialEndsAt } = useUser();

  const daysLeft = trialEndsAt && tenantPlan === 'trial'
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="hidden md:flex flex-col w-64 border-r border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-xl">
      <div className="p-6">
        <Link to="/" className="flex items-center gap-2 text-zinc-900 dark:text-white font-bold text-xl tracking-tight">
          <ArchiOfficeLogo size={32} />
          {t('app_name')}
        </Link>
      </div>
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-500"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200"
              )}
            >
              <item.icon size={20} />
              <span>{t(item.name)}</span>
            </Link>
          );
        })}
      </nav>

      {/* Trial / expired banner at bottom of sidebar */}
      {(isTrialExpired || (tenantPlan === 'trial' && daysLeft !== null && daysLeft <= 7)) && (
        <div className="m-4">
          <Link
            to="/billing"
            className={cn(
              'block rounded-lg px-3 py-2.5 text-xs font-medium text-center transition-colors',
              isTrialExpired
                ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30'
                : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30'
            )}
          >
            {isTrialExpired
              ? 'Essai expiré — Mettre à niveau'
              : `Essai : ${daysLeft}j restant${daysLeft !== 1 ? 's' : ''} — Passer au Pro`}
          </Link>
        </div>
      )}
    </div>
  );
}
