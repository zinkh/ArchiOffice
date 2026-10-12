// Outils d'agent pour ce que la fiche affaire porte HORS des ressources CRUD de AGENT_RESOURCES :
// des listes rattachées à l'opération ou des routes imbriquées (/api/projects/:id/...) que
// create_record / update_record n'atteignent pas. Sans eux, un agent à qui l'on demandait
// d'ajouter les lots, l'équipe, les cotraitants ou un point au journal d'une affaire créait une
// tâche à la place du travail demandé.
//
// Tous passent par l'API REST avec le jeton de la personne (mêmes contrôles, même journal
// d'activité que l'écran). Deux principes communs : rejouer une demande est sans risque (un
// doublon est signalé, jamais recréé) et retirer quoi que ce soit demande la confirmation en
// deux temps de delete_record (needs_confirmation, puis confirm: true).
//
//   manage_project_lots         lots de l'opération (numéro, intitulé, ordre)
//   manage_project_cotraitants  cotraitants du contrat (spécialité + contact)
//   manage_project_members      équipe du cabinet affectée à l'affaire
//   manage_project_journal      phase en cours et journal de l'opération (notes de phase)
//   manage_observations         observations de chantier de l'opération, hors compte-rendu
//   manage_meeting_attendees    participants d'une réunion
//
// Le CHANGEMENT de phase reste volontairement un geste humain : il passe par une checklist de
// contrôles à renseigner (POST /api/projects/:id/phase), qu'un agent ne doit pas valider seul.
import type { FunctionDeclarationLike } from './toolTypes.js';
import type { InternalAuth } from './internalApi.js';
import { buildRecordUrl } from './recordLinks.js';
import { createContactResolver, failure, makeRequest, norm, plural, text, type Json, type ToolRequest } from './toolRequest.js';

type Result = { response: Json; summary?: string };

const MAX_ITEMS = 50;
const asItems = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object').slice(0, MAX_ITEMS) : []);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const confirmation = (aRetirer: unknown, extra: Json = {}): Result => ({
  response: { needs_confirmation: true, a_retirer: aRetirer, ...extra, instruction: "Présente cela à l'utilisateur. Ne rappelle l'outil avec confirm: true qu'après son accord explicite sur ces éléments précis." },
});

export const PROJECT_WORK_TOOL_NAMES = [
  'manage_project_lots', 'manage_project_cotraitants', 'manage_project_members', 'manage_project_journal', 'manage_observations',
] as const;
export const MEETING_WORK_TOOL_NAMES = ['manage_meeting_attendees'] as const;

const projectIdProp = { type: 'string', description: "Identifiant de l'opération (search_records sur projects)" };
const confirmProp = { type: 'boolean', description: "Pour remove : laisser vide au premier appel ; true seulement après l'accord explicite de l'utilisateur." };

