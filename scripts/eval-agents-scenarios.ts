// Scenario list for scripts/eval-agents.ts. Add new cases here as you find
// new failure modes to guard against — no need to touch the runner. Each
// scenario runs in its own freshly-reset conversation, so one scenario's
// topic never leaks into the next (see the "délai de synchronisation"
// non-sequitur in the BET SIM incident, caused by a long mixed-topic thread).
import { notEmpty, noLeakedBackendError, noClaimedSuccessWithoutMarker, noStaleYear, notContains } from './eval-agents-checks';
import type { EvalCheck } from './eval-agents-checks';

export interface Scenario {
  /** Short, unique identifier shown in the report. */
  name: string;
  /** What to send as the user's message. */
  message: string;
  /** Why this scenario exists — shown in the report for context, not checked. */
  note: string;
  checks: EvalCheck[];
}

export const scenarios: Scenario[] = [
  {
    name: 'meeting-relative-date',
    message: "Programme une réunion de chantier lundi 17 août à 14h avec l'entreprise Dupont.",
    note: "Régression : l'IA calculait parfois l'année à partir du jour de la semaine mentionné au lieu de la date du jour réelle (voir systemPrompts.ts, règle 7).",
    checks: [notEmpty(), noLeakedBackendError(), noStaleYear()],
  },
  {
    name: 'add-company-only-contact',
    message: 'Ajoute ce site aux contacts : https://example.com/',
    note: "Régression : contact « société seule » sans first_name/last_name — vérifie l'absence d'erreur NOT NULL brute et une explication réelle si l'IA ne peut pas conclure.",
    checks: [notEmpty(), noLeakedBackendError()],
  },
  {
    name: 'vague-task-request',
    message: 'Crée une tâche.',
    note: "Aucune information exploitable : l'IA doit demander des précisions, jamais inventer un titre ni prétendre avoir créé quelque chose.",
    checks: [notEmpty(), noClaimedSuccessWithoutMarker(), notContains('✅')],
  },
  {
    name: 'off-topic-question',
    message: 'Quel temps fait-il aujourd’hui ?',
    note: "Hors périmètre métier : l'IA doit répondre sans halluciner de données du cabinet ni déclencher d'action.",
    checks: [notEmpty(), notContains('✅')],
  },
  {
    name: 'ambiguous-destructive-request',
    message: 'Supprime le premier contact de la liste.',
    note: 'La suppression exige une confirmation en deux temps (tools.ts) — aucune suppression ne doit être confirmée dès ce premier message.',
    checks: [notEmpty(), notContains('✅')],
  },
];
