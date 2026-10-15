// Bouton de sauvegarde de la file hors ligne, en deux appuis (voir src/lib/offlineQueueBackup.ts) :
// le premier construit le fichier, le second le remet (feuille de partage sur iPad, téléchargement
// ailleurs). Le résultat n'est annoncé « enregistré » qu'une fois la remise réellement faite :
// annoncer un succès dès la construction laissait croire à une sauvegarde qui n'existait pas.
import { useState } from 'react';
import { IconDownload, IconLoader2, IconShare } from '@tabler/icons-react';
import { prepareQueueBackup, deliverBackupFile, type PreparedBackup } from '../lib/offlineQueueBackup';

interface Props {
  /** Nombre d'écritures en file, pour le libellé. */
  pending?: number;
  className?: string;
  style?: React.CSSProperties;
  onMessage?: (message: { kind: 'ok' | 'error'; text: string } | null) => void;
}

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export function QueueBackupExport({ pending, className, style, onMessage }: Props) {
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'ready' | 'delivering'>('idle');
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null);

  const say = (kind: 'ok' | 'error', text: string) => onMessage?.({ kind, text });

  const prepare = async () => {
    setPhase('preparing');
    onMessage?.(null);
    try {
      const result = await prepareQueueBackup();
      if (result.count === 0) {
        setPhase('idle');
        say('error', result.unreadable > 0
          ? `Rien à sauvegarder : ${result.unreadable} ${plural(result.unreadable, 'photo est illisible', 'photos sont illisibles')} sur cet appareil.`
          : 'La file est vide : rien à sauvegarder.');
        return;
      }
      setPrepared(result);
      setPhase('ready');
      say('ok', `Fichier prêt (${result.count} ${plural(result.count, 'écriture', 'écritures')}). Appuyez sur « Enregistrer le fichier » pour le conserver.`);
    } catch (err) {
      setPhase('idle');
      say('error', (err as Error).message || 'La préparation de la sauvegarde a échoué.');
    }
  };

  const deliver = async () => {
    if (!prepared) return;
    setPhase('delivering');
    try {
      const outcome = await deliverBackupFile(prepared.file);
      if (outcome === 'cancelled') {
        setPhase('ready');
        say('error', 'Enregistrement annulé : le fichier n\'a pas été conservé. Appuyez de nouveau pour le faire.');
        return;
      }
      const extra = prepared.unreadable > 0
        ? ` ${prepared.unreadable} ${plural(prepared.unreadable, 'photo illisible', 'photos illisibles')} sur cet appareil ${plural(prepared.unreadable, 'n\'a', 'n\'ont')} pas pu être sauvegardée${prepared.unreadable > 1 ? 's' : ''} : à reprendre.`
        : '';
      say(
        prepared.unreadable > 0 ? 'error' : 'ok',
        outcome === 'shared'
          ? `${prepared.file.name} remis via la feuille de partage. Vérifiez qu'il est bien enregistré (Fichiers, Mail ou AirDrop) avant de quitter l'application.${extra}`
          : `${prepared.file.name} téléchargé. Vérifiez qu'il apparaît dans vos téléchargements avant de quitter l'application.${extra}`,
      );
      setPrepared(null);
      setPhase('idle');
    } catch (err) {
      setPhase('ready');
      say('error', `La remise du fichier a échoué (${(err as Error).message || 'erreur inconnue'}). Appuyez de nouveau pour réessayer.`);
    }
  };

  if (phase === 'ready' || phase === 'delivering') {
    return (
      <button type="button" onClick={deliver} disabled={phase === 'delivering'} className={className} style={style}>
        {phase === 'delivering' ? <IconLoader2 size={13} className="animate-spin" /> : <IconShare size={13} />}
        Enregistrer le fichier
      </button>
    );
  }

  return (
    <button type="button" onClick={prepare} disabled={phase === 'preparing'} className={className} style={style}>
      {phase === 'preparing' ? <IconLoader2 size={13} className="animate-spin" /> : <IconDownload size={13} />}
      Sauvegarder dans un fichier{typeof pending === 'number' ? ` (${pending})` : ''}
    </button>
  );
}

export default QueueBackupExport;
