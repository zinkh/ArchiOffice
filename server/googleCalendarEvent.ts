// Corps d'un événement Google Calendar à partir de ce qu'un client (un agent, un écran) envoie.
// Pur et sans réseau pour pouvoir être testé : validation des dates et heures, jour entier ou
// plage horaire, jamais d'invention d'une durée au-delà de « une heure par défaut ».

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CALENDAR_TIME_ZONE = 'Europe/Paris';
const MAX_TEXT = 4000;

export interface CalendarEventInput {
  title?: unknown; date?: unknown; end_date?: unknown; start_time?: unknown; end_time?: unknown;
  description?: unknown; location?: unknown;
}

const validDate = (v: string) => ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const clip = (v: unknown, max = MAX_TEXT) => String(v ?? '').trim().slice(0, max);

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addHour(date: string, time: string): { date: string; time: string } {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + 60;
  const next = total >= 24 * 60 ? addDays(date, 1) : date;
  const minutes = total % (24 * 60);
  return { date: next, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` };
}

/**
 * `partial` : une modification, où seuls les champs présents sont écrits. La date, les heures
 * et la date de fin se réécrivent ensemble : changer l'heure sans la date est refusé, pour ne
 * pas deviner le jour de l'événement.
 */
export function buildGoogleEventBody(input: CalendarEventInput, partial = false): { body?: Record<string, unknown>; error?: string } {
  const body: Record<string, unknown> = {};
  const title = clip(input.title, 300);
  if (input.title !== undefined || !partial) {
    if (!title) return { error: 'Le titre est requis.' };
    body.summary = title;
  }
  if (input.description !== undefined) body.description = clip(input.description);
  if (input.location !== undefined) body.location = clip(input.location, 500);

  const timesGiven = input.start_time !== undefined || input.end_time !== undefined || input.end_date !== undefined;
  if (input.date === undefined && !partial) return { error: 'La date (AAAA-MM-JJ) est requise.' };
  if (input.date === undefined && partial && timesGiven) return { error: "Pour changer l'heure ou la fin, précise aussi date (AAAA-MM-JJ)." };
  if (input.date !== undefined) {
    const date = clip(input.date, 10);
    if (!validDate(date)) return { error: 'date invalide : AAAA-MM-JJ attendu.' };
    const endDate = input.end_date !== undefined && clip(input.end_date) ? clip(input.end_date, 10) : date;
    if (!validDate(endDate)) return { error: 'end_date invalide : AAAA-MM-JJ attendu.' };
    if (endDate < date) return { error: 'La fin ne peut pas précéder le début.' };
    const start = clip(input.start_time, 5);
    if (!start) {
      // Jour entier : Google attend une fin exclusive.
      body.start = { date };
      body.end = { date: addDays(endDate, 1) };
    } else {
      if (!HOUR.test(start)) return { error: 'start_time invalide : HH:MM attendu.' };
      let end = clip(input.end_time, 5);
      let endDay = endDate;
      if (end) {
        if (!HOUR.test(end)) return { error: 'end_time invalide : HH:MM attendu.' };
      } else {
        const plusOne = addHour(endDate, start);
        end = plusOne.time; endDay = plusOne.date;
      }
      if (`${endDay}T${end}` <= `${date}T${start}`) return { error: "L'heure de fin doit être après l'heure de début." };
      body.start = { dateTime: `${date}T${start}:00`, timeZone: CALENDAR_TIME_ZONE };
      body.end = { dateTime: `${endDay}T${end}:00`, timeZone: CALENDAR_TIME_ZONE };
    }
  }
  if (partial && !Object.keys(body).length) return { error: 'Rien à modifier.' };
  return { body };
}

/** Les ids rendus par GET /events : `google-<id du calendrier>-<id Google de l'événement>`. */
export function parseCalendarEventId(id: string): { calendarId: string; eventId: string } | null {
  const m = /^google-([0-9a-fA-F-]{36})-(.+)$/.exec(id);
  return m ? { calendarId: m[1], eventId: m[2] } : null;
}
