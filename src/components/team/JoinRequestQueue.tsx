import { IconCheck, IconX } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { DEFAULT_SPRING } from '../../lib/motion';
import type { JoinRequest } from '../../services/userService';
import { FOCUS_RING, MONO_LABEL, PANEL, pad2, tint } from './teamShared';

interface JoinRequestQueueProps {
  requests: JoinRequest[];
  decidingId: string | null;
  onDecide: (id: string, decision: 'approve' | 'reject') => void;
}

/**
 * File de décisions : une bande hachurée ambre au bord (zone à trancher), un
 * compteur, puis une ligne par demande avec deux gestes nommés. Approuver prend
 * le vert de succès Tabler, refuser le rouge de danger, en contour.
 */
export default function JoinRequestQueue({ requests, decidingId, onDecide }: JoinRequestQueueProps) {
  const { t, i18n } = useTranslation();
  if (requests.length === 0) return null;

  return (
    <section aria-labelledby="team-queue-title" className={cn(PANEL, 'relative flex overflow-hidden')}>
      <div
        aria-hidden="true"
        className="w-3 shrink-0 border-r border-[var(--tblr-border)] text-[var(--tblr-warning)] sm:w-4"
        style={{ backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 1.5px, transparent 1.5px 6px)' }}
      />
      <div className="min-w-0 flex-1 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className={MONO_LABEL}>{t('team_queue_eyebrow')}</p>
            <h2 id="team-queue-title" className="mt-1 text-xl font-semibold tracking-tight text-[var(--tblr-text)]">{t('team_queue_title')}</h2>
            <p className="mt-1 max-w-lg text-sm text-zinc-600 dark:text-zinc-400">{t('team_queue_hint')}</p>
          </div>
          <div className="flex shrink-0 items-baseline gap-3 sm:block sm:text-right" aria-live="polite">
            <span className="block font-mono text-3xl font-extralight leading-none tabular-nums text-[var(--tblr-warning)] sm:text-6xl">{pad2(requests.length)}</span>
            <span className={cn(MONO_LABEL, 'sm:mt-1 sm:block')}>{t('team_queue_count', { count: requests.length })}</span>
          </div>
        </div>

        <ul className="mt-5 border-t border-[var(--tblr-border)]">
          <AnimatePresence initial={false}>
            {requests.map((request, i) => {
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
                  className="flex flex-col gap-3 border-b border-[var(--tblr-border)] py-3.5 sm:flex-row sm:items-center sm:gap-5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <span className="w-9 shrink-0 font-mono text-xs text-zinc-600 dark:text-zinc-400">D-{pad2(i + 1)}</span>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold tracking-tight text-[var(--tblr-text)]">{request.name || request.email}</p>
                      {request.name && <p className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">{request.email}</p>}
                      <p className="mt-1 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--tblr-warning)]" />
                        {t('team_queue_pending')}
                        {dated && <span aria-hidden="true">·</span>}
                        {dated && <span>{t('team_requested_on', { date: dated })}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 pl-[3.25rem] sm:pl-0">
                    <button
                      type="button"
                      onClick={() => onDecide(request.id, 'reject')}
                      disabled={busy}
                      className={cn('btn btn-secondary flex-1 justify-center !text-[var(--tblr-danger)] !border-[var(--tblr-danger)]/50 disabled:opacity-40 sm:flex-none', FOCUS_RING)}
                    >
                      <IconX size={15} aria-hidden="true" />
                      {t('team_join_request_reject')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecide(request.id, 'approve')}
                      disabled={busy}
                      style={{ background: tint('var(--tblr-success)', 16), borderColor: 'var(--tblr-success)' }}
                      className={cn('btn flex-1 justify-center font-semibold text-[var(--tblr-text)] hover:brightness-95 disabled:opacity-40 sm:flex-none', FOCUS_RING)}
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
      </div>
    </section>
  );
}
