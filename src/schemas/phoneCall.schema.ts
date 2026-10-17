// Valide POST /api/phone-calls et PUT /api/phone-calls/:id.
//
// Les trois listes de valeurs ci-dessous sont la source unique du vocabulaire
// des appels : l'écran, le serveur et les agents s'y réfèrent plutôt que de
// redéclarer leur propre copie. Les priorités sont celles des tâches, pour
// qu'un appel devenu tâche garde la sienne telle quelle.
import { z } from 'zod';
import { TASK_PRIORITIES } from './task.schema';

export const PHONE_CALL_DIRECTIONS = ['entrant', 'sortant'] as const;
export const PHONE_CALL_STATUSES = ['a_traiter', 'en_cours', 'traite'] as const;
export const PHONE_CALL_PRIORITIES = TASK_PRIORITIES;

export type PhoneCallDirection = (typeof PHONE_CALL_DIRECTIONS)[number];
export type PhoneCallStatus = (typeof PHONE_CALL_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'date au format YYYY-MM-DD attendue');
const isoDateTime = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'date et heure ISO attendues');

export const createPhoneCallSchema = z.object({
  id: z.string().optional(),
  subject: z.string().trim().min(1, 'subject is required'),
  direction: z.enum(PHONE_CALL_DIRECTIONS).optional(),
  called_at: isoDateTime.optional(),
  duration_minutes: z.number().int().min(0).max(1440).nullish(),
  caller_name: z.string().nullish(),
  caller_company: z.string().nullish(),
  caller_phone: z.string().nullish(),
  caller_email: z.string().nullish(),
  contact_id: z.string().nullish(),
  project_id: z.string().nullish(),
  notes: z.string().nullish(),
  assignee_id: z.string().nullish(),
  status: z.enum(PHONE_CALL_STATUSES).optional(),
  priority: z.enum(PHONE_CALL_PRIORITIES).optional(),
  callback_due: z.union([isoDate, z.literal('')]).nullish(),
});

// .passthrough() comme les tâches : l'écran renvoie au PUT la ligne telle que
// l'API la lui a rendue (tenant_id, created_at...). La protection contre
// l'écriture d'un champ inattendu est la liste blanche du handler.
export const updatePhoneCallSchema = createPhoneCallSchema.partial().passthrough();
