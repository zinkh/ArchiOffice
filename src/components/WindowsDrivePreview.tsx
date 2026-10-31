import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { desktopBridge } from '../lib/desktopBridge';

/** Only mounted after the page's local paid capability check. Native main owns
 * the experiment flag, executable path, directory and signed authorization. */
export function WindowsDrivePreview({projectId}:{projectId:string|null}) {
  const {t}=useTranslation();const [enabled,setEnabled]=useState(false);const [active,setActive]=useState(false);
  const [busy,setBusy]=useState(false);const lock=useRef(false);const [message,setMessage]=useState<string|null>(null);
  useEffect(()=> {
    let live=true;void desktopBridge()?.getWindowsDrivePreview?.().then(s=>{if(live){setEnabled(s.enabled);setActive(s.active);}}).catch(()=>{});
    return ()=>{live=false;};
  },[]);
  const run=async(stop=false)=> {
    if(lock.current)return;lock.current=true;setBusy(true);setMessage(null);
    try {
      const bridge=desktopBridge();
      if(stop){await bridge?.stopWindowsDrivePreview?.();setActive(false);setMessage('windows_drive_stopped');}
      else if(projectId){const result=await bridge?.startWindowsDrivePreview?.(projectId);setMessage(result?.status==='opened'?'windows_drive_opened':'windows_drive_error');if(result?.status==='opened')setActive(true);}
    }catch{setMessage('windows_drive_error');}finally{lock.current=false;setBusy(false);}
  };
  if(!enabled)return <p className="text-xs max-w-prose" role="status" style={{color:'var(--tblr-muted)'}}><strong style={{color:'var(--tblr-text)'}}>{t('windows_drive_unavailable_title')}</strong>{' : '}{t('windows_drive_unavailable_preview')}</p>;
  return <div className="space-y-2" aria-busy={busy}>
    <p className="text-sm max-w-prose">{t('windows_drive_explanation')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost min-h-11" disabled={busy||!projectId} onClick={()=>void run()}>{t(busy?'windows_drive_preparing':'windows_drive_open')}</button>
      {active&&<button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={()=>void run(true)}>{t('windows_drive_stop')}</button>}
    </div>
    {!projectId&&<p className="text-xs">{t('windows_drive_choose_project')}</p>}
    {message&&<p className="text-xs max-w-prose" role={message==='windows_drive_error'?'alert':'status'}>{t(message)}</p>}
  </div>;
}
