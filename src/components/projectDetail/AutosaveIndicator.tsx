import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconCheck, IconRefresh } from '@tabler/icons-react';
import type { AutosaveStatus } from '../../hooks/useProjectAutosave';

/**
 * État de l'enregistrement automatique de la fiche, à la place du bouton
 * Enregistrer. Discret tant que tout va bien, explicite en cas d'échec, avec
 * un nouvel essai à portée de main. Sur téléphone, seule l'icône reste.
 */
export function AutosaveIndicator({ status, onRetry }: { status: AutosaveStatus; onRetry: () => void }) {
  const { t } = useTranslation();
  if (status === 'idle') return null;

  if (status === 'error' || status === 'invalid') {
    const label = status === 'invalid' ? t('projectdetail_autosave_name_required') : t('projectdetail_autosave_failed');
    return (
      <div role="alert" className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium" style={{ color: 'var(--tblr-text)' }}>
        <IconAlertTriangle size={16} aria-hidden className="shrink-0" style={{ color: 'var(--tblr-danger)' }} />
        <span className="hidden sm:inline">{label}</span>
        {status === 'error' && (
          <button
            type="button"
            onClick={onRetry}
            title={label}
            aria-label={`${label} : ${t('projectdetail_autosave_retry')}`}
            className="h-8 px-2.5 inline-flex items-center gap-1 rounded-lg border text-[0.8125rem] font-semibold transition-colors hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconRefresh size={14} aria-hidden />
            {t('projectdetail_autosave_retry')}
          </button>
        )}
      </div>
    );
  }

  const busy = status === 'pending' || status === 'saving';
  const label = busy ? t('projectdetail_autosave_saving') : t('projectdetail_autosave_saved');
  return (
    <span role="status" title={label} className="inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap" style={{ color: 'var(--tblr-muted)' }}>
      {busy
        ? <span aria-hidden className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        : <IconCheck size={14} aria-hidden />}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </span>
  );
}
