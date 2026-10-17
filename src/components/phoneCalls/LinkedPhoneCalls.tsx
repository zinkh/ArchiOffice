import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconPhoneIncoming, IconPhoneOutgoing, IconPlus, IconAlertTriangle } from '@tabler/icons-react';
import { useUser } from '../../UserContext';
import { usePhoneCalls } from '../../hooks/usePhoneCalls';
import { isCallbackOverdue } from '../../lib/phoneCalls';

interface LinkedPhoneCallsProps {
  projectId: string;
}

/** Appels téléphoniques rattachés à une affaire. Un clic ouvre l'appel dans /appels. */
export default function LinkedPhoneCalls({ projectId }: LinkedPhoneCallsProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { allUsers } = useUser();
  const { calls, loading } = usePhoneCalls({ projectId });
  const memberName = useMemo(() => new Map(allUsers.map(m => [m.id, m.name || m.email])), [allUsers]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section aria-labelledby="linked-phone-calls-title">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 id="linked-phone-calls-title" className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
          {t('phonecalls_linked_title')}{calls.length > 0 ? ` (${calls.length})` : ''}
        </h4>
        <button
          type="button"
          onClick={() => navigate(`/appels?new=1&project=${encodeURIComponent(projectId)}`)}
          className="flex items-center gap-1 text-[0.6875rem] font-semibold px-2 py-1 rounded-lg border transition-colors hover:bg-[var(--tblr-surface-2)]"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          <IconPlus size={13} /> {t('phonecalls_linked_new')}
        </button>
      </div>

      {!loading && calls.length === 0 && (
        <p className="text-xs italic py-2" style={{ color: 'var(--tblr-muted)' }}>{t('phonecalls_linked_empty')}</p>
      )}

      <ul className="space-y-1.5">
        {calls.map(call => {
          const Icon = call.direction === 'sortant' ? IconPhoneOutgoing : IconPhoneIncoming;
          const overdue = isCallbackOverdue(call, today);
          return (
            <li key={call.id}>
              <button
                type="button"
                onClick={() => navigate(`/appels?open=${encodeURIComponent(call.id)}`)}
                className="w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg border transition-colors hover:bg-[var(--tblr-surface-2)]"
                style={{ borderColor: overdue ? '#ffa8a8' : 'var(--tblr-border)', color: 'var(--tblr-text)' }}
              >
                <Icon size={16} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} aria-label={t(`phonecalls_direction_${call.direction}`) as string} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{call.subject}</span>
                  <span className="block text-[0.6875rem] truncate" style={{ color: 'var(--tblr-muted)' }}>
                    {new Date(call.called_at).toLocaleDateString(i18n.language)}
                    {call.caller_name ? ` · ${call.caller_name}` : ''}
                    {call.assignee_id ? ` · ${memberName.get(call.assignee_id) || ''}` : ''}
                  </span>
                </span>
                {overdue && <IconAlertTriangle size={14} className="shrink-0" style={{ color: '#c92a2a' }} aria-label={t('phonecalls_overdue') as string} />}
                <span className="text-[0.6875rem] font-semibold shrink-0" style={{ color: 'var(--tblr-muted)' }}>{t(`phonecalls_status_${call.status}`)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
