import { db } from '../db';
import type { Contact, MeetingAttendee } from '../types';
import { listPendingWrites } from './offlineQueue';

/**
 * Intervenants d'une réunion, lisibles et modifiables sans réseau.
 *
 * Lecture : cache local d'abord, puis le serveur quand il répond ; les
 * écritures encore en file (`pendingWrites`, entité `meetingAttendee`) sont
 * REJOUÉES par-dessus le résultat. L'opération est idempotente : une écriture
 * qui a atteint le serveur entre-temps est déjà dans la liste et ne s'y ajoute
 * pas une seconde fois.
 *
 * Écriture : chaque appelant génère lui-même les identifiants (intervenant et,
 * pour un nouveau contact, la fiche contact), comme pour les réunions : le
 * serveur les accepte tels quels et rejoue sans doublon
 * (`server/routes/meetingAttendees.ts`).
 */

type AttendeeContact = NonNullable<MeetingAttendee['contact']>;

export const attendeesUrl = (meetingId: string) => `/api/meetings/${meetingId}/attendees`;

/** Fiche contact telle qu'affichée dans un intervenant. */
export function toAttendeeContact(c: Partial<Contact> & { id: string }): AttendeeContact {
  return {
    id: c.id,
    first_name: c.first_name ?? '',
    last_name: c.last_name ?? '',
    company_name: c.company_name,
    job_title: c.job_title,
    phone_mobile: c.phone_mobile,
    phone_work: c.phone_work,
    phone: c.phone ?? '',
    email: c.email ?? '',
    email_work: c.email_work,
    email_home: c.email_home,
  } as AttendeeContact;
}

/** Applique les écritures en file à une liste d'intervenants déjà connue. */
export function applyPendingAttendeeWrites(
  base: MeetingAttendee[],
  meetingId: string,
  writes: Array<{ method: string; url: string; jsonBody?: any }>,
  contactsById: Map<string, Contact>,
): MeetingAttendee[] {
  const root = attendeesUrl(meetingId);
  let list = [...base];
  for (const w of writes) {
    const body = w.jsonBody || {};
    if (w.method === 'POST' && w.url === root) {
      if (list.some(a => a.id === body.id || a.contact_id === body.contact_id)) continue;
      const contact = contactsById.get(body.contact_id);
      list.push({
        id: body.id, meeting_id: meetingId, contact_id: body.contact_id, role: body.role || '',
        contact: contact ? toAttendeeContact(contact) : undefined,
      });
    } else if (w.method === 'POST' && w.url === `${root}/new-contact`) {
      if (list.some(a => a.id === body.id)) continue;
      list.push({
        id: body.id, meeting_id: meetingId, contact_id: body.contact_id, role: body.role || '',
        contact: toAttendeeContact({
          id: body.contact_id, first_name: body.first_name, last_name: body.last_name,
          company_name: body.company_name, job_title: body.job_title,
          phone_mobile: body.phone_mobile, phone: body.phone_mobile, email: body.email,
        }),
      });
    } else if (w.method === 'PATCH' && w.url.startsWith(`${root}/`)) {
      const attendeeId = w.url.slice(root.length + 1);
      list = list.map(a => a.id === attendeeId ? { ...a, role: body.role } : a);
    } else if (w.method === 'DELETE' && w.url.startsWith(`${root}/`)) {
      const attendeeId = w.url.slice(root.length + 1);
      list = list.filter(a => a.id !== attendeeId);
    }
  }
  return list;
}

async function readCachedAttendees(meetingId: string): Promise<MeetingAttendee[]> {
  try { return await db.meetingAttendeesCache.where('meeting_id').equals(meetingId).toArray(); }
  catch { return []; }
}

async function readCachedContacts(): Promise<Contact[]> {
  try { return await db.contacts.toArray(); }
  catch { return []; }
}

async function pendingAttendeeWrites(meetingId: string) {
  const root = attendeesUrl(meetingId);
  return (await listPendingWrites('meetingAttendee')).filter(w => w.url === root || w.url.startsWith(`${root}/`));
}

/**
 * Intervenants d'une réunion : `onData` est appelé d'abord avec le cache (s'il
 * y en a un), puis avec la réponse du serveur. Rend ce qui est affiché au
 * final (cache seul hors ligne).
 */
export async function loadMeetingAttendees(
  meetingId: string,
  contacts: Contact[],
  onData?: (attendees: MeetingAttendee[]) => void,
): Promise<MeetingAttendee[]> {
  const contactsById = new Map(contacts.map(c => [c.id, c]));
  const withPending = async (list: MeetingAttendee[]) =>
    applyPendingAttendeeWrites(list, meetingId, await pendingAttendeeWrites(meetingId), contactsById);

  const cached = await readCachedAttendees(meetingId);
  let shown = await withPending(cached);
  if (cached.length > 0 || (await pendingAttendeeWrites(meetingId)).length > 0) onData?.(shown);

  if (!navigator.onLine) return shown;
  try {
    const response = await fetch(attendeesUrl(meetingId));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote: MeetingAttendee[] = (await response.json()).map((a: MeetingAttendee) => ({ ...a, meeting_id: meetingId }));
    shown = await withPending(remote);
    onData?.(shown);
    try {
      await db.transaction('rw', db.meetingAttendeesCache, async () => {
        await db.meetingAttendeesCache.where('meeting_id').equals(meetingId).delete();
        if (remote.length > 0) await db.meetingAttendeesCache.bulkPut(remote);
      });
    } catch { /* cache indisponible : l'affichage ne dépend pas de lui */ }
  } catch { /* réseau KO : on garde le cache */ }
  return shown;
}

/**
 * Annuaire de contacts : le serveur quand il répond, sinon le cache local
 * (rempli par les autres écrans).
 */
export async function loadContactsForAttendees(): Promise<Contact[]> {
  if (navigator.onLine) {
    try {
      const response = await fetch('/api/contacts');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contacts: Contact[] = await response.json();
      try { await db.contacts.bulkPut(contacts); } catch { /* cache indisponible */ }
      return contacts;
    } catch { /* retombe sur le cache */ }
  }
  return readCachedContacts();
}
