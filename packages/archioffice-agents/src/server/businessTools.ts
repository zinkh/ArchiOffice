// Outils d'agent pour les modules métier qui n'ont pas de route de collection à plat et que
// create_record / update_record n'atteignent donc pas :
//
//   manage_situations         situations de travaux et certificats de paiement (scope marches_entreprises)
//   manage_project_notices    notices d'études et réglementaires (scope projects)
//   manage_consultation       entreprises consultées du module ACT (scope projects)
//   create_invoice_from_note  facture brouillon d'une note d'honoraires (scope invoices)
//   manage_calendar           agenda : réunions, jalons, tâches et événements Google (scope meetings)
//
// Même contrat que projectWorkTools.ts : API REST avec le jeton de la personne, rejouer est
// sans risque, rien ne se supprime ni ne s'écrase sans needs_confirmation puis confirm: true.
//
// Ce que ces outils ne font volontairement PAS : calculer ni émettre un certificat de paiement
// (retenue de garantie, révision, TVA, PDF : l'écran « Établir le certificat » en reste le seul
// juge), attribuer un lot, ni changer une situation en saisie détaillée (lignes du DPGF).
import type { FunctionDeclarationLike } from './toolTypes.js';
import type { InternalAuth } from './internalApi.js';
import { buildRecordUrl } from './recordLinks.js';
import { createContactResolver, failure, makeRequest, norm, plural, text, type Json, type ToolRequest } from './toolRequest.js';

type Result = { response: Json; summary?: string };

const MAX_ITEMS = 50;
const asItems = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object').slice(0, MAX_ITEMS) : []);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const money = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const confirmation = (aTraiter: unknown, extra: Json = {}): Result => ({
  response: { needs_confirmation: true, concerne: aTraiter, ...extra, instruction: "Présente cela à l'utilisateur. Ne rappelle l'outil avec confirm: true qu'après son accord explicite." },
});
const confirmProp = { type: 'boolean', description: "Laisser vide au premier appel ; true seulement après l'accord explicite de l'utilisateur." };

export const BUSINESS_TOOL_SCOPES: Record<string, string> = {
  manage_situations: 'marches_entreprises',
  manage_project_notices: 'projects',
  manage_consultation: 'projects',
  create_invoice_from_note: 'invoices',
  manage_calendar: 'meetings',
};
export const BUSINESS_TOOL_NAMES = Object.keys(BUSINESS_TOOL_SCOPES);

export function buildBusinessTools(actionScopes: string[]): FunctionDeclarationLike[] {
  return BUSINESS_TOOLS.filter(t => actionScopes.includes(BUSINESS_TOOL_SCOPES[t.name]));
}

const projectId = { type: 'string', description: "Identifiant de l'opération (search_records sur projects)" };

