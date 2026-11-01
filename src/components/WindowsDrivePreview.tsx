import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { desktopBridge } from '../lib/desktopBridge';

/** Only mounted after the page's local paid capability check. Native main owns
 * the experiment flag, executable path, directory and signed authorization. */
export function WindowsDrivePreview({projectId}:{projectId:string|null}) {
  const {t}=useTranslation();const [enabled,setEnabled]=useState(false);const [active,setActive]=useState(false);
  const [configured,setConfigured]=useState(false);
  const [busy,setBusy]=useState(false);const lock=useRef(false);const [message,setMessage]=useState<string|null>(null);
  useEffect(()=> {
    let live=true;
    const load=()=>void desktopBridge()?.getWindowsDrivePreview?.().then(s=>{if(live){setEnabled(s.enabled);setActive(s.active);setConfigured(!!s.configured);if(s.error)setMessage(s.error==='DRIVE_LETTER_IN_USE'?'windows_drive_letter_busy':s.error==='DRIVE_SNAPSHOT_INVALID'?'windows_drive_snapshot_invalid':'windows_drive_error');}}).catch(()=>{if(live){setActive(false);setMessage('windows_drive_error');}});
    load();const timer=setInterval(load,5000);
    return ()=>{live=false;clearInterval(timer);};
  },[]);
  const run=async(stop=false)=> {
    if(lock.current)return;lock.current=true;setBusy(true);setMessage(null);
    try {
      const bridge=desktopBridge();
      if(stop){await bridge?.stopWindowsDrivePreview?.();setActive(false);setConfigured(false);setMessage('windows_drive_stopped');}
      else {const result=projectId?await bridge?.startWindowsDrivePreview?.(projectId):await bridge?.openWindowsDrive?.();setMessage(result?.status==='opened'?'windows_drive_opened':result?.code==='DRIVE_LETTER_IN_USE'?'windows_drive_letter_busy':result?.code==='DRIVE_SNAPSHOT_INVALID'?'windows_drive_snapshot_invalid':'windows_drive_error');if(result?.status==='opened'){setActive(true);setConfigured(true);}}
    }catch{setMessage('windows_drive_error');}finally{lock.current=false;setBusy(false);}
  };
  if(!enabled)return <p className="text-xs max-w-prose" role="status" style={{color:'var(--tblr-muted)'}}><strong style={{color:'var(--tblr-text)'}}>{t('windows_drive_unavailable_title')}</strong>{' : '}{t('windows_drive_unavailable_preview')}</p>;
  return <div className="space-y-2" aria-busy={busy}>
    <h3 className="text-sm font-semibold">{t(active?'windows_drive_active':'windows_drive_title')}</h3>
    <p className="text-sm max-w-prose">{t('windows_drive_explanation')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost min-h-11" disabled={busy||(!projectId&&!active)} onClick={()=>void run()}>{t(busy?'windows_drive_preparing':active?'windows_drive_open_active':'windows_drive_open')}</button>
      {(active||configured)&&<button type="button" className="btn btn-ghost min-h-11" disabled={busy} onClick={()=>void run(true)}>{t('windows_drive_stop')}</button>}
    </div>
    {!projectId&&!active&&<p className="text-xs">{t('windows_drive_choose_project')}</p>}
    {message&&<p className="text-xs max-w-prose" role={message==='windows_drive_error'||message==='windows_drive_letter_busy'||message==='windows_drive_snapshot_invalid'?'alert':'status'}>{t(message)}</p>}
  </div>;
}
