// Contenu des réunions liées à une proposition, mis en forme pour le prompt de
// l'étude de faisabilité (server/routes/proposalFeasibilityAi.ts). Les réunions
// d'une proposition sont celles dont `meetings.proposal_id` désigne la fiche
// (visites, rendez-vous avec le client...). Source facultative : une proposition
// sans réunion, ou une lecture qui échoue, ne bloque jamais la rédaction.
import { tenantScopedFrom } from './tenantScopedFrom';

export const MAX_MEETINGS_CHARS = 12_000;
const MAX_MEETINGS = 20;

export interface MeetingRow { id: string; title?: string | null; date?: string | null; notes?: string | null }
export interface AttendeeRow { meeting_id: string; role?: string | null; contacts?: { name?: string | null; first_name?: string | null; last_name?: string | null } | null }

/** Les notes sont saisies dans un éditeur riche : on n'en garde que le texte. */
export function plainText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attendeeLabel(a: AttendeeRow): string {
  const c = a.contacts;
  const name = c?.name?.trim() || [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim();
  if (!name) return '';
  return a.role ? `${name} (${a.role})` : name;
}

function dateLabel(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
}

/**
 * Texte des réunions, de la plus ancienne à la plus récente, borné à
 * `MAX_MEETINGS_CHARS`. `extraByMeeting` porte le texte des documents rattachés
 * à chaque réunion. Chaîne vide quand il n'y a rien à lire.
 */
export function formatMeetingsForPrompt(
  meetings: MeetingRow[],
  attendees: AttendeeRow[] = [],
  extraByMeeting: Record<string, string> = {},
): string {
  const ordered = [...meetings].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
  let out = '';
  for (const m of ordered) {
    if (out.length >= MAX_MEETINGS_CHARS) break;
    const notes = plainText(m.notes);
    const extra = (extraByMeeting[m.id] ?? '').trim();
    if (!notes && !extra) continue;
    const who = attendees.filter(a => a.meeting_id === m.id).map(attendeeLabel).filter(Boolean).join(', ');
    const head = [m.title?.trim() || 'Réunion', dateLabel(m.date)].filter(Boolean).join(' du ');
    const block = `--- Réunion : ${head} ---\n${who ? `Participants : ${who}\n` : ''}${notes}${extra ? `\n${extra}` : ''}`;
    out += `\n\n${block.slice(0, MAX_MEETINGS_CHARS - out.length)}`;
  }
  return out.trim();
}

/**
 * Lit les réunions liées à la proposition (notes, participants, documents
 * rattachés à la réunion). `readDocs` est la lecture de texte des pièces jointes
 * déjà utilisée par l'étude. Jamais d'exception : au pire, chaîne vide.
 */
export async function loadProposalMeetingsText(
  supabaseAdmin: any,
  tenantId: string,
  proposalId: string,
  readDocs: (docs: Array<{ name: string; file_url: string; mime_type?: string | null }>) => Promise<string>,
): Promise<string> {
  try {
    const { data: meetings } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meetings')
      .select('id, title, date, notes').eq('proposal_id', proposalId).order('date', { ascending: true });
    const rows = ((meetings || []) as MeetingRow[]).slice(-MAX_MEETINGS);
    if (!rows.length) return '';

    const attendees: AttendeeRow[] = [];
    const extra: Record<string, string> = {};
    for (const m of rows) {
      const { data: att } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_attendees')
        .select('meeting_id, role, contacts(*)').eq('meeting_id', m.id).then((r: any) => r, () => ({ data: [] }));
      if (att?.length) attendees.push(...(att as AttendeeRow[]));
      const { data: docs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents')
        .select('name, file_url, mime_type').eq('resource_type', 'meetings').eq('resource_id', m.id);
      if (docs?.length) extra[m.id] = await readDocs(docs as any).catch(() => '');
    }
    return formatMeetingsForPrompt(rows, attendees, extra);
  } catch {
    return '';
  }
}
