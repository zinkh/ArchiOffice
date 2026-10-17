import { describe, expect, it } from 'vitest';
import type { PendingWrite } from '../../db';
import type { PhoneCall } from '../../types';
import {
  DEFAULT_PHONE_CALL_FILTERS, filterPhoneCalls, fromLocalInputValue, isCallbackOverdue,
  overlayPendingPhoneCalls, sortPhoneCalls, summarizeForAssignee, telHref, toLocalInputValue,
} from '../phoneCalls';

const call = (over: Partial<PhoneCall> = {}): PhoneCall => ({
  id: 'c1', direction: 'entrant', called_at: '2026-10-15T09:00:00.000Z', subject: 'Devis',
  status: 'a_traiter', priority: 'normal', ...over,
});

const write = (over: Partial<PendingWrite>): PendingWrite => ({
  id: 'w', tenantId: 't', method: 'POST', url: '/api/phone-calls', kind: 'json',
  entity: 'phoneCall', status: 'pending', attempts: 0, createdAt: 1, ...over,
});

describe('isCallbackOverdue', () => {
  it('compte un rappel dont l\'échéance est strictement passée', () => {
    expect(isCallbackOverdue(call({ callback_due: '2026-10-16' }), '2026-10-17')).toBe(true);
  });
  it('ne compte pas le jour même, ni un appel traité, ni une date absente ou illisible', () => {
    expect(isCallbackOverdue(call({ callback_due: '2026-10-17' }), '2026-10-17')).toBe(false);
    expect(isCallbackOverdue(call({ callback_due: '2026-10-01', status: 'traite' }), '2026-10-17')).toBe(false);
    expect(isCallbackOverdue(call({ callback_due: null }), '2026-10-17')).toBe(false);
    expect(isCallbackOverdue(call({ callback_due: 'bientôt' }), '2026-10-17')).toBe(false);
  });
});

describe('filterPhoneCalls', () => {
  const calls = [
    call({ id: 'a', assignee_id: 'u1', project_id: 'p1', caller_company: 'Charpentes Martin' }),
    call({ id: 'b', assignee_id: 'u2', status: 'traite' }),
    call({ id: 'c', assignee_id: null, status: 'en_cours', notes: 'Rappeler la mairie' }),
  ];
  const ids = (filters: Partial<typeof DEFAULT_PHONE_CALL_FILTERS>) =>
    filterPhoneCalls(calls, { ...DEFAULT_PHONE_CALL_FILTERS, ...filters }).map(c => c.id);

  it('masque les appels traités par défaut', () => expect(ids({})).toEqual(['a', 'c']));
  it('montre tout avec le statut « all »', () => expect(ids({ status: 'all' })).toEqual(['a', 'b', 'c']));
  it('filtre par collaborateur et par appels non attribués', () => {
    expect(ids({ assignee: 'u1' })).toEqual(['a']);
    expect(ids({ assignee: 'none' })).toEqual(['c']);
  });
  it('filtre par affaire', () => expect(ids({ project: 'p1' })).toEqual(['a']));
  it('cherche sans tenir compte de la casse, dans la société comme dans les notes', () => {
    expect(ids({ search: 'MARTIN' })).toEqual(['a']);
    expect(ids({ search: 'mairie' })).toEqual(['c']);
  });
});

describe('sortPhoneCalls', () => {
  it('range les plus récents d\'abord sans modifier la liste d\'origine', () => {
    const input = [call({ id: 'old', called_at: '2026-10-01T08:00:00.000Z' }), call({ id: 'new', called_at: '2026-10-16T08:00:00.000Z' })];
    expect(sortPhoneCalls(input).map(c => c.id)).toEqual(['new', 'old']);
    expect(input[0].id).toBe('old');
  });
});

describe('summarizeForAssignee', () => {
  it('compte les appels ouverts du collaborateur et ses rappels en retard', () => {
    const calls = [
      call({ id: '1', assignee_id: 'u1', callback_due: '2026-10-10' }),
      call({ id: '2', assignee_id: 'u1' }),
      call({ id: '3', assignee_id: 'u1', status: 'traite', callback_due: '2026-10-10' }),
      call({ id: '4', assignee_id: 'u2', callback_due: '2026-10-10' }),
    ];
    expect(summarizeForAssignee(calls, 'u1', '2026-10-17')).toEqual({ open: 2, overdue: 1 });
  });
});

