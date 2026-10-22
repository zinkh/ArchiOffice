// Copilot "next steps" suggestion engine — rule-based, no AI call.
//
// This module is intentionally framework-free (no React/DOM) so it can be
// imported both from the frontend bundle (Dashboard.tsx, the global
// AgentChat badge) and from the Express backend (server/routes/copilotSuggestions.ts),
// which computes the same suggestions for pages other than the Dashboard.
//
// computeCopilotSuggestions() returns raw descriptors (type + params) rather
// than final text, so the i18n formatting stays entirely on the client via
// formatCopilotSuggestion() — the server never needs a translation layer.
import type { Project, Milestone } from '../types';
import { resumeQualifications, resumeAssurance, resumeRge, parContact, joursAvant, normaliserSiret, type Qualification } from './qualifications';

const MAX_SUGGESTIONS = 10;
// Plafond par type de suggestion : sans lui, un type très bavard (une carte par
// affaire en retard de jalons) occupait toute la liste et masquait les autres.
const MAX_PER_TYPE = 3;
const BEHIND_SCHEDULE_WINDOW_DAYS = 14;
const BEHIND_SCHEDULE_PROGRESS_THRESHOLD = 80;
const TASK_DUE_SOON_DAYS = 3;
const PROPOSAL_NO_ANSWER_DAYS = 15;
const TENDER_DEADLINE_WINDOW_DAYS = 7;
const TENDER_DEADLINE_URGENT_DAYS = 2;
const INVOICE_DUE_SOON_DAYS = 7;
const DRAFT_INVOICE_STALE_DAYS = 7;
const MAX_TITLES = 3;
// Données qu'une fiche d'affaire en cours doit porter ; une clé = `ai_field_<clé>`.
const PROJECT_REQUIRED_FIELDS = ['address', 'start_date', 'end_date', 'project_code', 'project_manager', 'surface', 'construction_cost'] as const;
const MEETING_MINUTES_DAYS = 3;
const RESERVE_DONE_STATUSES = ['Levée', 'Quitus Transmis'];
const CONTRACT_NOT_INVOICED_DAYS = 45;
const PERMIT_ALERT_DAYS = 10;
const PERMIT_ALERT_PAST_DAYS = 30;
// Délais d'instruction de droit commun (mois), à vérifier selon le dossier.
const PERMIT_DELAY_MONTHS: Record<string, number> = { DP: 1, PC: 3, AT: 4 };
const OS_UNACKNOWLEDGED_DAYS = 7;
const SITUATION_TO_VERIFY_DAYS = 10;
const WORKLOAD_MAX_OPEN_TASKS = 15;
const QUALIFICATION_ALERT_DAYS = 30;
const MAX_NAMES = 3;
const DAY_MS = 86400000;

// `status` is typed loosely (not the `Invoice` interface's capitalized enum)
// because rows fetched straight from Supabase have been observed with both
// casings ("overdue" and "Overdue") — same tolerance the original Dashboard
// rule (pre-extraction) applied.
export interface CopilotInvoiceInput {
  id: string;
  invoice_number: string;
  project_name?: string | null;
  client?: string | null;
  status: string;
  total_amount?: number;
  amount?: number;
  due_date?: string | null;
  issue_date?: string | null;
  created_at?: string | null;
  project_id?: string | null;
}

export interface CopilotTaskInput {
  id: string;
  project_id?: string | null;
  title: string;
  status?: string | null;
  progress?: number | null;
  due_date?: string | null;
  end_date?: string | null;
  assignee_id?: string | null;
}

