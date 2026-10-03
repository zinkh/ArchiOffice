import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconInfoCircle, IconChecklist, IconReceipt2, IconFileDescription, IconUsersGroup,
  IconBuildingFactory2, IconMail,
} from '@tabler/icons-react';
import { PillTabs, type PillTabItem } from '../ui/PillTabs';
import { cn } from '../../lib/utils';
import {
  CHANTIER_ONLY_TABS, groupOfTab, tabForGroup, visibleTabGroups,
  type ProjectTabGroupId, type ProjectTabId,
} from '../../lib/projectTabs';

interface ProjectTabBarProps {
  activeTab: string;
  onChange: (tab: ProjectTabId) => void;
  isChantier: boolean;
  /** Visibilité et repère « hors mission » des onglets gouvernés par le contrat MOE. */
  chantierTabState: Record<string, { visible: boolean; horsMission: boolean } | undefined>;
}

const GROUP_ICONS: Record<ProjectTabGroupId, React.ElementType> = {
  INFOS: IconInfoCircle,
  TACHES: IconChecklist,
  HONOS: IconReceipt2,
  ETUDES: IconFileDescription,
  CONSULTATION: IconUsersGroup,
  CHANTIER: IconBuildingFactory2,
  CORRESPONDANCE: IconMail,
};

/** Sigle de mission MOP accolé au nom de famille, là où une seule mission la compose. */
const GROUP_HINTS: Partial<Record<ProjectTabGroupId, string>> = { ETUDES: 'PRO', CONSULTATION: 'ACT' };

/**
 * Barre d'onglets de la fiche affaire : au plus sept familles au premier
 * niveau, et les missions de chantier (VISA, DET, RDT, AOR) en second niveau,
 * sous « Chantier », plutôt que dix onglets alignés.
 */
export function ProjectTabBar({ activeTab, onChange, isChantier, chantierTabState }: ProjectTabBarProps) {
  const { t } = useTranslation();
  // Dernier onglet consulté dans chaque famille : revenir au chantier rouvre
  // la mission qu'on venait de quitter plutôt que la première.
  const lastTabByGroup = useRef<Partial<Record<ProjectTabGroupId, ProjectTabId>>>({});

  const isVisible = (tab: ProjectTabId) =>
    !(CHANTIER_ONLY_TABS.includes(tab) && (!isChantier || chantierTabState[tab]?.visible === false));
  const groups = visibleTabGroups(isVisible);
  const activeGroup = groupOfTab(activeTab);
  useEffect(() => {
    const group = groupOfTab(activeTab);
    if (group) lastTabByGroup.current[group.id] = activeTab as ProjectTabId;
  }, [activeTab]);
  const activeVisibleGroup = groups.find(g => g.id === activeGroup?.id);

  const horsMission = (tab: string) => !!chantierTabState[tab]?.horsMission;
  const horsMissionLabel = t('project_tab_hors_mission');

  const groupItems: PillTabItem[] = groups.map(g => ({
    id: g.id,
    label: t(`project_tab_group_${g.id.toLowerCase()}`),
    icon: GROUP_ICONS[g.id],
    hint: GROUP_HINTS[g.id],
    title: g.tabs.length === 1 ? t(`project_tab_title_${g.tabs[0].toLowerCase()}`) : undefined,
    // Une famille entière hors mission le dit au premier niveau ; sinon le
    // repère reste sur la mission concernée, au second niveau.
    badge: g.tabs.every(horsMission) ? horsMissionLabel : undefined,
  }));

  const selectGroup = (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    onChange(tabForGroup(group, activeTab, lastTabByGroup.current[group.id]));
  };

  return (
    <div className="space-y-2">
      <PillTabs
        ariaLabel={t('project_tab_bar_label')}
        activeId={activeGroup?.id ?? ''}
        onChange={selectGroup}
        tabs={groupItems}
      />
      {activeVisibleGroup && activeVisibleGroup.tabs.length > 1 && (
        <div
          role="tablist"
          aria-label={t(`project_tab_group_${activeVisibleGroup.id.toLowerCase()}`)}
          className="flex items-center gap-1 overflow-x-auto max-w-full border-b"
          style={{ borderColor: 'var(--tblr-border)' }}
        >
          {activeVisibleGroup.tabs.map(tab => {
            const isActive = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange(tab)}
                title={t(`project_tab_title_${tab.toLowerCase()}`)}
                className={cn(
                  '-mb-px flex items-baseline gap-1.5 px-3 py-2 border-b-2 whitespace-nowrap shrink-0 transition-colors text-[0.8125rem]',
                  isActive ? 'font-semibold' : 'font-medium hover:text-[var(--tblr-text)]',
                )}
                style={{
                  borderColor: isActive ? 'var(--tblr-primary)' : 'transparent',
                  color: isActive ? 'var(--tblr-text)' : 'var(--tblr-muted)',
                }}
              >
                <span className="font-mono text-[0.8125rem] font-bold">{tab}</span>
                <span className="hidden md:inline">{t(`project_tab_title_${tab.toLowerCase()}`)}</span>
                {horsMission(tab) && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold"
                    style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
                  >
                    {horsMissionLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
