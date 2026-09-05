// Réglage personnel des notifications système, dans l'onglet Notifications des
// paramètres. Personnel et non par cabinet : l'abonnement est propre à un
// navigateur et la mise en sourdine d'une catégorie n'engage que son auteur.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBell, IconBellOff, IconLoader2, IconSend, IconDeviceDesktop } from '@tabler/icons-react';
import {
  enablePush, disablePush, getPushStatus, sendTestPush,
  fetchPushPreferences, savePushPreferences, isIos, isStandalone,
  type PushStatus,
} from '../lib/push';
import { isDesktopClient } from '../lib/desktopNotifications';

// Mêmes libellés que le flux d'activité — c'est la valeur écrite dans
// activities.category et reprise telle quelle par server/push.ts. 'Alertes IA'
// s'y ajoute : elle n'est jamais archivée, donc absente de la liste
// d'archivage, mais c'est la principale source de notifications.
const NOTIFIABLE_CATEGORIES = [
  'Alertes IA', 'Messages', 'Projets', 'Factures', "Appels d'offres",
  'Devis', 'Réunions', 'Tâches', 'Ordres de service', 'Réserves/Observations',
];

export function PushNotificationsCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [muted, setMuted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const desktop = isDesktopClient();

  const refresh = useCallback(async () => {
    // Sur le client de bureau il n'y a pas d'abonnement à interroger : les
    // notifications passent par le relevé natif, toujours actif.
    setStatus(desktop ? 'enabled' : await getPushStatus());
    try {
      const prefs = await fetchPushPreferences();
      setMuted(prefs.muted);
    } catch {
      /* préférences illisibles : on laisse la liste vide, rien n'est coupé */
    }
  }, [desktop]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setStatus(status === 'enabled' ? await disablePush() : await enablePush());
    } catch (err: any) {
      setMessage(err?.message || t('push_error'));
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = async (category: string) => {
    const next = muted.includes(category)
      ? muted.filter(c => c !== category)
      : [...muted, category];
    setMuted(next);
    try {
      await savePushPreferences(next);
    } catch {
      // Revenir à l'état précédent plutôt que d'afficher une case cochée que
      // le serveur ignore.
      setMuted(muted);
      setMessage(t('push_error'));
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await sendTestPush();
      setMessage(t('push_test_sent'));
    } catch (err: any) {
      setMessage(err?.message || t('push_error'));
    } finally {
      setBusy(false);
    }
  };

  const enabled = status === 'enabled';
  // iOS ne donne accès à l'API Push que depuis une app installée sur l'écran
  // d'accueil : dans l'onglet Safari le bouton ne peut rien faire, autant
  // l'expliquer plutôt que d'échouer silencieusement.
  const iosNeedsInstall = !desktop && status === 'unsupported' && isIos() && !isStandalone();

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div className="flex items-center gap-2">
        {desktop ? <IconDeviceDesktop size={16} style={{ color: 'var(--tblr-muted)' }} /> : <IconBell size={16} style={{ color: 'var(--tblr-muted)' }} />}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('push_title')}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>
            {desktop ? t('push_desc_desktop') : t('push_desc')}
          </p>
        </div>
      </div>

      {status === null && (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>
          <IconLoader2 size={14} className="animate-spin" /> {t('push_checking')}
        </div>
      )}

      {status === 'unconfigured' && (
        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('push_unconfigured')}</p>
      )}

      {status === 'denied' && (
        <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{t('push_denied')}</p>
      )}

      {iosNeedsInstall && (
        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('push_ios_install')}</p>
      )}

      {status === 'unsupported' && !iosNeedsInstall && (
        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('push_unsupported')}</p>
      )}

      {(status === 'enabled' || status === 'disabled') && (
        <div className="flex flex-wrap items-center gap-2">
          {!desktop && (
            <button
              type="button" onClick={toggle} disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              style={{
                background: enabled ? 'var(--tblr-surface-2)' : 'var(--tblr-primary)',
                color: enabled ? 'var(--tblr-text)' : '#fff',
                border: '1px solid var(--tblr-border)',
              }}
            >
              {busy ? <IconLoader2 size={14} className="animate-spin" /> : enabled ? <IconBellOff size={14} /> : <IconBell size={14} />}
              {enabled ? t('push_disable') : t('push_enable')}
            </button>
          )}
          <button
            type="button" onClick={test} disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
          >
            <IconSend size={14} /> {t('push_test')}
          </button>
        </div>
      )}

      {message && <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{message}</p>}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('push_categories')}</p>
        {NOTIFIABLE_CATEGORIES.map(cat => (
          <label
            key={cat}
            className="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer"
            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}
          >
            <span className="text-sm" style={{ color: 'var(--tblr-text)' }}>{cat}</span>
            <input
              type="checkbox"
              checked={!muted.includes(cat)}
              onChange={() => toggleCategory(cat)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
