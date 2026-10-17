// Logique pure du journal des appels : retards, filtres et superposition des
// écritures encore en file hors ligne. Aucune dépendance au réseau ni à React,
// pour rester testable (src/lib/__tests__/phoneCalls.test.ts).
import type { PendingWrite } from '../db';
import type { PhoneCall } from '../types';

export interface PhoneCallFilters {
  /** 'all', 'none' (non attribués) ou l'identifiant d'un collaborateur. */
  assignee: string;
  /** 'all', 'open' (à traiter et en cours) ou un statut précis. */
  status: string;
  /** 'all' ou l'identifiant d'une affaire. */
  project: string;
  search: string;
}

export const DEFAULT_PHONE_CALL_FILTERS: PhoneCallFilters = { assignee: 'all', status: 'open', project: 'all', search: '' };

/** Un appel est « ouvert » tant qu'il n'est pas marqué traité. */
export function isOpenCall(call: Pick<PhoneCall, 'status'>): boolean {
  return call.status !== 'traite';
}

/**
 * Rappel en retard : échéance strictement passée sur un appel pas encore
 * traité. Une date absente ou illisible n'est jamais comptée comme un retard.
 */
export function isCallbackOverdue(call: Pick<PhoneCall, 'status' | 'callback_due'>, today: string): boolean {
  if (!isOpenCall(call) || !call.callback_due) return false;
  const due = String(call.callback_due).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today;
}

function haystack(call: PhoneCall): string {
  return [call.subject, call.caller_name, call.caller_company, call.caller_phone, call.caller_email, call.notes]
    .filter(Boolean).join(' ').toLowerCase();
}

export function filterPhoneCalls(calls: PhoneCall[], filters: PhoneCallFilters): PhoneCall[] {
  const needle = filters.search.trim().toLowerCase();
  return calls.filter(call => {
    if (filters.assignee === 'none' ? !!call.assignee_id : filters.assignee !== 'all' && call.assignee_id !== filters.assignee) return false;
    if (filters.status === 'open' ? !isOpenCall(call) : filters.status !== 'all' && call.status !== filters.status) return false;
    if (filters.project !== 'all' && call.project_id !== filters.project) return false;
    if (needle && !haystack(call).includes(needle)) return false;
    return true;
  });
}

/** Les plus récents d'abord ; à égalité, la création la plus récente. */
export function sortPhoneCalls(calls: PhoneCall[]): PhoneCall[] {
  return [...calls].sort((a, b) =>
    b.called_at.localeCompare(a.called_at) || (b.created_at || '').localeCompare(a.created_at || ''));
}

export interface PhoneCallSummary {
  open: number;
  overdue: number;
}

/** Appels à traiter pour un collaborateur, et parmi eux ceux dont le rappel est en retard. */
export function summarizeForAssignee(calls: PhoneCall[], assigneeId: string, today: string): PhoneCallSummary {
  const mine = calls.filter(c => c.assignee_id === assigneeId && isOpenCall(c));
  return { open: mine.length, overdue: mine.filter(c => isCallbackOverdue(c, today)).length };
}

const PENDING_ENTITY: PendingWrite['entity'] = 'phoneCall';

/**
 * Les écritures du journal encore en file (hors ligne), rejouées par-dessus la
 * liste lue : une création en attente est ajoutée (marquée `pendingSync`), une
 * modification en attente est appliquée, une suppression en attente retire la
 * ligne. Sans cela, une relecture du serveur faisait disparaître de l'écran un
 * appel saisi sur le chantier avant son envoi.
 */
export function overlayPendingPhoneCalls(calls: PhoneCall[], pending: PendingWrite[]): PhoneCall[] {
  let result = [...calls];
  const ordered = pending
    .filter(w => w.entity === PENDING_ENTITY && w.kind === 'json')
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const write of ordered) {
    const body = (write.jsonBody || {}) as Partial<PhoneCall>;
    const targetId = write.method === 'POST' ? body.id : write.url.split('/').pop();
    if (!targetId) continue;
    if (write.method === 'POST') {
      if (!result.some(c => c.id === targetId)) result = [{ ...(body as PhoneCall), id: targetId, pendingSync: true }, ...result];
    } else if (write.method === 'PUT') {
      result = result.map(c => (c.id === targetId ? { ...c, ...body, pendingSync: true } : c));
    } else if (write.method === 'DELETE') {
      result = result.filter(c => c.id !== targetId);
    }
  }
  return result;
}

/** Corps d'une nouvelle saisie : tout ce que le formulaire peut laisser vide l'est. */
export function emptyPhoneCallDraft(now: Date, defaults: Partial<PhoneCall> = {}): Partial<PhoneCall> {
  return {
    direction: 'entrant',
    called_at: now.toISOString(),
    status: 'a_traiter',
    priority: 'normal',
    ...defaults,
  };
}

/** `datetime-local` attend l'heure LOCALE sans fuseau : toISOString() la décalerait. */
export function toLocalInputValue(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInputValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