export const PROJECT_WORK_TOOLS: FunctionDeclarationLike[] = [
  {
    name: 'manage_project_lots',
    description:
      "Lit, ajoute, modifie, retire ou réordonne les LOTS d'une opération (liste des lots de la fiche : numéro et intitulé). " +
      "À utiliser dès que l'utilisateur parle des lots d'une affaire (« ajoute le lot 03 Charpente », « renumérote », « mets le lot X en premier »), jamais une tâche ni la description du projet. " +
      "Le numéro est libre (« 00 », « 01A », « 01.2 ») mais unique dans le projet. add : lots = [{numero, intitule}]. update : lots = [{id ou numero, nouveau_numero?, intitule?}]. " +
      "remove : lots = [{id ou numero}], avec confirmation en deux temps ; retirer un lot détache ses visas et ses marchés. reorder : ordre = numéros ou identifiants dans le nouvel ordre (les lots omis suivent, dans leur ordre actuel).",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        action: { type: 'string', enum: ['list', 'add', 'update', 'remove', 'reorder'] },
        lots: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, numero: { type: 'string' }, nouveau_numero: { type: 'string' }, intitule: { type: 'string' } } } },
        ordre: { type: 'array', items: { type: 'string' }, description: 'reorder : numéros ou identifiants de lots, dans le nouvel ordre' },
        confirm: confirmProp,
      },
      required: ['project_id', 'action'],
    },
  },
  {
    name: 'manage_project_cotraitants',
    description:
      "Lit, ajoute ou retire les COTRAITANTS d'une opération (bureaux d'études et cotraitants du groupement de maîtrise d'œuvre listés dans la fiche : spécialité + fiche contact). " +
      "Distincts des intervenants (manage_project_stakeholders) et des entreprises de travaux (lots). Chaque cotraitant est une fiche contact existante (contact_id ou nom exact) avec une spécialité obligatoire (« Structure », « Fluides », « Thermique »...). " +
      "add : intervenants = [{contact_id|nom, specialite}] ; remove : [{contact_id|nom, specialite?}] avec confirmation en deux temps.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        action: { type: 'string', enum: ['list', 'add', 'remove'] },
        intervenants: { type: 'array', items: { type: 'object', properties: { contact_id: { type: 'string' }, nom: { type: 'string' }, specialite: { type: 'string' } } } },
        confirm: confirmProp,
      },
      required: ['project_id', 'action'],
    },
  },
  {
    name: 'manage_project_members',
    description:
      "Lit, ajoute ou retire les membres de l'ÉQUIPE DU CABINET affectés à une opération (qui travaille sur l'affaire, ce qui détermine aussi qui la voit pour un chef de projet). " +
      "Ce sont des personnes du cabinet (comptes), pas des contacts : désigne-les par user_id, nom exact ou e-mail. add : membres = [{user_id|nom|email, role?}] ; remove : [{user_id|nom|email}] avec confirmation en deux temps.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        action: { type: 'string', enum: ['list', 'add', 'remove'] },
        membres: { type: 'array', items: { type: 'object', properties: { user_id: { type: 'string' }, nom: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', description: 'Rôle sur l\'affaire (défaut : member)' } } } },
        confirm: confirmProp,
      },
      required: ['project_id', 'action'],
    },
  },
  {
    name: 'manage_project_journal',
    description:
      "Lit la phase de mission en cours d'une opération et son JOURNAL (notes datées par phase : observation, programme, budget, décision du maître d'ouvrage, point d'attention), ou y ajoute une note. " +
      "À utiliser pour consigner une décision du client, un dépassement de budget ou un point de vigilance, plutôt que le champ description. " +
      "action « list » : phase en cours + notes ; « add_note » : phase (défaut : la phase en cours), type (observation, programme, budget, decision_moa, attention), texte, et pour un budget budget_avant / budget_apres en euros. " +
      "Cet outil ne change PAS la phase : le passage à la phase suivante passe par la checklist de contrôles de la fiche, que seul l'utilisateur valide.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        action: { type: 'string', enum: ['list', 'add_note'] },
        phase: { type: 'string', enum: ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR'] },
        type: { type: 'string', enum: ['observation', 'programme', 'budget', 'decision_moa', 'attention'] },
        texte: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD (défaut : aujourd\'hui)' },
        budget_avant: { type: 'number' },
        budget_apres: { type: 'number' },
      },
      required: ['project_id', 'action'],
    },
  },
  {
    name: 'manage_observations',
    description:
      "Lit, ajoute, modifie, lève ou supprime les OBSERVATIONS de chantier d'une opération (suivi par lot, onglet Observations), indépendamment d'un compte-rendu. " +
      "Pour inscrire un point dans un brouillon de CR précis, utilise plutôt add_site_report_observation. " +
      "add : observations = [{texte, lot?, type?, urgence?, due_date?}] ; update : [{id, texte?, statut?, urgence?, due_date?, reponse?, lot?}] (statut : « À faire », « En cours », « Levée », « Urgent », « Refusée ») ; " +
      "remove : [{id}] avec confirmation en deux temps ; list : ouvertes_seulement pour ne voir que celles non levées.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        action: { type: 'string', enum: ['list', 'add', 'update', 'remove'] },
        ouvertes_seulement: { type: 'boolean' },
        observations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, texte: { type: 'string' }, lot: { type: 'string', description: 'Numéro, intitulé du lot ; ne pas inventer' },
              type: { type: 'string', enum: ['observation', 'reserve', 'a_faire'] }, urgence: { type: 'string', enum: ['normal', 'urgent', 'bloquant'] },
              statut: { type: 'string' }, due_date: { type: 'string' }, reponse: { type: 'string' },
            },
          },
        },
        confirm: confirmProp,
      },
      required: ['project_id', 'action'],
    },
  },
];

export const MEETING_WORK_TOOLS: FunctionDeclarationLike[] = [
  {
    name: 'manage_meeting_attendees',
    description:
      "Lit, ajoute ou retire les PARTICIPANTS d'une réunion (fiche réunion de l'application : contacts invités avec leur rôle). " +
      "Chaque participant est une fiche contact existante (contact_id ou nom exact ; crée-la d'abord avec create_record si besoin) et un rôle facultatif. " +
      "add : participants = [{contact_id|nom, role?}] ; remove : [{contact_id|nom}] avec confirmation en deux temps. meeting_id vient de search_records sur meetings.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        meeting_id: { type: 'string', description: 'Identifiant de la réunion' },
        action: { type: 'string', enum: ['list', 'add', 'remove'] },
        participants: { type: 'array', items: { type: 'object', properties: { contact_id: { type: 'string' }, nom: { type: 'string' }, role: { type: 'string' } } } },
        confirm: confirmProp,
      },
      required: ['meeting_id', 'action'],
    },
  },
];

// ── Lots ─────────────────────────────────────────────────────────────────────

const lotView = (l: Json) => ({ id: l.id, numero: l.lot_number, intitule: l.lot_title, contact_id: l.contact_id || null });

