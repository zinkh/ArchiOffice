// Zone de progression des messages envoyés en arrière-plan (voir
// src/lib/backgroundSend.ts). Montée une fois dans App.tsx : elle reste visible
// quelle que soit la page, pendant que la personne continue de travailler.
// Style sobre (gris) ; la couleur n'est utilisée que pour l'état d'erreur.
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconAlertTriangle, IconRefresh, IconX, IconSend } from '@tabler/icons-react';
import { dismissSend, getSendJobs, hasRunningSends, retrySend, subscribeSends, type SendJob } from '../lib/backgroundSend';

function JobCard({ job }: { job: SendJob }) {
  const { t } = useTranslation();
  const pct = job.status === 'sent' ? 100 : Math.min(99, Math.round((job.done / Math.max(1, job.total)) * 100));
  const enCours = job.status === 'running';
  return (
    <div
      className="rounded-xl shadow-lg p-3 w-[min(22rem,calc(100vw-2rem))] text-sm"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {job.status === 'sent' ? <IconCheck size={16} /> : job.status === 'error' ? <IconAlertTriangle size={16} style={{ color: 'var(--tblr-danger)' }} /> : <IconSend size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate" title={job.label}>{job.label || t('mail_bg_no_subject')}</p>
          <p className="text-xs" role="status" aria-live="polite" style={{ color: job.status === 'error' ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
            {job.status === 'sent' ? t('mail_bg_sent') : job.status === 'error' ? job.error : job.step}
          </p>
        </div>
        {!enCours && (
          <button type="button" onClick={() => dismissSend(job.id)} aria-label={t('mail_bg_dismiss') as string}
            className="shrink-0 p-1 rounded" style={{ color: 'var(--tblr-muted)' }}>
            <IconX size={14} />
          </button>
        )}
      </div>
      {job.status !== 'error' && (
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--tblr-bg)' }}
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={job.label}>
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: 'var(--tblr-text)' }} />
        </div>
      )}
      {job.status === 'error' && (
        <button type="button" onClick={() => retrySend(job.id)}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          <IconRefresh size={13} /> {t('mail_bg_retry')}
        </button>
      )}
    </div>
  );
}

export default function BackgroundSendTray() {
  const jobs = useSyncExternalStore(subscribeSends, getSendJobs, getSendJobs);
  const actif = jobs.some(j => j.status === 'running');

  // Fermer ou recharger l'onglet interromprait l'envoi : le navigateur demande confirmation.
  useEffect(() => {
    if (!actif) return;
    const avertir = (e: BeforeUnloadEvent) => { if (hasRunningSends()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', avertir);
    return () => window.removeEventListener('beforeunload', avertir);
  }, [actif]);

  if (jobs.length === 0) return null;
  return (
    <div className="fixed z-[60] bottom-24 left-4 md:bottom-4 lg:left-[18rem] flex flex-col gap-2 print:hidden">
      {jobs.map(job => <JobCard key={job.id} job={job} />)}
    </div>
  );
}