const BUSINESS_TOOLS: FunctionDeclarationLike[] = [
  {
    name: 'manage_situations',
    description:
      "Lit et tient à jour les SITUATIONS DE TRAVAUX des entreprises d'une opération (onglet RDT) : une situation porte le CUMUL HT des travaux depuis le début du marché, présenté par l'entreprise puis admis par l'architecte. " +
      "list : marchés, situations, cumul admis et montant de la période (cumul admis moins celui de la situation précédente du même marché). " +
      "add : marche (marche_id, ou nom de l'entreprise) + montant_presente_ht (cumul), puis montant_admis_ht si l'architecte le corrige (vide = le présenté est admis), reference_entreprise, date_reception_situation. " +
      "update : id (ou marche + numero) et les champs à changer, tant que la situation est à l'état Brouillon. " +
      "certify : établit le certificat (état Validée + date) ; reopen : le rouvre ; mark_paid : Payée. remove : confirmation en deux temps, Brouillon seulement. " +
      "Les retenues, la révision, la TVA, le net à payer et le PDF du certificat sont calculés par l'écran « Établir le certificat » : ne les calcule pas et ne les annonce pas comme définitifs.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        action: { type: 'string', enum: ['list', 'add', 'update', 'certify', 'reopen', 'mark_paid', 'remove'] },
        marche: { type: 'string', description: "marche_id ou nom de l'entreprise du marché (add, ou update/certify avec numero)" },
        id: { type: 'string', description: 'Identifiant de la situation' },
        numero: { type: 'number', description: "Numéro de la situation dans le marché, à la place de id" },
        montant_presente_ht: { type: 'number', description: 'Cumul HT présenté par l\'entreprise' },
        montant_admis_ht: { type: 'number', description: 'Cumul HT admis par la maîtrise d\'œuvre' },
        reference_entreprise: { type: 'string' },
        date_reception_situation: { type: 'string', description: 'YYYY-MM-DD' },
        date_certificat: { type: 'string', description: 'certify : YYYY-MM-DD (défaut : aujourd\'hui)' },
        notes_moe: { type: 'string' },
        confirm: confirmProp,
      },
      required: ['project_id', 'action'],
    },
  },
  {
    name: 'manage_project_notices',
    description:
      "Lit, écrit ou fait rédiger les NOTICES d'une opération (onglet Études > NOTICES) : notice architecturale par phase (ESQ, APS, APD, PC, PRO, DCE), notice d'accessibilité et notice de sécurité incendie. " +
      "list : notices existantes et leur état ; read : le texte d'une notice ; write : enregistre le texte donné ; generate : rédaction assistée (plan Enterprise, consomme des crédits IA, à ne lancer que sur demande). " +
      "write et generate remplacent un texte déjà rédigé : confirmation en deux temps. Les notices réglementaires sont des BROUILLONS à vérifier par l'architecte : ne les présente jamais comme conformes.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        action: { type: 'string', enum: ['list', 'read', 'write', 'generate'] },
        kind: { type: 'string', enum: ['architectural', 'accessibility', 'security'] },
        phase: { type: 'string', enum: ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR'] },
        content: { type: 'string', description: 'write : texte complet de la notice' },
        instructions: { type: 'string', description: 'Consigne pour la rédaction assistée (jamais imprimée)' },
        confirm: confirmProp,
      },
      required: ['project_id', 'action'],
    },
  },
  {
    name: 'manage_consultation',
    description:
      "Suit les ENTREPRISES CONSULTÉES du module ACT d'une opération (tableau « Entreprises consultées ») : qui a reçu le DCE, qui est à relancer, qui a remis une offre. " +
      "list : entreprises, statut déduit et couverture par lot (moins de 3 entreprises par lot = consultation à étoffer). " +
      "add : entreprises = [{contact_id|nom, lots?: [numéros de lot], email?, envoyer_dce?}] ; une entreprise déjà consultée reçoit seulement les lots en plus. " +
      "update : [{entreprise (nom, contact_id ou id), lots?, dce_transmis_le?, relance_le?, offre_recue_le?, ne_repond_pas?, envoyer_dce?}] ; dates en YYYY-MM-DD. " +
      "remove : [{entreprise}] avec confirmation en deux temps. Ne prétends jamais avoir ENVOYÉ le DCE : poser dce_transmis_le enregistre une date, l'envoi se fait depuis l'écran. " +
      "Attention : l'écran ACT enregistre seul la consultation qu'il affiche ; modifie-la de préférence quand personne ne l'a ouverte.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        action: { type: 'string', enum: ['list', 'add', 'update', 'remove'] },
        entreprises: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              contact_id: { type: 'string' }, nom: { type: 'string' }, entreprise: { type: 'string' }, email: { type: 'string' },
              lots: { type: 'array', items: { type: 'string' } }, envoyer_dce: { type: 'boolean' }, ne_repond_pas: { type: 'boolean' },
              dce_transmis_le: { type: 'string' }, relance_le: { type: 'string' }, offre_recue_le: { type: 'string' },
            },
          },
        },
        confirm: confirmProp,
      },
      required: ['project_id', 'action'],
    },
  },
  {
    name: 'create_invoice_from_note',
    description:
      "Génère la facture BROUILLON d'une note d'honoraires (la part de l'agence, avec les montants HT, TVA et TTC de la note). N'existe que si la note n'est pas déjà facturée : sinon la facture existante est rendue. " +
      "Premier appel sans confirm : présente les montants à l'utilisateur ; confirm: true seulement après son accord. Le numéro de facture est attribué par le système ou par le connecteur comptable : ne l'invente jamais. Réservé aux rôles autorisés à facturer.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: "Identifiant de la note d'honoraires (search_records sur notes_honoraires)" },
        confirm: confirmProp,
      },
      required: ['note_id'],
    },
  },
  {
    name: 'manage_calendar',
    description:
      "Agenda de la personne : lit les réunions, jalons, tâches (échéances) et événements Google Calendar d'une période, et crée, déplace ou supprime des événements Google dans son calendrier par défaut. " +
      "agenda : start et end (YYYY-MM-DD, au plus 92 jours). create_event : title, date, et facultativement start_time/end_time (HH:MM, une heure par défaut), end_date, description, location ; sans heure, jour entier. " +
      "update_event / delete_event : id tel que rendu par agenda (événements « google-… » seulement ; une réunion ou une tâche se modifie avec update_record). delete_event : confirmation en deux temps. " +
      "Pour une RÉUNION de l'application utilise plutôt create_record sur meetings. Ne crée pas d'événement sans demande explicite.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['agenda', 'create_event', 'update_event', 'delete_event'] },
        start: { type: 'string', description: 'agenda : début de période YYYY-MM-DD' },
        end: { type: 'string', description: 'agenda : fin de période YYYY-MM-DD' },
        id: { type: 'string', description: 'update_event / delete_event : identifiant de l\'événement' },
        title: { type: 'string' }, date: { type: 'string' }, end_date: { type: 'string' },
        start_time: { type: 'string' }, end_time: { type: 'string' },
        description: { type: 'string' }, location: { type: 'string' },
        confirm: confirmProp,
      },
      required: ['action'],
    },
  },
];

