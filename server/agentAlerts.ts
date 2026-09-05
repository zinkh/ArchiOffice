// ── Alertes métier des agents IA ────────────────────────────────────────────
// Le pendant automatique du chat : personne n'a besoin de poser la question
// pour que la situation soit détectée. Un cycle relit l'état du cabinet et
// crée une alerte par situation anormale (études engagées sans contrat signé,
// facture échue, réserves non levées...), la referme d'elle-même quand la
// cause disparaît, et la publie dans le flux d'activité.
//
// Même forme que les autres tâches de fond du serveur (tenderRssPoller.ts,
// notificationArchiver.ts) : une fonction de cycle exportée — donc testable
// sans horloge — et un start* appelé une fois depuis server.ts.
//
// Chaque règle porte son code, son seuil par défaut et sa gravité ; le
// cabinet peut désactiver une règle ou déplacer son seuil (table
// agent_alert_rules, voir server/routes/agentAlerts.ts). Un code retiré du
// serveur laisse simplement sa ligne de réglage inutilisée.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyTenantAdmins } from './mailer';
import { notifyTenantAdminsPush } from './push';

const DEFAULT_CHECK_INTERVAL_HOURS = 6;

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface DetectedAlert {
  dedupKey: string;
  title: string;
  message: string;
  targetType?: string;
  targetId?: string;
}

interface Row { [key: string]: any }

export interface TenantSnapshot {
  tenantId: string;
  now: Date;
  projects: Row[];
  phaseHistory: Row[];
  contrats: Row[];
  invoices: Row[];
  proposals: Row[];
  tenders: Row[];
  tasks: Row[];
  meetings: Row[];
  ordresDeService: Row[];
  reserves: Row[];
  notesHonoraires: Row[];
}

export interface AlertRuleDef {
  code: string;
  label: string;
  description: string;
  defaultSeverity: AlertSeverity;
  /** Délai de tolérance avant de signaler. null = pas de seuil réglable. */
  defaultThresholdDays: number | null;
  evaluate: (snapshot: TenantSnapshot, thresholdDays: number) => DetectedAlert[];
}

// Phases pendant lesquelles le cabinet produit des études : c'est le fait
// d'y entrer qui doit être couvert par un contrat signé.
const STUDY_PHASES = new Set(['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE']);
const SITE_PHASES = new Set(['ACT', 'VISA', 'DET', 'AOR']);

