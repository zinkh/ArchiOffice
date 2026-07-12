import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconCommand } from '@tabler/icons-react';
import { getImportProgress, ImportJobStatus } from '../lib/cloudSync';

export default function CloudImportProgress() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get('jobId');
  const [status, setStatus] = useState<ImportJobStatus | null>(null);

  useEffect(() => {
    if (!jobId) {
      navigate('/login');
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const job = await getImportProgress(jobId);
        if (cancelled) return;
        setStatus(job);
        if (job.status === 'done') {
          window.location.href = '/';
          return;
        }
        if (job.status !== 'error') {
          setTimeout(poll, 1000);
        }
      } catch {
        if (!cancelled) setTimeout(poll, 1000);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [jobId, navigate]);

  const percent = status && status.tablesTotal > 0 ? Math.round((status.tablesDone / status.tablesTotal) * 100) : 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505]">
      <div className="w-full max-w-md p-8 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-blue-600 rounded flex items-center justify-center text-white">
            <IconCommand size={32} />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-6">
          {t('import_progress_title')}
        </h2>

        {status?.status === 'error' ? (
          <p className="text-sm text-red-500 text-center">{status.error}</p>
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