// ── Situations de travaux ────────────────────────────────────────────────────

const admis = (s: Json): number => { const v = money(s.montant_admis_ht); const p = money(s.montant_presente_ht); return Number.isFinite(v as number) && v !== null ? (v as number) : Number.isFinite(p as number) && p !== null ? (p as number) : 0; };
const ETAT_LABELS: Record<string, string> = { Brouillon: 'À vérifier', 'Validée': 'Certificat établi', 'Payée': 'Payée' };

async function manageSituations(request: ToolRequest, pid: string, args: Json): Promise<Result> {
  const action = text(args.action);
  const [{ res: mr, json: marches }, { res: sr, json: situations }] = await Promise.all([
    request(`/api/marches-entreprises/${encodeURIComponent(pid)}`),
    request(`/api/situations/${encodeURIComponent(pid)}`),
  ]);
  if (!mr.ok || !Array.isArray(marches) || !sr.ok || !Array.isArray(situations)) return failure('Lecture des marchés et situations impossible : opération introuvable ?');
  const recordUrl = buildRecordUrl('marches_entreprises', { id: pid, project_id: pid });

  const byMarche = (m: Json) => situations.filter(s => s.marche_id === m.id).sort((a, b) => (a.numero_situation ?? 0) - (b.numero_situation ?? 0));
  const view = (m: Json) => {
    let previous = 0;
    return {
      marche_id: m.id, entreprise: m.entreprise_nom, lot: [m.lot_numero, m.lot_titre].filter(Boolean).join(' '), montant_marche_ht: m.montant_ht ?? null,
      situations: byMarche(m).map(s => {
        const cumul = admis(s); const periode = cumul - previous; previous = cumul;
        return { id: s.id, numero: s.numero_situation, etat: ETAT_LABELS[s.etat] || s.etat, mode: s.mode_saisie || 'simple', cumul_presente_ht: s.montant_presente_ht ?? null, cumul_admis_ht: cumul, periode_ht: periode, reference: s.reference_entreprise || null, date_certificat: s.date_certificat || null };
      }),
    };
  };
  if (action === 'list') return { response: { project_id: pid, marches: marches.map(view), sans_marche: situations.filter(s => !s.marche_id).length, record_url: recordUrl } };

  const findMarche = (v: unknown): { m?: Json; erreur?: string } => {
    const w = norm(v);
    if (!w) return { erreur: 'marche est requis (marche_id ou nom de l\'entreprise).' };
    const m = marches.filter(x => String(x.id) === text(v) || norm(x.entreprise_nom) === w);
    if (m.length === 1) return { m: m[0] };
    return { erreur: m.length ? `plusieurs marchés pour « ${v} » : précise marche_id` : `marché « ${v} » introuvable : crée-le d'abord (marches_entreprises)`, };
  };
  const findSituation = (): { s?: Json; erreur?: string } => {
    if (text(args.id)) { const s = situations.find(x => String(x.id) === text(args.id)); return s ? { s } : { erreur: 'situation introuvable dans cette opération.' }; }
    if (args.numero !== undefined) {
      const { m, erreur } = findMarche(args.marche);
      if (!m) return { erreur: erreur || 'marche requis avec numero.' };
      const s = situations.find(x => x.marche_id === m.id && Number(x.numero_situation) === Number(args.numero));
      return s ? { s } : { erreur: `situation n° ${args.numero} introuvable pour ${m.entreprise_nom}.` };
    }
    return { erreur: 'id (ou marche + numero) est requis.' };
  };

  const fields = (): { patch?: Json; erreur?: string } => {
    const patch: Json = {};
    for (const k of ['montant_presente_ht', 'montant_admis_ht'] as const) {
      if (args[k] === undefined) continue;
      const n = money(args[k]);
      if (n === null) { patch[k] = null; continue; }
      if (Number.isNaN(n) || (n as number) < 0) return { erreur: `${k} invalide.` };
      patch[k] = n;
    }
    if (args.reference_entreprise !== undefined) patch.reference_entreprise = text(args.reference_entreprise) || null;
    if (args.notes_moe !== undefined) patch.notes_moe = text(args.notes_moe) || null;
    if (args.date_reception_situation !== undefined) {
      if (text(args.date_reception_situation) && !ISO_DATE.test(text(args.date_reception_situation))) return { erreur: 'date_reception_situation : YYYY-MM-DD.' };
      patch.date_reception_situation = text(args.date_reception_situation) || null;
    }
    return { patch };
  };
  const put = async (id: string, patch: Json) => request(`/api/situations/${encodeURIComponent(id)}`, 'PUT', patch);
  const fresh = async () => { const { json } = await request(`/api/situations/${encodeURIComponent(pid)}`); return Array.isArray(json) ? json : situations; };
  const ok = async (extra: Json, summary: string): Promise<Result> => {
    situations.splice(0, situations.length, ...(await fresh()));
    return { response: { success: true, ...extra, marches: marches.map(view), record_url: recordUrl }, summary };
  };

  if (action === 'add') {
    const { m, erreur } = findMarche(args.marche);
    if (!m) return failure(erreur!);
    const { patch, erreur: e2 } = fields();
    if (!patch) return failure(e2!);
    if (patch.montant_presente_ht === undefined || patch.montant_presente_ht === null) return failure('montant_presente_ht (cumul HT) est requis.');
    const previous = byMarche(m).at(-1);
    if (previous && Number(patch.montant_presente_ht) < admis(previous)) {
      return { response: { error: `Le cumul présenté (${patch.montant_presente_ht} €) est inférieur au cumul admis de la situation n° ${previous.numero_situation} (${admis(previous)} €) : une situation porte le cumul depuis le début du marché. Vérifie le montant avec l'utilisateur.` } };
    }
    const { res, json } = await request('/api/situations', 'POST', { project_id: pid, marche_id: m.id, ...patch });
    if (!res.ok) return failure(json?.error || `Création impossible (HTTP ${res.status}).`);
    return ok({ ajoutee: { id: json?.id, numero: json?.numero_situation, entreprise: m.entreprise_nom } }, `Situation n° ${json?.numero_situation} créée pour ${m.entreprise_nom}`);
  }

  if (action === 'update' || action === 'certify' || action === 'reopen' || action === 'mark_paid' || action === 'remove') {
    const { s, erreur } = findSituation();
    if (!s) return failure(erreur!);
    const label = `situation n° ${s.numero_situation}`;
    if (action === 'remove') {
      if (s.etat !== 'Brouillon') return failure(`La ${label} a un certificat établi : rouvre-la d'abord (reopen).`);
      if (args.confirm !== true) return confirmation({ id: s.id, numero: s.numero_situation, cumul_presente_ht: s.montant_presente_ht });
      const { res, json } = await request(`/api/situations/${encodeURIComponent(String(s.id))}`, 'DELETE');
      if (!res.ok) return failure(json?.error || `Suppression impossible (HTTP ${res.status}).`);
      return ok({ supprimee: { id: s.id, numero: s.numero_situation } }, `Situation n° ${s.numero_situation} supprimée`);
    }
    if (action === 'update') {
      if (s.etat !== 'Brouillon') return failure(`La ${label} a un certificat établi : ses montants sont verrouillés, rouvre-la d'abord (reopen).`);
      if (s.mode_saisie === 'detaille') return failure(`La ${label} est saisie ligne par ligne (DPGF) : modifie-la depuis l'écran.`);
      const { patch, erreur: e2 } = fields();
      if (!patch) return failure(e2!);
      if (!Object.keys(patch).length) return failure('Rien à modifier.');
      const { res, json } = await put(String(s.id), patch);
      if (!res.ok) return failure(json?.error || `Modification impossible (HTTP ${res.status}).`);
      return ok({ modifiee: { id: s.id, numero: s.numero_situation, ...patch } }, `Situation n° ${s.numero_situation} modifiée`);
    }
    if (action === 'certify') {
      if (s.etat !== 'Brouillon') return { response: { success: true, already_done: true, etat: ETAT_LABELS[s.etat] || s.etat } };
      const date = text(args.date_certificat) || today();
      if (!ISO_DATE.test(date)) return failure('date_certificat : YYYY-MM-DD.');
      const { res, json } = await put(String(s.id), { etat: 'Validée', date_certificat: date });
      if (!res.ok) return failure(json?.error || `Impossible d'établir le certificat (HTTP ${res.status}).`);
      return ok({ certificat: { id: s.id, numero: s.numero_situation, date }, rappel: "Le calcul du net à payer et le PDF se font depuis l'écran « Établir le certificat »." }, `Certificat établi pour la situation n° ${s.numero_situation}`);
    }
    if (action === 'reopen') {
      if (s.etat === 'Brouillon') return { response: { success: true, already_done: true } };
      if (args.confirm !== true) return confirmation({ id: s.id, numero: s.numero_situation, etat: ETAT_LABELS[s.etat] || s.etat }, { avertissement: 'Rouvrir une situation déverrouille ses montants et retire la date du certificat.' });
      const { res, json } = await put(String(s.id), { etat: 'Brouillon', date_certificat: null });
      if (!res.ok) return failure(json?.error || `Réouverture impossible (HTTP ${res.status}).`);
      return ok({ rouverte: { id: s.id, numero: s.numero_situation } }, `Situation n° ${s.numero_situation} rouverte`);
    }
    if (s.etat !== 'Validée') return failure(s.etat === 'Payée' ? `La ${label} est déjà payée.` : `La ${label} n'a pas de certificat établi : utilise certify d'abord.`);
    const { res, json } = await put(String(s.id), { etat: 'Payée' });
    if (!res.ok) return failure(json?.error || `Mise à jour impossible (HTTP ${res.status}).`);
    return ok({ payee: { id: s.id, numero: s.numero_situation } }, `Situation n° ${s.numero_situation} marquée payée`);
  }
  return failure('action doit valoir list, add, update, certify, reopen, mark_paid ou remove.');
}

