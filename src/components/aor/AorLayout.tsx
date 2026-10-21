// Mise en page de l'onglet AOR : une barre d'onglets collante (Réserves, DOE,
// Réception, Plans) avec le nombre d'éléments à suivre, puis les blocs
// eux-mêmes. Sous 1024 px la barre est un vrai jeu d'onglets : un seul bloc est
// affiché à la fois (le dernier consulté est retenu). Au bureau tous les blocs
// restent affichés et la barre mène à celui qu'on veut, en le mettant en avant
// au défilement.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useHorizontalScrollHints } from '../../hooks/useHorizontalScrollHints';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { TOUCH_TARGET } from '../chantier/fields';
import { cn } from '../../lib/utils';

export interface AorSectionDef {
  id: string;
  label: string;
  /** Nombre d'éléments affiché dans la barre. */
  count?: number | null;
  /** Le nombre désigne des éléments en attente : pastille ambre. */
  alert?: boolean;
  children: ReactNode;
}

const CLE_ONGLET = 'aor:tab';

function lireOnglet(ids: string[]): string {
  try {
    const memorise = localStorage.getItem(CLE_ONGLET);
    if (memorise && ids.includes(memorise)) return memorise;
  } catch { /* stockage indisponible */ }
  return ids[0] ?? '';
}

function ecrireOnglet(id: string) {
  try { localStorage.setItem(CLE_ONGLET, id); } catch { /* stockage indisponible */ }
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
  const bureau = useMediaQuery('(min-width: 1024px)');
  const ids = sections.map(s => s.id).join('|');
  const [actif, setActif] = useState(() => lireOnglet(ids.split('|')));
  const barre = useHorizontalScrollHints<HTMLDivElement>('[aria-current="true"]', actif);

  // Au bureau, met en avant dans la barre le bloc qui occupe le haut de l'écran.
  useEffect(() => {
    if (!bureau || typeof IntersectionObserver === 'undefined') return;
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
  }, [ids, bureau]);

  const aller = useCallback((id: string) => {
    setActif(id);
    ecrireOnglet(id);
    requestAnimationFrame(() => {
      const sansMouvement = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const cible = bureau ? document.getElementById(`aor-${id}`) : document.getElementById('aor-barre');
      cible?.scrollIntoView({ behavior: sansMouvement ? 'auto' : 'smooth', block: 'start' });
    });
  }, [bureau]);

  return (
    <div className="space-y-4 lg:space-y-8">
      <nav id="aor-barre" aria-label={t('aor_nav_label')}
        className="sticky top-0 z-20 scroll-mt-2 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] shadow-sm">
        <div ref={barre} className="scroll-fade-x flex gap-1 overflow-x-auto p-1.5">
          {sections.map(s => (
            <button key={s.id} type="button" onClick={() => aller(s.id)} aria-current={actif === s.id ? 'true' : undefined}
              aria-controls={`aor-${s.id}`}
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

      {sections.map(s => (
        <section key={s.id} id={`aor-${s.id}`} aria-label={s.label}
          className={cn('scroll-mt-20 space-y-8', actif !== s.id && 'hidden lg:block')}>
          {s.children}
        </section>
      ))}
    </div>
  );
}