async function manageLots(request: ToolRequest, projectId: string, args: Json): Promise<Result> {
  const action = text(args.action);
  const base = `/api/projects/${encodeURIComponent(projectId)}/lots`;
  const read = async (): Promise<Json[] | null> => {
    const { res, json } = await request(base);
    return res.ok && Array.isArray(json) ? json : null;
  };
  let lots = await read();
  if (!lots) return failure('Lecture des lots impossible : opération introuvable ?');
  const recordUrl = buildRecordUrl('projects', { id: projectId });
  const done = (extra: Json, summary: string, fresh: Json[]): Result => ({ response: { success: true, ...extra, lots: fresh.map(lotView), record_url: recordUrl }, summary });
  const find = (it: Json) => lots!.find(l => (it.id ? String(l.id) === text(it.id) : norm(l.lot_number) === norm(it.numero)));
  const items = asItems(args.lots);

  if (action === 'list') return { response: { project_id: projectId, lots: lots.map(lotView), record_url: recordUrl } };

  if (action === 'add') {
    if (!items.length) return failure('lots est requis pour add.');
    const ajoutes: Json[] = []; const deja_presents: Json[] = []; const non_traites: Json[] = [];
    for (const it of items) {
      const numero = text(it.numero); const intitule = text(it.intitule);
      if (!numero || !intitule) { non_traites.push({ element: numero || intitule || 'lot vide', raison: 'numero et intitule requis' }); continue; }
      const same = lots.find(l => norm(l.lot_number) === norm(numero));
      if (same) {
        if (norm(same.lot_title) === norm(intitule)) deja_presents.push({ numero, intitule });
        else non_traites.push({ element: `${numero} ${intitule}`, raison: `le numéro « ${numero} » est déjà pris par « ${same.lot_title} » : utilise update ou un autre numéro` });
        continue;
      }
      const { res, json } = await request(base, 'POST', { lot_number: numero, lot_title: intitule });
      if (!res.ok) { non_traites.push({ element: `${numero} ${intitule}`, raison: json?.error || `HTTP ${res.status}` }); continue; }
      ajoutes.push({ id: json?.id, numero, intitule });
      lots = (await read()) ?? lots;
    }
    if (!ajoutes.length && non_traites.length) return failure("Aucun lot n'a pu être ajouté.", { non_traites, deja_presents, lots: lots.map(lotView) });
    return done({ ajoutes, ...(deja_presents.length ? { deja_presents } : {}), ...(non_traites.length ? { non_traites } : {}) }, `${plural(ajoutes.length, 'lot ajouté', 'lots ajoutés')} à l'opération`, lots);
  }

  if (action === 'update') {
    if (!items.length) return failure('lots est requis pour update.');
    const modifies: Json[] = []; const non_traites: Json[] = [];
    for (const it of items) {
      const lot = find(it);
      if (!lot) { non_traites.push({ element: text(it.id) || text(it.numero), raison: 'lot introuvable dans cette opération' }); continue; }
      const patch: Json = {};
      if (text(it.nouveau_numero)) patch.lot_number = text(it.nouveau_numero);
      if (text(it.intitule)) patch.lot_title = text(it.intitule);
      if (!Object.keys(patch).length) { non_traites.push({ element: lot.lot_number, raison: 'rien à modifier : nouveau_numero ou intitule requis' }); continue; }
      const { res, json } = await request(`/api/lots/${encodeURIComponent(String(lot.id))}`, 'PUT', patch);
      if (!res.ok) { non_traites.push({ element: `${lot.lot_number} ${lot.lot_title}`, raison: json?.error || `HTTP ${res.status}` }); continue; }
      modifies.push({ id: lot.id, avant: { numero: lot.lot_number, intitule: lot.lot_title }, apres: { numero: patch.lot_number ?? lot.lot_number, intitule: patch.lot_title ?? lot.lot_title } });
    }
    const fresh = (await read()) ?? lots;
    if (!modifies.length) return failure("Aucun lot n'a pu être modifié.", { non_traites, lots: fresh.map(lotView) });
    return done({ modifies, ...(non_traites.length ? { non_traites } : {}) }, `${plural(modifies.length, 'lot modifié', 'lots modifiés')}`, fresh);
  }

  if (action === 'remove') {
    if (!items.length) return failure('lots est requis pour remove.');
    const cibles: Json[] = []; const non_traites: Json[] = [];
    for (const it of items) { const lot = find(it); if (lot && !cibles.includes(lot)) cibles.push(lot); else if (!lot) non_traites.push({ element: text(it.id) || text(it.numero), raison: 'lot introuvable dans cette opération' }); }
    if (!cibles.length) return failure('Aucun lot à retirer.', { non_traites, lots: lots.map(lotView) });
    if (args.confirm !== true) return confirmation(cibles.map(lotView), { avertissement: 'Retirer un lot détache ses visas, ses marchés et ses articles de DPGF.', ...(non_traites.length ? { non_traites } : {}) });
    const retires: Json[] = [];
    for (const lot of cibles) {
      const { res, json } = await request(`/api/lots/${encodeURIComponent(String(lot.id))}`, 'DELETE');
      if (res.ok) retires.push(lotView(lot)); else non_traites.push({ element: `${lot.lot_number} ${lot.lot_title}`, raison: json?.error || `HTTP ${res.status}` });
    }
    const fresh = (await read()) ?? [];
    return done({ retires, ...(non_traites.length ? { non_traites } : {}) }, `${plural(retires.length, 'lot retiré', 'lots retirés')} de l'opération`, fresh);
  }

  if (action === 'reorder') {
    const wanted = Array.isArray(args.ordre) ? args.ordre.map(text).filter(Boolean) : [];
    if (!wanted.length) return failure('ordre est requis pour reorder.');
    const ids: string[] = []; const inconnus: string[] = [];
    for (const w of wanted) {
      const lot = lots.find(l => String(l.id) === w) ?? lots.find(l => norm(l.lot_number) === norm(w));
      if (!lot) inconnus.push(w); else if (!ids.includes(String(lot.id))) ids.push(String(lot.id));
    }
    if (inconnus.length) return failure(`Lots introuvables : ${inconnus.join(', ')}.`, { lots: lots.map(lotView) });
    for (const l of lots) if (!ids.includes(String(l.id))) ids.push(String(l.id));
    const { res, json } = await request(`${base}/order`, 'PUT', { ids });
    if (!res.ok) return failure(json?.error || `Réorganisation impossible (HTTP ${res.status}).`);
    return done({}, 'Lots réordonnés', Array.isArray(json) ? json : (await read()) ?? lots);
  }
  return failure('action doit valoir list, add, update, remove ou reorder.');
}

