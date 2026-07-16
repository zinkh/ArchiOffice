import { useRegisterSW } from 'virtual:pwa-register/react';
import { IconRefresh, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
// Dismissing only snoozes the banner locally — it does not clear `needRefresh`
// on the SW registration. Without this, a user who dismisses once would never
// be reminded again (the browser only re-fires the update event on an actual
// new deploy, not on every periodic check), leaving them stranded on a stale
// cached app shell indefinitely — the same class of "won't load" bug as a
// stuck auth token, just at the service-worker layer.
const DISMISS_SNOOZE_MS = 4 * 60 * 60 * 1000;

export function UpdateBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Check right away (a tab can sit open for days before the first
      // hourly check) and again whenever the tab regains focus, in addition
      // to the hourly poll.
      registration.update();
      setInterval(() => {
        registration.update();
      }, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    },
  });

  useEffect(() => {
    if (!dismissed) return;
    const timer = setTimeout(() => setDismissed(false), DISMISS_SNOOZE_MS);
    return () => clearTimeout(timer);
  }, [dismissed]);

  if (!needRefresh || dismissed) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[200] flex items-start gap-3 p-4 rounded-lg shadow-lg"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
    >
      <IconRefresh size={20} className="shrink-0 mt-0.5" style={{ color: 'var(--tblr-primary)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>
          {t('update_available_title')}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
          {t('update_available_message')}
        </p>
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => updateServiceWorker(true)}
            className="px-3 py-1.5 rounded text-xs font-semibold text-white"
            style={{ background: 'var(--tblr-primary)' }}
          >
            {t('update_now')}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="px-3 py-1.5 rounded text-xs font-medium"
            style={{ color: 'var(--tblr-muted)' }}
          >
            {t('update_dismiss')}
          </button>
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0"
        style={{ color: 'var(--tblr-muted)' }}
        aria-label={t('update_dismiss')}
      >
        <IconX size={16} />
      </button>
    </div>
  );
}
