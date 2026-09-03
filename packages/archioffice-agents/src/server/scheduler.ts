// ── Exécutions planifiées d'agents ──────────────────────────────────────────
// Une planification associe un agent, une consigne et une cadence (chaque
// jour, chaque semaine, chaque mois). À l'échéance, l'agent reçoit la consigne
// avec le contexte du cabinet et rend un compte rendu, publié dans le flux
// d'activité et conservé dans agent_schedule_runs.
//
// Volontairement en LECTURE SEULE : hors session, il n'existe aucun jeton
// d'authentification utilisateur à transmettre à l'API interne (c'est ce
// jeton qui fait qu'une action d'agent traverse exactement les mêmes
// contrôles qu'un formulaire rempli à la main, voir tools.ts). Plutôt que de
// fabriquer un jeton de service qui contournerait ces contrôles, une
// exécution planifiée n'appelle aucun outil : elle observe, elle rédige, et
// c'est l'architecte qui décide ensuite. Les écritures automatiques sont
// couvertes par le moteur d'alertes (server/agentAlerts.ts), dont le seul
// effet en base est de créer une alerte.
import type { AgentRow } from '../types.js';
import { buildAgentContext } from './context.js';
import { buildAgentSystemPrompt } from './systemPrompts.js';
import { resolveLlmProvider, getPlatformAiConfig, LlmNotConfiguredError } from './llm/index.js';

const DEFAULT_TICK_MINUTES = 15;
const RUN_TIMEOUT_MS = 120_000;

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export interface AgentSchedule {
  id: string;
  tenant_id: string;
  agent_id: string;
  name: string;
  prompt: string;
  frequency: ScheduleFrequency;
  hour_utc: number;
  weekday: number | null;
  day_of_month: number | null;
  enabled: boolean;
  notify_email: boolean;
  created_by: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface SchedulerDeps {
  /** Facturation du cabinet, comme pour une conversation ordinaire. */
  deductAiCredit?: (params: {
    tenantId: string; userId: string;
    agentId: string | null; conversationId: string | null;
    endpointType: 'agent' | 'suggest_articles';
    provider: string; model: string;
    inputTokens: number; outputTokens: number;
  }) => Promise<{ newBalance: number; costCents: number }>;
  /** Notification par email des administrateurs du cabinet. */
  notifyTenantAdmins?: (supabaseAdmin: any, tenantId: string, subject: string, html: string) => Promise<boolean>;
}

/**
 * Prochaine échéance strictement postérieure à `from`, en UTC.
 * Le jour du mois est plafonné à 28 par la contrainte de la table, ce qui
 * évite d'avoir à décider ce que vaut « le 31 » en février.
 */
export function computeNextRun(
  schedule: Pick<AgentSchedule, 'frequency' | 'hour_utc' | 'weekday' | 'day_of_month'>,
  from: Date
): Date {
  const hour = Math.min(Math.max(schedule.hour_utc ?? 6, 0), 23);
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, 0, 0, 0));

  if (schedule.frequency === 'daily') {
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  if (schedule.frequency === 'weekly') {
    const target = Math.min(Math.max(schedule.weekday ?? 1, 0), 6);
    let delta = (target - next.getUTCDay() + 7) % 7;
    if (delta === 0 && next <= from) delta = 7;
    next.setUTCDate(next.getUTCDate() + delta);
    return next;
  }

  const day = Math.min(Math.max(schedule.day_of_month ?? 1, 1), 28);
  next.setUTCDate(day);
  if (next <= from) {
    next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(day);
  }
  return next;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("L'agent n'a pas répondu dans le temps imparti.")), ms)),
  ]);
}

export interface ScheduleRunResult {
  status: 'ok' | 'error' | 'skipped';
  reply?: string;
  error?: string;
  tokensUsed: number;
}

