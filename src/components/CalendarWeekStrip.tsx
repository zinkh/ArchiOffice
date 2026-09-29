import { format, getISOWeek, isSameDay, isToday } from 'date-fns';
import type { Locale } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useSwipeNav } from '../hooks/useSwipeNav';
import { cn } from '../lib/utils';

export interface WeekStripDots {
  colors: string[];
  /** Nombre d'évènements au-delà des pastilles affichées. */
  extra: number;
}

interface Props {
  days: Date[];
  selectedDay: Date;
  onSelect: (day: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  dotsFor: (day: Date) => WeekStripDots;
  locale: Locale;
}

/**
 * Bande de jours pour téléphone : remplace la grille des vues 3 jours et
 * 5 jours ouvrés, dont les colonnes de 65 px tronquaient tous les titres.
 * Un appui sélectionne le jour, dont la liste complète s'affiche dessous ;
 * un balayage change de période. Le numéro de semaine ISO est en marge,
 * comme dans la vue mensuelle.
 */
export function CalendarWeekStrip({ days, selectedDay, onSelect, onPrev, onNext, dotsFor, locale }: Props) {
  const { t } = useTranslation();
  const swipeProps = useSwipeNav({ onPrev, onNext });
  const weekNumber = getISOWeek(days[0]);

  return (
    <div
      {...swipeProps}
      className="sm:hidden flex rounded-xl overflow-hidden"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
    >
      <div
        className="flex items-start justify-center pt-3 w-7 shrink-0 text-[0.6875rem] font-semibold"
        style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', borderRight: '1px solid var(--tblr-border)' }}
        title={t('calendar_week_number', { week: weekNumber }) as string}
      >
        {weekNumber}
      </div>
      <div className="grid flex-1 min-w-0" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map(day => {
          const selected = isSameDay(day, selectedDay);
          const today = isToday(day);
          const { colors, extra } = dotsFor(day);
          return (
            <button
              key={format(day, 'yyyy-MM-dd')}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={selected}
              aria-label={format(day, 'EEEE d MMMM', { locale })}
              className="flex flex-col items-center gap-1 py-2 min-w-0 transition-colors"
              style={{ background: selected ? 'var(--tblr-primary-lt)' : 'transparent' }}
            >
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
                {format(day, 'EEE', { locale })}
              </span>
              <span
                className={cn('w-8 h-8 flex items-center justify-center rounded-full text-sm font-semibold')}
                style={today
                  ? { background: 'var(--tblr-primary)', color: 'white' }
                  : selected
                    ? { border: '2px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }
                    : { color: 'var(--tblr-text)' }}
              >
                {format(day, 'd')}
              </span>
              <span className="flex items-center justify-center gap-0.5 h-2" aria-hidden="true">
                {colors.map((color, i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                ))}
                {extra > 0 && <span className="text-[0.6875rem] leading-none" style={{ color: 'var(--tblr-muted)' }}>+</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