export interface CopilotProposalInput {
  id: string;
  title: string;
  reference?: string | null;
  client_name?: string | null;
  nom_societe?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface CopilotTenderInput {
  id: string;
  title: string;
  client?: string | null;
  status?: string | null;
  submission_deadline?: string | null;
  archived?: boolean | null;
}

export interface CopilotMeetingInput { id: string; title?: string | null; date?: string | null; notes?: string | null }
export interface CopilotReserveInput { id: string; project_id?: string | null; status?: string | null; due_date?: string | null }
export interface CopilotContractInput { id: string; project_id?: string | null; status?: string | null; intitule_projet?: string | null; numero?: string | null; date_debut?: string | null; created_at?: string | null }
export interface CopilotFeeNoteInput { project_id?: string | null; contrat_id?: string | null }
export interface CopilotPermitInput { id: string; project_id?: string | null; type?: string | null; reference?: string | null; submission_date?: string | null; status?: string | null }
export interface CopilotLotInput { id?: string; project_id?: string | null; contact_id?: string | null; lot_number?: string | null; lot_title?: string | null; rge_required?: boolean | null }

export interface CopilotContactInput {
  id: string; first_name?: string | null; last_name?: string | null; company_name?: string | null;
  email?: string | null; email_work?: string | null; phone?: string | null; phone_mobile?: string | null; phone_work?: string | null;
  siret?: string | null;
}
export interface CopilotOrderInput { id: string; project_id?: string | null; status?: string | null; date?: string | null }
export interface CopilotSituationInput { id: string; project_id?: string | null; etat?: string | null; date_situation?: string | null }
export interface CopilotObservationInput { id: string; project_id?: string | null; statut?: string | null; due_date?: string | null }
export interface CopilotMarketInput {
  id: string; project_id?: string | null; entreprise_nom?: string | null; contact_id?: string | null; act_entreprise_id?: string | null; lot_numero?: string | null;
  type_marche?: string | null; statut?: string | null; statut_signature?: string | null; date_notification?: string | null;
}
export interface CopilotConsultationInput { project_id?: string | null; consultation?: { pieces_admin?: { id: string; nom?: string }[]; pieces_recues?: Record<string, string[]> } | null }
export interface CopilotDocumentInput { project_id?: string | null; contact_id?: string | null; name?: string | null; description?: string | null; doc_type?: string | null }
export interface CopilotPersonInput { id: string; name?: string | null }

export type CopilotSuggestionRaw =
  | { id: string; tone: 'danger'; type: 'overdue_milestone'; params: { project: string; client: string; count: number; titles: string } }
  | { id: string; tone: 'warning'; type: 'project_behind'; params: { project: string; client: string; progress: number; days: number } }
  | { id: string; tone: 'danger'; type: 'invoice_overdue'; params: { number: string; client: string; amount: number } }
  | { id: string; tone: 'danger'; type: 'task_overdue'; params: { project: string; count: number; titles: string } }
  | { id: string; tone: 'warning'; type: 'task_due_soon'; params: { count: number; titles: string } }
  | { id: string; tone: 'warning'; type: 'proposal_no_answer'; params: { title: string; client: string; days: number } }
  | { id: string; tone: 'danger' | 'warning'; type: 'tender_deadline'; params: { title: string; client: string; days: number } }
  | { id: string; tone: 'warning'; type: 'invoice_due_soon'; params: { count: number; amount: number; numbers: string } }
  | { id: string; tone: 'warning'; type: 'meeting_no_minutes'; params: { title: string; days: number } }
  | { id: string; tone: 'danger'; type: 'reserves_open'; params: { project: string; count: number } }
  | { id: string; tone: 'warning'; type: 'contract_not_invoiced'; params: { title: string; days: number } }
  | { id: string; tone: 'warning'; type: 'project_no_contract'; params: { project: string } }
  | { id: string; tone: 'warning'; type: 'task_unassigned'; params: { count: number; titles: string } }
  | { id: string; tone: 'danger' | 'warning'; type: 'permit_deadline'; params: { reference: string; kind: string; days: number } }
  | { id: string; tone: 'warning'; type: 'lots_without_company'; params: { project: string; count: number } }
  | { id: string; tone: 'warning'; type: 'company_no_contact'; params: { count: number; names: string } }
  | { id: string; tone: 'warning'; type: 'company_no_siret'; params: { count: number; names: string } }
  | { id: string; tone: 'warning'; type: 'os_unacknowledged'; params: { project: string; count: number } }
  | { id: string; tone: 'warning'; type: 'situation_to_verify'; params: { project: string; count: number; days: number } }
  | { id: string; tone: 'danger'; type: 'observations_overdue'; params: { project: string; count: number } }
  | { id: string; tone: 'danger' | 'warning'; type: 'qualification_expiring'; params: { company: string; days: number } }
  | { id: string; tone: 'warning'; type: 'insurance_missing'; params: { project: string; count: number; names: string } }
  | { id: string; tone: 'danger' | 'warning'; type: 'insurance_expiring'; params: { project: string; company: string; days: number } }
  | { id: string; tone: 'danger' | 'warning'; type: 'rge_required'; params: { project: string; lot: string; company: string; state: 'missing' | 'expired' | 'soon'; days: number } }
  | { id: string; tone: 'warning'; type: 'workload'; params: { name: string; count: number } }
  | { id: string; tone: 'warning'; type: 'project_incomplete'; params: { project: string; fields: string[] } }
  | { id: string; tone: 'warning'; type: 'invoice_draft_stale'; params: { count: number; amount: number; numbers: string } };

export interface CopilotSuggestion {
  id: string;
  tone: 'danger' | 'warning';
  text: string;
  draft: string;
}

const strip = (v: string | null | undefined) =>
  (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Une date absente ou illisible n'est jamais comptée comme un retard.
function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);
const invoiceAmount = (inv: CopilotInvoiceInput) => inv.total_amount || inv.amount || 0;
const joinTitles = (titles: string[]) => {
  const shown = titles.slice(0, MAX_TITLES).join(', ');
  return titles.length > MAX_TITLES ? `${shown}…` : shown;
};

function overdueMilestones(projects: Project[], milestones: Milestone[], now: Date): CopilotSuggestionRaw[] {
  const byProject = new Map<string, Milestone[]>();
  milestones
    .filter(m => !m.completed && m.project_id && new Date(m.due_date) < now)
    .forEach(m => {
      const arr = byProject.get(m.project_id!) || [];
      arr.push(m);
      byProject.set(m.project_id!, arr);
    });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, ms] of byProject) {
    const project = projects.find(p => p.id === projectId);
    if (!project) continue;
    list.push({
      id: `overdue-milestone-${projectId}`,
      tone: 'danger',
      type: 'overdue_milestone',
      params: { project: project.name, client: project.client, count: ms.length, titles: ms.map(m => m.title).join(', ') },
    });
  }
  // Les affaires les plus en retard d'abord.
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

function projectsBehind(projects: Project[], now: Date): CopilotSuggestionRaw[] {
  const list: CopilotSuggestionRaw[] = [];
  projects
    .filter(p => p.status === 'In Progress' && p.end_date)
    .forEach(p => {
      const daysLeft = Math.ceil((new Date(p.end_date).getTime() - now.getTime()) / DAY_MS);
      if (daysLeft >= 0 && daysLeft <= BEHIND_SCHEDULE_WINDOW_DAYS && (p.progression || 0) < BEHIND_SCHEDULE_PROGRESS_THRESHOLD) {
        list.push({
          id: `behind-schedule-${p.id}`,
          tone: 'warning',
          type: 'project_behind',
          params: { project: p.name, client: p.client, progress: p.progression || 0, days: daysLeft },
        });
      }
    });
  return list;
}

function meetingsWithoutMinutes(meetings: CopilotMeetingInput[], now: Date): CopilotSuggestionRaw[] {
  const list: CopilotSuggestionRaw[] = [];
  meetings.forEach(m => {
    if ((m.notes ?? '').trim()) return;
    const d = parseDate(m.date);
    if (!d) return;
    const days = daysBetween(d, now);
    if (days < MEETING_MINUTES_DAYS) return;
    list.push({ id: `meeting-no-minutes-${m.id}`, tone: 'warning', type: 'meeting_no_minutes', params: { title: m.title || '', days } });
  });
  return list.sort((a, b) => (a.params as { days: number }).days - (b.params as { days: number }).days);
}

