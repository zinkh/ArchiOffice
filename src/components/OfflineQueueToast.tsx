import { useEffect } from 'react';
import { useToastWithUndo } from '../hooks/useToastWithUndo';
import { Toast } from './ui/Toast';
import { OFFLINE_QUEUE_NOTICE_EVENT } from '../lib/offlineQueue';

/**
 * Alerte (toast) quand l'envoi de photos ou d'écritures de chantier pose problème, est annulé ou
 * reprend (src/lib/offlineQueue.ts). Montée une fois dans l'en-tête : la file n'a pas d'écran à elle,
 * et sans ce message un échec d'envoi restait silencieux jusqu'à l'ouverture de la pastille.
 */
export function OfflineQueueToast() {
  const { toast, showToast } = useToastWithUndo();

  useEffect(() => {
    const onNotice = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; type: 'error' | 'success' }>).detail;
      if (detail?.message) showToast(detail.message, detail.type, { duration: 8000 });
    };
    window.addEventListener(OFFLINE_QUEUE_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(OFFLINE_QUEUE_NOTICE_EVENT, onNotice);
    // showToast est recréé à chaque rendu : l'écouteur n'a besoin que d'être posé une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Toast toast={toast} />;
}

export default OfflineQueueToast;
