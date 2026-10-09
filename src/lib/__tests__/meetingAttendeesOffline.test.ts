import { describe, expect, it } from 'vitest';
import { applyPendingAttendeeWrites, attendeesUrl } from '../meetingAttendeesOffline';
import type { Contact, MeetingAttendee } from '../../types';

const meetingId = 'm1';
const root = attendeesUrl(meetingId);
const jean = { id: 'c1', first_name: 'Jean', last_name: 'Dupont' } as Contact;
const contacts = new Map([[jean.id, jean]]);

describe('applyPendingAttendeeWrites', () => {
  it('shows an existing contact added offline, with its contact card', () => {
    const list = applyPendingAttendeeWrites([], meetingId, [
      { method: 'POST', url: root, jsonBody: { id: 'a1', contact_id: 'c1', role: 'MOE' } },
    ], contacts);
    expect(list).toHaveLength(1);
    expect(list[0].contact?.last_name).toBe('Dupont');
    expect(list[0].role).toBe('MOE');
  });

  it('builds the contact of a new attendee from the queued form', () => {
    const list = applyPendingAttendeeWrites([], meetingId, [
      { method: 'POST', url: `${root}/new-contact`, jsonBody: { id: 'a2', contact_id: 'c2', first_name: 'Claire', last_name: 'Petit', role: 'BET' } },
    ], contacts);
    expect(list[0].contact_id).toBe('c2');
    expect(list[0].contact?.first_name).toBe('Claire');
  });

  it('does not add twice an attendee the server already returns', () => {
    const server: MeetingAttendee[] = [{ id: 'a1', contact_id: 'c1', role: 'MOE' }];
    const list = applyPendingAttendeeWrites(server, meetingId, [
      { method: 'POST', url: root, jsonBody: { id: 'a1', contact_id: 'c1', role: 'MOE' } },
    ], contacts);
    expect(list).toHaveLength(1);
  });

  it('applies queued role changes and removals in order', () => {
    const server: MeetingAttendee[] = [
      { id: 'a1', contact_id: 'c1', role: '' },
      { id: 'a3', contact_id: 'c3', role: '' },
    ];
    const list = applyPendingAttendeeWrites(server, meetingId, [
      { method: 'PATCH', url: `${root}/a1`, jsonBody: { role: 'MOA' } },
      { method: 'DELETE', url: `${root}/a3` },
    ], contacts);
    expect(list).toEqual([{ id: 'a1', contact_id: 'c1', role: 'MOA' }]);
  });
});
