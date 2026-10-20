import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlayerStopFilled } from '@tabler/icons-react';

/** Reports waiting time, without inventing server-side task progress. */
export function ChatRequestStatus({ onStop }: { onStop: () => void }) {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-2.5 px-1 text-[0.75rem]" style={{ color: 'var(--tblr-muted)' }}>
      <span aria-hidden="true" className="flex items-center gap-[3px] shrink-0">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--tblr-primary)', animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
      <p role="status" className="flex-1 min-w-0">{t(seconds < 20 ? 'agent_chat_waiting' : 'agent_chat_waiting_long')}</p>
      <span aria-hidden="true" className="tabular-nums shrink-0">{seconds} s</span>
      {/* Petit à l'œil, 44 px au doigt : la zone de touche déborde du bouton. */}
      <button
        type="button"
        onClick={onStop}
        className="relative shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[0.75rem] font-medium transition-[background-color,transform] hover:bg-[var(--tblr-surface-2)] active:scale-95 before:absolute before:-inset-2 focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)] outline-none"
        style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
      >
        <IconPlayerStopFilled size={10} />
        {t('agent_chat_stop_waiting')}
      </button>
    </div>
  );
}

export interface AgentConsultation { id: string; name: string }

/** A colleague's contribution never changes the active conversation by itself. */
export function ConsultedAgentLinks({ agents, onOpen, disabled = false }: {
  agents?: AgentConsultation[];
  onOpen: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (!agents?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {agents.map(agent => (
        <button key={agent.id} type="button" disabled={disabled} onClick={() => onOpen(agent.id)}
          className="btn btn-secondary min-h-11 text-[0.8125rem] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]">
          {t('agent_chat_view_colleague', { name: agent.name })}
        </button>
      ))}
    </div>
  );
}
