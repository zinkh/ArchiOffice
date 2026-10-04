import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX } from '@tabler/icons-react';
import { useEscapeKey } from '../../../hooks/useEscapeKey';
import { cn } from '../../../lib/utils';

/**
 * Fenêtre des situations de travaux : même voile et même Échap que les autres
 * fenêtres de la fiche, plein écran sur téléphone (on vérifie une situation sur
 * le chantier aussi bien qu'au bureau).
 */
export function DialogShell({
  open, title, subtitle, onClose, busy, wide, footer, children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Pendant un enregistrement : Échap et le voile ne ferment pas. */
  busy?: boolean;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  useEscapeKey(open, () => { if (!busy) onClose(); });
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/50 sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'flex flex-col w-full bg-[var(--tblr-surface)] sm:rounded-lg shadow-xl max-h-dvh sm:max-h-[92dvh]',
          wide ? 'sm:max-w-5xl' : 'sm:max-w-xl',
        )}
        style={{ border: '1px solid var(--tblr-border)' }}
      >
        <div className="flex items-start justify-between gap-4 px-4 sm:px-5 py-4 border-b border-[var(--tblr-border)]" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-[var(--tblr-text)]">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--tblr-muted)] mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('situations_travaux_close')}
            className="btn btn-ghost p-1.5 -m-1 disabled:opacity-40"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4">{children}</div>
        {footer && (
          <div
            className="flex flex-wrap items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] sm:rounded-b-lg"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Champ({ label, htmlFor, hint, children, className }: {
  label: string; htmlFor: string; hint?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={htmlFor} className="block text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">{label}</label>
      {children}
      {hint && <p className="text-[0.6875rem] text-[var(--tblr-muted)]">{hint}</p>}
    </div>
  );
}

// Classes du système (src/index.css) : un seul bleu d'action, contrôles à
// rayon court, anneau de focus bleu pâle. Pas de bouton noir maison.
export const inputClass = 'tblr-input disabled:opacity-60';

export const boutonPrincipal = 'btn btn-primary justify-center font-semibold disabled:opacity-50 disabled:cursor-not-allowed';

export const boutonSecondaire = 'btn btn-secondary justify-center disabled:opacity-50 disabled:cursor-not-allowed';

export const formatEuros = (n: number): string =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
