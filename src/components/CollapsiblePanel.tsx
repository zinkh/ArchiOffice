import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { usePanelCollapsed } from '../lib/panelState';

/**
 * Colonne de liste repliable (écrans lg et plus ; en dessous, la page garde
 * sa navigation par vues empilées et le repli ne s'applique pas).
 *
 * Replié, le panneau se réduit à une poignée verticale (16 px à la souris,
 * 44 px au doigt) qui le rouvre. Le contenu garde sa largeur pendant la
 * transition (200 ms sur la largeur du conteneur, cf. `.collapsible-panel`
 * dans index.css) plutôt que de se recomposer à chaque image.
 *
 * `panelKey` est mémorisé dans localStorage : une clé par panneau ET par page.
 */
export function useListPanel(panelKey: string) {
  return usePanelCollapsed(panelKey, false, true);
}

export function PanelCollapseButton({
  onClick, label, expanded, className,
}: { onClick: () => void; label: string; expanded: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      className={cn(
        'hidden lg:inline-flex shrink-0 items-center justify-center w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded transition-colors',
        'text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface)]',
        className,
      )}
    >
      {expanded ? <IconChevronLeft size={16} /> : <IconChevronRight size={16} />}
    </button>
  );
}

export function CollapsiblePanel({
  collapsed, onExpand, expandLabel, className, style, children,
}: {
  collapsed: boolean;
  onExpand: () => void;
  expandLabel: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('collapsible-panel relative flex flex-col overflow-hidden min-w-0', className)}
      data-collapsed={collapsed}
      style={style}
    >
      <div
        className="flex flex-col flex-1 min-h-0 lg:w-[var(--panel-w)]"
        // `inert` retire le contenu replié du focus clavier et des lecteurs d'écran.
        {...(collapsed ? { inert: true, 'aria-hidden': true } as object : {})}
      >
        {children}
      </div>
      {collapsed && (
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={false}
          aria-label={expandLabel}
          title={expandLabel}
          className="hidden lg:flex absolute inset-0 items-center justify-center transition-colors text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface)]"
        >
          <IconChevronRight size={14} />
        </button>
      )}
    </div>
  );
}

export function useExpandLabel(collapsed: boolean) {
  const { t } = useTranslation();
  return {
    collapse: t('panel_list_collapse') as string,
    expand: t('panel_list_expand') as string,
    current: t(collapsed ? 'panel_list_expand' : 'panel_list_collapse') as string,
  };
}
