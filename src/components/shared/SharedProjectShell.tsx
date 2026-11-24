// Coque d'une affaire partagée avec un confrère : la même fiche qu'ArchiOffice (en-tête, familles d'onglets,
// panneau), limitée aux ateliers que le cabinet a accordés. Le confrère voit ainsi le vrai logiciel, pas une liste
// de validation. Un bandeau discret et un lien « Essayer ArchiOffice » le lui font découvrir.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconSparkles } from '@tabler/icons-react';
import { ProjectTabBar } from '../projectDetail/ProjectTabBar';
import type { ProjectTabId } from '../../lib/projectTabs';
import { sharedVisibleTabs, type SharedGrantLike } from '../../lib/sharedTabs';

export interface SharedShellProject {
  name: string; project_code: string | null; address: string | null;
}

export default function SharedProjectShell({ project, tenantName, grants, archived, canWriteAnything, activeTab, onTabChange, children }: {
  project: SharedShellProject; tenantName: string | null; grants: SharedGrantLike[]; archived: boolean;
  canWriteAnything: boolean; activeTab: ProjectTabId; onTabChange: (tab: ProjectTabId) => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  const visible = sharedVisibleTabs(grants);
  const panelId = 'shared-project-panel';
  const statusLabel = archived ? t('shared_archived_badge') : canWriteAnything ? t('shared_badge_collab') : t('shared_readonly');

  return (
    <div className="-m-4 sm:-m-6 flex flex-col min-h-[calc(100dvh-3.5rem)]" style={{ background: 'var(--tblr-bg)' }}>
      <div
        className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <Link
          to="/partages"
          className="w-8 h-8 flex items-center justify-center rounded-lg border transition-colors hover:bg-[var(--tblr-surface-2)] shrink-0"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
          title={t('shared_back')} aria-label={t('shared_back')}
        >
          <IconArrowLeft size={18} aria-hidden />
        </Link>
        <div className="flex items-baseline gap-2.5 min-w-0 flex-1">
          <h1 className="font-bold text-base truncate min-w-0" style={{ color: 'var(--tblr-text)' }} title={project.name}>{project.name}</h1>
          {project.project_code && (
            <span className="font-mono text-[0.6875rem] shrink-0" style={{ color: 'var(--tblr-muted)' }}>{project.project_code}</span>
          )}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-[0.6875rem] font-semibold shrink-0 whitespace-nowrap"
            style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
          >
            {statusLabel}
          </span>
        </div>
        {tenantName && (
          <span className="hidden md:inline text-xs shrink-0" style={{ color: 'var(--tblr-muted)' }}>
            {t('shared_from', { name: tenantName })}
          </span>
        )}
        <Link
          to="/register"
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[0.8125rem] font-semibold whitespace-nowrap transition-colors hover:brightness-95 outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]"
          style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
        >
          <IconSparkles size={14} aria-hidden />
          {t('shared_try_archioffice')}
        </Link>
      </div>
      {project.address && (
        <p className="px-4 pt-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>{project.address}</p>
      )}

      <div className="shrink-0 px-4 pt-3">
        <ProjectTabBar
          panelId={panelId} activeTab={activeTab} onChange={onTabChange}
          isChantier chantierTabState={{}} isTabVisible={tab => visible.has(tab)}
        />
      </div>

      <div id={panelId} role="tabpanel" aria-label={t(`project_tab_title_${activeTab.toLowerCase()}`)} tabIndex={0}
        className="flex-1 p-4 sm:p-6 outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]">
        <div className="max-w-6xl mx-auto space-y-4 pb-10">{children}</div>
      </div>

      <footer className="shrink-0 px-4 py-2 border-t text-center text-xs" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
        {t('shared_promo_footer')}{' '}
        <Link to="/register" className="font-semibold underline" style={{ color: 'var(--tblr-primary)' }}>{t('shared_try_archioffice')}</Link>
      </footer>
    </div>
  );
}