function overdueReserves(projects: Project[], reserves: CopilotReserveInput[], now: Date): CopilotSuggestionRaw[] {
  const byProject = new Map<string, number>();
  reserves.forEach(r => {
    if (RESERVE_DONE_STATUSES.includes(r.status ?? '')) return;
    const d = parseDate(r.due_date);
    if (!d || d >= now) return;
    const key = r.project_id || '';
    byProject.set(key, (byProject.get(key) || 0) + 1);
  });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, count] of byProject) {
    const project = projects.find(p => p.id === projectId);
    if (!project) continue;
    list.push({ id: `reserves-open-${projectId}`, tone: 'danger', type: 'reserves_open', params: { project: project.name, count } });
  }
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

function contractsNotInvoiced(
  contracts: CopilotContractInput[], notes: CopilotFeeNoteInput[], invoices: CopilotInvoiceInput[], now: Date,
): CopilotSuggestionRaw[] {
  const billedProjects = new Set([...invoices.map(i => i.project_id), ...notes.map(n => n.project_id)].filter(Boolean));
  const billedContracts = new Set(notes.map(n => n.contrat_id).filter(Boolean));
  const list: CopilotSuggestionRaw[] = [];
  contracts.forEach(c => {
    if (c.status !== 'Signé' || billedContracts.has(c.id) || (c.project_id && billedProjects.has(c.project_id))) return;
    const d = parseDate(c.date_debut || c.created_at);
    if (!d) return;
    const days = daysBetween(d, now);
    if (days < CONTRACT_NOT_INVOICED_DAYS) return;
    list.push({ id: `contract-not-invoiced-${c.id}`, tone: 'warning', type: 'contract_not_invoiced', params: { title: c.intitule_projet || c.numero || '', days } });
  });
  return list.sort((a, b) => (b.params as { days: number }).days - (a.params as { days: number }).days);
}

function projectsWithoutContract(projects: Project[], contracts: CopilotContractInput[]): CopilotSuggestionRaw[] {
  const withContract = new Set(contracts.map(c => c.project_id).filter(Boolean));
  return projects
    .filter(p => p.status === 'In Progress' && !withContract.has(p.id))
    .map(p => ({ id: `project-no-contract-${p.id}`, tone: 'warning' as const, type: 'project_no_contract' as const, params: { project: p.name } }));
}

function unassignedTasks(tasks: CopilotTaskInput[]): CopilotSuggestionRaw[] {
  const open = tasks.filter(t => isOpenTask(t) && !t.assignee_id);
  if (open.length === 0) return [];
  return [{ id: 'tasks-unassigned', tone: 'warning', type: 'task_unassigned', params: { count: open.length, titles: joinTitles(open.map(t => t.title)) } }];
}

function permitsDue(permits: CopilotPermitInput[], now: Date): CopilotSuggestionRaw[] {
  const list: CopilotSuggestionRaw[] = [];
  permits.forEach(p => {
    if (p.status !== 'en_instruction') return;
    const months = PERMIT_DELAY_MONTHS[p.type ?? ''];
    const submitted = parseDate(p.submission_date);
    if (!months || !submitted) return;
    const limit = new Date(submitted);
    limit.setMonth(limit.getMonth() + months);
    const days = Math.ceil((limit.getTime() - now.getTime()) / DAY_MS);
    if (days > PERMIT_ALERT_DAYS || days < -PERMIT_ALERT_PAST_DAYS) return;
    list.push({
      id: `permit-deadline-${p.id}`,
      tone: days <= 3 ? 'danger' : 'warning',
      type: 'permit_deadline',
      params: { reference: p.reference || '', kind: p.type || '', days },
    });
  });
  return list.sort((a, b) => (a.params as { days: number }).days - (b.params as { days: number }).days);
}

function lotsWithoutCompany(projects: Project[], lots: CopilotLotInput[]): CopilotSuggestionRaw[] {
  const missing = new Map<string, number>();
  lots.forEach(l => {
    if (l.contact_id || !l.project_id) return;
    missing.set(l.project_id, (missing.get(l.project_id) || 0) + 1);
  });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, count] of missing) {
    const project = projects.find(p => p.id === projectId);
    if (!project || project.status !== 'In Progress') continue;
    list.push({ id: `lots-no-company-${projectId}`, tone: 'warning', type: 'lots_without_company', params: { project: project.name, count } });
  }
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