// ── Cotraitants ──────────────────────────────────────────────────────────────

async function manageCotraitants(request: ToolRequest, projectId: string, args: Json): Promise<Result> {
  const action = text(args.action);
  const projectPath = `/api/projects/${encodeURIComponent(projectId)}`;
  const { res: pr, json: project } = await request(`${projectPath}/full`);
  if (!pr.ok || !project) return failure(project?.error || `Opération introuvable (HTTP ${pr.status}).`);
  const current: Json[] = Array.isArray(project.cotraitants_list) ? project.cotraitants_list : [];
  const view = (c: Json) => ({ id: c.id, specialite: c.specialty, contact_id: c.contact_id || null });
  const recordUrl = buildRecordUrl('projects', { id: projectId });
  if (action === 'list') return { response: { project_id: projectId, cotraitants: current.map(view), record_url: recordUrl } };
  if (action !== 'add' && action !== 'remove') return failure('action doit valoir list, add ou remove.');
  const items = asItems(args.intervenants);
  if (!items.length) return failure('intervenants est requis pour add et remove.');

  const resolve = createContactResolver(request);
  const next: Json[] = current.map(c => ({ id: c.id, specialty: c.specialty, contact_id: c.contact_id || null }));
  const changes: Json[] = []; const deja_presents: Json[] = []; const non_traites: Json[] = [];
  const retires: Json[] = [];

  for (const it of items) {
    const specialite = text(it.specialite);
    const r = await resolve(it);
    const label = r.name || text(it.nom) || text(it.contact_id) || 'cotraitant';
    if (r.inconnu) { non_traites.push({ element: label, raison: 'contact_id introuvable dans ce cabinet' }); continue; }
    if (r.ambigu) { non_traites.push({ element: label, raison: 'plusieurs contacts portent ce nom : précise contact_id', candidats: r.ambigu }); continue; }
    if (!r.contact_id) { non_traites.push({ element: label, raison: 'un cotraitant est une fiche contact existante : crée-la avec create_record puis passe son contact_id' }); continue; }
    if (action === 'add') {
      if (!specialite) { non_traites.push({ element: label, raison: 'specialite requise' }); continue; }
      if (next.some(c => c.contact_id === r.contact_id && norm(c.specialty) === norm(specialite))) { deja_presents.push({ nom: r.name, specialite }); continue; }
      next.push({ id: crypto.randomUUID(), specialty: specialite, contact_id: r.contact_id });
      changes.push({ nom: r.name, specialite, contact_id: r.contact_id });
    } else {
      const matches = next.filter(c => c.contact_id === r.contact_id && (!specialite || norm(c.specialty) === norm(specialite)) && !retires.includes(c));
      if (!matches.length) { non_traites.push({ element: label, raison: "ne fait pas partie des cotraitants de l'opération" }); continue; }
      if (matches.length > 1 && !specialite) { non_traites.push({ element: label, raison: 'tient plusieurs spécialités : précise specialite', candidats: matches.map(view) }); continue; }
      retires.push(...matches);
    }
  }

  if (action === 'remove') {
    if (!retires.length) return failure('Aucun cotraitant à retirer.', { non_traites, cotraitants: current.map(view) });
    if (args.confirm !== true) return confirmation(retires.map(view), non_traites.length ? { non_traites } : {});
    for (const c of retires) next.splice(next.indexOf(c), 1);
    changes.push(...retires.map(view));
  } else if (!changes.length) {
    return { response: { success: non_traites.length === 0, ajoutes: [], ...(deja_presents.length ? { deja_presents } : {}), ...(non_traites.length ? { non_traites } : {}), cotraitants: current.map(view), record_url: recordUrl, ...(non_traites.length ? { error: "Aucun cotraitant n'a pu être ajouté." } : {}) } };
  }

  // La liste est envoyée seule : le serveur ne remplace une liste que si le corps la porte
  // et garde l'identifiant des lignes déjà présentes.
  const { res, json } = await request(projectPath, 'PUT', { cotraitants_list: next });
  if (!res.ok) return failure(json?.error || `Enregistrement des cotraitants impossible (HTTP ${res.status}).`);
  const { json: after } = await request(`${projectPath}/full`);
  const saved: Json[] = Array.isArray(after?.cotraitants_list) ? after.cotraitants_list : next.map(c => ({ ...c }));
  return {
    response: { success: true, project_id: projectId, [action === 'add' ? 'ajoutes' : 'retires']: changes, ...(deja_presents.length ? { deja_presents } : {}), ...(non_traites.length ? { non_traites } : {}), cotraitants: saved.map(view), record_url: recordUrl },
    summary: `${plural(changes.length, 'cotraitant')} ${action === 'add' ? 'ajouté' : 'retiré'}${changes.length > 1 ? 's' : ''}`,
  };
}

