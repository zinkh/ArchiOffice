import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconCalendarEvent, IconChevronRight, IconPlus } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import {
  isUpcomingMeeting,
  linkedMeetingsUrl,
  meetingPageUrl,
  meetingParent,
  sortLinkedMeetings,
  type MeetingParentKind,
} from '../lib/linkedMeetings';
import type { Meeting } from '../types';

interface LinkedMeetingsProps {
  kind: MeetingParentKind;
  parentId: string;
  /** Titre de la rubrique ; `null` quand l'écran porte déjà son propre titre (onglet). */
  title?: string | null;
  /** Nombre de réunions affichées (toutes par défaut). */
  limit?: number;
  onCount?: (count: number) => void;
}

function formatMeetingDate(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  return date.includes('T') ? `${day} · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : day;
}

/** Réunions rattachées à une fiche (projet, proposition, appel d'offres). Un
 *  clic ouvre la réunion dans /reunions, déjà sélectionnée sous son parent. */
export default function LinkedMeetings({ kind, parentId, title, limit, onCount }: LinkedMeetingsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    apiFetch<Meeting[]>(linkedMeetingsUrl(kind, parentId))
      .then(data => {
        if (cancelled) return;
        const sorted = sortLinkedMeetings(Array.isArray(data) ? data : []);
        setMeetings(sorted);
        onCount?.(sorted.length);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, parentId]);

  const shown = limit ? meetings.slice(0, limit) : meetings;
  const heading = title === undefined ? t('linked_meetings_title') : title;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        {heading ? (
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
            {heading}{meetings.length > 0 ? ` (${meetings.length})` : ''}
          </div>
        ) : <span />}
        <button
          type="button"
          onClick={() => navigate(meetingPageUrl(kind, parentId, { new: true }))}
          className="flex items-center gap-1 text-[0.6875rem] font-semibold px-2 py-1 rounded-lg border transition-colors hover:bg-[var(--tblr-surface-2)]"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          <IconPlus size={13} /> {t('linked_meetings_new')}
        </button>
      </div>

      {loading && <p className="text-xs italic py-2" style={{ color: 'var(--tblr-muted)' }}>…</p>}
      {!loading && error && <p className="text-xs py-2" style={{ color: 'var(--tblr-danger)' }}>{t('linked_meetings_error')}</p>}
      {!loading && !error && meetings.length === 0 && (
        <p className="text-xs italic py-2" style={{ color: 'var(--tblr-muted)' }}>{t('linked_meetings_empty')}</p>
      )}

      {!loading && !error && shown.length > 0 && (
        <ul className="flex flex-col">
          {shown.map(meeting => {
            const parent = meetingParent(meeting, { kind, id: parentId });
            const upcoming = isUpcomingMeeting(meeting);
            return (
              <li key={meeting.id}>
                <button
                  type="button"
                  onClick={() => navigate(meetingPageUrl(parent.kind, parent.id, { open: meeting.id }))}
                  title={t('linked_meetings_open')}
                  className="w-full flex items-center gap-2.5 py-2 px-1 border-t text-left transition-colors hover:bg-[var(--tblr-surface-2)]"
                  style={{ borderColor: 'var(--tblr-surface-2)' }}
                >
                  <IconCalendarEvent size={16} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[0.78125rem] font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{meeting.title}</span>
                    <span className="block font-mono text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{formatMeetingDate(meeting.date)}</span>
                  </span>
                  {upcoming && (
                    <span className="shrink-0 text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
                      {t('linked_meetings_upcoming')}
                    </span>
                  )}
                  <IconChevronRight size={14} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