const contactName = (c: CopilotContactInput) =>
  (c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`).trim() || '—';
const namesOf = (list: CopilotContactInput[]) => {
  const shown = list.slice(0, MAX_NAMES).map(contactName).join(', ');
  return list.length > MAX_NAMES ? `${shown}…` : shown;
};
const lotHolders = (lots: CopilotLotInput[], contacts: CopilotContactInput[]) => {
  const ids = new Set(lots.map(l => l.contact_id).filter(Boolean));
  return contacts.filter(c => ids.has(c.id));
};

function companiesWithoutContact(lots: CopilotLotInput[], contacts: CopilotContactInput[]): CopilotSuggestionRaw[] {
  const missing = lotHolders(lots, contacts).filter(c =>
    !(c.email || c.email_work || '').trim() && !(c.phone || c.phone_mobile || c.phone_work || '').trim());
  if (missing.length === 0) return [];
  return [{ id: 'companies-no-contact', tone: 'warning', type: 'company_no_contact', params: { count: missing.length, names: namesOf(missing) } }];
}

function companiesWithoutSiret(lots: CopilotLotInput[], contacts: CopilotContactInput[]): CopilotSuggestionRaw[] {
  const missing = lotHolders(lots, contacts).filter(c => normaliserSiret(c.siret).length !== 14);
  if (missing.length === 0) return [];
  return [{ id: 'companies-no-siret', tone: 'warning', type: 'company_no_siret', params: { count: missing.length, names: namesOf(missing) } }];
}

const projectName = (projects: Project[], id: string | null | undefined) => projects.find(p => p.id === id)?.name;

function unacknowledgedOrders(projects: Project[], orders: CopilotOrderInput[], now: Date): CopilotSuggestionRaw[] {
  const byProject = new Map<string, number>();
  orders.forEach(o => {
    if (strip(o.status) !== 'submitted') return;
    const d = parseDate(o.date);
    if (!d || daysBetween(d, now) < OS_UNACKNOWLEDGED_DAYS) return;
    byProject.set(o.project_id || '', (byProject.get(o.project_id || '') || 0) + 1);
  });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, count] of byProject) {
    const project = projectName(projects, projectId);
    if (project) list.push({ id: `os-unacknowledged-${projectId}`, tone: 'warning', type: 'os_unacknowledged', params: { project, count } });
  }
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

function situationsToVerify(projects: Project[], situations: CopilotSituationInput[], now: Date): CopilotSuggestionRaw[] {
  const byProject = new Map<string, { count: number; days: number }>();
  situations.forEach(s => {
    if (strip(s.etat) !== 'brouillon') return;
    const d = parseDate(s.date_situation);
    if (!d) return;
    const days = daysBetween(d, now);
    if (days < SITUATION_TO_VERIFY_DAYS) return;
    const cur = byProject.get(s.project_id || '') || { count: 0, days: 0 };
    byProject.set(s.project_id || '', { count: cur.count + 1, days: Math.max(cur.days, days) });
  });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, v] of byProject) {
    const project = projectName(projects, projectId);
    if (project) list.push({ id: `situation-to-verify-${projectId}`, tone: 'warning', type: 'situation_to_verify', params: { project, ...v } });
  }
  return list.sort((a, b) => (b.params as { days: number }).days - (a.params as { days: number }).days);
}

function overdueObservations(projects: Project[], observations: CopilotObservationInput[], now: Date): CopilotSuggestionRaw[] {
  const byProject = new Map<string, number>();
  observations.forEach(o => {
    if (strip(o.statut) === 'levee') return;
    const d = parseDate(o.due_date);
    if (!d || d >= now) return;
    byProject.set(o.project_id || '', (byProject.get(o.project_id || '') || 0) + 1);
  });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, count] of byProject) {
    const project = projectName(projects, projectId);
    if (project) list.push({ id: `observations-overdue-${projectId}`, tone: 'danger', type: 'observations_overdue', params: { project, count } });
  }
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

function expiringQualifications(
  lots: CopilotLotInput[], contacts: CopilotContactInput[], qualifications: Qualification[], now: Date,
): CopilotSuggestionRaw[] {
  const today = now.toISOString().slice(0, 10);
  const byContact = parContact(qualifications);
  const list: CopilotSuggestionRaw[] = [];
  lotHolders(lots, contacts).forEach(c => {
    // Sans aucune qualification enregistrée : on ne sait rien, on ne signale rien.
    const resume = resumeQualifications(byContact[c.id] || [], today);
    const fin = resume.principale?.date_fin;
    if (!fin || (resume.statut !== 'expiree' && resume.statut !== 'bientot')) return;
    const days = joursAvant(fin, today);
    if (days > QUALIFICATION_ALERT_DAYS) return;
    list.push({ id: `qualification-expiring-${c.id}`, tone: days < 0 ? 'danger' : 'warning', type: 'qualification_expiring', params: { company: contactName(c), days } });
  });
  return list.sort((a, b) => (a.params as { days: number }).days - (b.params as { days: number }).days);
}

const INSURANCE_PATTERN = /assurance|decennale/;

// Une entreprise notifiée (marché notifié ou signé, ni résilié ni subséquent) doit
// justifier de son assurance avant d'exécuter : pièce cochée dans l'ACT, ou
// document de l'affaire rattaché à l'entreprise (fiche ou nom cité).
const isNotifiedMarket = (m: CopilotMarketInput) =>
  (!!m.date_notification || m.statut_signature === 'signe') && strip(m.statut) !== 'resilie' && m.type_marche !== 'subsequent' && !!m.project_id;

function missingInsurance(
  projects: Project[], markets: CopilotMarketInput[], consultations: CopilotConsultationInput[], documents: CopilotDocumentInput[],
  qualifications: Qualification[],
): CopilotSuggestionRaw[] {
  const byContact = parContact(qualifications);
  const insuranceDocs = documents.filter(d => INSURANCE_PATTERN.test(strip(`${d.name ?? ''} ${d.description ?? ''} ${d.doc_type ?? ''}`)));
  const byProject = new Map<string, string[]>();
  markets.forEach(m => {
    if (!isNotifiedMarket(m) || !m.project_id) return;
    // Une attestation saisie sur la fiche de l'entreprise (avec sa validité) vaut présence.
    if (m.contact_id && (byContact[m.contact_id] ?? []).some(q => q.organisme === 'assurance')) return;
    const consultation = consultations.find(c => c.project_id === m.project_id)?.consultation;
    const insurancePieceIds = (consultation?.pieces_admin ?? [])
      .filter(p => p.id === 'assurance' || INSURANCE_PATTERN.test(strip(p.nom)))
      .map(p => p.id);
    const received = (m.act_entreprise_id && consultation?.pieces_recues?.[m.act_entreprise_id]) || [];
    if (insurancePieceIds.some(id => received.includes(id))) return;
    const company = strip(m.entreprise_nom);
    const hasDocument = insuranceDocs.some(d => d.project_id === m.project_id
      && ((!!m.contact_id && d.contact_id === m.contact_id) || (company.length >= 3 && strip(`${d.name ?? ''} ${d.description ?? ''}`).includes(company))));
    if (hasDocument) return;
    byProject.set(m.project_id, [...(byProject.get(m.project_id) || []), m.entreprise_nom || '—']);
  });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, names] of byProject) {
    const project = projectName(projects, projectId);
    if (!project) continue;
    const unique = [...new Set(names)];
    list.push({
      id: `insurance-missing-${projectId}`, tone: 'warning', type: 'insurance_missing',
      params: { project, count: unique.length, names: unique.slice(0, MAX_NAMES).join(', ') + (unique.length > MAX_NAMES ? '…' : '') },
    });
  }
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

function expiringInsurance(
  projects: Project[], markets: CopilotMarketInput[], qualifications: Qualification[], now: Date,
): CopilotSuggestionRaw[] {
  const today = now.toISOString().slice(0, 10);
  const byContact = parContact(qualifications);
  const seen = new Set<string>();
  const list: CopilotSuggestionRaw[] = [];
  markets.forEach(m => {
    if (!isNotifiedMarket(m) || !m.contact_id) return;
    const key = `${m.project_id}:${m.contact_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Sans date de fin saisie, on ne sait rien de la validité : rien n'est signalé.
    const resume = resumeAssurance(byContact[m.contact_id] ?? [], today);
    const fin = resume.principale?.date_fin;
    if (!fin || (resume.statut !== 'expiree' && resume.statut !== 'bientot')) return;
    const days = joursAvant(fin, today);
    const project = projectName(projects, m.project_id);
    if (!project || days > QUALIFICATION_ALERT_DAYS) return;
    list.push({
      id: `insurance-expiring-${key}`, tone: days < 0 ? 'danger' : 'warning', type: 'insurance_expiring',
      params: { project, company: m.entreprise_nom || '—', days },
    });
  });
  return list.sort((a, b) => (a.params as { days: number }).days - (b.params as { days: number }).days);
}

