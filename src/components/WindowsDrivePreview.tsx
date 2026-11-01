import { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmDialog } from './ui/ConfirmDialog';
import { desktopBridge, type DriveCatalogUpdate, type WindowsDriveEditReport } from '../lib/desktopBridge';

const errorKey = (code?: string) => code === 'DRIVE_LETTER_IN_USE' ? 'windows_drive_letter_busy'
  : code === 'DRIVE_SNAPSHOT_INVALID' ? 'windows_drive_snapshot_invalid'
  : code === 'DRIVE_PROJECT_LIMIT' ? 'windows_drive_project_limit' : 'windows_drive_error';
const refreshErrors: Record<string,string> = {DRIVE_LOCAL_CHANGES:'windows_drive_local_changes',DRIVE_REFRESH_STALE:'windows_drive_refresh_stale',DRIVE_REFRESH_INTERRUPTED:'windows_drive_refresh_interrupted',DRIVE_BUSY:'windows_drive_busy'};
const displayError=(code?:string)=>code&&refreshErrors[code]||errorKey(code);
const errors = new Set(['windows_drive_letter_busy', 'windows_drive_snapshot_invalid', 'windows_drive_project_limit', 'windows_drive_error',...Object.values(refreshErrors)]);

/** Native main owns the paths, project selection, identities and signed grants. */
export function WindowsDrivePreview({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ enabled: boolean; active: boolean; configured?: boolean; projectCount?: number; projectIds?: string[]; previousProjectIds?:string[];editReports?:WindowsDriveEditReport[] }>({ enabled: false, active: false });
  const {confirm,dialog}=useConfirmDialog();
  const [plan,setPlan]=useState<(DriveCatalogUpdate & {projectId:string})|null>(null);
  const [busyLabel,setBusyLabel]=useState('windows_drive_preparing');
  useEffect(()=>setPlan(null),[projectId]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);
  const live = useRef(true);
  const selectedProject=useRef(projectId);selectedProject.current=projectId;
  const added = !!projectId && !!state.projectIds?.includes(projectId);
  const editReport=state.editReports?.find(report=>report.projectId===projectId);
  const load = useCallback(async () => {
    try {
      const status = await desktopBridge()?.getWindowsDrivePreview?.();
      if (live.current) {
        setState(status || { enabled: false, active: false });
        setMessage(previous => status?.error ? displayError(status.error) : previous && errors.has(previous) ? null : previous);
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
  const run = async (action: 'open' | 'disconnect' | 'remove' | 'check' | 'refresh' | 'previous' | 'edit' = 'open') => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(null);setBusyLabel(action==='check'?'windows_drive_checking':action==='refresh'?'windows_drive_refreshing':'windows_drive_preparing');
    try {
      const bridge = desktopBridge();
      if(action==='edit'&&projectId) {
        if(!await confirm({title:t('windows_drive_edit_title'),message:t('windows_drive_edit_confirm'),confirmLabel:t('windows_drive_edit_enable'),cancelLabel:t('cancel'),tone:'primary'}))return;
        if(!live.current||selectedProject.current!==projectId)return;
        setPlan(null);const result=await bridge?.enableWindowsDriveEditing?.(projectId);await load();setMessage(result?.status==='editing'?'windows_drive_edit_enabled':displayError(result?.code));
      } else if(action==='check'&&projectId) {
        const result=await bridge?.checkWindowsDriveCatalog?.(projectId);setPlan(result?.status==='update_available'?{...result,projectId}:null);
        setMessage(result?.status==='up_to_date'?'windows_drive_up_to_date':result?.status==='update_available'?null:displayError(result?.code));
      } else if(action==='refresh'&&projectId&&plan?.projectId===projectId) {
        if(!await confirm({title:t('windows_drive_refresh_title'),message:<div className="space-y-3">{summary(plan)}<p>{t('windows_drive_refresh_confirm')}</p></div>,confirmLabel:t('windows_drive_refresh_apply'),cancelLabel:t('cancel'),tone:'primary'}))return;
        const result=await bridge?.refreshWindowsDriveCatalog?.(projectId,plan.token);setPlan(null);await load();setMessage(result?.status==='refreshed'?'windows_drive_refreshed':displayError(result?.code));
      } else if(action==='previous'&&projectId) {
        const result=await bridge?.openPreviousWindowsDriveProject?.(projectId);setMessage(result?.status==='copies_shown'?'windows_drive_previous_opened':displayError(result?.code));
      } else if (action === 'disconnect') {setPlan(null);
        await bridge?.stopWindowsDrivePreview?.();
        setState(previous => ({ ...previous, active: false, configured: false, projectCount: 0, projectIds: [] }));
        setMessage('windows_drive_stopped');
      } else if (action === 'remove' && projectId) {setPlan(null);
        const result = await bridge?.removeWindowsDriveProject?.(projectId);
        await load(); setMessage(result?.status === 'removed' ? 'windows_drive_removed' : displayError(result?.code));
      } else {
        const result = projectId && !added ? await bridge?.startWindowsDrivePreview?.(projectId) : await bridge?.openWindowsDrive?.();
        if (result?.status === 'opened') { setState(previous => ({ ...previous, active: true, configured: true })); await load(); }
        setMessage(result?.status === 'opened' ? 'windows_drive_opened' : displayError(result?.code));
      }
    } catch { setMessage('windows_drive_error'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const summary=(update:DriveCatalogUpdate)=><dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm max-w-prose">{(['added','updated','removed','moved','folders'] as const).map(key=><div key={key} className="contents"><dt>{t('windows_drive_change_'+key)}</dt><dd className="tabular-nums text-right">{update[key]}</dd></div>)}</dl>;
  if (!checked) return <p className="text-sm" role="status">{t('windows_drive_loading')}</p>;
  if (!state.enabled) return <p className="text-xs max-w-prose" role="status" style={{ color: 'var(--tblr-muted)' }}><strong style={{ color: 'var(--tblr-text)' }}>{t('windows_drive_unavailable_title')}</strong>{' : '}{t('windows_drive_unavailable_preview')}</p>;
  return <div className="space-y-2" aria-busy={busy}>
    <h3 className="text-sm font-semibold">{t(state.active ? 'windows_drive_active' : 'windows_drive_title')}</h3>
    {state.active && <p className="text-sm" role="status">{t('windows_drive_project_count', { count: state.projectCount ?? 1 })}</p>}
    <p className="text-sm max-w-prose">{t('windows_drive_explanation')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost min-h-11" disabled={busy || (!projectId && !state.active)} onClick={() => void run()}>{t(busy ? busyLabel : state.active ? projectId && !added ? 'windows_drive_add' : 'windows_drive_open_active' : 'windows_drive_open')}</button>
      {added&&!editReport && <button type="button" className="btn btn-primary min-h-11" disabled={busy} onClick={()=>void run('edit')}>{t('windows_drive_edit_enable')}</button>}
      {added && <button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={()=>void run('check')}>{t('windows_drive_check_catalog')}</button>}
      {projectId&&state.previousProjectIds?.includes(projectId)&&<button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={()=>void run('previous')}>{t('windows_drive_previous')}</button>}
      {added && <button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={() => void run('remove')}>{t('windows_drive_remove')}</button>}
      {(state.active || state.configured) && <button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={() => void run('disconnect')}>{t('windows_drive_stop')}</button>}
    </div>
    {added&&plan?.projectId===projectId&&<div className="space-y-3">{summary(plan)}<button type="button" className="btn btn-primary min-h-11" disabled={busy} onClick={()=>void run('refresh')}>{t('windows_drive_refresh_apply')}</button></div>}
    {added&&editReport&&<div className="space-y-2 max-w-prose">
      <p className="text-sm font-semibold">{t('windows_drive_edit_enabled')}</p>
      <p className="text-sm">{t('windows_drive_edit_help')}</p>
      <p className="text-sm tabular-nums" role="status">{t('windows_drive_edit_status',{pending:editReport.pending,blocked:editReport.blocked,conflicts:editReport.conflicts})}</p>
      {editReport.unavailable>0&&<p className="text-sm" role="alert">{t('windows_drive_edit_unavailable')}</p>}
      {(editReport.blocked>0||editReport.conflicts>0)&&<p className="text-sm" role="alert">{t('windows_drive_edit_attention')}</p>}
    </div>}
    {dialog}
    {!projectId && !state.active && <p className="text-xs">{t('windows_drive_choose_project')}</p>}
    {message && <p className="text-xs max-w-prose" role={errors.has(message) ? 'alert' : 'status'}>{t(message)}</p>}
  </div>;
}
