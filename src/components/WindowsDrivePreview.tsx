import { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { desktopBridge } from '../lib/desktopBridge';

const errorKey = (code?: string) => code === 'DRIVE_LETTER_IN_USE' ? 'windows_drive_letter_busy'
  : code === 'DRIVE_SNAPSHOT_INVALID' ? 'windows_drive_snapshot_invalid'
  : code === 'DRIVE_PROJECT_LIMIT' ? 'windows_drive_project_limit' : 'windows_drive_error';
const errors = new Set(['windows_drive_letter_busy', 'windows_drive_snapshot_invalid', 'windows_drive_project_limit', 'windows_drive_error']);

/** Native main owns the paths, project selection, identities and signed grants. */
export function WindowsDrivePreview({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ enabled: boolean; active: boolean; configured?: boolean; projectCount?: number; projectIds?: string[] }>({ enabled: false, active: false });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);
  const live = useRef(true);
  const added = !!projectId && !!state.projectIds?.includes(projectId);
  const load = useCallback(async () => {
    try {
      const status = await desktopBridge()?.getWindowsDrivePreview?.();
      if (live.current) {
        setState(status || { enabled: false, active: false });
        setMessage(previous => status?.error ? errorKey(status.error) : previous && errors.has(previous) ? null : previous);
      }
    } catch {
      if (live.current) { setState(previous => ({ ...previous, active: false })); setMessage('windows_drive_error'); }
    } finally { if (live.current) setChecked(true); }
  }, []);
  useEffect(() => {
    live.current = true;
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { live.current = false; clearInterval(timer); };
  }, [load]);
  const run = async (action: 'open' | 'disconnect' | 'remove' = 'open') => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(null);
    try {
      const bridge = desktopBridge();
      if (action === 'disconnect') {
        await bridge?.stopWindowsDrivePreview?.();
        setState(previous => ({ ...previous, active: false, configured: false, projectCount: 0, projectIds: [] }));
        setMessage('windows_drive_stopped');
      } else if (action === 'remove' && projectId) {
        const result = await bridge?.removeWindowsDriveProject?.(projectId);
        await load(); setMessage(result?.status === 'removed' ? 'windows_drive_removed' : errorKey(result?.code));
      } else {
        const result = projectId && !added ? await bridge?.startWindowsDrivePreview?.(projectId) : await bridge?.openWindowsDrive?.();
        if (result?.status === 'opened') { setState(previous => ({ ...previous, active: true, configured: true })); await load(); }
        setMessage(result?.status === 'opened' ? 'windows_drive_opened' : errorKey(result?.code));
      }
    } catch { setMessage('windows_drive_error'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  if (!checked) return <p className="text-sm" role="status">{t('windows_drive_loading')}</p>;
  if (!state.enabled) return <p className="text-xs max-w-prose" role="status" style={{ color: 'var(--tblr-muted)' }}><strong style={{ color: 'var(--tblr-text)' }}>{t('windows_drive_unavailable_title')}</strong>{' : '}{t('windows_drive_unavailable_preview')}</p>;
  return <div className="space-y-2" aria-busy={busy}>
    <h3 className="text-sm font-semibold">{t(state.active ? 'windows_drive_active' : 'windows_drive_title')}</h3>
    {state.active && <p className="text-sm" role="status">{t('windows_drive_project_count', { count: state.projectCount ?? 1 })}</p>}
    <p className="text-sm max-w-prose">{t('windows_drive_explanation')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost min-h-11" disabled={busy || (!projectId && !state.active)} onClick={() => void run()}>{t(busy ? 'windows_drive_preparing' : state.active ? projectId && !added ? 'windows_drive_add' : 'windows_drive_open_active' : 'windows_drive_open')}</button>
      {added && <button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={() => void run('remove')}>{t('windows_drive_remove')}</button>}
      {(state.active || state.configured) && <button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={() => void run('disconnect')}>{t('windows_drive_stop')}</button>}
    </div>
    {!projectId && !state.active && <p className="text-xs">{t('windows_drive_choose_project')}</p>}
    {message && <p className="text-xs max-w-prose" role={errors.has(message) ? 'alert' : 'status'}>{t(message)}</p>}
  </div>;
}