const lotKey = (n: string | null | undefined) => (n ?? '').trim().toLowerCase().replace(/^0+(?=\d)/, '');

// Un lot qui exige le RGE : l'entreprise titulaire (fiche du lot, à défaut le
// marché du même numéro) doit porter une qualification RGE en cours de validité.
// Ici l'absence de toute qualification EST signalée : c'est le lot qui l'exige.
function rgeRequiredLots(
  projects: Project[], lots: CopilotLotInput[], markets: CopilotMarketInput[], contacts: CopilotContactInput[],
  qualifications: Qualification[], now: Date,
): CopilotSuggestionRaw[] {
  const today = now.toISOString().slice(0, 10);
  const byContact = parContact(qualifications);
  const list: CopilotSuggestionRaw[] = [];
  lots.forEach(l => {
    if (!l.rge_required || !l.project_id) return;
    const project = projects.find(p => p.id === l.project_id);
    if (!project || ['completed', 'termine', 'livre', 'clos', 'archive'].some(k => strip(project.status).startsWith(k))) return;
    const contactId = l.contact_id
      || markets.find(m => m.project_id === l.project_id && m.type_marche !== 'subsequent' && strip(m.statut) !== 'resilie' && lotKey(m.lot_numero) === lotKey(l.lot_number))?.contact_id;
    const contact = contacts.find(c => c.id === contactId);
    if (!contactId || !contact) return;
    const resume = resumeRge(byContact[contactId] ?? [], today);
    const fin = resume.principale?.date_fin;
    const days = fin ? joursAvant(fin, today) : 0;
    let state: 'missing' | 'expired' | 'soon' | null = null;
    if (resume.statut === 'aucune') state = 'missing';
    else if (resume.statut === 'expiree') state = 'expired';
    else if (resume.statut === 'bientot' && days <= QUALIFICATION_ALERT_DAYS) state = 'soon';
    if (!state) return;
    list.push({
      id: `rge-required-${l.id ?? `${l.project_id}-${l.lot_number}`}`,
      tone: state === 'soon' ? 'warning' : 'danger',
      type: 'rge_required',
      params: { project: project.name, lot: [l.lot_number, l.lot_title].filter(Boolean).join(' '), company: contactName(contact), state, days },
    });
  });
  const rank = { missing: 0, expired: 1, soon: 2 } as const;
  return list.sort((a, b) => rank[(a.params as { state: 'missing' | 'expired' | 'soon' }).state] - rank[(b.params as { state: 'missing' | 'expired' | 'soon' }).state]);
}

function overloadedPeople(tasks: CopilotTaskInput[], people: CopilotPersonInput[]): CopilotSuggestionRaw[] {
  const counts = new Map<string, number>();
  tasks.filter(isOpenTask).forEach(t => { if (t.assignee_id) counts.set(t.assignee_id, (counts.get(t.assignee_id) || 0) + 1); });
  const list: CopilotSuggestionRaw[] = [];
  for (const [id, count] of counts) {
    if (count <= WORKLOAD_MAX_OPEN_TASKS) continue;
    list.push({ id: `workload-${id}`, tone: 'warning', type: 'workload', params: { name: people.find(p => p.id === id)?.name || '', count } });
  }
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

function incompleteProjects(projects: Project[]): CopilotSuggestionRaw[] {
  const list: CopilotSuggestionRaw[] = [];
  projects
    .filter(p => !['completed', 'termine', 'livre', 'clos', 'archive'].some(k => strip(p.status).startsWith(k)))
    .forEach(p => {
      const record = p as unknown as Record<string, unknown>;
      const fields = PROJECT_REQUIRED_FIELDS.filter(f => {
        const v = record[f];
        return v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (typeof v === 'number' && v <= 0);
      });
      if (fields.length === 0) return;
      list.push({ id: `incomplete-project-${p.id}`, tone: 'warning', type: 'project_incomplete', params: { project: p.name, fields: [...fields] } });
    });
  // Les fiches les plus lacunaires d'abord.
  return list.sort((a, b) => (b.params as { fields: string[] }).fields.length - (a.params as { fields: string[] }).fields.length);
}

function overdueInvoices(invoices: CopilotInvoiceInput[]): CopilotSuggestionRaw[] {
  return invoices
    .filter(inv => strip(inv.status) === 'overdue')
    .map(inv => ({
      id: `overdue-invoice-${inv.id}`,
      tone: 'danger' as const,
      type: 'invoice_overdue' as const,
      params: { number: inv.invoice_number, client: inv.project_name || inv.client || '', amount: invoiceAmount(inv) },
    }));
}

// Une tâche est ouverte tant qu'elle n'est ni « done » ni à 100 % (même règle
// que getTaskStatus, src/components/tasks/taskDisplay.ts).
const isOpenTask = (t: CopilotTaskInput) => strip(t.status) !== 'done' && (t.progress ?? 0) < 100;
const taskDeadline = (t: CopilotTaskInput) => parseDate(t.due_date || t.end_date);

function overdueTasks(projects: Project[], tasks: CopilotTaskInput[], now: Date): CopilotSuggestionRaw[] {
  const byProject = new Map<string, CopilotTaskInput[]>();
  tasks.filter(isOpenTask).forEach(t => {
    const d = taskDeadline(t);
    if (!d || d >= now) return;
    const key = t.project_id || '';
    const arr = byProject.get(key) || [];
    arr.push(t);
    byProject.set(key, arr);
  });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, ts] of byProject) {
    const project = projects.find(p => p.id === projectId);
    list.push({
      id: `overdue-task-${projectId || 'none'}`,
      tone: 'danger',
      type: 'task_overdue',
      // Une tâche interne, sans affaire, reste signalée avec un nom vide
      // (le texte i18n sait l'afficher).
      params: { project: project?.name || '', count: ts.length, titles: joinTitles(ts.map(t => t.title)) },
    });
  }
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

