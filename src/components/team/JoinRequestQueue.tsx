import { IconCheck, IconX } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { DEFAULT_SPRING } from '../../lib/motion';
import type { JoinRequest } from '../../services/userService';
import { FOCUS_RING, INK_LINE, MONO_LABEL, pad2 } from './teamShared';

interface JoinRequestQueueProps {
  requests: JoinRequest[];
  decidingId: string | null;
  onDecide: (id: string, decision: 'approve' | 'reject') => void;
}

/**
 * File de décisions : une bande hachurée au bord (zone à trancher, comme une
 * zone de démolition sur un plan), un gros compteur, puis une ligne par demande
 * avec deux gestes nommés. L'ambre n'est utilisé que pour la pastille d'état.
 */
export default function JoinRequestQueue({ requests, decidingId, onDecide }: JoinRequestQueueProps) {
  const { t, i18n } = useTranslation();
  if (requests.length === 0) return null;

  return (
    <section
      aria-labelledby="team-queue-title"
      className={cn('relative flex overflow-hidden border border-dashed bg-white dark:bg-zinc-900/60', INK_LINE)}
    >
      <div
        aria-hidden="true"
        className="w-3 shrink-0 border-r border-zinc-900/80 text-zinc-900 opacity-80 dark:border-zinc-100/70 dark:text-zinc-100 sm:w-4"
        style={{ backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 6px)' }}
      />
      <div className="min-w-0 flex-1 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={MONO_LABEL}>{t('team_queue_eyebrow')}</p>
            <h2 id="team-queue-title" className="mt-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
              {t('team_queue_title')}
            </h2>
            <p className="mt-1 max-w-lg text-sm text-zinc-600 dark:text-zinc-400">{t('team_queue_hint')}</p>
          </div>
          <div className="shrink-0 text-right" aria-live="polite">
            <span className="block font-mono text-5xl font-extralight leading-none tabular-nums text-zinc-900 dark:text-white sm:text-6xl">
              {pad2(requests.length)}
            </span>
            <span className={cn(MONO_LABEL, 'mt-1 block')}>{t('team_queue_count', { count: requests.length })}</span>
          </div>
        </div>

        <ul className="mt-5 border-t border-zinc-900/80 dark:border-zinc-100/70">
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
                  className="flex flex-col gap-3 border-b border-zinc-300 py-3.5 dark:border-zinc-700 sm:flex-row sm:items-center sm:gap-5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <span className="w-9 shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">D-{pad2(i + 1)}</span>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-white">
                        {request.name || request.email}
                      </p>
                      {request.name && <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{request.email}</p>}
                      <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
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
                      className={cn(
                        'inline-flex flex-1 items-center justify-center gap-1.5 rounded-[2px] border border-zinc-900/80 px-3.5 py-2 text-sm font-semibold text-zinc-900 transition-[transform,background-color] duration-100 active:scale-[0.97] disabled:opacity-40 sm:flex-none dark:border-zinc-100/70 dark:text-zinc-100',
                        '[@media(hover:hover)]:hover:bg-zinc-100 dark:[@media(hover:hover)]:hover:bg-zinc-800',
                        FOCUS_RING,
                      )}
                    >
                      <IconX size={15} aria-hidden="true" />
                      {t('team_join_request_reject')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecide(request.id, 'approve')}
                      disabled={busy}
                      className={cn(
                        'inline-flex flex-1 items-center justify-center gap-1.5 rounded-[2px] border border-zinc-900 bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white transition-[transform,background-color] duration-100 active:scale-[0.97] disabled:opacity-40 sm:flex-none dark:border-white dark:bg-white dark:text-zinc-900',
                        '[@media(hover:hover)]:hover:bg-zinc-700 dark:[@media(hover:hover)]:hover:bg-zinc-200',
                        FOCUS_RING,
                      )}
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