// ── Équipe de l'affaire ──────────────────────────────────────────────────────

async function manageMembers(request: ToolRequest, projectId: string, args: Json): Promise<Result> {
  const action = text(args.action);
  const base = `/api/projects/${encodeURIComponent(projectId)}/members`;
  const { res: team, json: people } = await request('/api/team');
  if (!team.ok || !Array.isArray(people)) return failure("Lecture de l'équipe du cabinet impossible.");
  const nameOf = (id: string) => people.find(p => String(p.id) === id)?.name || id;
  const readMembers = async (): Promise<Json[]> => { const { res, json } = await request(base); return res.ok && Array.isArray(json) ? json : []; };
  const view = (m: Json) => ({ user_id: m.user_id, nom: nameOf(String(m.user_id)), role: m.role || 'member' });
  const current = await readMembers();
  const recordUrl = buildRecordUrl('projects', { id: projectId });
  if (action === 'list') return { response: { project_id: projectId, membres: current.map(view), record_url: recordUrl } };
  if (action !== 'add' && action !== 'remove') return failure('action doit valoir list, add ou remove.');
  const items = asItems(args.membres);
  if (!items.length) return failure('membres est requis pour add et remove.');

  const resolve = (it: Json): { id?: string; label: string; erreur?: string; candidats?: Json[] } => {
    const label = text(it.nom) || text(it.email) || text(it.user_id) || 'membre';
    let found = text(it.user_id) ? people.filter(p => String(p.id) === text(it.user_id)) : [];
    if (!found.length && text(it.email)) found = people.filter(p => norm(p.email) === norm(it.email));
    if (!found.length && text(it.nom)) found = people.filter(p => norm(p.name) === norm(it.nom));
    if (found.length === 1) return { id: String(found[0].id), label: found[0].name || label };
    if (found.length > 1) return { label, erreur: 'plusieurs personnes correspondent : précise user_id', candidats: found.map(p => ({ user_id: p.id, nom: p.name, email: p.email })) };
    return { label, erreur: "personne introuvable dans l'équipe du cabinet" };
  };

  const changes: Json[] = []; const deja_presents: Json[] = []; const non_traites: Json[] = [];
  const cibles: Json[] = [];
  for (const it of asItems(args.membres)) {
    const r = resolve(it);
    if (!r.id) { non_traites.push({ element: r.label, raison: r.erreur, ...(r.candidats ? { candidats: r.candidats } : {}) }); continue; }
    const existing = current.find(m => String(m.user_id) === r.id);
    if (action === 'add') {
      if (existing) { deja_presents.push({ nom: r.label }); continue; }
      const { res, json } = await request(base, 'POST', { user_id: r.id, ...(text(it.role) ? { role: text(it.role) } : {}) });
      if (!res.ok) { non_traites.push({ element: r.label, raison: json?.error || `HTTP ${res.status}` }); continue; }
      changes.push({ user_id: r.id, nom: r.label, role: text(it.role) || 'member' });
    } else if (!existing) non_traites.push({ element: r.label, raison: "ne fait pas partie de l'équipe de l'affaire" });
    else if (!cibles.includes(existing)) cibles.push(existing);
  }

  if (action === 'remove') {
    if (!cibles.length) return failure('Aucun membre à retirer.', { non_traites, membres: current.map(view) });
    if (args.confirm !== true) return confirmation(cibles.map(view), non_traites.length ? { non_traites } : {});
    for (const m of cibles) {
      const { res, json } = await request(`${base}/${encodeURIComponent(String(m.user_id))}`, 'DELETE');
      if (res.ok) changes.push(view(m)); else non_traites.push({ element: nameOf(String(m.user_id)), raison: json?.error || `HTTP ${res.status}` });
    }
  } else if (!changes.length) {
    return { response: { success: non_traites.length === 0, ajoutes: [], ...(deja_presents.length ? { deja_presents } : {}), ...(non_traites.length ? { non_traites } : {}), membres: current.map(view), record_url: recordUrl, ...(non_traites.length ? { error: "Aucun membre n'a pu être ajouté." } : {}) } };
  }
  return {
    response: { success: true, project_id: projectId, [action === 'add' ? 'ajoutes' : 'retires']: changes, ...(deja_presents.length ? { deja_presents } : {}), ...(non_traites.length ? { non_traites } : {}), membres: (await readMembers()).map(view), record_url: recordUrl },
    summary: `${plural(changes.length, 'membre')} ${action === 'add' ? 'affecté' : 'retiré'}${changes.length > 1 ? 's' : ''} ${action === 'add' ? 'à' : 'de'} l'opération`,
  };
}

