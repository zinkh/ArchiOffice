// Import de notes dans un brouillon de compte-rendu de chantier (onglet DET).
//
// L'agent (ou un client MCP) lit d'abord la source de ces notes — message dicté, compte rendu
// manuscrit saisi, e-mail, pièce jointe via read_email_attachment / read_document — puis les
// range lui-même dans les quatre endroits d'un CR et les transmet ici, déjà structurées :
// l'outil n'interprète rien, il écrit. Comme add_site_report_observation, il passe par l'API
// REST de l'application avec le jeton de la personne : mêmes contrôles, même journal d'activité.
//
//   rubriques     → site_report_notes   (« Rubriques » du CR)
//   observations  → observations        (« Observations par lot », rattachées au CR)
//   decisions     → site_reports.decisions
//   meeting_notes → site_reports.meetingnotes (ajoutées après le texte déjà saisi)
//
// Jamais sur un CR diffusé, jamais de doublon (comparaison sans casse sur le texte) : rejouer
// le même import ne change rien.
import type { FunctionDeclarationLike } from './toolTypes.js';
import { internalHeaders, type InternalAuth } from './internalApi.js';
import { buildRecordUrl } from './recordLinks.js';

export const IMPORT_SITE_REPORT_NOTES_TOOL_NAME = 'import_site_report_notes';

const MAX_ITEMS = 60;
const MAX_TEXT = 4000;
const OBSERVATION_TYPES = ['observation', 'reserve', 'a_faire'];
const URGENCES = ['normal', 'urgent', 'bloquant'];
const DECISION_TAGS = ['planning', 'technique', 'financier'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const IMPORT_SITE_REPORT_NOTES_TOOL: FunctionDeclarationLike = {
  name: IMPORT_SITE_REPORT_NOTES_TOOL_NAME,
  description:
    "Importe des notes (prises sur le chantier, dictées, extraites d'un e-mail ou d'un document) dans le brouillon d'un compte-rendu de chantier (onglet DET). " +
    "Lis d'abord la source (read_email, read_email_attachment, read_document), puis range TOUT son contenu : " +
    "rubriques (points administratifs ou thématiques : planning, sécurité, documents à remettre...), observations par lot (travaux à faire, à lever), décisions de la maîtrise d'œuvre, et notes de réunion libres. " +
    "Ne reformule pas ce qui est dit, n'invente ni lot, ni entreprise, ni date : laisse vide ce que la source ne dit pas. " +
    "Sans report_id, l'outil prend le seul brouillon de l'opération ; s'il n'y en a aucun, crée-le avec create_site_report, s'il y en a plusieurs, demande lequel. " +
    "Les doublons sont ignorés, donc rejouer un import est sans risque. Ne prétends pas avoir diffusé le compte-rendu.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: "Identifiant de l'opération" },
      report_id: { type: 'string', description: 'Identifiant du brouillon DET, si connu' },
      rubriques: {
        type: 'array',
        description: 'Entrées de rubriques du CR',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Nom de la rubrique (ex. « Planning », « Sécurité », « Documents à remettre »)' },
            text: { type: 'string', description: 'Texte de l\'entrée' },
            responsible_company: { type: 'string', description: 'Entreprise ou intervenant concerné, si la source le dit' },
            due_date: { type: 'string', description: 'Échéance YYYY-MM-DD, si la source la donne' },
          },
          required: ['category', 'text'],
        },
      },
      observations: {
        type: 'array',
        description: 'Observations par lot',
        items: {
          type: 'object',
          properties: {
            texte: { type: 'string', description: "Observation complète, entreprise comprise si citée" },
            lot: { type: 'string', description: 'Numéro, intitulé ou entreprise du lot, si connu ; ne pas inventer' },
            type: { type: 'string', enum: OBSERVATION_TYPES, description: "observation (défaut), reserve (« à lever ») ou a_faire" },
            urgence: { type: 'string', enum: URGENCES, description: 'normal (défaut), urgent ou bloquant' },
            due_date: { type: 'string', description: 'Délai YYYY-MM-DD, si la source le donne' },
          },
          required: ['texte'],
        },
      },
      decisions: {
        type: 'array',
        description: "Décisions de la maîtrise d'œuvre",
        items: {
          type: 'object',
          properties: {
            texte: { type: 'string' },
            auteur: { type: 'string', description: 'Qui a décidé, si la source le dit' },
            tag: { type: 'string', enum: DECISION_TAGS, description: 'planning, technique (défaut) ou financier' },
          },
          required: ['texte'],
        },
      },
      meeting_notes: { type: 'string', description: "Notes libres de réunion, ajoutées à la suite de celles déjà saisies" },
    },
    required: ['project_id'],
  },
};