function tasksDueSoon(tasks: CopilotTaskInput[], now: Date): CopilotSuggestionRaw[] {
  const soon = tasks.filter(t => {
    if (!isOpenTask(t)) return false;
    const d = taskDeadline(t);
    if (!d) return false;
    const days = (d.getTime() - now.getTime()) / DAY_MS;
    return days >= 0 && days <= TASK_DUE_SOON_DAYS;
  });
  if (soon.length === 0) return [];
  return [{
    id: 'tasks-due-soon',
    tone: 'warning',
    type: 'task_due_soon',
    params: { count: soon.length, titles: joinTitles(soon.map(t => t.title)) },
  }];
}

function proposalsWithoutAnswer(proposals: CopilotProposalInput[], now: Date): CopilotSuggestionRaw[] {
  const list: CopilotSuggestionRaw[] = [];
  proposals
    .filter(p => strip(p.status) === 'sent')
    .forEach(p => {
      const created = parseDate(p.created_at);
      if (!created) return;
      const days = daysBetween(created, now);
      if (days < PROPOSAL_NO_ANSWER_DAYS) return;
      list.push({
        id: `proposal-no-answer-${p.id}`,
        tone: 'warning',
        type: 'proposal_no_answer',
        params: { title: p.reference || p.title, client: p.nom_societe || p.client_name || '', days },
      });
    });
  // Les devis les plus anciens d'abord.
  return list.sort((a, b) => (b.params as { days: number }).days - (a.params as { days: number }).days);
}

function tendersClosingSoon(tenders: CopilotTenderInput[], now: Date): CopilotSuggestionRaw[] {
  const list: CopilotSuggestionRaw[] = [];
  tenders
    .filter(t => !t.archived && !['submitted', 'won', 'lost'].includes(strip(t.status)))
    .forEach(t => {
      const deadline = parseDate(t.submission_deadline);
      if (!deadline) return;
      const days = Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
      if (days < 0 || days > TENDER_DEADLINE_WINDOW_DAYS) return;
      list.push({
        id: `tender-deadline-${t.id}`,
        tone: days <= TENDER_DEADLINE_URGENT_DAYS ? 'danger' : 'warning',
        type: 'tender_deadline',
        params: { title: t.title, client: t.client || '', days },
      });
    });
  return list.sort((a, b) => (a.params as { days: number }).days - (b.params as { days: number }).days);
}

function invoicesDueSoon(invoices: CopilotInvoiceInput[], now: Date): CopilotSuggestionRaw[] {
  const soon = invoices.filter(inv => {
    const status = strip(inv.status);
    // Émise et pas encore réglée ; une facture déjà « overdue » a sa propre règle.
    if (!status || status === 'draft' || status === 'paid' || status === 'overdue') return false;
    const d = parseDate(inv.due_date);
    if (!d) return false;
    const days = (d.getTime() - now.getTime()) / DAY_MS;
    return days >= 0 && days <= INVOICE_DUE_SOON_DAYS;
  });
  if (soon.length === 0) return [];
  return [{
    id: 'invoices-due-soon',
    tone: 'warning',
    type: 'invoice_due_soon',
    params: {
      count: soon.length,
      amount: soon.reduce((sum, inv) => sum + invoiceAmount(inv), 0),
      numbers: joinTitles(soon.map(inv => inv.invoice_number)),
    },
  }];
}

function staleDraftInvoices(invoices: CopilotInvoiceInput[], now: Date): CopilotSuggestionRaw[] {
  const stale = invoices.filter(inv => {
    if (strip(inv.status) !== 'draft') return false;
    const created = parseDate(inv.issue_date || inv.created_at);
    return !!created && daysBetween(created, now) >= DRAFT_INVOICE_STALE_DAYS;
  });
  if (stale.length === 0) return [];
  return [{
    id: 'invoices-draft-stale',
    tone: 'warning',
    type: 'invoice_draft_stale',
    params: {
      count: stale.length,
      amount: stale.reduce((sum, inv) => sum + invoiceAmount(inv), 0),
      numbers: joinTitles(stale.map(inv => inv.invoice_number || '—')),
    },
  }];
}