// ── Journal et phase ─────────────────────────────────────────────────────────

const NOTE_KINDS = ['observation', 'programme', 'budget', 'decision_moa', 'attention'];
const PHASES = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR'];

async function manageJournal(request: ToolRequest, projectId: string, args: Json): Promise<Result> {
  const action = text(args.action);
  const projectPath = `/api/projects/${encodeURIComponent(projectId)}`;
  const { res: hr, json: history } = await request(`${projectPath}/phase-history`);
  const phases: Json[] = hr.ok && Array.isArray(history) ? history : [];
  const currentPhase: string | null = phases.length ? text([...phases].sort((a, b) => String(a.entered_at).localeCompare(String(b.entered_at))).at(-1)?.phase) || null : null;
  const { res: nr, json: notes } = await request(`${projectPath}/phase-notes`);
  if (!nr.ok || !Array.isArray(notes)) return failure(notes?.error || 'Lecture du journal impossible : opération introuvable ?');
  const view = (n: Json) => ({ id: n.id, phase: n.phase, type: n.kind, texte: n.body, date: n.occurred_on, budget_avant: n.budget_before ?? null, budget_apres: n.budget_after ?? null, auteur: n.author_name || null });
  const recordUrl = buildRecordUrl('projects', { id: projectId });
  if (action === 'list') return { response: { project_id: projectId, phase_en_cours: currentPhase, notes: notes.map(view), record_url: recordUrl } };
  if (action !== 'add_note') return failure('action doit valoir list ou add_note.');

  const body = text(args.texte);
  const phase = text(args.phase) || currentPhase || '';
  const kind = text(args.type) || 'observation';
  if (!body) return failure('texte est requis.');
  if (!PHASES.includes(phase)) return failure(currentPhase ? 'phase inconnue.' : "Aucune phase en cours pour cette opération : précise phase (ESQ, APS, APD, PC, PRO, DCE, ACT, VISA, DET, AOR).");
  if (!NOTE_KINDS.includes(kind)) return failure(`type doit valoir ${NOTE_KINDS.join(', ')}.`);
  const duplicate = notes.find(n => n.phase === phase && n.kind === kind && norm(n.body) === norm(body));
  if (duplicate) return { response: { success: true, already_exists: true, note: view(duplicate), record_url: recordUrl } };
  const date = ISO_DATE.test(text(args.date)) ? text(args.date) : undefined;
  const { res, json } = await request(`${projectPath}/phase-notes`, 'POST', {
    phase, kind, body, ...(date ? { occurred_on: date } : {}),
    ...(kind === 'budget' && args.budget_avant !== undefined ? { budget_before: args.budget_avant } : {}),
    ...(kind === 'budget' && args.budget_apres !== undefined ? { budget_after: args.budget_apres } : {}),
  });
  if (!res.ok) return failure(json?.error || `Ajout de la note impossible (HTTP ${res.status}).`);
  return { response: { success: true, note: view(json), phase_en_cours: currentPhase, record_url: recordUrl }, summary: `Note ajoutée au journal (phase ${phase})` };
}

// ── Observations ─────────────────────────────────────────────────────────────

const OBS_TYPES = ['observation', 'reserve', 'a_faire'];
const OBS_URGENCES = ['normal', 'urgent', 'bloquant'];

