// Le pendant de server/mailAccounts.ts pour le calendrier : une connexion
// (calendar_connections) est un COMPTE Google, qui expose plusieurs
// calendriers (calendar_calendars) — primary, un agenda partagé « Chantiers »,
// etc. Deux booléens indépendants par calendrier : sync_enabled (affiché en
// lecture dans /calendar) et is_default (la cible d'écriture du push
// ArchiOffice → Google, unique par utilisateur, tous comptes confondus).
import { tenantScopedFrom } from './tenantScopedFrom';
import { getGoogleCalendarAccessToken } from './mailOAuthTokens';

export interface CalendarConnectionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: 'google';
  external_account_email: string | null;
  [key: string]: any;
}

export interface CalendarCalendarRow {
  id: string;
  tenant_id: string;
  user_id: string;
  connection_id: string;
  external_calendar_id: string;
  display_name: string | null;
  color: string | null;
  is_default: boolean;
  sync_enabled: boolean;
}

export async function resolveCalendarConnection(
  supabaseAdmin: any, tenantId: string, userId: string, connectionId?: string | null,
): Promise<CalendarConnectionRow | null> {
  const table = () => tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_connections');
  if (connectionId) {
    const { data } = await table().select('*').eq('id', connectionId).eq('user_id', userId).eq('provider', 'google').maybeSingle();
    return (data as CalendarConnectionRow) || null;
  }
  const { data: rows } = await table().select('*').eq('user_id', userId).eq('provider', 'google').order('created_at', { ascending: true }).limit(1);
  return (rows && rows[0]) || null;
}

/** Le calendrier cible du push (POST /api/google-calendar/sync), tous comptes de cet utilisateur confondus. */
export async function resolveWriteCalendar(supabaseAdmin: any, tenantId: string, userId: string): Promise<CalendarCalendarRow | null> {
  const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_calendars')
    .select('*').eq('user_id', userId).eq('is_default', true).maybeSingle();
  return (data as CalendarCalendarRow) || null;
}

/** Tous les calendriers affichés en lecture (GET /events les agrège tous). */
export async function listReadCalendars(supabaseAdmin: any, tenantId: string, userId: string): Promise<CalendarCalendarRow[]> {
  const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_calendars')
    .select('*').eq('user_id', userId).eq('sync_enabled', true);
  return (data as CalendarCalendarRow[]) || [];
}

/** Comptes + leurs calendriers, pour GET /api/calendar/accounts. */
export async function listCalendarAccounts(supabaseAdmin: any, tenantId: string, userId: string) {
  const { data: connections } = await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_connections')
    .select('id, provider, external_account_email, last_synced_at').eq('user_id', userId).order('created_at', { ascending: true });
  const { data: calendars } = await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_calendars')
    .select('id, connection_id, external_calendar_id, display_name, color, is_default, sync_enabled').eq('user_id', userId);
  return ((connections || []) as any[]).map(c => ({
    id: c.id,
    provider: c.provider,
    email: c.external_account_email || null,
    lastSyncedAt: c.last_synced_at || null,
    calendars: ((calendars || []) as any[])
      .filter(cal => cal.connection_id === c.id)
      .map(cal => ({
        id: cal.id,
        externalCalendarId: cal.external_calendar_id,
        displayName: cal.display_name || cal.external_calendar_id,
        color: cal.color || null,
        isDefault: !!cal.is_default,
        syncEnabled: !!cal.sync_enabled,
      })),
  }));
}

/**
 * Interroge calendarList chez Google et met calendar_calendars à jour
 * (upsert par external_calendar_id). Utilisée à la fois par le callback
 * OAuth (première découverte automatique des calendriers d'un compte) et
 * par POST /api/calendar/accounts/:id/refresh (rejouable à la main). Lève
 * en cas de scope insuffisant ou d'échec réseau — l'appelant décide s'il
 * s'agit d'une erreur bloquante (la route) ou d'un best-effort (le callback,
 * qui ne doit pas faire échouer toute la connexion pour ça).
 */
export async function refreshCalendarList(supabaseAdmin: any, tenantId: string, userId: string, connection: CalendarConnectionRow): Promise<void> {
  const accessToken = await getGoogleCalendarAccessToken(connection);
  const resp = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data: any = await resp.json();
  if (!resp.ok) {
    const err: any = new Error(data.error?.message || 'Échec de la récupération des calendriers Google');
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  const { data: existingCalendars } = await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_calendars')
    .select('*').eq('connection_id', connection.id);
  const byExternalId = new Map<string, any>((existingCalendars || []).map((c: any) => [c.external_calendar_id, c]));
  const hasAnyDefault = (existingCalendars || []).some((c: any) => c.is_default);

  for (const cal of (data.items || []) as any[]) {
    const existing = byExternalId.get(cal.id);
    if (existing) {
      await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_calendars')
        .update({ display_name: cal.summary || cal.id, color: cal.backgroundColor || null }).eq('id', existing.id);
    } else {
      // Le calendrier primary du compte s'affiche et se synchronise par
      // défaut à sa toute première découverte (comportement identique à
      // avant le multi-calendrier) ; un agenda partagé découvert après coup
      // ne s'active pas tout seul.
      const makeDefault = cal.primary && !hasAnyDefault;
      await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_calendars').insert({
        id: crypto.randomUUID(),
        user_id: userId,
        connection_id: connection.id,
        external_calendar_id: cal.id,
        display_name: cal.summary || cal.id,
        color: cal.backgroundColor || null,
        is_default: makeDefault,
        sync_enabled: !!cal.primary,
      });
    }
  }
}

/** Effacer-puis-poser, comme mailAccounts.setDefaultMailAccount et documentTemplates:set-default. */
export async function setDefaultCalendar(supabaseAdmin: any, tenantId: string, userId: string, calendarId: string): Promise<boolean> {
  const table = () => tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_calendars');
  const { data: target } = await table().select('id').eq('id', calendarId).eq('user_id', userId).maybeSingle();
  if (!target) return false;
  await table().update({ is_default: false }).eq('user_id', userId).eq('is_default', true);
  // Le calendrier cible de l'écriture doit forcément être affiché en lecture aussi.
  await table().update({ is_default: true, sync_enabled: true }).eq('id', calendarId);
  return true;
}
