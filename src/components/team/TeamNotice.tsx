import { useEffect } from 'react';
import { IconX } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { PANEL_SPRING } from '../../lib/motion';
import { FOCUS_RING } from './teamShared';

export interface TeamNoticeData {
  kind: 'info' | 'error';
  text: string;
}

const DISMISS_MS = 7000;

/** Retour sobre, noir sur blanc (inversé en sombre). Un filet rouge ne marque que l'erreur. */
export default function TeamNotice({ notice, onClose }: { notice: TeamNoticeData; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const id = window.setTimeout(onClose, DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [notice, onClose]);

  return (
    <motion.div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={PANEL_SPRING}
      className={cn(
        'fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-md items-start gap-3 border-l-4 bg-zinc-900 py-3 pl-4 pr-2 text-sm text-white shadow-lg dark:bg-white dark:text-zinc-900',
        notice.kind === 'error' ? 'border-red-500' : 'border-zinc-500',
      )}
    >
      <p className="min-w-0 flex-1 leading-snug">{notice.text}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('team_modal_close') as string}
        className={cn('p-1 opacity-70 hover:opacity-100', FOCUS_RING, 'focus-visible:outline-white dark:focus-visible:outline-zinc-900')}
      >
        <IconX size={16} aria-hidden="true" />
      </button>
    </motion.div>
  );
}
