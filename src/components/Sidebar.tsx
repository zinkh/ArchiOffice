import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import {
  IconLayoutDashboard,
  IconBriefcase,
  IconBooks,
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
  IconChevronLeft,
  IconClipboardList,
  IconCalendarWeek,
  IconContract,
  IconShieldLock,
  IconShieldCheck,
  IconCloudUpload,
  IconBuildingBank,
  IconFileDescription,
  IconMessageCircle,
  IconMail,
} from '@tabler/icons-react';
import { BrandLogo } from './ArchiOfficeLogo';
import { useUser } from '../UserContext';
import { useSettings } from '../hooks/useSettings';
import { apiFetch } from '../lib/api';
import { usePanelCollapsed, usePanelShortcuts, narrowByDefault, SIDEBAR_PANEL_KEY } from '../lib/panelState';

// ── All nav items (still exported for Header mobile menu)
export const NAV_ITEMS = [
  { name: 'dashboard',      path: '/',              icon: IconLayoutDashboard },
  { name: 'projects',       path: '/projects',       icon: IconBriefcase },
  { name: 'references',     path: '/references',     icon: IconArchive },
  { name: 'documents',      path: '/documents',      icon: IconFiles },
  { name: 'proposals',      path: '/proposals',      icon: IconFileSpreadsheet },
  { name: 'invoices',       path: '/invoices',       icon: IconFileInvoice },
  { name: 'tenders',        path: '/tenders',        icon: IconClipboardCheck },
  { name: 'specifications', path: '/specifications', icon: IconBooks },
  { name: 'gantt',          path: '/gantt',          icon: IconChartBar },
  { name: 'calendar',       path: '/calendar',       icon: IconCalendarWeek },
  { name: 'kanban',         path: '/kanban',         icon: IconLayoutKanban },
  { name: 'reunions',       path: '/reunions',        icon: IconMessages },
  { name: 'ordres_de_service', path: '/ordres-de-service', icon: IconClipboardList },
  { name: 'team_hr',        path: '/team',           icon: IconUsers },
  { name: 'contacts',       path: '/contacts',       icon: IconAddressBook },
  { name: 'mailbox',        path: '/mailbox',        icon: IconMail },
  { name: 'templates',      path: '/templates',      icon: IconFileSpreadsheet },
  { name: 'settings',       path: '/settings',       icon: IconSettings },
  { name: 'billing',        path: '/billing',        icon: IconCreditCard },
  { name: 'contrats',       path: '/contrats',       icon: IconContract },
  { name: 'maf_declaration', path: '/maf-declaration', icon: IconShieldCheck },
  { name: 'document_templates', path: '/document_templates', icon: IconFileDescription },
  { name: 'support',        path: '/support',        icon: IconMessageCircle },
];

