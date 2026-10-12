import { describe, expect, it } from 'vitest';
import { buildGoogleEventBody, parseCalendarEventId } from '../server/googleCalendarEvent';

describe('corps d\'un événement Google Calendar', () => {
  it('jour entier : fin exclusive le lendemain', () => {
    expect(buildGoogleEventBody({ title: 'Visite', date: '2026-10-20' }).body).toEqual({ summary: 'Visite', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } });
  });

  it('plage horaire : une heure par défaut, passage de minuit compris', () => {
    expect(buildGoogleEventBody({ title: 'RDV', date: '2026-10-20', start_time: '09:30' }).body).toMatchObject({
      start: { dateTime: '2026-10-20T09:30:00', timeZone: 'Europe/Paris' }, end: { dateTime: '2026-10-20T10:30:00' },
    });
    expect(buildGoogleEventBody({ title: 'Nuit', date: '2026-10-20', start_time: '23:30' }).body).toMatchObject({ end: { dateTime: '2026-10-21T00:30:00' } });
  });

  it('refuse les dates, heures et plages invalides', () => {
    expect(buildGoogleEventBody({ date: '2026-10-20' }).error).toContain('titre');
    expect(buildGoogleEventBody({ title: 'x' }).error).toContain('date');
    expect(buildGoogleEventBody({ title: 'x', date: '20/10/2026' }).error).toContain('invalide');
    expect(buildGoogleEventBody({ title: 'x', date: '2026-10-20', start_time: '25:00' }).error).toContain('start_time');
    expect(buildGoogleEventBody({ title: 'x', date: '2026-10-20', start_time: '10:00', end_time: '09:00' }).error).toContain('fin');
    expect(buildGoogleEventBody({ title: 'x', date: '2026-10-20', end_date: '2026-10-19' }).error).toContain('précéder');
  });

  it('une modification n\'écrit que les champs fournis et exige la date pour changer l\'heure', () => {
    expect(buildGoogleEventBody({ title: 'Nouveau' }, true).body).toEqual({ summary: 'Nouveau' });
    expect(buildGoogleEventBody({ start_time: '10:00' }, true).error).toContain('date');
    expect(buildGoogleEventBody({}, true).error).toContain('Rien');
  });

  it('retrouve le calendrier et l\'événement dans un identifiant', () => {
    expect(parseCalendarEventId('google-123e4567-e89b-12d3-a456-426614174000-abc_def')).toEqual({ calendarId: '123e4567-e89b-12d3-a456-426614174000', eventId: 'abc_def' });
    expect(parseCalendarEventId('meeting-1')).toBeNull();
  });
});