export async function runSchedule(
  supabaseAdmin: any,
  schedule: AgentSchedule,
  deps: SchedulerDeps = {},
  now = new Date()
): Promise<ScheduleRunResult> {
  const startedAt = now.toISOString();

  const record = async (result: ScheduleRunResult, costCents?: number) => {
    await supabaseAdmin.from('agent_schedule_runs').insert({
      tenant_id: schedule.tenant_id,
      schedule_id: schedule.id,
      agent_id: schedule.agent_id,
      status: result.status,
      reply: result.reply ?? null,
      error: result.error ?? null,
      tokens_used: result.tokensUsed,
      cost_eur_cents: costCents ?? null,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
    await supabaseAdmin.from('agent_schedules').update({
      last_run_at: startedAt,
      next_run_at: computeNextRun(schedule, new Date(now.getTime() + 60_000)).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', schedule.id);
    return result;
  };

  const { data: agent } = await supabaseAdmin
    .from('agents').select('*')
    .eq('id', schedule.agent_id).eq('tenant_id', schedule.tenant_id).eq('is_active', true).maybeSingle();
  if (!agent) {
    return record({ status: 'skipped', error: "Agent introuvable ou désactivé.", tokensUsed: 0 });
  }

  // Une planification ne doit jamais faire basculer un cabinet en solde
  // négatif à son insu : sans crédit, l'exécution est sautée, pas facturée.
  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('ai_credit_balance_eur_cents, agent_billing_mode').eq('id', schedule.tenant_id).single();
  const billingMode = (tenant as any)?.agent_billing_mode ?? 'prepaid';
  const balance = (tenant as any)?.ai_credit_balance_eur_cents ?? 0;
  if (billingMode === 'prepaid' && balance <= 0) {
    return record({ status: 'skipped', error: 'Crédit IA épuisé — exécution planifiée sautée.', tokensUsed: 0 });
  }

  try {
    const ctx = await buildAgentContext(
      supabaseAdmin, schedule.tenant_id,
      schedule.created_by || '',
      (agent as any).context_scopes || [], []
    );
    const systemPrompt = buildAgentSystemPrompt(agent as AgentRow, ctx) +
      "\n\n═══ EXÉCUTION PLANIFIÉE ═══\n" +
      "Ce message n'est pas envoyé par une personne : il provient d'une tâche planifiée qui s'exécute sans surveillance. " +
      "Tu n'as ici AUCUN outil : tu ne peux ni écrire en base, ni envoyer de mail, ni consulter le web. " +
      "Réponds par un compte rendu écrit, autonome et daté, qui puisse être lu tel quel par l'architecte : " +
      "constat, points d'attention, actions recommandées. Si une information manque, dis-le au lieu de la supposer.";

    const provider = resolveLlmProvider(await getPlatformAiConfig(supabaseAdmin));
    const result = await withTimeout(
      provider.chat({ system: systemPrompt, messages: [{ role: 'user', content: schedule.prompt }], tools: [] }),
      RUN_TIMEOUT_MS
    );

    const tokensUsed = result.usage.inputTokens + result.usage.outputTokens;
    let costCents: number | undefined;
    if (tokensUsed > 0 && deps.deductAiCredit) {
      const deducted = await deps.deductAiCredit({
        tenantId: schedule.tenant_id,
        userId: schedule.created_by || '',
        agentId: schedule.agent_id, conversationId: null,
        endpointType: 'agent',
        provider: provider.id, model: provider.model,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      });
      costCents = deducted.costCents;
    }

    const reply = result.text?.trim() || "L'agent n'a produit aucun texte pour cette exécution.";

    await supabaseAdmin.from('activities').insert({
      id: crypto.randomUUID(),
      tenant_id: schedule.tenant_id,
      user_id: null,
      user_name: (agent as any).name || 'Agent IA',
      action: `Tâche planifiée « ${schedule.name} » exécutée`,
      target: schedule.name,
      target_id: schedule.id,
      target_type: 'agent_schedule',
      category: 'Alertes IA',
      created_at: new Date().toISOString(),
    }).then(() => {}, () => {});

    if (schedule.notify_email && deps.notifyTenantAdmins) {
      const html = `<h3>${schedule.name}</h3><pre style="white-space:pre-wrap;font-family:inherit">${reply
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
      await deps.notifyTenantAdmins(supabaseAdmin, schedule.tenant_id, `[ArchiOffice] ${schedule.name}`, html).catch(() => {});
    }

    return record({ status: 'ok', reply, tokensUsed }, costCents);
  } catch (e: any) {
    const message = e instanceof LlmNotConfiguredError
      ? "Aucun fournisseur IA n'est configuré sur cette instance."
      : (e?.message || 'Erreur inconnue');
    return record({ status: 'error', error: message, tokensUsed: 0 });
  }
}

/** Exécute les planifications dont l'échéance est passée. */
export async function runDueSchedules(supabaseAdmin: any, deps: SchedulerDeps = {}, now = new Date()): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('agent_schedules').select('*')
    .eq('enabled', true)
    .lte('next_run_at', now.toISOString());
  if (error) {
    console.error('[agentScheduler] lecture des planifications impossible:', error.message);
    return 0;
  }
  let ran = 0;
  for (const schedule of (data || []) as AgentSchedule[]) {
    try {
      const result = await runSchedule(supabaseAdmin, schedule, deps, now);
      console.log(`[agentScheduler] « ${schedule.name} » (${schedule.tenant_id}) : ${result.status}`);
      ran++;
    } catch (e: any) {
      console.error(`[agentScheduler] exécution en échec pour ${schedule.id}:`, e?.message);
    }
  }
  return ran;
}

// Une planification créée sans next_run_at (ou dont la cadence a changé) ne
// se déclencherait jamais : on la recale au démarrage et à chaque tick.
export async function backfillNextRuns(supabaseAdmin: any, now = new Date()): Promise<void> {
  const { data } = await supabaseAdmin
    .from('agent_schedules').select('id, frequency, hour_utc, weekday, day_of_month')
    .eq('enabled', true).is('next_run_at', null);
  for (const schedule of (data || []) as AgentSchedule[]) {
    await supabaseAdmin.from('agent_schedules')
      .update({ next_run_at: computeNextRun(schedule, now).toISOString() })
      .eq('id', schedule.id);
  }
}

export function startAgentScheduler(supabaseAdmin: any, deps: SchedulerDeps = {}): void {
  const tickMinutes = parseInt(process.env.AGENT_SCHEDULER_TICK_MINUTES || '', 10) || DEFAULT_TICK_MINUTES;
  const tick = async () => {
    await backfillNextRuns(supabaseAdmin).catch(() => {});
    await runDueSchedules(supabaseAdmin, deps);
  };
  tick().catch(e => console.error('[agentScheduler] premier tick en échec:', e.message));
  setInterval(() => { tick().catch(e => console.error('[agentScheduler] tick en échec:', e.message)); }, tickMinutes * 60 * 1000);
}
