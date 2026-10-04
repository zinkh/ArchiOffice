import { describe, expect, it } from 'vitest';
import { isUpcomingMeeting, linkedMeetingsUrl, meetingPageUrl, meetingParent, sortLinkedMeetings } from '../linkedMeetings';
import type { Meeting } from '../../types';

const meeting = (id: string, date: string, extra: Partial<Meeting> = {}): Meeting =>
  ({ id, date, title: id, type: 'projet', created_at: date, ...extra });

describe('linkedMeetingsUrl', () => {
  it('filtre sur la bonne colonne', () => {
    expect(linkedMeetingsUrl('project', 'p1')).toBe('/api/meetings?project_id=p1');
    expect(linkedMeetingsUrl('proposal', 'pr 1')).toBe('/api/meetings?proposal_id=pr%201');
    expect(linkedMeetingsUrl('tender', 't1')).toBe('/api/meetings?tender_id=t1');
  });
});

describe('meetingPageUrl', () => {
  it('ouvre une réunion sous son parent', () => {
    expect(meetingPageUrl('proposal', 'pr1', { open: 'm1' })).toBe('/reunions?parent=proposal:pr1&open=m1');
  });
  it('ouvre le formulaire de création', () => {
    expect(meetingPageUrl('tender', 't1', { new: true })).toBe('/reunions?parent=tender:t1&new=1');
  });
});

describe('meetingParent', () => {
  const fallback = { kind: 'project' as const, id: 'p1' };
  it('une visite de proposition rattachée aussi au projet s\'ouvre sous la proposition', () => {
    expect(meetingParent(meeting('m', '2026-01-01', { project_id: 'p1', proposal_id: 'pr1' }), fallback)).toEqual({ kind: 'proposal', id: 'pr1' });
  });
  it('une visite de candidature s\'ouvre sous l\'appel d\'offres', () => {
    expect(meetingParent(meeting('m', '2026-01-01', { tender_id: 't1' }), fallback)).toEqual({ kind: 'tender', id: 't1' });
  });
  it('une réunion de projet reste sous son projet', () => {
    expect(meetingParent(meeting('m', '2026-01-01', { project_id: 'p2' }), fallback)).toEqual({ kind: 'project', id: 'p2' });
    expect(meetingParent(meeting('m', '2026-01-01'), fallback)).toEqual(fallback);
  });
});

describe('sortLinkedMeetings', () => {
  const now = new Date('2026-10-03T10:00:00').getTime();
  it('à venir d\'abord (la plus proche en tête), puis les passées (la plus récente en tête)', () => {
    const list = [
      meeting('passee-ancienne', '2026-01-10'),
      meeting('future-lointaine', '2026-12-01'),
      meeting('aujourdhui', '2026-10-03T08:00:00'),
      meeting('passee-recente', '2026-09-30'),
      meeting('future-proche', '2026-10-05'),
    ];
    expect(sortLinkedMeetings(list, now).map(m => m.id)).toEqual([
      'aujourdhui', 'future-proche', 'future-lointaine', 'passee-recente', 'passee-ancienne',
    ]);
  });
  it('une date illisible passe en dernier, jamais « à venir »', () => {
    const list = [meeting('illisible', 'pas une date'), meeting('passee', '2026-01-01')];
    expect(sortLinkedMeetings(list, now).map(m => m.id)).toEqual(['passee', 'illisible']);
    expect(isUpcomingMeeting(list[0], now)).toBe(false);
  });
});