export const NAV_SECTIONS = [
  {
    key: 'gestion',
    label: 'Gestion',
    items: [
      { name: 'dashboard',  path: '/',          icon: IconLayoutDashboard },
      { name: 'team_hr',    path: '/team',      icon: IconUsers },
    ],
  },
  {
    key: 'affaires',
    label: 'Affaires',
    items: [
      { name: 'projects',  path: '/projects',  icon: IconBriefcase },
      { name: 'tenders',   path: '/tenders',   icon: IconClipboardCheck },
      { name: 'proposals', path: '/proposals', icon: IconFileSpreadsheet },
      { name: 'contrats',  path: '/contrats',  icon: IconContract },
      { name: 'invoices',  path: '/invoices',  icon: IconFileInvoice },
    ],
  },
  {
    key: 'outils',
    label: 'Outils',
    items: [
      { name: 'gantt',          path: '/gantt',          icon: IconChartBar },
      { name: 'kanban',         path: '/kanban',         icon: IconLayoutKanban },
      { name: 'calendar',       path: '/calendar',       icon: IconCalendarWeek },
      { name: 'reunions',       path: '/reunions',        icon: IconMessages },
      { name: 'ordres_de_service', path: '/ordres-de-service', icon: IconClipboardList },
      { name: 'mailbox',        path: '/mailbox',        icon: IconMail },
    ],
  },
  {
    key: 'ressources',
    label: 'Ressources',
    items: [
      { name: 'documents',      path: '/documents',      icon: IconFiles },
      { name: 'specifications', path: '/specifications', icon: IconBooks },
      { name: 'templates',      path: '/templates',      icon: IconFileSpreadsheet },
      { name: 'document_templates', path: '/document_templates', icon: IconFileDescription },
      { name: 'references',     path: '/references',     icon: IconArchive },
      { name: 'contacts',       path: '/contacts',       icon: IconAddressBook },
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    items: [
      { name: 'settings',  path: '/settings',  icon: IconSettings },
      { name: 'billing',   path: '/billing',   icon: IconCreditCard },
      { name: 'support',   path: '/support',   icon: IconMessageCircle },
    ],
  },
];

const STORAGE_KEY = 'sidebar_collapsed_sections';

/**
 * Émis par la page Équipe quand une demande de rattachement est approuvée ou
 * refusée, pour que le compteur du menu se mette à jour sans attendre un
 * rechargement (les deux vues ne partagent aucun état).
 */
export const JOIN_REQUESTS_CHANGED = 'archioffice:join-requests-changed';

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Corps du menu — les catégories repliables (Gestion, Affaires, Outils…),
 * le lien Super Admin et le bandeau d'essai. Partagé par la barre latérale
 * desktop (`Sidebar`, toujours montée mais masquée en CSS sous `md`) et le
 * tiroir mobile du `Header` : les deux doivent afficher le même
 * regroupement par catégories, pas une liste à plat d'un côté et des
 * sections de l'autre. `onNavigate` referme le tiroir mobile après un clic ;
 * `undefined` en desktop, où il n'y a rien à refermer.
 */
export function SidebarNav({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { tenantPlan, isTrialExpired, trialEndsAt, currentUser } = useUser();
  const { settings } = useSettings();

  const [collapsed_, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  // Demandes de rattachement en attente. Elles ne se valident que depuis la
  // page Équipe : sans ce compteur, un administrateur qui ne pense pas à
  // ouvrir cette page ne sait pas qu'on attend sa réponse — le demandeur, lui,
  // a bien lu « votre demande a été transmise ».
  const [pendingJoinRequests, setPendingJoinRequests] = useState(0);
  const [superpdpConnected, setSuperpdpConnected] = useState(false);
  const [chorusProConnected, setChorusProConnected] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed_)); } catch {}
  }, [collapsed_]);

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

  const isTenantAdmin = currentUser?.system_role === 'admin';

  useEffect(() => {
    if (!isTenantAdmin) { setPendingJoinRequests(0); return; }
    const load = () => {
      apiFetch<{ id: string }[]>('/api/team/join-requests')
        .then(rows => setPendingJoinRequests(rows.length))
        .catch(() => setPendingJoinRequests(0));
    };
    load();
    // La page Équipe émet cet événement après une approbation ou un refus :
    // le compteur retombe tout de suite, sans interroger l'API en boucle.
    window.addEventListener(JOIN_REQUESTS_CHANGED, load);
    return () => window.removeEventListener(JOIN_REQUESTS_CHANGED, load);
  }, [isTenantAdmin]);

  const mafEnabled = !!(settings as any)?.maf_enabled;

  const toggleSection = (key: string) => {
    setCollapsed((prev: Record<string, boolean>) => ({ ...prev, [key]: !prev[key] }));
  };

  const daysLeft = trialEndsAt && tenantPlan === 'trial'
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  // Infobulle du menu replié : `title` seul n'apparaît ni au doigt ni dans une
  // zone qui défile, d'où une infobulle en position fixe (hors du clipping du
  // `overflow-y-auto`), ouverte au survol, au focus clavier ou à l'appui long.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const longPress = useRef<{ timer?: number; fired: boolean }>({ fired: false });
  const hideTip = () => setTip(null);
  const showTip = (el: HTMLElement, label: string) => {
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 8 });
  };
  useEffect(() => { if (!collapsed) setTip(null); }, [collapsed]);

  const itemClass = (isActive: boolean) => cn(
    'flex items-center rounded text-[0.8125rem] font-medium transition-colors',
    collapsed
      ? 'justify-center min-h-[44px] w-full'
      : 'gap-2.5 px-3 py-1.5',
    isActive
      ? 'text-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)]'
      : 'text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]'
  );

  const navLink = (to: string, Icon: typeof IconSettings, label: string, isActive: boolean, badge?: number) => (
    <Link
      key={to}
      to={to}
      onClick={e => {
        if (longPress.current.fired) { e.preventDefault(); longPress.current.fired = false; return; }
        onNavigate?.();
      }}
      className={cn(itemClass(isActive), collapsed && 'relative')}
      aria-label={collapsed ? label : undefined}
      aria-current={isActive ? 'page' : undefined}
      {...(collapsed ? {
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTip(e.currentTarget, label),
        onMouseLeave: hideTip,
        onFocus: (e: React.FocusEvent<HTMLElement>) => showTip(e.currentTarget, label),
        onBlur: hideTip,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
          if (e.pointerType !== 'touch') return;
          const el = e.currentTarget;
          longPress.current.fired = false;
          window.clearTimeout(longPress.current.timer);
          longPress.current.timer = window.setTimeout(() => {
            longPress.current.fired = true;
            showTip(el, label);
            window.setTimeout(hideTip, 1800);
          }, 500);
        },
        onPointerUp: () => window.clearTimeout(longPress.current.timer),
        onPointerCancel: () => window.clearTimeout(longPress.current.timer),
      } : {})}
    >
      <Icon size={collapsed ? 20 : 16} className={isActive ? 'text-[var(--tblr-primary)]' : ''} />
      {!collapsed && <span className="flex-1">{label}</span>}
      {badge && badge > 0 ? (
        collapsed ? (
          <span
            className="absolute top-1.5 right-2 w-2 h-2 rounded-full"
            style={{ background: 'var(--tblr-warning, #f59f00)' }}
            aria-hidden="true"
          />
        ) : (
          <span
            className="min-w-[18px] h-[18px] px-1 rounded-full text-[0.6875rem] font-bold flex items-center justify-center leading-none text-white"
            style={{ background: 'var(--tblr-warning, #f59f00)' }}
            title={t('team_join_requests_title') as string}
          >
            {badge}
          </span>
        )
      ) : null}
    </Link>
  );

  return (
    <>
      {/* Navigation */}
      <nav className={cn('flex-1 py-3 space-y-1 overflow-y-auto overflow-x-hidden', collapsed ? 'px-1.5' : 'px-2')}>
        {NAV_SECTIONS.map((section, sectionIndex) => {
          const isCollapsed = !!collapsed_[section.key];
          const hasActive = section.items.some(item =>
            location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path))
          );
          return (
            <div key={section.key}>
              {/* Menu replié : un fin séparateur remplace le titre de section */}
              {collapsed ? (
                sectionIndex > 0 && (
                  <hr className="my-2 mx-2 border-0 border-t" style={{ borderColor: 'var(--tblr-border)' }} />
                )
              ) : (
              <button
                onClick={() => toggleSection(section.key)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-1.5 mb-0.5 rounded text-[0.6875rem] font-semibold uppercase tracking-widest transition-colors group',
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
              )}

              {/* Section items — toujours tous visibles quand le menu est replié */}
              {(collapsed || !isCollapsed) && (
                <div className="space-y-0.5 mb-2">
                  {section.items.map(item => {
                    const isActive = location.pathname === item.path
                      || (item.path !== '/' && location.pathname.startsWith(item.path));
                    return navLink(
                      item.path, item.icon, t(item.name) as string, isActive,
                      item.path === '/team' ? pendingJoinRequests : undefined,
                    );
                  })}
                  {/* Super PDP portal — shown only when connected */}
                  {section.key === 'affaires' && superpdpConnected &&
                    navLink('/superpdp', IconCloudUpload, 'Portail PDP', location.pathname === '/superpdp')}
                  {/* Chorus Pro portal — shown only when connected */}
                  {section.key === 'affaires' && chorusProConnected &&
                    navLink('/chorus-pro', IconBuildingBank, 'Portail Chorus Pro', location.pathname === '/chorus-pro')}
                  {/* MAF declaration — shown only when plugin is enabled */}
                  {section.key === 'affaires' && mafEnabled &&
                    navLink('/maf-declaration', IconShieldCheck, t('maf_declaration') as string, location.pathname === '/maf-declaration')}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {tip && (
        <div
          role="tooltip"
          className="fixed z-[100] px-2 py-1 rounded text-[0.75rem] font-medium pointer-events-none whitespace-nowrap shadow-lg"
          style={{
            top: tip.top,
            left: tip.left,
            transform: 'translateY(-50%)',
            background: 'var(--tblr-text)',
            color: 'var(--tblr-surface)',
          }}
        >
          {tip.label}
        </div>
      )}

      {/* Super-admin link */}
      {isSuperAdmin && (
        <div className={cn('pb-1 border-t pt-2', collapsed ? 'px-1.5' : 'px-2')} style={{ borderColor: 'var(--tblr-border)' }}>
          {navLink('/admin', IconShieldLock, 'Super Admin', location.pathname === '/admin')}
        </div>
      )}

      {/* Trial / expired banner */}
      {(isTrialExpired || (tenantPlan === 'trial' && daysLeft !== null && daysLeft <= 7)) && (
        <div className={cn('border-t shrink-0', collapsed ? 'p-1.5' : 'p-3')} style={{ borderColor: 'var(--tblr-border)' }}>
          <Link
            to="/billing"
            onClick={onNavigate}
            title={collapsed ? (isTrialExpired ? 'Essai expiré' : `Essai : ${daysLeft}j`) : undefined}
            aria-label={collapsed ? (isTrialExpired ? 'Essai expiré, mettre à niveau' : `Essai : ${daysLeft} jours restants`) : undefined}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded text-[0.75rem] font-medium transition-colors border',
              collapsed && 'justify-center px-0 min-h-[44px]',
              isTrialExpired
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
                : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
            )}
          >
            <IconAlertTriangle size={14} />
            {!collapsed && (isTrialExpired
              ? 'Essai expiré — Mettre à niveau'
              : `Essai : ${daysLeft}j restant${daysLeft !== 1 ? 's' : ''}`)}
          </Link>
        </div>
      )}
    </>
  );
}

/**
 * Barre latérale desktop — le chrome (logo, largeur fixe, bordure) autour du
 * contenu partagé `SidebarNav`. Toujours montée (masquée en CSS sous `md`
 * via `hidden md:flex`), donc son état interne (sections repliées, statut
 * des connecteurs) survit à un simple redimensionnement de fenêtre.
 */
export function Sidebar() {
  const { settings } = useSettings();
  const { t } = useTranslation();
  const { collapsed, toggle } = usePanelCollapsed(SIDEBAR_PANEL_KEY, narrowByDefault());
  usePanelShortcuts(toggle);
  const label = t(collapsed ? 'panel_sidebar_expand' : 'panel_sidebar_collapse') as string;

  const toggleButton = (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-controls="app-sidebar"
      aria-label={label}
      title={label}
      className="shrink-0 inline-flex items-center justify-center w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded transition-colors text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]"
    >
      {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
    </button>
  );

  return (
    <aside
      id="app-sidebar"
      className="hidden md:flex flex-col shrink-0 border-r overflow-y-auto overflow-x-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{
        width: collapsed ? '4rem' : 'var(--tblr-sidebar-w)',
        background: 'var(--tblr-surface)',
        borderColor: 'var(--tblr-border)',
      }}
    >
      {/* Logo area */}
      <div
        className={cn('flex border-b shrink-0', collapsed ? 'flex-col items-center gap-1 py-2' : 'flex-col px-4 py-3')}
        style={{ borderColor: 'var(--tblr-border)', minHeight: 'var(--tblr-navbar-h)' }}
      >
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-1' : 'justify-between gap-2')}>
          <Link
            to="/"
            className="flex items-center gap-2 font-bold text-base tracking-tight min-w-0"
            style={{ color: 'var(--tblr-text)' }}
            aria-label={collapsed ? 'ArchiOffice' : undefined}
          >
            <BrandLogo logoUrl={settings?.logoUrl} size={28} />
            {!collapsed && <span className="truncate">ArchiOffice</span>}
          </Link>
          {toggleButton}
        </div>
        {!collapsed && !settings?.logoUrl && settings?.agencyName && (
          <p
            className="mt-0.5 text-[0.6875rem] truncate pl-[36px]"
            style={{ color: 'var(--tblr-muted)' }}
          >
            {settings.agencyName}
          </p>
        )}
      </div>

      <SidebarNav collapsed={collapsed} />
    </aside>
  );
}
