// Intervenants d'une affaire (onglet INFOS de la fiche : maître d'ouvrage, écologue,
// bureau de contrôle, collectivité...). Table project_stakeholders, lue par
// GET /api/projects/:id/full (stakeholders_list) et écrite par
// PUT /api/projects/:id/stakeholders, qui REMPLACE toute la liste.
//
// Un agent ne pouvait pas les renseigner : aucune ressource de AGENT_RESOURCES ne les porte
// (la liste vit dans la fiche affaire, pas dans une route de collection) et update_record sur
// projects n'accepte pas stakeholders_list. Il créait alors une tâche « mettre à jour les
// intervenants » à la place du travail demandé.
//
// L'outil lit la liste actuelle, y ajoute ou en retire les lignes demandées et renvoie le
// tout : une ligne déjà présente garde son identifiant (les présences de compte rendu s'y
// rattachent), un doublon (même contact et même rôle) est ignoré, rejouer est sans risque.
// Retirer un intervenant passe par la même confirmation en deux temps que delete_record.
import type { FunctionDeclarationLike } from './toolTypes.js';
import { internalHeaders, type InternalAuth } from './internalApi.js';
import { buildRecordUrl } from './recordLinks.js';

export const MANAGE_PROJECT_STAKEHOLDERS_TOOL_NAME = 'manage_project_stakeholders';

const MAX_ITEMS = 50;
const ACTIONS = ['list', 'add', 'remove'];

export const MANAGE_PROJECT_STAKEHOLDERS_TOOL: FunctionDeclarationLike = {
  name: MANAGE_PROJECT_STAKEHOLDERS_TOOL_NAME,
  description:
    "Lit, ajoute ou retire les INTERVENANTS d'une opération (liste « Intervenants » de la fiche affaire : maître d'ouvrage, écologue, bureau de contrôle, collectivité, bureau d'études...). " +
    "Utilise cet outil dès que l'utilisateur demande d'ajouter, de lier ou de retirer des intervenants d'une affaire, jamais une tâche ni la description du projet comme substitut. " +
    "Chaque intervenant est une fiche contact existante (contact_id, obtenu avec search_records sur contacts) ET un rôle libre (« Écologue », « Bureau de contrôle »...) ; sans contact_id, " +
    "l'outil cherche le contact par son nom exact et, à défaut, enregistre le nom seul. Les contacts doivent exister : crée-les d'abord avec create_record. " +
    "action « list » : renvoie les intervenants actuels. « add » : ajoute ceux de intervenants, sans toucher aux autres ni créer de doublon. " +
    "« remove » : retire l'intervenant désigné par contact_id ou nom (et rôle si la même personne en tient plusieurs) ; premier appel sans confirm, qui ne retire rien et renvoie needs_confirmation, " +
    "puis confirm: true seulement après l'accord explicite de l'utilisateur.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: "Identifiant de l'opération (search_records sur projects)" },
      action: { type: 'string', enum: ACTIONS, description: 'list, add ou remove' },
      intervenants: {
        type: 'array',
        description: 'Intervenants à ajouter (add) ou à retirer (remove)',
        items: {
          type: 'object',
          properties: {
            contact_id: { type: 'string', description: 'Identifiant de la fiche contact' },
            nom: { type: 'string', description: "Nom du contact ou de la société, si contact_id n'est pas connu" },
            role: { type: 'string', description: 'Rôle dans l\'opération (obligatoire pour add) ; ex. « Écologue », « Autres intervenants »' },
          },
        },
      },
      confirm: { type: 'boolean', description: "Pour remove : laisser vide au premier appel ; true seulement après confirmation explicite de l'utilisateur." },
    },
    required: ['project_id', 'action'],
  },
};

type Json = Record<string, any>;
const norm = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase();
const text = (v: unknown) => String(v ?? '').trim();

const contactLabel = (c: Json): string =>
  text(c.company_name) || [text(c.first_name), text(c.last_name)].filter(Boolean).join(' ');