function daysSince(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

function daysUntil(value: string | null | undefined, now: Date): number | null {
  const since = daysSince(value, now);
  return since === null ? null : -since;
}

function projectLabel(project: Row): string {
  return project?.name || project?.project_code || project?.id || 'Projet sans nom';
}

/** Première entrée de phase du projet parmi un ensemble de phases. */
function firstPhaseEntry(snapshot: TenantSnapshot, projectId: string, phases: Set<string>): Row | null {
  const rows = snapshot.phaseHistory
    .filter(h => h.project_id === projectId && phases.has(String(h.phase || '').toUpperCase()))
    .sort((a, b) => String(a.entered_at).localeCompare(String(b.entered_at)));
  return rows[0] ?? null;
}

export const ALERT_RULES: AlertRuleDef[] = [
  {
    code: 'etudes_sans_contrat',
    label: 'Études engagées sans contrat signé',
    description:
      "Un projet est passé en phase d'études (ESQ, APS, APD, PC, PRO, DCE) ou est déclaré en cours alors qu'aucun contrat de maîtrise d'œuvre signé ne lui est rattaché.",
    defaultSeverity: 'critical',
    defaultThresholdDays: 15,
    evaluate(snapshot, thresholdDays) {
      const signedByProject = new Set(
        snapshot.contrats.filter(c => c.status === 'Signé' && c.project_id).map(c => String(c.project_id))
      );
      const alerts: DetectedAlert[] = [];
      for (const project of snapshot.projects) {
        if (project.status === 'Completed') continue;
        if (signedByProject.has(String(project.id))) continue;

        // Point de départ : l'entrée réelle en phase d'études quand
        // l'historique existe, sinon la date de début du projet, sinon rien
        // — on ne déclenche jamais sur une date inventée.
        const entry = firstPhaseEntry(snapshot, String(project.id), STUDY_PHASES);
        const startedAt = entry?.entered_at || (project.status === 'In Progress' ? project.start_date : null);
        const elapsed = daysSince(startedAt, snapshot.now);
        if (elapsed === null || elapsed < thresholdDays) continue;

        const phaseLabel = entry?.phase ? ` (phase ${entry.phase})` : '';
        alerts.push({
          dedupKey: `etudes_sans_contrat:${project.id}`,
          title: `Études sans contrat signé : ${projectLabel(project)}`,
          message:
            `Le projet « ${projectLabel(project)} » a démarré ses études${phaseLabel} il y a ${elapsed} jours ` +
            `et aucun contrat de maîtrise d'œuvre signé ne lui est rattaché. ` +
            `Produire des études sans contrat signé expose le cabinet sur sa rémunération comme sur sa responsabilité : ` +
            `faire signer le contrat, ou suspendre les études.`,
          targetType: 'project',
          targetId: String(project.id),
        });
      }
      return alerts;
    },
  },
  {
    code: 'chantier_sans_os',
    label: "Chantier démarré sans ordre de service",
    description: "Un projet est entré en phase chantier (ACT, VISA, DET, AOR) sans qu'aucun ordre de service ne soit enregistré.",
    defaultSeverity: 'warning',
    defaultThresholdDays: 10,
    evaluate(snapshot, thresholdDays) {
      const withOs = new Set(snapshot.ordresDeService.map(o => String(o.project_id)));
      const alerts: DetectedAlert[] = [];
      for (const project of snapshot.projects) {
        if (project.status === 'Completed') continue;
        if (withOs.has(String(project.id))) continue;
        const entry = firstPhaseEntry(snapshot, String(project.id), SITE_PHASES);
        const elapsed = daysSince(entry?.entered_at, snapshot.now);
        if (elapsed === null || elapsed < thresholdDays) continue;
        alerts.push({
          dedupKey: `chantier_sans_os:${project.id}`,
          title: `Chantier sans ordre de service : ${projectLabel(project)}`,
          message:
            `Le projet « ${projectLabel(project)} » est en phase ${entry?.phase} depuis ${elapsed} jours ` +
            `et aucun ordre de service n'a été émis. Le démarrage des travaux doit être notifié par OS.`,
          targetType: 'project',
          targetId: String(project.id),
        });
      }
      return alerts;
    },
  },
  {
    code: 'facture_echue',
    label: 'Facture échue impayée',
    description: "Une facture envoyée a dépassé sa date d'échéance sans être marquée payée.",
    defaultSeverity: 'critical',
    defaultThresholdDays: 0,
    evaluate(snapshot, thresholdDays) {
      const alerts: DetectedAlert[] = [];
      for (const invoice of snapshot.invoices) {
        if (invoice.status === 'Paid' || invoice.status === 'Draft') continue;
        const overdue = daysSince(invoice.due_date, snapshot.now);
        if (overdue === null || overdue < thresholdDays) continue;
        const amount = invoice.total_amount ?? invoice.amount;
        alerts.push({
          dedupKey: `facture_echue:${invoice.id}`,
          title: `Facture échue : ${invoice.invoice_number || invoice.id}`,
          message:
            `La facture ${invoice.invoice_number || invoice.id}` +
            `${amount ? ` (${amount} €)` : ''} est échue depuis ${overdue} jours et n'est pas marquée payée. Relance à envisager.`,
          targetType: 'invoice',
          targetId: String(invoice.id),
        });
      }
      return alerts;
    },
  },
  {
    code: 'devis_sans_suite',
    label: 'Devis envoyé sans réponse',
    description: "Un devis est à l'état « Envoyé » depuis plus longtemps que le seuil, sans acceptation ni refus.",
    defaultSeverity: 'warning',
    defaultThresholdDays: 30,
    evaluate(snapshot, thresholdDays) {
      const alerts: DetectedAlert[] = [];
      for (const proposal of snapshot.proposals) {
        if (proposal.status !== 'Sent') continue;
        const elapsed = daysSince(proposal.date_modification || proposal.created_at, snapshot.now);
        if (elapsed === null || elapsed < thresholdDays) continue;
        alerts.push({
          dedupKey: `devis_sans_suite:${proposal.id}`,
          title: `Devis sans réponse : ${proposal.title || proposal.id}`,
          message: `Le devis « ${proposal.title || proposal.id} » est envoyé depuis ${elapsed} jours sans réponse. Une relance est probablement utile.`,
          targetType: 'proposal',
          targetId: String(proposal.id),
        });
      }
      return alerts;
    },
  },
  {
    code: 'ao_echeance_proche',
    label: "Appel d'offres à échéance proche",
    description: "La date limite de remise d'un appel d'offres approche alors que la candidature n'est pas déposée.",
    defaultSeverity: 'critical',
    defaultThresholdDays: 7,
    evaluate(snapshot, thresholdDays) {
      const alerts: DetectedAlert[] = [];
      for (const tender of snapshot.tenders) {
        if (tender.archived) continue;
        if (tender.status !== 'Draft') continue;
        const remaining = daysUntil(tender.submission_deadline, snapshot.now);
        if (remaining === null || remaining > thresholdDays) continue;
        alerts.push({
          dedupKey: `ao_echeance_proche:${tender.id}`,
          title: `Échéance appel d'offres : ${tender.title || tender.id}`,
          message: remaining < 0
            ? `La date limite de remise de « ${tender.title} » est dépassée de ${-remaining} jours et la candidature est toujours au brouillon.`
            : `La remise de « ${tender.title} » est dans ${remaining} jour(s) et la candidature est toujours au brouillon.`,
          targetType: 'tender',
          targetId: String(tender.id),
        });
      }
      return alerts;
    },
  },
  {
    code: 'contrat_signe_sans_facturation',
    label: 'Contrat signé jamais facturé',
    description: "Un contrat de maîtrise d'œuvre est signé depuis longtemps sans qu'aucune facture ni note d'honoraires ne soit rattachée à son projet.",
    defaultSeverity: 'warning',
    defaultThresholdDays: 45,
    evaluate(snapshot, thresholdDays) {
      const billedProjects = new Set([
        ...snapshot.invoices.map(i => String(i.project_id)),
        ...snapshot.notesHonoraires.map(n => String(n.project_id)),
      ]);
      const billedContrats = new Set(snapshot.notesHonoraires.map(n => String(n.contrat_id)));
      const alerts: DetectedAlert[] = [];
      for (const contrat of snapshot.contrats) {
        if (contrat.status !== 'Signé') continue;
        if (billedContrats.has(String(contrat.id))) continue;
        if (contrat.project_id && billedProjects.has(String(contrat.project_id))) continue;
        const elapsed = daysSince(contrat.date_debut || contrat.created_at, snapshot.now);
        if (elapsed === null || elapsed < thresholdDays) continue;
        alerts.push({
          dedupKey: `contrat_signe_sans_facturation:${contrat.id}`,
          title: `Contrat signé non facturé : ${contrat.intitule_projet || contrat.numero || contrat.id}`,
          message:
            `Le contrat « ${contrat.intitule_projet || contrat.numero || contrat.id} » est signé depuis ${elapsed} jours ` +
            `et aucune facture ni note d'honoraires n'y est rattachée.`,
          targetType: 'contrat_moe',
          targetId: String(contrat.id),
        });
      }
      return alerts;
    },
  },
  {
    code: 'reserves_non_levees',
    label: 'Réserves non levées',
    description: "Des réserves de réception restent ouvertes au-delà du délai fixé.",
    defaultSeverity: 'warning',
    defaultThresholdDays: 30,
    evaluate(snapshot, thresholdDays) {
      const open = snapshot.reserves.filter(r => {
        const status = String(r.status || '');
        return status !== 'Levée' && status !== 'Quitus Transmis';
      });
      const byProject = new Map<string, Row[]>();
      for (const reserve of open) {
        const elapsed = daysSince(reserve.due_date || reserve.created_at, snapshot.now);
        if (elapsed === null || elapsed < thresholdDays) continue;
        const key = String(reserve.project_id || 'sans-projet');
        byProject.set(key, [...(byProject.get(key) || []), reserve]);
      }
      // Une alerte par projet plutôt qu'une par réserve : une réception en
      // porte couramment plusieurs dizaines, et cinquante notifications pour
      // une seule situation rendraient le flux inutilisable.
      return [...byProject.entries()].map(([projectId, rows]) => {
        const project = snapshot.projects.find(p => String(p.id) === projectId);
        return {
          dedupKey: `reserves_non_levees:${projectId}`,
          title: `Réserves non levées : ${project ? projectLabel(project) : 'projet inconnu'}`,
          message: `${rows.length} réserve(s) restent ouvertes au-delà de ${thresholdDays} jours sur ce projet.`,
          targetType: 'project',
          targetId: projectId,
        };
      });
    },
  },
  {
    code: 'reunion_sans_compte_rendu',
    label: 'Réunion sans compte rendu',
    description: "Une réunion passée n'a toujours aucune note ni compte rendu saisi.",
    defaultSeverity: 'info',
    defaultThresholdDays: 7,
    evaluate(snapshot, thresholdDays) {
      const alerts: DetectedAlert[] = [];
      for (const meeting of snapshot.meetings) {
        if (String(meeting.notes || '').trim()) continue;
        const elapsed = daysSince(meeting.date, snapshot.now);
        if (elapsed === null || elapsed < thresholdDays) continue;
        alerts.push({
          dedupKey: `reunion_sans_compte_rendu:${meeting.id}`,
          title: `Compte rendu manquant : ${meeting.title || meeting.id}`,
          message: `La réunion « ${meeting.title} » s'est tenue il y a ${elapsed} jours et aucun compte rendu n'a été saisi.`,
          targetType: 'meeting',
          targetId: String(meeting.id),
        });
      }
      return alerts;
    },
  },
  {
    code: 'tache_en_retard',
    label: 'Tâches en retard',
    description: "Des tâches ont dépassé leur date de fin sans être terminées.",
    defaultSeverity: 'info',
    defaultThresholdDays: 3,
    evaluate(snapshot, thresholdDays) {
      const late = snapshot.tasks.filter(t => {
        if (t.status === 'done') return false;
        const elapsed = daysSince(t.due_date || t.end_date, snapshot.now);
        return elapsed !== null && elapsed >= thresholdDays;
      });
      const byProject = new Map<string, Row[]>();
      for (const task of late) {
        const key = String(task.project_id || 'sans-projet');
        byProject.set(key, [...(byProject.get(key) || []), task]);
      }
      return [...byProject.entries()].map(([projectId, rows]) => {
        const project = snapshot.projects.find(p => String(p.id) === projectId);
        return {
          dedupKey: `tache_en_retard:${projectId}`,
          title: `Tâches en retard : ${project ? projectLabel(project) : 'hors projet'}`,
          message: `${rows.length} tâche(s) ont dépassé leur échéance de plus de ${thresholdDays} jours : ${rows.slice(0, 5).map(r => r.title).join(', ')}${rows.length > 5 ? '…' : ''}.`,
          targetType: 'project',
          targetId: projectId,
        };
      });
    },
  },
];

export const ALERT_RULES_BY_CODE = new Map(ALERT_RULES.map(r => [r.code, r]));

// ── Chargement de l'état d'un cabinet ───────────────────────────────────────
async function selectAll(supabaseAdmin: SupabaseClient, table: string, tenantId: string, columns: string): Promise<Row[]> {
  const { data, error } = await supabaseAdmin.from(table).select(columns).eq('tenant_id', tenantId);
  if (error) {
    console.error(`[agentAlerts] lecture de ${table} impossible pour ${tenantId}: ${error.message}`);
    return [];
  }
  return (data || []) as unknown as Row[];
}

export async function loadTenantSnapshot(supabaseAdmin: SupabaseClient, tenantId: string, now = new Date()): Promise<TenantSnapshot> {
  const [projects, phaseHistory, contrats, invoices, proposals, tenders, tasks, meetings, ordresDeService, reserves, notesHonoraires] =
    await Promise.all([
      selectAll(supabaseAdmin, 'projects', tenantId, 'id, name, status, start_date, end_date, project_code'),
      selectAll(supabaseAdmin, 'project_phase_history', tenantId, 'project_id, phase, entered_at, exited_at'),
      selectAll(supabaseAdmin, 'contrats_moe', tenantId, 'id, project_id, status, numero, intitule_projet, date_debut, created_at'),
      selectAll(supabaseAdmin, 'invoices', tenantId, 'id, project_id, status, due_date, invoice_number, amount, total_amount'),
      selectAll(supabaseAdmin, 'proposals', tenantId, 'id, title, status, created_at, date_modification'),
      selectAll(supabaseAdmin, 'tenders', tenantId, 'id, title, status, submission_deadline, archived'),
      selectAll(supabaseAdmin, 'tasks', tenantId, 'id, project_id, title, status, end_date, due_date, assignee_id'),
      selectAll(supabaseAdmin, 'meetings', tenantId, 'id, title, date, notes'),
      selectAll(supabaseAdmin, 'ordres_de_service', tenantId, 'id, project_id, date'),
      selectAll(supabaseAdmin, 'reserves', tenantId, 'id, project_id, status, created_at, due_date'),
      selectAll(supabaseAdmin, 'notes_honoraires', tenantId, 'id, project_id, contrat_id, date'),
    ]);
  return { tenantId, now, projects, phaseHistory, contrats, invoices, proposals, tenders, tasks, meetings, ordresDeService, reserves, notesHonoraires };
}

export interface RuleSetting {
  code: string;
  enabled: boolean;
  threshold_days: number | null;
  severity: AlertSeverity;
  notify_email: boolean;
}

/** Réglages du cabinet, complétés par les valeurs par défaut des règles. */
export function effectiveSettings(stored: RuleSetting[]): RuleSetting[] {
  const byCode = new Map(stored.map(s => [s.code, s]));
  return ALERT_RULES.map(rule => {
    const s = byCode.get(rule.code);
    return {
      code: rule.code,
      enabled: s ? s.enabled : true,
      threshold_days: s?.threshold_days ?? rule.defaultThresholdDays,
      severity: s?.severity ?? rule.defaultSeverity,
      notify_email: s?.notify_email ?? false,
    };
  });
}

export interface EvaluationOutcome {
  detected: (DetectedAlert & { code: string; severity: AlertSeverity; notifyEmail: boolean })[];
  /** Clés d'alertes ouvertes qui ne sont plus détectées : à refermer. */
  evaluatedCodes: string[];
}

export function evaluateSnapshot(snapshot: TenantSnapshot, settings: RuleSetting[]): EvaluationOutcome {
  const detected: EvaluationOutcome['detected'] = [];
  const evaluatedCodes: string[] = [];
  for (const setting of settings) {
    const rule = ALERT_RULES_BY_CODE.get(setting.code);
    if (!rule || !setting.enabled) continue;
    evaluatedCodes.push(rule.code);
    const threshold = setting.threshold_days ?? rule.defaultThresholdDays ?? 0;
    let found: DetectedAlert[] = [];
    try {
      found = rule.evaluate(snapshot, threshold);
    } catch (e: any) {
      // Une règle qui casse (donnée inattendue en base) ne doit pas empêcher
      // les autres de tourner.
      console.error(`[agentAlerts] règle ${rule.code} en échec pour ${snapshot.tenantId}: ${e?.message}`);
      continue;
    }
    for (const alert of found) {
      detected.push({ ...alert, code: rule.code, severity: setting.severity, notifyEmail: setting.notify_email });
    }
  }
  return { detected, evaluatedCodes };
}

async function publishActivity(supabaseAdmin: SupabaseClient, tenantId: string, alert: { title: string; targetType?: string; targetId?: string }) {
  await supabaseAdmin.from('activities').insert({
    id: randomUUID(),
    tenant_id: tenantId,
    user_id: null,
    user_name: 'Agent IA',
    action: alert.title,
    target: alert.title,
    target_id: alert.targetId ?? null,
    target_type: alert.targetType ?? null,
    category: 'Alertes IA',
    created_at: new Date().toISOString(),
  });
}

export async function runAlertCycleForTenant(supabaseAdmin: SupabaseClient, tenantId: string, now = new Date()): Promise<number> {
  const { data: storedRules } = await supabaseAdmin
    .from('agent_alert_rules')
    .select('code, enabled, threshold_days, severity, notify_email')
    .eq('tenant_id', tenantId);

  const settings = effectiveSettings((storedRules || []) as unknown as RuleSetting[]);
  const snapshot = await loadTenantSnapshot(supabaseAdmin, tenantId, now);
  const { detected, evaluatedCodes } = evaluateSnapshot(snapshot, settings);

  const { data: openRows } = await supabaseAdmin
    .from('agent_alerts')
    .select('id, dedup_key, rule_code, status')
    .eq('tenant_id', tenantId)
    .neq('status', 'resolved');
  const open = (openRows || []) as unknown as Row[];
  const openByKey = new Map(open.map(a => [String(a.dedup_key), a]));
  const detectedKeys = new Set(detected.map(d => d.dedupKey));

  let created = 0;
  for (const alert of detected) {
    if (openByKey.has(alert.dedupKey)) continue;
    const { error } = await supabaseAdmin.from('agent_alerts').insert({
      tenant_id: tenantId,
      rule_code: alert.code,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      target_type: alert.targetType ?? null,
      target_id: alert.targetId ?? null,
      dedup_key: alert.dedupKey,
      status: 'open',
      detected_at: now.toISOString(),
      notified_at: alert.notifyEmail ? now.toISOString() : null,
    });
    // La contrainte (tenant_id, dedup_key) rend l'insertion idempotente :
    // une course entre deux cycles se solde par un conflit, pas un doublon.
    if (error) continue;
    created++;
    await publishActivity(supabaseAdmin, tenantId, alert).catch(() => {});
    // La notification système part pour toute alerte créée, indépendamment de
    // notify_email : couper le mail d'une règle veut dire « pas dans ma boîte
    // de réception », pas « ne me préviens jamais ». Le filtrage propre à ce
    // canal est la préférence par personne (profiles.notification_prefs).
    await notifyTenantAdminsPush(supabaseAdmin, tenantId, {
      title: alert.title,
      body: alert.message,
      url: '/notifications',
      category: 'Alertes IA',
      // Une alerte déjà affichée et non lue est remplacée par sa version la
      // plus récente au lieu d'empiler un doublon.
      tag: `alert:${alert.dedupKey}`,
    });
    if (alert.notifyEmail) {
      await notifyTenantAdmins(
        supabaseAdmin,
        tenantId,
        `[ArchiOffice] ${alert.title}`,
        `<p>${alert.message}</p><p style="color:#666;font-size:12px">Alerte automatique ArchiOffice (règle ${alert.code}).</p>`
      ).catch(() => {});
    }
  }

  // Refermeture automatique : une alerte ouverte dont la règle a bien été
  // réévaluée et qui n'est plus détectée n'a plus lieu d'être. Les alertes
  // dont la règle a été désactivée entre-temps sont laissées telles quelles
  // plutôt que refermées à tort.
  const stale = open.filter(a => evaluatedCodes.includes(String(a.rule_code)) && !detectedKeys.has(String(a.dedup_key)));
  if (stale.length > 0) {
    await supabaseAdmin
      .from('agent_alerts')
      .update({ status: 'resolved', resolved_at: now.toISOString() })
      .in('id', stale.map(a => a.id));
  }

  return created;
}

export async function runAlertCycle(supabaseAdmin: SupabaseClient): Promise<void> {
  const { data: tenants, error } = await supabaseAdmin.from('tenants').select('id');
  if (error) {
    console.error('[agentAlerts] liste des cabinets impossible:', error.message);
    return;
  }
  for (const tenant of (tenants || []) as unknown as Row[]) {
    try {
      const created = await runAlertCycleForTenant(supabaseAdmin, String(tenant.id));
      if (created > 0) console.log(`[agentAlerts] ${created} alerte(s) créée(s) pour le cabinet ${tenant.id}`);
    } catch (e: any) {
      console.error(`[agentAlerts] cycle en échec pour ${tenant.id}:`, e?.message);
    }
  }
}

export function startAgentAlerts(supabaseAdmin: SupabaseClient): void {
  const intervalHours = parseInt(process.env.AGENT_ALERTS_INTERVAL_HOURS || '', 10) || DEFAULT_CHECK_INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  runAlertCycle(supabaseAdmin).catch(e => console.error('[agentAlerts] premier cycle en échec:', e.message));
  setInterval(() => {
    runAlertCycle(supabaseAdmin).catch(e => console.error('[agentAlerts] cycle en échec:', e.message));
  }, intervalMs);
}