// Ordre de priorité des règles : ce qui est déjà en retard, puis l'imminent,
// puis les relances commerciales.
export function computeCopilotSuggestions(input: {
  projects: Project[];
  milestones: Milestone[];
  invoices: CopilotInvoiceInput[];
  tasks?: CopilotTaskInput[];
  proposals?: CopilotProposalInput[];
  tenders?: CopilotTenderInput[];
  // Absent = donnée non lue : la règle correspondante se tait plutôt que de
  // signaler à tort une affaire « sans contrat » ou un lot « sans entreprise ».
  meetings?: CopilotMeetingInput[];
  reserves?: CopilotReserveInput[];
  contracts?: CopilotContractInput[];
  feeNotes?: CopilotFeeNoteInput[];
  permits?: CopilotPermitInput[];
  lots?: CopilotLotInput[];
  contacts?: CopilotContactInput[];
  orders?: CopilotOrderInput[];
  situations?: CopilotSituationInput[];
  observations?: CopilotObservationInput[];
  qualifications?: Qualification[];
  markets?: CopilotMarketInput[];
  consultations?: CopilotConsultationInput[];
  documents?: CopilotDocumentInput[];
  people?: CopilotPersonInput[];
  now?: Date;
}): CopilotSuggestionRaw[] {
  const { projects, milestones, invoices, tasks = [], proposals = [], tenders = [] } = input;
  const { meetings, reserves, contracts, feeNotes, permits, lots } = input;
  const { contacts, orders, situations, observations, qualifications, people = [] } = input;
  const { markets, consultations, documents } = input;
  const now = input.now ?? new Date();

  const groups: CopilotSuggestionRaw[][] = [
    overdueInvoices(invoices),
    overdueTasks(projects, tasks, now),
    overdueMilestones(projects, milestones, now),
    reserves ? overdueReserves(projects, reserves, now) : [],
    observations ? overdueObservations(projects, observations, now) : [],
    permits ? permitsDue(permits, now) : [],
    lots && contacts && qualifications ? expiringQualifications(lots, contacts, qualifications, now) : [],
    markets && consultations && documents ? missingInsurance(projects, markets, consultations, documents, qualifications ?? []) : [],
    markets && qualifications ? expiringInsurance(projects, markets, qualifications, now) : [],
    lots && contacts && qualifications ? rgeRequiredLots(projects, lots, markets ?? [], contacts, qualifications, now) : [],
    orders ? unacknowledgedOrders(projects, orders, now) : [],
    situations ? situationsToVerify(projects, situations, now) : [],
    tendersClosingSoon(tenders, now),
    tasksDueSoon(tasks, now),
    projectsBehind(projects, now),
    invoicesDueSoon(invoices, now),
    meetings ? meetingsWithoutMinutes(meetings, now) : [],
    proposalsWithoutAnswer(proposals, now),
    contracts ? contractsNotInvoiced(contracts, feeNotes ?? [], invoices, now) : [],
    unassignedTasks(tasks),
    overloadedPeople(tasks, people),
    lots && contacts ? companiesWithoutContact(lots, contacts) : [],
    lots && contacts ? companiesWithoutSiret(lots, contacts) : [],
    contracts ? projectsWithoutContract(projects, contracts) : [],
    lots ? lotsWithoutCompany(projects, lots) : [],
    incompleteProjects(projects),
    staleDraftInvoices(invoices, now),
  ].map(g => g.slice(0, MAX_PER_TYPE));

  // Tour de rôle entre les règles : chacune a sa place avant qu'une seule
  // ne prenne la deuxième. Puis le rouge (retard, échéance imminente) passe
  // avant l'orange, à ordre égal conservé.
  const interleaved: CopilotSuggestionRaw[] = [];
  for (let round = 0; round < MAX_PER_TYPE; round++) {
    for (const g of groups) if (g[round]) interleaved.push(g[round]);
  }
  const list = [...interleaved.filter(x => x.tone === 'danger'), ...interleaved.filter(x => x.tone !== 'danger')]
    .slice(0, MAX_SUGGESTIONS);
  return list;
}

const formatEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

