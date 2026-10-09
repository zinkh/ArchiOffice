import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconInfoCircle, IconChecklist, IconReceipt2, IconFileDescription, IconUsersGroup,
  IconBuildingFactory2, IconMail, IconChevronDown,
} from '@tabler/icons-react';
import { PillTabs, type PillTabItem } from '../ui/PillTabs';
import { BottomSheet, SheetOption } from '../ui/BottomSheet';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cn } from '../../lib/utils';
import { useHorizontalScrollHints } from '../../hooks/useHorizontalScrollHints';
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
  /** Contenu à droite du sélecteur sur téléphone (état d'enregistrement). */
  mobileTrailing?: React.ReactNode;
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
const GROUP_HINTS: Partial<Record<ProjectTabGroupId, string>> = { ETUDES: 'ESQ–PRO', CONSULTATION: 'ACT' };

/**
 * Barre d'onglets de la fiche affaire : au plus sept familles au premier
 * niveau. Les inspirations, le PRO et les notices vivent sous « Études » ; les missions de
 * chantier (VISA, DET, RDT, AOR) vivent sous « Chantier ».
 */
export function ProjectTabBar({ activeTab, onChange, isChantier, chantierTabState, mobileTrailing }: ProjectTabBarProps) {
  const { t } = useTranslation();
  // Sous 768 px, deux barres défilantes cédaient la place au contenu et
  // tronquaient leurs libellés : un seul sélecteur ouvre une feuille en liste.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [sheetOpen, setSheetOpen] = useState(false);
  // Dernier onglet consulté dans chaque famille : revenir au chantier rouvre
  // la mission qu'on venait de quitter plutôt que la première.
  const lastTabByGroup = useRef<Partial<Record<ProjectTabGroupId, ProjectTabId>>>({});
  const subTabsRef = useHorizontalScrollHints<HTMLDivElement>('[aria-selected="true"]', activeTab);

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

  if (!isDesktop) {
    const currentGroup = activeVisibleGroup ?? groups[0];
    const CurrentIcon = currentGroup ? GROUP_ICONS[currentGroup.id] : IconInfoCircle;
    const currentGroupLabel = currentGroup ? t(`project_tab_group_${currentGroup.id.toLowerCase()}`) : '';
    const showMission = !!currentGroup && currentGroup.tabs.length > 1 && !!activeGroup && (currentGroup.tabs as string[]).includes(activeTab);
    const currentLabel = showMission ? `${currentGroupLabel} · ${activeTab}` : currentGroupLabel;
    const choose = (tab: ProjectTabId) => { setSheetOpen(false); onChange(tab); };

    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-label={t('project_tab_picker_open', { current: currentLabel })}
          onClick={() => setSheetOpen(true)}
          className="min-h-11 min-w-0 flex-1 inline-flex items-center gap-2 rounded-lg border px-3 text-left text-[0.9375rem] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          <CurrentIcon size={18} aria-hidden className="shrink-0" style={{ color: 'var(--tblr-primary)' }} />
          <span className="truncate">{currentGroupLabel}</span>
          {showMission && (
            <span className="font-mono text-[0.8125rem] font-bold shrink-0" style={{ color: 'var(--tblr-muted)' }}>· {activeTab}</span>
          )}
          {currentGroup && horsMission(activeTab) && (
            <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold shrink-0" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
              {horsMissionLabel}
            </span>
          )}
          <IconChevronDown size={16} aria-hidden className="ml-auto shrink-0" style={{ color: 'var(--tblr-muted)' }} />
        </button>
        {mobileTrailing}
        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('project_tab_picker_title')}>
          {groups.map(g => {
            const Icon = GROUP_ICONS[g.id];
            const groupLabel = t(`project_tab_group_${g.id.toLowerCase()}`);
            if (g.tabs.length === 1) {
              return (
                <SheetOption
                  key={g.id}
                  selected={g.tabs[0] === activeTab}
                  onSelect={() => choose(g.tabs[0])}
                  trailing={horsMission(g.tabs[0]) ? <span className="text-[0.6875rem] font-semibold">{horsMissionLabel}</span> : undefined}
                >
                  <Icon size={18} aria-hidden className="shrink-0" />
                  {groupLabel}
                </SheetOption>
              );
            }
            return (
              <div key={g.id} role="group" aria-label={groupLabel} className="py-1">
                <div className="flex items-center gap-3 px-3 pt-2 pb-1 text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
                  <Icon size={16} aria-hidden className="shrink-0" />
                  {groupLabel}
                </div>
                {g.tabs.map(tab => (
                  <SheetOption
                    key={tab}
                    indent
                    selected={tab === activeTab}
                    onSelect={() => choose(tab)}
                    trailing={horsMission(tab) ? <span className="text-[0.6875rem] font-semibold">{horsMissionLabel}</span> : undefined}
                  >
                    <span className="font-mono font-bold w-10 shrink-0">{tab}</span>
                    <span className="truncate">{t(`project_tab_title_${tab.toLowerCase()}`)}</span>
                  </SheetOption>
                ))}
              </div>
            );
          })}
        </BottomSheet>
      </div>
    );
  }

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
          ref={subTabsRef}
          role="tablist"
          aria-label={t(`project_tab_group_${activeVisibleGroup.id.toLowerCase()}`)}
          className="scroll-fade-x flex items-center gap-1 overflow-x-auto max-w-full border-b"
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