// ── Notices ──────────────────────────────────────────────────────────────────

const NOTICE_KINDS = ['architectural', 'accessibility', 'security'];
const NOTICE_PHASES = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR'];

async function manageNotices(request: ToolRequest, pid: string, args: Json): Promise<Result> {
  const action = text(args.action);
  const base = `/api/projects/${encodeURIComponent(pid)}/notices`;
  const { res, json: notices } = await request(base);
  if (!res.ok || !Array.isArray(notices)) return failure(notices?.error || 'Lecture des notices impossible : opération introuvable ?');
  const recordUrl = buildRecordUrl('projects', { id: pid });
  const brief = (n: Json) => ({ type: n.kind, phase: n.phase, etat: n.status === 'redige' ? 'rédigée' : 'à rédiger', caracteres: String(n.content || '').length, modifiee_le: n.updated_at || null });
  if (action === 'list') return { response: { project_id: pid, notices: notices.map(brief), record_url: recordUrl } };

  const kind = text(args.kind); const phase = text(args.phase);
  if (!NOTICE_KINDS.includes(kind)) return failure(`kind doit valoir ${NOTICE_KINDS.join(', ')}.`);
  if (!NOTICE_PHASES.includes(phase)) return failure(`phase doit valoir ${NOTICE_PHASES.join(', ')}.`);
  const existing = notices.find(n => n.kind === kind && n.phase === phase);
  const path = `${base}/${kind}/${phase}`;
  if (action === 'read') {
    return { response: existing ? { ...brief(existing), contenu: existing.content || '', consignes: existing.instructions || '', note: kind === 'architectural' ? undefined : 'Brouillon réglementaire à vérifier par l\'architecte.', record_url: recordUrl } : { type: kind, phase, etat: 'à rédiger', contenu: '', record_url: recordUrl } };
  }
  const hasText = !!text(existing?.content);
  if (action === 'write') {
    const content = String(args.content ?? '');
    if (!content.trim()) return failure('content est requis.');
    if (existing && existing.content === content) return { response: { success: true, already_done: true, notice: brief(existing) } };
    if (hasText && args.confirm !== true) return confirmation({ ...brief(existing!) }, { avertissement: 'Le texte déjà rédigé sera remplacé.' });
    const { res: pr, json } = await request(path, 'PUT', { content, ...(args.instructions !== undefined ? { instructions: String(args.instructions) } : { instructions: existing?.instructions ?? '' }) });
    if (!pr.ok) return failure(json?.error || `Enregistrement impossible (HTTP ${pr.status}).`);
    return { response: { success: true, notice: brief(json), record_url: recordUrl }, summary: `Notice ${kind} ${phase} enregistrée` };
  }
  if (action === 'generate') {
    if (hasText && args.confirm !== true) return confirmation({ ...brief(existing!) }, { avertissement: 'La rédaction assistée remplace le texte existant et consomme des crédits IA.' });
    const { res: gr, json } = await request(`${path}/generate-ai`, 'POST', args.instructions !== undefined ? { instructions: String(args.instructions) } : {});
    if (!gr.ok) return failure(json?.error || `Rédaction impossible (HTTP ${gr.status}).`);
    return { response: { success: true, notice: brief(json), apercu: String(json?.content || '').slice(0, 1500), note: 'Brouillon généré : à relire et valider par l\'architecte, jamais présenté comme conforme.', record_url: recordUrl }, summary: `Notice ${kind} ${phase} rédigée (brouillon)` };
  }
  return failure('action doit valoir list, read, write ou generate.');
}

