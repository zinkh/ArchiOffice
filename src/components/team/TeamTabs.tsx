import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { FOCUS_RING } from './teamShared';

export type TeamTab = 'team' | 'leave' | 'time';

/** Valeur de `?tab=` pour chaque onglet. L'équipe est l'onglet par défaut : pas de paramètre. */
export const TAB_PARAM: Record<TeamTab, string | null> = { team: null, leave: 'conges', time: 'temps' };

export function tabFromParam(value: string | null): TeamTab {
  return (Object.keys(TAB_PARAM) as TeamTab[]).find((k) => TAB_PARAM[k] === value) ?? 'team';
}

interface TeamTabsProps {
  tab: TeamTab;
  onTab: (tab: TeamTab) => void;
  /** Congés à valider (responsables et administrateurs) : affichés en pastille sur l'onglet Congés. */
  pendingLeave: number;
}

const TABS: { id: TeamTab; label: string }[] = [
  { id: 'team', label: 'team_tab_team' },
  { id: 'leave', label: 'team_tab_leave' },
  { id: 'time', label: 'team_tab_time' },
];

/** Onglets soulignés des écrans Tabler : l'équipe, les congés et le suivi du temps partagent une seule page. */
export default function TeamTabs({ tab, onTab, pendingLeave }: TeamTabsProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('team_tabs_label') as string} className="-mb-1 overflow-x-auto border-b border-[var(--tblr-border)]">
      <ul className="flex min-w-max gap-1">
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onTab(item.id)}
                className={cn(
                  'press -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium',
                  active
                    ? 'border-[var(--tblr-primary)] text-[var(--tblr-primary)]'
                    : 'border-transparent text-[var(--tblr-muted)] [@media(hover:hover)]:hover:text-[var(--tblr-text)]',
                  FOCUS_RING,
                  '-outline-offset-2',
                )}
              >
                {t(item.label)}
                {item.id === 'leave' && pendingLeave > 0 && (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--tblr-warning)] px-1 text-[0.6875rem] font-bold leading-none text-white tabular-nums">
                    {pendingLeave}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