export function formatCopilotSuggestion(
  raw: CopilotSuggestionRaw,
  t: (key: string, params?: Record<string, unknown>) => string
): CopilotSuggestion {
  switch (raw.type) {
    case 'overdue_milestone':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_overdue_milestone', { count: raw.params.count, project: raw.params.project }),
        draft: t('ai_draft_overdue_milestone', { project: raw.params.project, client: raw.params.client, titles: raw.params.titles }),
      };
    case 'project_behind':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_project_behind', { project: raw.params.project, progress: raw.params.progress, days: raw.params.days }),
        draft: t('ai_draft_project_behind', { project: raw.params.project, client: raw.params.client, progress: raw.params.progress, days: raw.params.days }),
      };
    case 'invoice_overdue':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_invoice_overdue', { number: raw.params.number, client: raw.params.client }),
        draft: t('ai_draft_invoice_overdue', { number: raw.params.number, client: raw.params.client, amount: formatEur(raw.params.amount) }),
      };
    case 'task_overdue':
      return {
        id: raw.id,
        tone: raw.tone,
        text: raw.params.project
          ? t('ai_suggestion_task_overdue', { count: raw.params.count, project: raw.params.project })
          : t('ai_suggestion_task_overdue_no_project', { count: raw.params.count }),
        draft: t('ai_draft_task_overdue', { count: raw.params.count, titles: raw.params.titles, project: raw.params.project || t('ai_no_project') }),
      };
    case 'task_due_soon':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_task_due_soon', { count: raw.params.count, days: TASK_DUE_SOON_DAYS }),
        draft: t('ai_draft_task_due_soon', { count: raw.params.count, titles: raw.params.titles, days: TASK_DUE_SOON_DAYS }),
      };
    case 'proposal_no_answer':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_proposal_no_answer', { title: raw.params.title, days: raw.params.days }),
        draft: t('ai_draft_proposal_no_answer', { title: raw.params.title, client: raw.params.client || t('ai_the_client'), days: raw.params.days }),
      };
    case 'tender_deadline':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_tender_deadline', { title: raw.params.title, days: raw.params.days }),
        draft: t('ai_draft_tender_deadline', { title: raw.params.title, client: raw.params.client || t('ai_the_client'), days: raw.params.days }),
      };
    case 'invoice_due_soon':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_invoice_due_soon', { count: raw.params.count, days: INVOICE_DUE_SOON_DAYS }),
        draft: t('ai_draft_invoice_due_soon', { count: raw.params.count, numbers: raw.params.numbers, amount: formatEur(raw.params.amount), days: INVOICE_DUE_SOON_DAYS }),
      };
    case 'meeting_no_minutes':
      return {
        id: raw.id, tone: raw.tone,
        text: t('ai_suggestion_meeting_no_minutes', { title: raw.params.title, days: raw.params.days }),
        draft: t('ai_draft_meeting_no_minutes', { title: raw.params.title, days: raw.params.days }),
      };
    case 'reserves_open':
      return {
        id: raw.id, tone: raw.tone,
        text: t('ai_suggestion_reserves_open', { project: raw.params.project, count: raw.params.count }),
        draft: t('ai_draft_reserves_open', { project: raw.params.project, count: raw.params.count }),
      };
    case 'contract_not_invoiced':
      return {
        id: raw.id, tone: raw.tone,
        text: t('ai_suggestion_contract_not_invoiced', { title: raw.params.title, days: raw.params.days }),
        draft: t('ai_draft_contract_not_invoiced', { title: raw.params.title, days: raw.params.days }),
      };
    case 'project_no_contract':
      return {
        id: raw.id, tone: raw.tone,
        text: t('ai_suggestion_project_no_contract', { project: raw.params.project }),
        draft: t('ai_draft_project_no_contract', { project: raw.params.project }),
      };
    case 'task_unassigned':
      return {
        id: raw.id, tone: raw.tone,
        text: t('ai_suggestion_task_unassigned', { count: raw.params.count }),
        draft: t('ai_draft_task_unassigned', { count: raw.params.count, titles: raw.params.titles }),
      };
    case 'permit_deadline': {
      const key = raw.params.days < 0 ? 'passed' : 'soon';
      const vars = { kind: raw.params.kind, reference: raw.params.reference, days: Math.abs(raw.params.days) };
      return {
        id: raw.id, tone: raw.tone,
        text: t(`ai_suggestion_permit_deadline_${key}`, vars),
        draft: t(`ai_draft_permit_deadline_${key}`, vars),
      };
    }
    case 'lots_without_company':
      return {
        id: raw.id, tone: raw.tone,
        text: t('ai_suggestion_lots_without_company', { project: raw.params.project, count: raw.params.count }),
        draft: t('ai_draft_lots_without_company', { project: raw.params.project, count: raw.params.count }),
      };
    case 'company_no_contact':
      return { id: raw.id, tone: raw.tone, text: t('ai_suggestion_company_no_contact', { count: raw.params.count }), draft: t('ai_draft_company_no_contact', { count: raw.params.count, names: raw.params.names }) };
    case 'company_no_siret':
      return { id: raw.id, tone: raw.tone, text: t('ai_suggestion_company_no_siret', { count: raw.params.count }), draft: t('ai_draft_company_no_siret', { count: raw.params.count, names: raw.params.names }) };
    case 'os_unacknowledged':
      return { id: raw.id, tone: raw.tone, text: t('ai_suggestion_os_unacknowledged', { project: raw.params.project, count: raw.params.count, days: OS_UNACKNOWLEDGED_DAYS }), draft: t('ai_draft_os_unacknowledged', { project: raw.params.project, count: raw.params.count }) };
    case 'situation_to_verify':
      return { id: raw.id, tone: raw.tone, text: t('ai_suggestion_situation_to_verify', { project: raw.params.project, count: raw.params.count, days: raw.params.days }), draft: t('ai_draft_situation_to_verify', { project: raw.params.project, count: raw.params.count }) };
    case 'observations_overdue':
      return { id: raw.id, tone: raw.tone, text: t('ai_suggestion_observations_overdue', { project: raw.params.project, count: raw.params.count }), draft: t('ai_draft_observations_overdue', { project: raw.params.project, count: raw.params.count }) };
    case 'qualification_expiring': {
      const key = raw.params.days < 0 ? 'expired' : 'soon';
      const vars = { company: raw.params.company, days: Math.abs(raw.params.days) };
      return { id: raw.id, tone: raw.tone, text: t(`ai_suggestion_qualification_${key}`, vars), draft: t(`ai_draft_qualification_${key}`, vars) };
    }
    case 'insurance_missing':
      return {
        id: raw.id, tone: raw.tone,
        text: t('ai_suggestion_insurance_missing', { project: raw.params.project, count: raw.params.count, names: raw.params.names }),
        draft: t('ai_draft_insurance_missing', { project: raw.params.project, count: raw.params.count, names: raw.params.names }),
      };
    case 'insurance_expiring': {
      const key = raw.params.days < 0 ? 'expired' : 'soon';
      const vars = { project: raw.params.project, company: raw.params.company, days: Math.abs(raw.params.days) };
      return { id: raw.id, tone: raw.tone, text: t(`ai_suggestion_insurance_${key}`, vars), draft: t(`ai_draft_insurance_${key}`, vars) };
    }
    case 'rge_required': {
      const vars = { project: raw.params.project, lot: raw.params.lot, company: raw.params.company, days: Math.abs(raw.params.days) };
      return { id: raw.id, tone: raw.tone, text: t(`ai_suggestion_rge_${raw.params.state}`, vars), draft: t(`ai_draft_rge_${raw.params.state}`, vars) };
    }
    case 'workload':
      return {
        id: raw.id, tone: raw.tone,
        text: raw.params.name ? t('ai_suggestion_workload', { name: raw.params.name, count: raw.params.count }) : t('ai_suggestion_workload_anon', { count: raw.params.count }),
        draft: t('ai_draft_workload', { name: raw.params.name || t('ai_a_colleague'), count: raw.params.count }),
      };
    case 'project_incomplete':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_project_incomplete', { project: raw.params.project, count: raw.params.fields.length, fields: raw.params.fields.map(f => t(`ai_field_${f}`)).join(', ') }),
        draft: t('ai_draft_project_incomplete', { project: raw.params.project, fields: raw.params.fields.map(f => t(`ai_field_${f}`)).join(', ') }),
      };
    case 'invoice_draft_stale':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_invoice_draft_stale', { count: raw.params.count, days: DRAFT_INVOICE_STALE_DAYS }),
        draft: t('ai_draft_invoice_draft_stale', { count: raw.params.count, numbers: raw.params.numbers, amount: formatEur(raw.params.amount) }),
      };
  }
}
