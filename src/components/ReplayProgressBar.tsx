// Avancement de l'envoi de la file hors ligne (src/lib/offlineQueue.ts, `ReplayProgress`) : dit si
// quelque chose est en train de partir, laquelle des saisies, où en est la photo, et, une fois le
// passage terminé, ce qui est parti et ce qui reste en attente. Sans lui, « 19 en attente » ne
// permettait pas de distinguer un envoi lent d'un envoi bloqué.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { IconLoader2 } from '@tabler/icons-react';
import { getReplayProgress, subscribeReplayProgress } from '../lib/offlineQueue';
import { entityLabel, formatBytes } from '../lib/pendingWriteLabels';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ReplayProgressBar({ className }: { className?: string }) {
  const p = useSyncExternalStore(subscribeReplayProgress, getReplayProgress, getReplayProgress);
  const [now, setNow] = useState(() => Date.now());

  // Le temps écoulé avance même quand aucun octet ne bouge : c'est ce qui distingue « lent » de « figé ».
  useEffect(() => {
    if (!p.running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [p.running]);

  if (p.running) {
    const photoFraction = p.currentKind === 'multipart' && p.bytesTotal > 0 ? p.bytesSent / p.bytesTotal : 0;
    const fraction = p.total > 0 ? Math.min(1, (p.processed + photoFraction) / p.total) : 0;
    const elapsed = p.startedAt ? Math.max(0, Math.round((now - p.startedAt) / 1000)) : 0;
    return (
      <div className={className} role="status">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold" style={{ color: 'var(--tblr-text)' }}>
          <span className="flex items-center gap-1.5">
            <IconLoader2 size={13} className="animate-spin" />
            Envoi en cours : {p.processed}/{p.total}
          </span>
          <span style={{ color: 'var(--tblr-muted)' }}>{elapsed} s</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          className="mt-1.5 h-1.5 w-full rounded-full overflow-hidden"
          style={{ background: 'var(--tblr-surface-2)' }}
        >
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.round(fraction * 100)}%`, background: 'var(--tblr-primary)' }} />
        </div>
        <div className="mt-1 text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
          {p.currentEntity ? `${entityLabel(p.currentEntity)} : ` : ''}
          {p.currentKind === 'multipart'
            ? p.bytesTotal > 0
              ? p.bytesSent > 0
                ? `${formatBytes(p.bytesSent)} sur ${formatBytes(p.bytesTotal)} (${Math.round(photoFraction * 100)} %)`
                : `photo de ${formatBytes(p.bytesTotal)}, connexion au serveur…`
              : 'envoi de la photo…'
            : 'envoi de la saisie…'}
          {' · '}{p.sent} {plural(p.sent, 'envoyée', 'envoyées')}{p.failed > 0 ? `, ${p.failed} en échec` : ''}
        </div>
      </div>
    );
  }

  if (!p.finishedAt) {
    return (
      <p className={className} role="status" style={{ color: 'var(--tblr-muted)', fontSize: '0.6875rem' }}>
        Aucun envoi lancé depuis l'ouverture de l'application. Appuyez sur « Réessayer maintenant » pour démarrer.
      </p>
    );
  }

  const stopText = p.stopReason === 'offline'
    ? ' Connexion perdue : l\'envoi reprendra au retour du réseau.'
    : p.stopReason === 'network'
      ? ' Connexion instable : les saisies restantes seront retentées dans 30 s.'
      : '';
  const allSent = p.total > 0 && p.failed === 0 && !p.stopReason;
  return (
    <p
      className={className}
      role="status"
      style={{ color: allSent || p.total === 0 ? 'var(--tblr-muted)' : 'var(--tblr-danger, #e03131)', fontSize: '0.6875rem' }}
    >
      {p.total === 0
        ? `Dernier essai à ${clock(p.finishedAt)} : rien à envoyer.`
        : `Dernier essai à ${clock(p.finishedAt)} : ${p.sent} ${plural(p.sent, 'envoyée', 'envoyées')} sur ${p.total}${allSent ? '.' : `, ${p.total - p.sent} ${plural(p.total - p.sent, 'reste', 'restent')} en attente.`}${stopText}`}
    </p>
  );
}

export default ReplayProgressBar;