// ── Consultation ACT ─────────────────────────────────────────────────────────

const MIN_PER_LOT = 3;
const statutEntreprise = (e: Json): string => {
  if (e.ne_repond_pas) return 'Ne répond pas';
  if (e.offre_recue_le) return 'Offre reçue';
  if (e.dce_transmis_le) return e.relance_le && e.relance_le <= today() ? 'À relancer' : 'DCE envoyé';
  return e.envoyer_dce ? 'DCE à envoyer' : 'DCE non prévu';
};
const EMPTY_CONSULTATION = { dce_documents: [], entreprises: [], criteres: [], pieces_admin: [], questions: [], offres: [], attributions: [], comparatif: [] };

async function manageConsultation(request: ToolRequest, pid: string, args: Json): Promise<Result> {
  const action = text(args.action);
  const [{ res: ar, json: act }, { res: lr, json: lots }] = await Promise.all([
    request(`/api/projects/${encodeURIComponent(pid)}/act`),
    request(`/api/projects/${encodeURIComponent(pid)}/lots`),
  ]);
  if (!ar.ok || !lr.ok || !Array.isArray(lots)) return failure('Lecture de la consultation impossible : opération introuvable ?');
  const consultation: Json = act?.consultation && typeof act.consultation === 'object' ? act.consultation : {};
  const current: Json[] = Array.isArray(consultation.entreprises) ? consultation.entreprises : [];
  const lotNum = (id: string) => lots.find(l => String(l.id) === id)?.lot_number ?? id;
  const recordUrl = `${buildRecordUrl('projects', { id: pid })}?tab=ACT`;
  const view = (e: Json) => ({ id: e.id, nom: e.nom, contact_id: e.contact_id || null, email: e.email || null, lots: (e.lots_ids || []).map(lotNum), statut: statutEntreprise(e), dce_transmis_le: e.dce_transmis_le || null, relance_le: e.relance_le || null, offre_recue_le: e.offre_recue_le || null });
  const couverture = (list: Json[] = current) => lots.map(l => ({ lot: `${l.lot_number} ${l.lot_title}`, entreprises: list.filter(e => !e.ne_repond_pas && (e.lots_ids || []).includes(l.id)).length })).map(c => ({ ...c, a_etoffer: c.entreprises < MIN_PER_LOT }));

  if (action === 'list') return { response: { project_id: pid, entreprises: current.map(view), couverture_par_lot: couverture(), minimum_par_lot: MIN_PER_LOT, record_url: recordUrl } };
  if (!['add', 'update', 'remove'].includes(action)) return failure('action doit valoir list, add, update ou remove.');
  const items = asItems(args.entreprises);
  if (!items.length) return failure('entreprises est requis.');

  const resolve = createContactResolver(request);
  const next: Json[] = current.map(e => ({ ...e }));
  const lotIds = (refs: unknown): { ids: string[]; inconnus: string[] } => {
    const ids: string[] = []; const inconnus: string[] = [];
    for (const r of Array.isArray(refs) ? refs : []) {
      const l = lots.find(x => String(x.id) === text(r) || norm(x.lot_number) === norm(r));
      if (l) { if (!ids.includes(String(l.id))) ids.push(String(l.id)); } else inconnus.push(text(r));
    }
    return { ids, inconnus };
  };
  const changes: Json[] = []; const non_traites: Json[] = []; const cibles: Json[] = [];
  const dateOk = (v: unknown) => v === undefined || v === null || v === '' || ISO_DATE.test(text(v));

  for (const it of items) {
    const label = text(it.entreprise) || text(it.nom) || text(it.contact_id) || 'entreprise';
    const lt = lotIds(it.lots);
    if (lt.inconnus.length) { non_traites.push({ element: label, raison: `lot(s) introuvable(s) : ${lt.inconnus.join(', ')}`, lots_possibles: lots.map(l => l.lot_number) }); continue; }
    if (![it.dce_transmis_le, it.relance_le, it.offre_recue_le].every(dateOk)) { non_traites.push({ element: label, raison: 'dates : YYYY-MM-DD' }); continue; }

    if (action === 'add') {
      const r = await resolve(it);
      if (r.inconnu) { non_traites.push({ element: label, raison: 'contact_id introuvable dans ce cabinet' }); continue; }
      if (r.ambigu) { non_traites.push({ element: label, raison: 'plusieurs contacts portent ce nom : précise contact_id', candidats: r.ambigu }); continue; }
      if (!r.name) { non_traites.push({ element: label, raison: 'contact_id ou nom requis' }); continue; }
      const existing = next.find(e => (r.contact_id && e.contact_id === r.contact_id) || norm(e.nom) === norm(r.name));
      if (existing) {
        const added = lt.ids.filter(id => !(existing.lots_ids || []).includes(id));
        if (!added.length) { non_traites.push({ element: r.name, raison: 'déjà consultée pour ces lots' }); continue; }
        existing.lots_ids = [...(existing.lots_ids || []), ...added];
        changes.push({ nom: r.name, lots_ajoutes: added.map(lotNum) });
        continue;
      }
      next.push({ id: crypto.randomUUID(), ...(r.contact_id ? { contact_id: r.contact_id } : {}), nom: r.name, ...(text(it.email) ? { email: text(it.email) } : {}), lots_ids: lt.ids, envoyer_dce: it.envoyer_dce !== false });
      changes.push({ nom: r.name, lots: lt.ids.map(lotNum) });
      continue;
    }

    const target = next.find(e => String(e.id) === text(it.entreprise) || (text(it.contact_id) && e.contact_id === text(it.contact_id)) || norm(e.nom) === norm(it.entreprise || it.nom));
    if (!target) { non_traites.push({ element: label, raison: "ne fait pas partie des entreprises consultées" }); continue; }
    if (action === 'remove') { if (!cibles.includes(target)) cibles.push(target); continue; }
    const patch: Json = {};
    for (const k of ['dce_transmis_le', 'relance_le', 'offre_recue_le'] as const) if (it[k] !== undefined) patch[k] = text(it[k]) || undefined;
    if (it.ne_repond_pas !== undefined) patch.ne_repond_pas = !!it.ne_repond_pas;
    if (it.envoyer_dce !== undefined) patch.envoyer_dce = !!it.envoyer_dce;
    if (text(it.email)) patch.email = text(it.email);
    if (Array.isArray(it.lots)) patch.lots_ids = lt.ids;
    if (!Object.keys(patch).length) { non_traites.push({ element: target.nom, raison: 'rien à modifier' }); continue; }
    Object.assign(target, patch);
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete target[k];
    changes.push({ nom: target.nom, ...patch });
  }

  if (action === 'remove') {
    if (!cibles.length) return failure('Aucune entreprise à retirer.', { non_traites });
    if (args.confirm !== true) return confirmation(cibles.map(view), non_traites.length ? { non_traites } : {});
    for (const c of cibles) { next.splice(next.indexOf(c), 1); changes.push({ nom: c.nom }); }
  }
  if (!changes.length) return failure("Aucune modification n'a pu être faite.", { non_traites, entreprises: current.map(view) });

  const { res, json } = await request(`/api/projects/${encodeURIComponent(pid)}/act`, 'PUT', { consultation: { ...EMPTY_CONSULTATION, ...consultation, entreprises: next } });
  if (!res.ok) return failure(json?.error || `Enregistrement impossible (HTTP ${res.status}).`);
  const verb = action === 'add' ? 'ajoutees' : action === 'update' ? 'modifiees' : 'retirees';
  const done = action === 'add' ? 'ajoutée' : action === 'update' ? 'modifiée' : 'retirée';
  return {
    response: { success: true, project_id: pid, [verb]: changes, ...(non_traites.length ? { non_traites } : {}), entreprises: next.map(view), couverture_par_lot: couverture(next), record_url: recordUrl },
    summary: `${plural(changes.length, `entreprise ${done}`, `entreprises ${done}s`)} (consultation)`,
  };
}

