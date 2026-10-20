// Mise en page de l'onglet AOR : une barre de sections collante (Réserves, DOE,
// Réception, Plans) avec le nombre d'éléments à suivre, puis les blocs
// eux-mêmes. Sous 1024 px chaque bloc se replie sur son titre et son compteur
// (état mémorisé par bloc) ; au bureau tout reste déplié.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@tabler/icons-react';
import { useHorizontalScrollHints } from '../../hooks/useHorizontalScrollHints';
import { TOUCH_TARGET } from '../chantier/fields';
import { cn } from '../../lib/utils';

export interface AorSectionDef {
  id: string;
  label: string;
  /** Nombre d'éléments affiché dans la barre et sur le titre replié. */
  count?: number | null;
  /** Le nombre désigne des éléments en attente : pastille ambre. */
  alert?: boolean;
  children: ReactNode;
}

const cleMemoire = (id: string) => `aor:section:${id}`;

function lireOuverte(id: string): boolean {
  try { return localStorage.getItem(cleMemoire(id)) !== '0'; } catch { return true; }
}

function ecrireOuverte(id: string, ouverte: boolean) {
  try { localStorage.setItem(cleMemoire(id), ouverte ? '1' : '0'); } catch { /* stockage indisponible */ }
}

function Compteur({ count, alert }: { count?: number | null; alert?: boolean }) {
  if (count == null) return null;
  return (
    <span className={cn(
      'inline-flex min-w-5 justify-center px-1.5 py-0.5 rounded-full text-[0.6875rem] font-bold tabular-nums',
      alert && count > 0
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
        : 'bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]',
    )}>
      {count}
    </span>
  );
}

export function AorLayout({ sections }: { sections: AorSectionDef[] }) {
  const { t } = useTranslation();
  const [ouvertes, setOuvertes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map(s => [s.id, lireOuverte(s.id)])));
  const [actif, setActif] = useState(sections[0]?.id ?? '');
  const barre = useHorizontalScrollHints<HTMLDivElement>('[aria-current="true"]', actif);
  const ids = sections.map(s => s.id).join('|');

  // Met en avant dans la barre le bloc qui occupe le haut de l'écran.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visibles = new Set<string>();
    const ordre = ids.split('|');
    const obs = new IntersectionObserver(entries => {
      for (const e of entries) {
        const id = e.target.id.replace(/^aor-/, '');
        if (e.isIntersecting) visibles.add(id); else visibles.delete(id);
      }
      const premier = ordre.find(id => visibles.has(id));
      if (premier) setActif(premier);
    }, { rootMargin: '-96px 0px -55% 0px' });
    for (const id of ordre) {
      const el = document.getElementById(`aor-${id}`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [ids]);

  const basculer = useCallback((id: string, ouverte: boolean) => {
    setOuvertes(prev => ({ ...prev, [id]: ouverte }));
    ecrireOuverte(id, ouverte);
  }, []);

  const aller = (id: string) => {
    basculer(id, true);
    setActif(id);
    requestAnimationFrame(() => {
      const sansMouvement = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      document.getElementById(`aor-${id}`)?.scrollIntoView({ behavior: sansMouvement ? 'auto' : 'smooth', block: 'start' });
    });
  };

  return (
    <div className="space-y-4 lg:space-y-8">
      <nav aria-label={t('aor_nav_label')}
        className="sticky top-0 z-20 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] shadow-sm">
        <div ref={barre} className="scroll-fade-x flex gap-1 overflow-x-auto p-1.5">
          {sections.map(s => (
            <button key={s.id} type="button" onClick={() => aller(s.id)} aria-current={actif === s.id ? 'true' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors min-h-9',
                TOUCH_TARGET,
                actif === s.id
                  ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]'
                  : 'text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)]',
              )}>
              {s.label}
              <Compteur count={s.count} alert={s.alert} />
            </button>
          ))}
        </div>
      </nav>

      {sections.map(s => {
        const ouverte = ouvertes[s.id] !== false;
        return (
          <section key={s.id} id={`aor-${s.id}`} aria-label={s.label} className="scroll-mt-20 space-y-4">
            <button type="button" aria-expanded={ouverte} aria-controls={`aor-${s.id}-contenu`}
              onClick={() => basculer(s.id, !ouverte)}
              className={cn('lg:hidden flex w-full items-center gap-2 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] px-4 text-left min-h-12', TOUCH_TARGET)}>
              <span className="flex-1 text-sm font-bold">{s.label}</span>
              <Compteur count={s.count} alert={s.alert} />
              <IconChevronDown size={18} aria-hidden className={cn('shrink-0 text-[var(--tblr-muted)] transition-transform', ouverte && 'rotate-180')} />
            </button>
            <div id={`aor-${s.id}-contenu`} className={cn('space-y-8', !ouverte && 'hidden lg:block')}>
              {s.children}
            </div>
          </section>
        );
      })}
    </div>
  );
}
