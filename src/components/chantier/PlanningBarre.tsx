import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLink } from '@tabler/icons-react';
import { ajouterJours, type GesteDatesPlanning, type TachePlanning } from '../../lib/planningChantier';

interface Props {
  tache: TachePlanning;
  left: number;
  width: number;
  hauteur: number;
  couleur: string;
  avancement: boolean;
  disabled: boolean;
  onOpen: () => void;
  onDateStart: (e: PointerEvent<HTMLElement>, geste: GesteDatesPlanning) => void;
  onDateKeyboard: (geste: GesteDatesPlanning, date: string) => void;
  onLinkStart: (e: PointerEvent<HTMLElement>) => void;
  onLinkClick: () => void;
}

export function PlanningBarre({ tache, left, width, hauteur, couleur, avancement, disabled, onOpen, onDateStart, onDateKeyboard, onLinkStart, onLinkClick }: Props) {
  const { t } = useTranslation();
  const clavier = (e: KeyboardEvent, geste: GesteDatesPlanning) => {
    if (disabled || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const origine = geste === 'fin' ? tache.fin : tache.debut;
    onDateKeyboard(geste, ajouterJours(origine, (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1)));
  };
  const etiquette = (geste: GesteDatesPlanning) => t(`planning_gesture_${geste}`, { name: tache.libelle });
  return <div data-planning-bar={tache.id} className="absolute group" style={{ left, width: tache.jalon ? 14 : Math.max(28, width), height: hauteur - 14, top: 7 }}>
    <button type="button" disabled={disabled} onClick={onOpen} onPointerDown={e => onDateStart(e, 'deplacer')}
      onKeyDown={e => clavier(e, 'deplacer')} aria-label={etiquette('deplacer')} title={`${etiquette('deplacer')} · ${tache.debut} – ${tache.fin}`}
      className="absolute inset-0 rounded overflow-hidden cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tblr-primary)]"
      style={{ background: couleur, ...(tache.jalon ? { width: 14, height: 14, top: (hauteur - 28) / 2, transform: 'rotate(45deg)' } : {}) }}>
      {!tache.jalon && avancement && <span data-planning-progress={tache.id} className="block h-full bg-black/40 pointer-events-none" style={{ width: `${tache.avancement}%` }} />}
    </button>
    {!tache.jalon && (['debut', 'fin'] as const).map(geste => <button key={geste} type="button" disabled={disabled}
      aria-label={etiquette(geste)} title={etiquette(geste)} onPointerDown={e => { e.stopPropagation(); onDateStart(e, geste); }}
      onKeyDown={e => clavier(e, geste)}
      className="planning-resize-handle absolute top-0 bottom-0 w-2.5 cursor-ew-resize rounded bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tblr-primary)] pointer-coarse:hidden"
      style={{ [geste === 'debut' ? 'left' : 'right']: -4 }}><span className="pointer-events-none absolute inset-y-1 left-1/2 w-0.5 bg-[var(--tblr-surface)] border-l border-[var(--tblr-text)]" /></button>)}
    <button type="button" disabled={disabled} aria-label={t('planning_link_from', { name: tache.libelle })}
      title={t('planning_link_from', { name: tache.libelle })} onClick={onLinkClick} onPointerDown={e => { e.stopPropagation(); onLinkStart(e); }}
      className="planning-link-handle absolute -right-7 top-0 h-7 w-6 flex items-center justify-center rounded bg-transparent text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tblr-primary)] pointer-coarse:w-11 pointer-coarse:h-11 pointer-coarse:-top-2 pointer-coarse:-right-12">
      <IconLink size={14} aria-hidden="true" />
    </button>
  </div>;
}
