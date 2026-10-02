import { useEffect } from 'react';
import { IconAlertTriangle, IconCircleCheck, IconX } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { PANEL_SPRING } from '../../lib/motion';
import { FOCUS_RING } from './teamShared';

export interface TeamNoticeData {
  kind: 'success' | 'info' | 'error';
  text: string;
}

const DISMISS_MS = 5000;

/** Retour de l'interface. Une confirmation s'efface seule ; une erreur reste jusqu'à fermeture manuelle. */
export default function TeamNotice({ notice, onClose }: { notice: TeamNoticeData; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (notice.kind === 'error') return;
    const id = window.setTimeout(onClose, DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [notice, onClose]);

  const isError = notice.kind === 'error';
  const Icon = isError ? IconAlertTriangle : IconCircleCheck;
  return (
    <motion.div
      role={isError ? 'alert' : 'status'}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={PANEL_SPRING}
      className={cn(
        'fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-md items-start gap-3 rounded-[var(--tblr-radius)] border border-l-4 border-[var(--tblr-border)] bg-[var(--tblr-surface)] py-3 pl-3 pr-2 text-sm text-[var(--tblr-text)] shadow-lg',
        isError ? 'border-l-[var(--tblr-danger)]' : 'border-l-[var(--tblr-success)]',
      )}
    >
      <Icon size={18} aria-hidden="true" className={cn('mt-px shrink-0', isError ? 'text-[var(--tblr-danger)]' : 'text-[var(--tblr-success)]')} />
      <p className="min-w-0 flex-1 leading-snug">{notice.text}</p>
      <button type="button" onClick={onClose} aria-label={t('team_modal_close') as string} className={cn('btn btn-ghost !p-1', FOCUS_RING)}>
        <IconX size={16} aria-hidden="true" />
      </button>
    </motion.div>
  );
}
