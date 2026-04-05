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
  IconCommand,
  IconCalculator
} from '@tabler/icons-react';

export const NAV_ITEMS = [
  { name: 'dashboard', path: '/', icon: IconLayoutDashboard },
  { name: 'projects', path: '/projects', icon: IconBriefcase },
  { name: 'documents', path: '/documents', icon: IconFiles },
  { name: 'proposals', path: '/proposals', icon: IconFileSpreadsheet },
  { name: 'invoices', path: '/invoices', icon: IconFileInvoice },
  { name: 'tenders', path: '/tenders', icon: IconClipboardCheck },
  { name: 'specifications', path: '/specifications', icon: IconFileText },
  { name: 'act', path: '/act', icon: IconCalculator },
  { name: 'gantt', path: '/gantt', icon: IconChartBar },
  { name: 'team', path: '/team', icon: IconUsers },
  { name: 'contacts', path: '/contacts', icon: IconAddressBook },
  { name: 'templates', path: '/templates', icon: IconFileSpreadsheet },
  { name: 'settings', path: '/settings', icon: IconSettings },
];

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="hidden md:flex flex-col w-64 border-r border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-xl">
      <div className="p-6">
        <Link to="/" className="flex items-center gap-2 text-zinc-900 dark:text-white font-bold text-xl tracking-tight">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white">
            <IconCommand size={20} />
          </div>
          ArchiManager
        </Link>
      </div>
      <nav className="flex-1 px-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path;
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
    </div>
  );
}