async function manageObservations(request: ToolRequest, projectId: string, args: Json): Promise<Result> {
  const action = text(args.action);
  const base = `/api/projects/${encodeURIComponent(projectId)}/observations`;
  const read = async (): Promise<Json[] | null> => { const { res, json } = await request(base); return res.ok && Array.isArray(json) ? json : null; };
  const list = await read();
  if (!list) return failure('Lecture des observations impossible : opération introuvable ?');
  const view = (o: Json) => ({ id: o.id, numero: o.number, texte: o.texte, statut: o.statut, type: o.type, urgence: o.urgence, echeance: o.due_date || null, lot: o.lot ? `${o.lot.lot_number} ${o.lot.lot_title}` : null, reponse: o.reponse || null });
  const recordUrl = buildRecordUrl('projects', { id: projectId });
  if (action === 'list') {
    const rows = args.ouvertes_seulement ? list.filter(o => o.statut !== 'Levée') : list;
    return { response: { project_id: projectId, total: rows.length, observations: rows.slice(0, 100).map(view), record_url: recordUrl } };
  }
  if (!['add', 'update', 'remove'].includes(action)) return failure('action doit valoir list, add, update ou remove.');
  const items = asItems(args.observations);
  if (!items.length) return failure('observations est requis pour add, update et remove.');

  let lots: Json[] | null = null;
  const resolveLot = async (value: unknown): Promise<{ id?: string; erreur?: string }> => {
    const w = norm(value);
    if (!w) return {};
    if (!lots) { const { res, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/lots`); lots = res.ok && Array.isArray(json) ? json : []; }
    const m = lots.filter(l => [l.id, l.lot_number, l.lot_title].some(v => norm(v) === w));
    if (m.length === 1) return { id: String(m[0].id) };
    return { erreur: m.length ? `plusieurs lots correspondent à « ${value} »` : `lot « ${value} » introuvable` };
  };

  const changes: Json[] = []; const doublons: string[] = []; const non_traites: Json[] = [];
  const cibles: Json[] = [];
  for (const it of items) {
    if (action === 'add') {
      const texte = text(it.texte);
      if (!texte) { non_traites.push({ element: 'observation vide', raison: 'texte requis' }); continue; }
      if (list.some(o => norm(o.texte) === norm(texte))) { doublons.push(texte); continue; }
      const lot = await resolveLot(it.lot);
      if (lot.erreur) { non_traites.push({ element: texte, raison: lot.erreur }); continue; }
      const due = ISO_DATE.test(text(it.due_date)) ? text(it.due_date) : undefined;
      const { res, json } = await request(base, 'POST', {
        texte, statut: 'À faire', type: OBS_TYPES.includes(it.type) ? it.type : 'observation', urgence: OBS_URGENCES.includes(it.urgence) ? it.urgence : 'normal',
        ...(lot.id ? { lot_id: lot.id } : {}), ...(due ? { due_date: due } : {}),
      });
      if (!res.ok) { non_traites.push({ element: texte, raison: json?.error || `HTTP ${res.status}` }); continue; }
      changes.push({ id: json?.id, numero: json?.number, texte });
      continue;
    }
    const obs = list.find(o => String(o.id) === text(it.id));
    if (!obs) { non_traites.push({ element: text(it.id) || 'observation', raison: "observation introuvable dans cette opération" }); continue; }
    if (action === 'remove') { cibles.push(obs); continue; }
    const patch: Json = {};
    for (const k of ['texte', 'statut', 'reponse'] as const) if (it[k] !== undefined) patch[k] = text(it[k]);
    if (it.urgence !== undefined) { if (!OBS_URGENCES.includes(it.urgence)) { non_traites.push({ element: obs.texte, raison: `urgence : ${OBS_URGENCES.join(', ')}` }); continue; } patch.urgence = it.urgence; }
    if (it.type !== undefined) { if (!OBS_TYPES.includes(it.type)) { non_traites.push({ element: obs.texte, raison: `type : ${OBS_TYPES.join(', ')}` }); continue; } patch.type = it.type; }
    if (it.due_date !== undefined) { if (it.due_date && !ISO_DATE.test(text(it.due_date))) { non_traites.push({ element: obs.texte, raison: 'due_date : YYYY-MM-DD' }); continue; } patch.due_date = text(it.due_date) || null; }
    if (it.lot !== undefined) { const lot = await resolveLot(it.lot); if (lot.erreur) { non_traites.push({ element: obs.texte, raison: lot.erreur }); continue; } patch.lot_id = lot.id ?? null; }
    if (!Object.keys(patch).length) { non_traites.push({ element: obs.texte, raison: 'rien à modifier' }); continue; }
    const { res, json } = await request(`/api/observations/${encodeURIComponent(String(obs.id))}`, 'PUT', patch);
    if (!res.ok) { non_traites.push({ element: obs.texte, raison: json?.error || `HTTP ${res.status}` }); continue; }
    changes.push({ id: obs.id, numero: obs.number, ...patch });
  }

  if (action === 'remove') {
    if (!cibles.length) return failure('Aucune observation à supprimer.', { non_traites });
    if (args.confirm !== true) return confirmation(cibles.map(view), non_traites.length ? { non_traites } : {});
    for (const o of cibles) {
      const { res, json } = await request(`/api/observations/${encodeURIComponent(String(o.id))}`, 'DELETE');
      if (res.ok) changes.push({ id: o.id, numero: o.number, texte: o.texte }); else non_traites.push({ element: o.texte, raison: json?.error || `HTTP ${res.status}` });
    }
  }
  if (!changes.length && non_traites.length) return failure("Aucune observation n'a pu être traitée.", { non_traites, ...(doublons.length ? { doublons_ignores: doublons } : {}) });
  const verb = action === 'add' ? 'ajoutée' : action === 'update' ? 'modifiée' : 'supprimée';
  return {
    response: { success: true, project_id: projectId, [action === 'add' ? 'ajoutees' : action === 'update' ? 'modifiees' : 'supprimees']: changes, ...(doublons.length ? { doublons_ignores: doublons } : {}), ...(non_traites.length ? { non_traites } : {}), record_url: recordUrl },
    summary: `${plural(changes.length, `observation ${verb}`, `observations ${verb}s`)}`,
  };
}

// ── Participants d'une réunion ───────────────────────────────────────────────

async function manageAttendees(request: ToolRequest, meetingId: string, args: Json): Promise<Result> {
  const action = text(args.action);
  const base = `/api/meetings/${encodeURIComponent(meetingId)}/attendees`;
  const read = async (): Promise<Json[] | null> => { const { res, json } = await request(base); return res.ok && Array.isArray(json) ? json : null; };
  const current = await read();
  if (!current) return failure('Lecture des participants impossible : réunion introuvable ?');
  const view = (a: Json) => ({ id: a.id, nom: a.contact ? ([a.contact.company_name, [a.contact.first_name, a.contact.last_name].filter(Boolean).join(' ')].find(Boolean) || '') : '', contact_id: a.contact_id, role: a.role || null });
  const recordUrl = buildRecordUrl('meetings', { id: meetingId });
  if (action === 'list') return { response: { meeting_id: meetingId, participants: current.map(view), record_url: recordUrl } };
  if (action !== 'add' && action !== 'remove') return failure('action doit valoir list, add ou remove.');
  const items = asItems(args.participants);
  if (!items.length) return failure('participants est requis pour add et remove.');

  const resolve = createContactResolver(request);
  const changes: Json[] = []; const deja_presents: Json[] = []; const non_traites: Json[] = []; const cibles: Json[] = [];
  for (const it of items) {
    const r = await resolve(it);
    const label = r.name || text(it.nom) || text(it.contact_id) || 'participant';
    if (r.inconnu) { non_traites.push({ element: label, raison: 'contact_id introuvable dans ce cabinet' }); continue; }
    if (r.ambigu) { non_traites.push({ element: label, raison: 'plusieurs contacts portent ce nom : précise contact_id', candidats: r.ambigu }); continue; }
    if (!r.contact_id) { non_traites.push({ element: label, raison: 'un participant est une fiche contact existante : crée-la avec create_record puis passe son contact_id' }); continue; }
    const existing = current.find(a => a.contact_id === r.contact_id);
    if (action === 'add') {
      if (existing) { deja_presents.push({ nom: r.name }); continue; }
      const { res, json } = await request(base, 'POST', { contact_id: r.contact_id, ...(text(it.role) ? { role: text(it.role) } : {}) });
      if (!res.ok) { non_traites.push({ element: label, raison: json?.error || `HTTP ${res.status}` }); continue; }
      changes.push({ nom: r.name, contact_id: r.contact_id, role: text(it.role) || null });
    } else if (!existing) non_traites.push({ element: label, raison: 'ne fait pas partie des participants de la réunion' });
    else if (!cibles.includes(existing)) cibles.push(existing);
  }
  if (action === 'remove') {
    if (!cibles.length) return failure('Aucun participant à retirer.', { non_traites, participants: current.map(view) });
    if (args.confirm !== true) return confirmation(cibles.map(view), non_traites.length ? { non_traites } : {});
    for (const a of cibles) {
      const { res, json } = await request(`/api/meetings/${encodeURIComponent(meetingId)}/attendees/${encodeURIComponent(String(a.id))}`, 'DELETE');
      if (res.ok) changes.push(view(a)); else non_traites.push({ element: view(a).nom, raison: json?.error || `HTTP ${res.status}` });
    }
  } else if (!changes.length) {
    return { response: { success: non_traites.length === 0, ajoutes: [], ...(deja_presents.length ? { deja_presents } : {}), ...(non_traites.length ? { non_traites } : {}), participants: current.map(view), record_url: recordUrl, ...(non_traites.length ? { error: "Aucun participant n'a pu être ajouté." } : {}) } };
  }
  return {
    response: { success: true, meeting_id: meetingId, [action === 'add' ? 'ajoutes' : 'retires']: changes, ...(deja_presents.length ? { deja_presents } : {}), ...(non_traites.length ? { non_traites } : {}), participants: ((await read()) ?? []).map(view), record_url: recordUrl },
    summary: `${plural(changes.length, 'participant')} ${action === 'add' ? 'ajouté' : 'retiré'}${changes.length > 1 ? 's' : ''}`,
  };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export async function executeProjectWorkTool(baseUrl: string, auth: InternalAuth, name: string, args: Json): Promise<Result> {
  const request = makeRequest(baseUrl, auth);
  try {
    if (name === 'manage_meeting_attendees') {
      const meetingId = text(args.meeting_id);
      return meetingId ? await manageAttendees(request, meetingId, args) : failure('meeting_id est requis.');
    }
    const projectId = text(args.project_id);
    if (!projectId) return failure('project_id est requis.');
    switch (name) {
      case 'manage_project_lots': return await manageLots(request, projectId, args);
      case 'manage_project_cotraitants': return await manageCotraitants(request, projectId, args);
      case 'manage_project_members': return await manageMembers(request, projectId, args);
      case 'manage_project_journal': return await manageJournal(request, projectId, args);
      case 'manage_observations': return await manageObservations(request, projectId, args);
      default: return failure(`Fonction inconnue : ${name}`);
    }
  } catch (e: any) {
    return failure(e?.message || 'Action impossible.');
  }
}