type Json = Record<string, any>;
const norm = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase();
const clip = (v: unknown) => String(v ?? '').trim().slice(0, MAX_TEXT);
const asList = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object').slice(0, MAX_ITEMS) : []);

export async function importSiteReportNotes(baseUrl: string, auth: InternalAuth, args: Json): Promise<{ response: Json; summary?: string }> {
  const projectId = String(args.project_id || '').trim();
  if (!projectId) return { response: { error: 'project_id est requis.' } };
  const rubriques = asList(args.rubriques);
  const observations = asList(args.observations);
  const decisions = asList(args.decisions);
  const meetingNotes = clip(args.meeting_notes);
  if (!rubriques.length && !observations.length && !decisions.length && !meetingNotes) {
    return { response: { error: 'Aucune note à importer : renseigne rubriques, observations, decisions ou meeting_notes.' } };
  }

  const request = async (path: string, method = 'GET', body?: Json) => {
    const res = await fetch(baseUrl + path, { method, headers: internalHeaders(auth, body ? { 'Content-Type': 'application/json' } : undefined), body: body ? JSON.stringify(body) : undefined });
    const json: any = await res.json().catch(() => null);
    return { res, json };
  };

  try {
    const { res: reportsRes, json: reports } = await request(`/api/projects/${encodeURIComponent(projectId)}/reports`);
    if (!reportsRes.ok || !Array.isArray(reports)) return { response: { error: reports?.error || `Lecture des comptes-rendus impossible (HTTP ${reportsRes.status}).` } };
    const drafts = reports.filter((r: any) => r.statut === 'brouillon' || !r.statut);
    const requestedId = String(args.report_id || '').trim();
    const report = requestedId ? reports.find((r: any) => String(r.id) === requestedId) : drafts.length === 1 ? drafts[0] : null;
    if (!report) {
      return { response: { error: requestedId ? 'Ce compte-rendu ne fait pas partie de cette opération.' : drafts.length ? 'Plusieurs brouillons DET : précise le compte-rendu à compléter.' : "Aucun brouillon DET pour cette opération : crée-le d'abord avec create_site_report.", brouillons: drafts.map((r: any) => ({ id: r.id, numero: r.report_number, date: r.date })) } };
    }
    if (report.statut && report.statut !== 'brouillon') return { response: { error: 'Ce compte-rendu a déjà été diffusé : indique un brouillon à compléter.' } };
    const reportId = encodeURIComponent(String(report.id));

    const added = { rubriques: 0, observations: 0, decisions: 0, meeting_notes: false };
    const doublons: string[] = [];
    const non_importes: { element: string; raison: string }[] = [];
    let lots_possibles: Json[] | undefined;

    // ── Rubriques ────────────────────────────────────────────────────────
    if (rubriques.length) {
      const { res, json: existing } = await request(`/api/reports/${reportId}/notes`);
      if (!res.ok || !Array.isArray(existing)) return { response: { error: existing?.error || 'Lecture des rubriques impossible.' } };
      const seen = new Set(existing.map((n: any) => `${norm(n.category)}|${norm(n.text)}`));
      let count = existing.length;
      for (const r of rubriques) {
        const category = clip(r.category).slice(0, 120);
        const text = clip(r.text);
        if (!category || !text) { non_importes.push({ element: text || category || 'rubrique vide', raison: 'rubrique et texte requis' }); continue; }
        const key = `${norm(category)}|${norm(text)}`;
        if (seen.has(key)) { doublons.push(text); continue; }
        const due = ISO_DATE.test(String(r.due_date || '')) ? String(r.due_date) : undefined;
        const { res: pr, json } = await request(`/api/reports/${reportId}/notes`, 'POST', {
          id: crypto.randomUUID(), category, note_number: ++count, text, status: 'open',
          issue_date: report.date || new Date().toISOString().slice(0, 10),
          ...(clip(r.responsible_company) ? { responsible_company: clip(r.responsible_company).slice(0, 200) } : {}),
          ...(due ? { due_date: due } : {}),
        });
        if (!pr.ok) { non_importes.push({ element: text, raison: json?.error || `HTTP ${pr.status}` }); count--; continue; }
        seen.add(key); added.rubriques++;
      }
    }

    // ── Observations par lot ─────────────────────────────────────────────
    if (observations.length) {
      const { res, json: existing } = await request(`/api/reports/${reportId}/observations`);
      if (!res.ok || !Array.isArray(existing)) return { response: { error: existing?.error || 'Lecture des observations impossible.' } };
      const seen = new Set(existing.map((o: any) => norm(o.texte)));
      let lots: Json[] | null = null;
      for (const o of observations) {
        const texte = clip(o.texte);
        if (!texte) { non_importes.push({ element: 'observation vide', raison: 'texte requis' }); continue; }
        if (seen.has(norm(texte))) { doublons.push(texte); continue; }
        let lotId: string | undefined;
        const lot = norm(o.lot);
        if (lot) {
          if (!lots) {
            const { res: lr, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/lots`);
            lots = lr.ok && Array.isArray(json) ? json : [];
          }
          const matches = lots.filter(l => [l.id, l.lot_number, l.lot_title, l.contact_name].some(v => norm(v) === lot));
          if (matches.length !== 1) {
            lots_possibles = lots.map(l => ({ id: l.id, numero: l.lot_number, titre: l.lot_title, entreprise: l.contact_name }));
            non_importes.push({ element: texte, raison: matches.length ? `plusieurs lots correspondent à « ${o.lot} »` : `lot « ${o.lot} » introuvable` });
            continue;
          }
          lotId = String(matches[0].id);
        }
        const due = ISO_DATE.test(String(o.due_date || '')) ? String(o.due_date) : undefined;
        const { res: pr, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/observations`, 'POST', {
          texte, statut: 'À faire', created_report_id: report.id,
          type: OBSERVATION_TYPES.includes(o.type) ? o.type : 'observation',
          urgence: URGENCES.includes(o.urgence) ? o.urgence : 'normal',
          ...(lotId ? { lot_id: lotId } : {}),
          ...(due ? { due_date: due } : {}),
        });
        if (!pr.ok) { non_importes.push({ element: texte, raison: json?.error || `HTTP ${pr.status}` }); continue; }
        seen.add(norm(texte)); added.observations++;
      }
    }

    // ── Décisions et notes de réunion : un seul PUT, qui renvoie les champs conservés ──
    // PUT /api/reports/:id réécrit format, intervenants, notes et prochaine réunion à partir du
    // corps : on les renvoie donc tels qu'ils sont, et seuls décisions et notes bougent.
    const currentDecisions: Json[] = Array.isArray(report.decisions) ? report.decisions : [];
    const seenDecisions = new Set(currentDecisions.map(d => norm(d.texte)));
    const newDecisions: Json[] = [];
    for (const d of decisions) {
      const texte = clip(d.texte);
      if (!texte) { non_importes.push({ element: 'décision vide', raison: 'texte requis' }); continue; }
      if (seenDecisions.has(norm(texte))) { doublons.push(texte); continue; }
      seenDecisions.add(norm(texte));
      newDecisions.push({ auteur: clip(d.auteur).slice(0, 120), texte, tag: DECISION_TAGS.includes(d.tag) ? d.tag : 'technique' });
    }
    const currentNotes = String(report.meetingNotes || '').trim();
    const notesAlreadyThere = !!meetingNotes && norm(currentNotes).includes(norm(meetingNotes));
    if (notesAlreadyThere) doublons.push(meetingNotes.slice(0, 80));
    const appendNotes = !!meetingNotes && !notesAlreadyThere;
    if (newDecisions.length || appendNotes) {
      const { res, json } = await request(`/api/reports/${reportId}`, 'PUT', {
        pageFormat: report.pageFormat || undefined,
        stakeholders: report.stakeholders || [],
        companies: report.companies || [],
        nextMeeting: report.nextMeeting || undefined,
        meetingNotes: appendNotes ? [currentNotes, meetingNotes].filter(Boolean).join('\n\n') : (currentNotes || undefined),
        decisions: [...currentDecisions, ...newDecisions],
      });
      if (!res.ok) {
        non_importes.push({ element: 'décisions et notes de réunion', raison: json?.error || `HTTP ${res.status}` });
      } else {
        added.decisions = newDecisions.length;
        added.meeting_notes = appendNotes;
      }
    }

    const total = added.rubriques + added.observations + added.decisions + (added.meeting_notes ? 1 : 0);
    const response: Json = {
      success: non_importes.length === 0 || total > 0,
      report_id: report.id, report_number: report.report_number, project_id: projectId,
      ajoutes: added,
      ...(doublons.length ? { doublons_ignores: doublons } : {}),
      ...(non_importes.length ? { non_importes } : {}),
      ...(lots_possibles ? { lots_possibles } : {}),
      record_url: buildRecordUrl('site_reports', { id: report.id, project_id: projectId }),
    };
    if (total === 0 && non_importes.length) response.error = "Aucune note n'a pu être importée.";
    return { response, summary: `${total} élément${total > 1 ? 's' : ''} importé${total > 1 ? 's' : ''} dans le CR de chantier n° ${report.report_number}` };
  } catch (e: any) {
    return { response: { error: e?.message || "Import des notes impossible." } };
  }
}