const view = (s: Json) => ({ id: s.id, nom: s.name, role: s.role, contact_id: s.contact_id || null });

export async function manageProjectStakeholders(baseUrl: string, auth: InternalAuth, args: Json): Promise<{ response: Json; summary?: string }> {
  const projectId = text(args.project_id);
  const action = text(args.action);
  if (!projectId) return { response: { error: 'project_id est requis.' } };
  if (!ACTIONS.includes(action)) return { response: { error: 'action doit valoir list, add ou remove.' } };
  const items: Json[] = Array.isArray(args.intervenants) ? args.intervenants.filter(x => x && typeof x === 'object').slice(0, MAX_ITEMS) : [];
  if (action !== 'list' && !items.length) return { response: { error: 'intervenants est requis pour add et remove.' } };

  const request = async (path: string, method = 'GET', body?: Json) => {
    const res = await fetch(baseUrl + path, { method, headers: internalHeaders(auth, body ? { 'Content-Type': 'application/json' } : undefined), body: body ? JSON.stringify(body) : undefined });
    const json: any = await res.json().catch(() => null);
    return { res, json };
  };

  try {
    const projectPath = `/api/projects/${encodeURIComponent(projectId)}`;
    const { res: pr, json: project } = await request(`${projectPath}/full`);
    if (!pr.ok || !project) return { response: { error: project?.error || `Opération introuvable (HTTP ${pr.status}).` } };
    const current: Json[] = Array.isArray(project.stakeholders_list) ? project.stakeholders_list : [];
    const recordUrl = buildRecordUrl('projects', { id: projectId });

    if (action === 'list') {
      return { response: { project_id: projectId, intervenants: current.map(view), record_url: recordUrl } };
    }

    // Les contacts ne sont lus que si un nom est à résoudre ou un contact_id à vérifier.
    let contacts: Json[] | null = null;
    const loadContacts = async (): Promise<Json[]> => {
      if (contacts) return contacts;
      const { res, json } = await request('/api/contacts');
      contacts = res.ok && Array.isArray(json) ? json : [];
      return contacts;
    };

    // Résout une demande vers (contact_id, nom) ; `ambigu` liste les candidats quand le nom correspond à plusieurs fiches.
    const resolve = async (it: Json): Promise<{ contact_id: string | null; name: string; ambigu?: Json[]; inconnu?: boolean }> => {
      const id = text(it.contact_id);
      const nom = text(it.nom);
      const all = await loadContacts();
      if (id) {
        const c = all.find(x => String(x.id) === id);
        return c ? { contact_id: id, name: contactLabel(c) } : { contact_id: null, name: nom, inconnu: true };
      }
      if (!nom) return { contact_id: null, name: '' };
      const matches = all.filter(c => norm(contactLabel(c)) === norm(nom) || norm(c.company_name) === norm(nom));
      if (matches.length === 1) return { contact_id: String(matches[0].id), name: contactLabel(matches[0]) };
      if (matches.length > 1) return { contact_id: null, name: nom, ambigu: matches.map(m => ({ id: m.id, nom: contactLabel(m) })) };
      return { contact_id: null, name: nom };
    };

    const same = (s: Json, contactId: string | null, name: string, role?: string) =>
      (contactId ? s.contact_id === contactId : norm(s.name) === norm(name)) && (!role || norm(s.role) === norm(role));

    const next: Json[] = current.map(s => ({ id: s.id, name: s.name, role: s.role, contact_id: s.contact_id || null }));
    const ajoutes: Json[] = [];
    const deja_presents: Json[] = [];
    const non_traites: { element: string; raison: string; candidats?: Json[] }[] = [];

    if (action === 'add') {
      for (const it of items) {
        const role = text(it.role);
        const r = await resolve(it);
        const label = r.name || text(it.nom) || text(it.contact_id) || 'intervenant sans nom';
        if (!role) { non_traites.push({ element: label, raison: 'rôle requis' }); continue; }
        if (r.inconnu) { non_traites.push({ element: label, raison: 'contact_id introuvable dans ce cabinet : retrouve-le avec search_records' }); continue; }
        if (!r.contact_id && !r.name) { non_traites.push({ element: label, raison: 'contact_id ou nom requis' }); continue; }
        if (r.ambigu) { non_traites.push({ element: label, raison: 'plusieurs contacts portent ce nom : précise contact_id', candidats: r.ambigu }); continue; }
        if (next.some(s => same(s, r.contact_id, r.name, role))) { deja_presents.push({ nom: r.name, role }); continue; }
        const row = { id: crypto.randomUUID(), name: r.name, role, contact_id: r.contact_id };
        next.push(row);
        ajoutes.push({ nom: r.name, role, contact_id: r.contact_id, lie_a_un_contact: !!r.contact_id });
      }
      if (next.length > MAX_ITEMS) return { response: { error: `Au plus ${MAX_ITEMS} intervenants par opération.` } };
      if (!ajoutes.length) {
        return { response: { success: non_traites.length === 0, ajoutes: [], ...(deja_presents.length ? { deja_presents } : {}), ...(non_traites.length ? { non_traites } : {}), intervenants: current.map(view), record_url: recordUrl, ...(non_traites.length ? { error: "Aucun intervenant n'a pu être ajouté." } : {}) } };
      }
    } else {
      const retires: Json[] = [];
      for (const it of items) {
        const role = text(it.role) || undefined;
        const r = await resolve(it);
        const label = r.name || text(it.nom) || text(it.contact_id) || 'intervenant';
        const matches = next.filter(s => (it.id ? s.id === text(it.id) : same(s, r.contact_id, r.name, role)) && !retires.includes(s));
        if (!matches.length) { non_traites.push({ element: label, raison: "ne fait pas partie des intervenants de l'opération" }); continue; }
        if (matches.length > 1 && !role) {
          non_traites.push({ element: label, raison: 'tient plusieurs rôles : précise role', candidats: matches.map(view) });
          continue;
        }
        retires.push(...matches);
      }
      if (!retires.length) return { response: { error: "Aucun intervenant à retirer.", non_traites, intervenants: current.map(view) } };
      if (args.confirm !== true) {
        return { response: { needs_confirmation: true, a_retirer: retires.map(view), ...(non_traites.length ? { non_traites } : {}), instruction: "Présente ces intervenants à l'utilisateur. Ne rappelle l'outil avec confirm: true qu'après son accord explicite." } };
      }
      for (const s of retires) next.splice(next.indexOf(s), 1);
      ajoutes.push(...retires.map(view));
    }

    const { res: putRes, json: put } = await request(`${projectPath}/stakeholders`, 'PUT', { stakeholders: next });
    if (!putRes.ok) return { response: { error: put?.error || `Enregistrement des intervenants impossible (HTTP ${putRes.status}).` } };
    const saved: Json[] = Array.isArray(put?.stakeholders) ? put.stakeholders : next;
    const key = action === 'add' ? 'ajoutes' : 'retires';
    return {
      response: {
        success: true, project_id: projectId,
        [key]: ajoutes,
        ...(deja_presents.length ? { deja_presents } : {}),
        ...(non_traites.length ? { non_traites } : {}),
        intervenants: saved.map(view),
        record_url: recordUrl,
      },
      summary: action === 'add'
        ? `${ajoutes.length} intervenant${ajoutes.length > 1 ? 's' : ''} ajouté${ajoutes.length > 1 ? 's' : ''} à l'opération`
        : `${ajoutes.length} intervenant${ajoutes.length > 1 ? 's' : ''} retiré${ajoutes.length > 1 ? 's' : ''} de l'opération`,
    };
  } catch (e: any) {
    return { response: { error: e?.message || 'Mise à jour des intervenants impossible.' } };
  }
}
