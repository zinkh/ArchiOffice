import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    <div className="flex flex-wrap items-center gap-3 rounded-lg p-3 text-[0.8125rem]" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }}>
      <p role="status">{t(seconds < 20 ? 'agent_chat_waiting' : 'agent_chat_waiting_long')}</p>
      <span aria-hidden="true" className="tabular-nums" style={{ color: 'var(--tblr-muted)' }}>{seconds} s</span>
      <button type="button" onClick={onStop} className="btn btn-secondary min-h-11 focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]">
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