// ── Facture d'une note d'honoraires ──────────────────────────────────────────

async function invoiceFromNote(request: ToolRequest, args: Json): Promise<Result> {
  const noteId = text(args.note_id);
  if (!noteId) return failure('note_id est requis.');
  const { res, json: notes } = await request('/api/notes_honoraires');
  if (!res.ok || !Array.isArray(notes)) return failure(notes?.error || "Lecture des notes d'honoraires impossible.");
  const note = notes.find(n => String(n.id) === noteId);
  if (!note) return failure("Note d'honoraires introuvable : utilise search_records sur notes_honoraires.");
  const summary = { id: note.id, numero: note.numero, objet: note.objet, montant_ht: note.montant_ht, montant_tva: note.montant_tva, montant_ttc: note.montant_ttc, deja_facturee: !!note.invoice_id };
  if (args.confirm !== true && !note.invoice_id) return confirmation(summary, { instruction: "Présente ces montants (HT, TVA, TTC) à l'utilisateur et ne rappelle l'outil avec confirm: true qu'après son accord. Seule la part de l'agence est facturée, pas celle des cotraitants." });
  const { res: pr, json } = await request(`/api/notes_honoraires/${encodeURIComponent(noteId)}/facture`, 'POST', {});
  if (!pr.ok) return failure(json?.error || `Génération impossible (HTTP ${pr.status}).`);
  const invoice = json?.invoice;
  return {
    response: { success: true, already_existed: !!json?.already_existed, note: summary, invoice: invoice ? { id: invoice.id, numero: invoice.invoice_number || null, statut: invoice.status, montant_ht: invoice.amount, montant_ttc: invoice.total_amount, echeance: invoice.due_date } : null, record_url: invoice ? buildRecordUrl('invoices', { id: invoice.id }) : null },
    summary: json?.already_existed ? 'Facture déjà générée pour cette note' : 'Facture brouillon générée',
  };
}