describe('overlayPendingPhoneCalls', () => {
  it('ajoute une création en attente, marquée, sans doublonner une ligne déjà reçue', () => {
    const pending = [write({ jsonBody: { id: 'n1', subject: 'Saisi sur le chantier', called_at: '2026-10-17T07:00:00.000Z' } })];
    const once = overlayPendingPhoneCalls([], pending);
    expect(once).toHaveLength(1);
    expect(once[0]).toMatchObject({ id: 'n1', pendingSync: true });
    expect(overlayPendingPhoneCalls([call({ id: 'n1' })], pending)).toHaveLength(1);
  });
  it('applique une modification puis une suppression en attente, dans l\'ordre de la file', () => {
    const base = [call({ id: 'x', subject: 'Avant' }), call({ id: 'y' })];
    const edited = overlayPendingPhoneCalls(base, [write({ method: 'PUT', url: '/api/phone-calls/x', jsonBody: { subject: 'Après' } })]);
    expect(edited.find(c => c.id === 'x')).toMatchObject({ subject: 'Après', pendingSync: true });
    const removed = overlayPendingPhoneCalls(base, [write({ method: 'DELETE', url: '/api/phone-calls/y', jsonBody: undefined })]);
    expect(removed.map(c => c.id)).toEqual(['x']);
  });
  it('montre la tâche demandée hors ligne sur l\'appel, qui passe en cours', () => {
    const pending = [write({ url: '/api/phone-calls/c1/task', jsonBody: { task_id: 'task-offline-0001' } })];
    const [shown] = overlayPendingPhoneCalls([call({ id: 'c1' })], pending);
    expect(shown).toMatchObject({ task_id: 'task-offline-0001', status: 'en_cours', pendingSync: true });
  });
  it('ne change ni le statut d\'un appel déjà pris en charge, ni une tâche déjà liée', () => {
    const pending = [write({ url: '/api/phone-calls/c1/task', jsonBody: { task_id: 'nouvelle' } })];
    expect(overlayPendingPhoneCalls([call({ id: 'c1', task_id: 'ancienne' })], pending)[0].task_id).toBe('ancienne');
    expect(overlayPendingPhoneCalls([call({ id: 'c1', status: 'traite' })], pending)[0].status).toBe('traite');
  });
  it('ignore les écritures d\'une autre entité', () => {
    expect(overlayPendingPhoneCalls([], [write({ entity: 'meeting', jsonBody: { id: 'm', subject: 'x' } })])).toEqual([]);
  });
});

describe('telHref', () => {
  it('ne garde que les chiffres d\'un numéro saisi librement', () => {
    expect(telHref('06 84 01 66 33')).toBe('tel:0684016633');
    expect(telHref('03.83.00.00.00')).toBe('tel:0383000000');
    expect(telHref(' 03-83-00-00-00 ')).toBe('tel:0383000000');
  });
  it('conserve l\'indicatif international et retire le 0 entre parenthèses', () => {
    expect(telHref('+33 6 84 01 66 33')).toBe('tel:+33684016633');
    expect(telHref('+33 (0)6 84 01 66 33')).toBe('tel:+33684016633');
    expect(telHref('0033 6 84 01 66 33')).toBe('tel:+33684016633');
  });
  it('rend null pour une saisie qui n\'est pas un numéro', () => {
    expect(telHref(null)).toBeNull();
    expect(telHref(undefined)).toBeNull();
    expect(telHref('')).toBeNull();
    expect(telHref('à rappeler')).toBeNull();
    expect(telHref('12')).toBeNull();
  });
});

describe('conversion datetime-local', () => {
  it('fait l\'aller-retour sans décalage d\'heure', () => {
    const iso = '2026-10-17T10:30:00.000Z';
    expect(fromLocalInputValue(toLocalInputValue(iso))).toBe(iso);
  });
  it('rend une chaîne vide pour une date illisible', () => {
    expect(toLocalInputValue('pas une date')).toBe('');
  });
});
