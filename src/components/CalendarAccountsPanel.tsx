// Gestion des comptes Google Calendar connectés et de leurs calendriers —
// server/routes/calendarAccounts.ts. Un compte peut exposer plusieurs
// calendriers (agenda personnel, un agenda partagé « Chantiers »...) :
// sync_enabled les affiche dans la vue Calendrier, is_default désigne celui
// qui reçoit le push des jalons/tâches (POST /api/google-calendar/sync).
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBrandGoogle, IconLoader2, IconRefresh, IconStar, IconStarFilled, IconTrash, IconPlus } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface CalendarRow {
  id: string;
  externalCalendarId: string;
  displayName: string;
  color: string | null;
  isDefault: boolean;
  syncEnabled: boolean;
}

interface AccountRow {
  id: string;
  provider: 'google';
  email: string | null;
  lastSyncedAt: string | null;
  calendars: CalendarRow[];
}

interface CalendarAccountsPanelProps {
  onConnectAnother: () => void;
  onChanged: () => void; // rafraîchit la vue calendrier (les calendriers affichés ont changé)
}

export function CalendarAccountsPanel({ onConnectAnother, onChanged }: CalendarAccountsPanelProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await apiFetch<AccountRow[]>('/api/calendar/accounts'));
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async (connectionId: string) => {
    setRefreshingId(connectionId);
    setError(null);
    try {
      setAccounts(await apiFetch<AccountRow[]>(`/api/calendar/accounts/${connectionId}/refresh`, { method: 'POST' }));
      onChanged();
    } catch (err: any) {
      setError(err?.code === 'INSUFFICIENT_SCOPE' ? t('mail_reconnect_banner') as string : err?.message || null);
    } finally {
      setRefreshingId(null);
    }
  };

  const toggleSync = async (cal: CalendarRow) => {
    try {
      await apiFetch(`/api/calendar/calendars/${cal.id}`, { method: 'PUT', body: JSON.stringify({ syncEnabled: !cal.syncEnabled }) });
      await load();
      onChanged();
    } catch (err: any) {
      setError(err?.message || null);
    }
  };

  const setDefaultCalendar = async (cal: CalendarRow) => {
    try {
      await apiFetch(`/api/calendar/calendars/${cal.id}/default`, { method: 'POST' });
      await load();
      onChanged();
    } catch (err: any) {
      setError(err?.message || null);
    }
  };

  const disconnectAccount = async (connectionId: string) => {
    try {
      await apiFetch(`/api/calendar/accounts/${connectionId}`, { method: 'DELETE' });
      await load();
      onChanged();
    } catch (err: any) {
      setError(err?.message || null);
    }
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('calendar_accounts_title')}</h3>
        <button onClick={onConnectAnother} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          <IconPlus size={12} /> {t('calendar_accounts_add')}
        </button>
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-3" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={14} className="animate-spin" /></div>
      ) : accounts.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_none_connected')}</p>
      ) : (
        <div className="space-y-3">
          {accounts.map(a => (
            <div key={a.id} className="rounded-lg p-2.5" style={{ border: '1px solid var(--tblr-border)' }}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium truncate" style={{ color: 'var(--tblr-text)' }}>
                  <IconBrandGoogle size={13} className="shrink-0" /> <span className="truncate">{a.email}</span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => refresh(a.id)} disabled={refreshingId === a.id} title={t('calendar_accounts_refresh') as string} className="p-1 rounded-lg disabled:opacity-50" style={{ color: 'var(--tblr-muted)' }}>
                    {refreshingId === a.id ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />}
                  </button>
                  <button onClick={() => disconnectAccount(a.id)} title={t('correspondence_disconnect') as string} className="p-1 rounded-lg" style={{ color: 'var(--tblr-danger)' }}>
                    <IconTrash size={13} />
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {a.calendars.map(cal => (
                  <div key={cal.id} className="flex items-center justify-between gap-2 text-xs pl-1">
                    <label className="flex items-center gap-1.5 min-w-0 cursor-pointer">
                      <input type="checkbox" checked={cal.syncEnabled} onChange={() => toggleSync(cal)} />
                      {cal.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cal.color }} />}
                      <span className="truncate" style={{ color: 'var(--tblr-text)' }}>{cal.displayName}</span>
                    </label>
                    <button
                      onClick={() => setDefaultCalendar(cal)}
                      disabled={cal.isDefault}
                      title={cal.isDefault ? (t('calendar_accounts_write_target') as string) : (t('mail_accounts_set_default') as string)}
                      className="shrink-0 disabled:opacity-100"
                      style={{ color: cal.isDefault ? 'var(--tblr-warning)' : 'var(--tblr-muted)' }}
                    >
                      {cal.isDefault ? <IconStarFilled size={13} /> : <IconStar size={13} />}
                    </button>
                  </div>
                ))}
                {a.calendars.length === 0 && (
                  <p className="text-xs pl-1" style={{ color: 'var(--tblr-muted)' }}>{t('mail_folders_empty')}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