// ── Agenda ───────────────────────────────────────────────────────────────────

const MAX_DAYS = 92;

async function manageCalendar(request: ToolRequest, args: Json): Promise<Result> {
  const action = text(args.action);
  if (action === 'agenda') {
    const start = text(args.start); const end = text(args.end) || start;
    if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return failure('start et end (YYYY-MM-DD) sont requis.');
    if (end < start) return failure('end ne peut pas précéder start.');
    if ((Date.parse(end) - Date.parse(start)) / 86_400_000 > MAX_DAYS) return failure(`Période limitée à ${MAX_DAYS} jours.`);
    const inRange = (d: unknown) => typeof d === 'string' && d.slice(0, 10) >= start && d.slice(0, 10) <= end;
    const [g, m, ms, t] = await Promise.all([
      request(`/api/google-calendar/events?start=${start}&end=${end}`),
      request('/api/meetings'), request('/api/milestones'), request('/api/tasks'),
    ]);
    const items: Json[] = [];
    if (g.res.ok && Array.isArray(g.json)) for (const e of g.json) items.push({ source: 'google', id: e.id, titre: e.title, date: e.date, debut: e.start || null, fin: e.end || null, lieu: e.location || null });
    if (m.res.ok && Array.isArray(m.json)) for (const e of m.json) if (inRange(e.date)) items.push({ source: 'reunion', id: e.id, titre: e.title, date: String(e.date).slice(0, 10), projet: e.project_id || null });
    if (ms.res.ok && Array.isArray(ms.json)) for (const e of ms.json) if (inRange(e.due_date) && !e.completed) items.push({ source: 'jalon', id: e.id, titre: e.title, date: String(e.due_date).slice(0, 10), projet: e.project_id || null });
    if (t.res.ok && Array.isArray(t.json)) for (const e of t.json) if (e.status !== 'done' && inRange(e.due_date || e.end_date)) items.push({ source: 'tache', id: e.id, titre: e.title, date: String(e.due_date || e.end_date).slice(0, 10), projet: e.project_id || null });
    items.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.debut || '').localeCompare(String(b.debut || '')));
    return { response: { periode: { start, end }, total: items.length, evenements: items.slice(0, 200), google_connecte: g.res.ok, ...(g.res.ok ? {} : { note_google: "Agenda Google non lu (non connecté ou en erreur) : seuls les éléments de l'application sont listés." }) } };
  }
  if (action === 'create_event') {
    const { res, json } = await request('/api/google-calendar/events', 'POST', { title: args.title, date: args.date, end_date: args.end_date, start_time: args.start_time, end_time: args.end_time, description: args.description, location: args.location });
    if (!res.ok) return failure(json?.error || `Création impossible (HTTP ${res.status}).`);
    return { response: { success: true, id: json.id, titre: json.title, lien: json.link }, summary: `Événement créé : ${text(args.title)}` };
  }
  const id = text(args.id);
  if (!id.startsWith('google-')) return failure("id est requis : celui d'un événement « google-… » rendu par agenda.");
  if (action === 'update_event') {
    const { res, json } = await request(`/api/google-calendar/events/${encodeURIComponent(id)}`, 'PATCH', { title: args.title, date: args.date, end_date: args.end_date, start_time: args.start_time, end_time: args.end_time, description: args.description, location: args.location });
    if (!res.ok) return failure(json?.error || `Modification impossible (HTTP ${res.status}).`);
    return { response: { success: true, id }, summary: 'Événement modifié' };
  }
  if (action === 'delete_event') {
    if (args.confirm !== true) return confirmation({ id, titre: text(args.title) || undefined });
    const { res, json } = await request(`/api/google-calendar/events/${encodeURIComponent(id)}`, 'DELETE');
    if (!res.ok) return failure(json?.error || `Suppression impossible (HTTP ${res.status}).`);
    return { response: { success: true }, summary: 'Événement supprimé' };
  }
  return failure('action doit valoir agenda, create_event, update_event ou delete_event.');
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export async function executeBusinessTool(baseUrl: string, auth: InternalAuth, name: string, args: Json): Promise<Result> {
  const request = makeRequest(baseUrl, auth);
  try {
    if (name === 'create_invoice_from_note') return await invoiceFromNote(request, args);
    if (name === 'manage_calendar') return await manageCalendar(request, args);
    const pid = text(args.project_id);
    if (!pid) return failure('project_id est requis.');
    switch (name) {
      case 'manage_situations': return await manageSituations(request, pid, args);
      case 'manage_project_notices': return await manageNotices(request, pid, args);
      case 'manage_consultation': return await manageConsultation(request, pid, args);
      default: return failure(`Fonction inconnue : ${name}`);
    }
  } catch (e: any) {
    return failure(e?.message || 'Action impossible.');
  }
}
