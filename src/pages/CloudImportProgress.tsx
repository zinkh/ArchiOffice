import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconCommand } from '@tabler/icons-react';
import { getImportProgress, getExportProgress, retryImport, ImportJobStatus, ExportJobStatus } from '../lib/cloudSync';

type Phase = 'export' | 'import';

// Shared shape between ImportJobStatus and ExportJobStatus — enough to drive
// the progress bar regardless of which phase is currently polling.
interface ProgressLike {
  status: 'running' | 'done' | 'error';
  tablesDone: number;
  tablesTotal: number;
  currentTable: string | null;
  error: string | null;
}

export default function CloudImportProgress() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // État plutôt que lu une fois dans searchParams : une relance
  // (retryImport()) obtient un NOUVEL identifiant de tâche, qu'il faut
  // pouvoir réassigner ici pour relancer le sondage sur ce nouveau job.
  const [jobId, setJobId] = useState(searchParams.get('jobId'));
  const exportJobId = searchParams.get('exportJobId');
  const importJobId = searchParams.get('importJobId');
  const isUpgradeFlow = !!(exportJobId && importJobId);

  const [status, setStatus] = useState<ProgressLike | null>(null);
  const [phase, setPhase] = useState<Phase>('export');
  const [conflicts, setConflicts] = useState<ExportJobStatus['conflicts']>([]);
  const [finished, setFinished] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Le compte local et la session existent déjà dès que cet écran s'affiche
  // (posés avant même que l'import ne démarre — voir server/cloudLinkRoutes.ts)
  // : un import qui échoue laisse donc une application par ailleurs
  // pleinement utilisable, seule la synchro cloud n'est pas encore active.
  // Sans ce bouton, l'écran d'erreur était une impasse.
  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const result = await retryImport();
      setStatus(null);
      setJobId(result.importJobId);
    } catch (err: any) {
      setRetryError(err?.message || "La relance a échoué.");
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (!jobId && !isUpgradeFlow) {
      navigate('/login');
      return;
    }
    let cancelled = false;

    // Plain first-run import (server/cloudLinkRoutes.ts) — single job, then
    // a full reload straight into the app, unchanged from before.
    const pollImportOnly = async () => {
      try {
        const job: ImportJobStatus = await getImportProgress(jobId!);
        if (cancelled) return;
        setStatus(job);
        if (job.status === 'done') {
          window.location.href = '/';
          return;
        }
        if (job.status !== 'error') setTimeout(pollImportOnly, 1000);
      } catch {
        if (!cancelled) setTimeout(pollImportOnly, 1000);
      }
    };

    // Local → cloud upgrade (server/localCloudUpgrade.ts): push local data up
    // first, then pull down whatever the cloud tenant already had. Any
    // conflicts the export phase reports are shown once both phases finish,
    // instead of being silently lost behind the reload.
    const pollExport = async () => {
      try {
        const job: ExportJobStatus = await getExportProgress(exportJobId!);
        if (cancelled) return;
        setStatus(job);
        if (job.status === 'done') {
          setConflicts(job.conflicts);
          setPhase('import');
          setTimeout(pollImport, 300);
          return;
        }
        if (job.status !== 'error') setTimeout(pollExport, 1000);
      } catch {
        if (!cancelled) setTimeout(pollExport, 1000);
      }
    };

    const pollImport = async () => {
      try {
        const job: ImportJobStatus = await getImportProgress(importJobId!);
        if (cancelled) return;
        setStatus(job);
        if (job.status === 'done') {
          setFinished(true);
          return;
        }
        if (job.status !== 'error') setTimeout(pollImport, 1000);
      } catch {
        if (!cancelled) setTimeout(pollImport, 1000);
      }
    };

    if (isUpgradeFlow) pollExport();
    else pollImportOnly();

    return () => { cancelled = true; };
  }, [jobId, exportJobId, importJobId, isUpgradeFlow, navigate]);

  // Once both phases are done, auto-continue only when nothing needs the
  // user's attention — a conflict list stays on screen until acknowledged.
  useEffect(() => {
    if (finished && conflicts.length === 0) {
      window.location.href = '/';
    }
  }, [finished, conflicts]);

  const percent = status && status.tablesTotal > 0 ? Math.round((status.tablesDone / status.tablesTotal) * 100) : 0;
  const titleKey = isUpgradeFlow
    ? phase === 'export' ? 'cloud_upgrade_export_title' : 'cloud_upgrade_import_title'
    : 'import_progress_title';

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505]">
      <div className="w-full max-w-md p-8 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-blue-600 rounded flex items-center justify-center text-white">
            <IconCommand size={32} />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-6">
          {t(titleKey)}
        </h2>

        {status?.status === 'error' ? (
          <div className="space-y-4">
            <p className="text-sm text-red-500 text-center">{status.error}</p>
            {retryError && <p className="text-sm text-red-500 text-center">{retryError}</p>}
            {/* La relance ne rejoue que l'import (server/initialImport.ts) —
                le seul chemin passé par server/cloudLinkRoutes.ts, celui qui
                affiche jobId (pas isUpgradeFlow), donc le seul où ce bouton
                a un effet réel. */}
            {!isUpgradeFlow && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {retrying ? t('cloud_import_retrying') : t('cloud_import_retry')}
              </button>
            )}
            <button
              type="button"
              onClick={() => { window.location.href = '/'; }}
              className="w-full py-2 px-4 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium rounded-lg transition-colors"
            >
              {t('cloud_import_continue_anyway')}
            </button>
          </div>
        ) : finished && conflicts.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-center text-amber-600 dark:text-amber-400">
              {t('cloud_upgrade_conflicts_intro', { count: conflicts.length })}
            </p>
            <ul className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1 max-h-40 overflow-y-auto">
              {conflicts.map((c) => (
                <li key={c.table}>{t('cloud_upgrade_conflict_row', { table: c.table, count: c.rowCount })}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => { window.location.href = '/'; }}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              {t('cloud_upgrade_conflicts_continue')}
            </button>
          </div>
        ) : (
          <>
            <div className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-sm text-center text-zinc-500 dark:text-zinc-400">
              {status
                ? t('import_progress_table', { table: status.currentTable || '…', done: status.tablesDone, total: status.tablesTotal })
                : '…'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
