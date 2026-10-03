import type { Meeting } from '../types';

export type MeetingParentKind = 'project' | 'proposal' | 'tender';

const QUERY_PARAM: Record<MeetingParentKind, string> = {
  project: 'project_id',
  proposal: 'proposal_id',
  tender: 'tender_id',
};

/** `GET /api/meetings` filtré sur la fiche (projet, proposition, appel d'offres). */
export function linkedMeetingsUrl(kind: MeetingParentKind, parentId: string): string {
  return `/api/meetings?${QUERY_PARAM[kind]}=${encodeURIComponent(parentId)}`;
}

/** Le parent sous lequel la page Réunions range une réunion : la proposition
 *  ou l'appel d'offres qu'elle porte gagne sur le projet, exactement comme
 *  `withContextualType` côté serveur. Une réunion de visite rattachée aussi à
 *  un projet n'apparaît pas dans la liste « projet » de la page Réunions (filtrée
 *  sur le type `projet`) : la viser par son projet ne l'ouvrirait jamais. */
export function meetingParent(meeting: Meeting, fallback: { kind: MeetingParentKind; id: string }): { kind: MeetingParentKind; id: string } {
  if (meeting.proposal_id) return { kind: 'proposal', id: meeting.proposal_id };
  if (meeting.tender_id) return { kind: 'tender', id: meeting.tender_id };
  if (meeting.project_id) return { kind: 'project', id: meeting.project_id };
  return fallback;
}

/** Lien vers la page Réunions, réunion ouverte (`?open=`) ou formulaire de création (`?new=1`). */
export function meetingPageUrl(kind: MeetingParentKind, parentId: string, action: { open: string } | { new: true }): string {
  const parent = `parent=${kind}:${encodeURIComponent(parentId)}`;
  return 'open' in action
    ? `/reunions?${parent}&open=${encodeURIComponent(action.open)}`
    : `/reunions?${parent}&new=1`;
}

/** Réunions à venir d'abord (la plus proche en tête), puis les passées (la plus récente en tête). */
export function sortLinkedMeetings(meetings: Meeting[], now: number = Date.now()): Meeting[] {
  const time = (m: Meeting) => {
    const t = new Date(m.date).getTime();
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const upcoming = meetings.filter(m => time(m) >= startOfToday.getTime()).sort((a, b) => time(a) - time(b));
  const past = meetings.filter(m => time(m) < startOfToday.getTime()).sort((a, b) => time(b) - time(a));
  return [...upcoming, ...past];
}

export function isUpcomingMeeting(meeting: Meeting, now: number = Date.now()): boolean {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const t = new Date(meeting.date).getTime();
  return !Number.isNaN(t) && t >= startOfToday.getTime();
}
