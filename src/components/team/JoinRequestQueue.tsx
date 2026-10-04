import { IconCheck, IconX } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { DEFAULT_SPRING } from '../../lib/motion';
import type { JoinRequest } from '../../services/userService';
import { FOCUS_RING, PANEL } from './teamShared';

interface JoinRequestQueueProps {
  requests: JoinRequest[];
  decidingId: string | null;
  onDecide: (id: string, decision: 'approve' | 'reject') => void;
}

/**
 * Demandes de rattachement : une carte au filet orange (à trancher), puis une
 * ligne par demande avec deux gestes nommés. Approuver prend le vert de succès
 * Tabler, refuser reste en contour.
 */
export default function JoinRequestQueue({ requests, decidingId, onDecide }: JoinRequestQueueProps) {
  const { t, i18n } = useTranslation();
  if (requests.length === 0) return null;

  return (
    <section aria-labelledby="team-queue-title" className={cn(PANEL, 'border-l-[3px] !border-l-[var(--tblr-warning)]')} aria-live="polite">
      <div className="px-4 pt-3.5">
        <h2 id="team-queue-title" className="text-sm font-semibold text-[var(--tblr-text)]">
          {t('team_queue_title')} <span className="tabular-nums text-[var(--tblr-warning)]">({requests.length})</span>
        </h2>
        <p className="text-[0.8125rem] text-[var(--tblr-muted)]">{t('team_queue_hint')}</p>
      </div>

      <ul className="mt-2">
        <AnimatePresence initial={false}>
          {requests.map((request) => {
            const busy = decidingId === request.id;
            const date = new Date(request.created_at);
            const dated = Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(i18n.language);
            return (
              <motion.li
                key={request.id}
                layout="position"
                initial={false}
                exit={{ opacity: 0, x: 32 }}
                transition={DEFAULT_SPRING}
                className="flex flex-col gap-3 border-t border-[var(--tblr-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--tblr-text)]">{request.name || request.email}</p>
                  <p className="truncate text-[0.8125rem] text-[var(--tblr-muted)]">
                    {request.name && <>{request.email}{dated && ' · '}</>}
                    {dated && t('team_requested_on', { date: dated })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onDecide(request.id, 'reject')}
                    disabled={busy}
                    className={cn('btn btn-secondary flex-1 justify-center disabled:opacity-40 sm:flex-none', FOCUS_RING)}
                  >
                    <IconX size={15} aria-hidden="true" />
                    {t('team_join_request_reject')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecide(request.id, 'approve')}
                    disabled={busy}
                    style={{ background: 'var(--tblr-success)', borderColor: 'var(--tblr-success)' }}
                    className={cn('btn flex-1 justify-center text-white hover:brightness-95 disabled:opacity-40 sm:flex-none', FOCUS_RING)}
                  >
                    {busy ? (
                      <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <IconCheck size={15} aria-hidden="true" />
                    )}
                    {t('team_join_request_approve')}
                  </button>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
