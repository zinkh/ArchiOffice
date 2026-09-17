// Outils exposés au serveur MCP (voir httpServer.ts). Trois familles :
//
//   - Cinq outils de lecture "riches", écrits à la main pour les cas les
//     plus courants (le détail complet d'une affaire, une liste simple sans
//     mot-clé) — rien d'équivalent n'existe dans buildAgentTools, qui ne sait
//     que chercher par mot-clé ou lire un enregistrement après l'avoir trouvé.
//   - Les pièces jointes (upload_document/list_documents/get_document/
//     delete_document) — écrits à la main pour la même raison : un upload
//     porte un fichier binaire, pas un objet JSON du moule create_record.
//   - Le jeu générique create_record / update_record / search_records —
//     ainsi que mail/géo/CCTP-DPGF — RÉUTILISÉ tel quel depuis tools.ts, le
//     même que le chat des agents internes. C'est ce qui permet d'ouvrir
//     d'un coup toutes les ressources du cabinet (contacts, devis, appels
//     d'offres, réunions, jalons, réserves, contrats MOE...) sans écrire un
//     outil par ressource : AGENT_RESOURCES en est la seule source, une
//     ressource qui y gagne une entrée devient disponible ici sans y toucher.
//
// Restriction volontaire par rapport au chat interne, quel que soit
// AGENT_RESOURCES : jamais delete_record (aucune suppression depuis une
// liaison externe, quel que soit le connecteur), jamais l'envoi réel de mail
// (mailSend: false — create_draft suffit, voir mailTools.ts), jamais
// fetch_url/consulter un collègue/publier au flux d'activité (des capacités
// pensées pour un agent interne du cabinet, pas pour Claude/Gemini).
import { internalHeaders, type InternalAuth } from '../internalApi.js';
import type { FunctionDeclarationLike } from '../toolTypes.js';
import { buildAgentTools, executeAgentAction, describeAuthorizedResources } from '../tools.js';
import { AGENT_RESOURCES, type AgentCapabilities } from '../../types.js';

async function callApi(baseUrl: string, auth: InternalAuth, method: string, path: string, body?: unknown) {
  try {
    const res = await fetch(baseUrl + path, {
      method,
      headers: internalHeaders(auth, body ? { 'Content-Type': 'application/json' } : undefined),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: data?.error || `Échec (${res.status})` }) }], isError: true };
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e?.message || 'Requête impossible.' }) }], isError: true };
  }
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

// ── Pièces jointes ───────────────────────────────────────────────────────
// Réutilise server/routes/documents.ts (upload multipart, liste, suppression
// avec versions) tel qu'il existe déjà pour l'onglet Documents d'une affaire
// — étendu par resource_type/resource_id (migrate_documents_attachments.sql)
// pour se rattacher à n'importe quelle fiche, pas seulement un projet. Ces
// quatre outils sont écrits à la main (comme les RICH_TOOLS ci-dessus) car
// aucun ne rentre dans le moule générique create_record/update_record : un
// upload porte un fichier binaire, pas un objet JSON, et une lecture doit
// aller chercher les octets derrière une URL signée plutôt que de renvoyer
// un enregistrement.
//
// Copie à la main de server/routes/documents.ts's ATTACHABLE_RESOURCE_TYPES
// — ce paquet n'importe rien du serveur hôte (voir externalFiles.ts), donc
// pas de source commune possible. Les deux listes doivent rester alignées.
const DOCUMENT_RESOURCE_TYPES = [
  'projects', 'contacts', 'proposals', 'tenders', 'permits', 'meetings',
  'receptions', 'reserves', 'contrats_moe', 'ordres_de_service', 'visas',
  'notes_honoraires', 'marches_entreprises', 'tasks', 'milestones',
];

// Volontairement plus bas que la limite serveur (50 Mo, server/documentUpload.ts) :
// un appel MCP porte le fichier encodé en base64 dans la requête JSON-RPC
// elle-même, environ un tiers plus volumineux que l'original — mieux vaut
// une limite annoncée et tenue que de laisser filer un appel qui échouera
// de toute façon plus loin dans la chaîne.
const MAX_MCP_FILE_BYTES = 25 * 1024 * 1024;

interface DocumentSummary {
  id: string;
  file_name: string;
  mime_type: string | null;
  category: string | null;
  size: number | null;
  uploaded_at: string;
}

function toSummary(doc: any): DocumentSummary {
  return {
    id: String(doc.id),
    file_name: doc.name,
    mime_type: doc.mime_type ?? null,
    category: doc.category ?? null,
    size: doc.size_bytes ?? null,
    uploaded_at: doc.uploaded_at,
  };
}

async function fetchAttachedDocuments(baseUrl: string, auth: InternalAuth, resource: string, resourceId: string): Promise<any[]> {
  const res = await fetch(
    `${baseUrl}/api/documents?resource_type=${encodeURIComponent(resource)}&resource_id=${encodeURIComponent(resourceId)}`,
    { headers: internalHeaders(auth) },
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

const DOCUMENT_TOOLS: FunctionDeclarationLike[] = [
  {
    name: 'upload_document',
    description:
      "Dépose un fichier (PDF, DOCX, XLSX, image...) et l'attache à une fiche existante du cabinet (projet, permis, appel d'offres, devis...). " +
      `Le fichier voyage encodé en base64 dans file_content — limite ${MAX_MCP_FILE_BYTES / (1024 * 1024)} Mo. ` +
      "category est un intitulé libre (ex. « CERFA », « notice_securite », « notice_accessibilite », « plan », « photo »).",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', enum: DOCUMENT_RESOURCE_TYPES, description: 'Type de fiche à laquelle attacher le fichier' },
        resource_id: { type: 'string', description: 'Identifiant de la fiche cible' },
        file_name: { type: 'string' },
        file_content: { type: 'string', description: 'Contenu du fichier encodé en base64' },
        mime_type: { type: 'string' },
        category: { type: 'string', description: 'Optionnel — classement libre du document' },
        description: { type: 'string', description: 'Optionnel' },
      },
      required: ['resource', 'resource_id', 'file_name', 'file_content', 'mime_type'],
    },
  },
  {
    name: 'list_documents',
    description: "Liste les pièces jointes déjà attachées à une fiche du cabinet.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', enum: DOCUMENT_RESOURCE_TYPES },
        resource_id: { type: 'string' },
      },
      required: ['resource', 'resource_id'],
    },
  },
  {
    name: 'get_document',
    description: "Retélécharge une pièce jointe (contenu encodé en base64) pour la relire ou l'analyser. Utilise list_documents au préalable pour connaître document_id.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', enum: DOCUMENT_RESOURCE_TYPES },
        resource_id: { type: 'string' },
        document_id: { type: 'string' },
      },
      required: ['resource', 'resource_id', 'document_id'],
    },
  },
  {
    name: 'delete_document',
    description:
      "Retire définitivement une pièce jointe. Action IRRÉVERSIBLE : n'appelle cet outil avec confirm: true qu'après que l'utilisateur a explicitement confirmé vouloir supprimer CE fichier précis. " +
      "Le premier appel (confirm absent/false) ne supprime rien et renvoie needs_confirmation avec le nom du fichier visé.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', enum: DOCUMENT_RESOURCE_TYPES },
        resource_id: { type: 'string' },
        document_id: { type: 'string' },
        confirm: { type: 'boolean', description: 'Laisser vide/false lors du premier essai.' },
      },
      required: ['resource', 'resource_id', 'document_id'],
    },
  },
];
const DOCUMENT_TOOL_NAMES = DOCUMENT_TOOLS.map(t => t.name);

async function executeDocumentTool(baseUrl: string, auth: InternalAuth, name: string, args: Record<string, any>) {
  const resource = String(args.resource || '');
  const resourceId = String(args.resource_id || '');
  if (!DOCUMENT_RESOURCE_TYPES.includes(resource)) return errorResult(`resource "${resource}" non pris en charge.`);
  if (!resourceId) return errorResult('resource_id est requis.');

  if (name === 'upload_document') {
    const fileName = String(args.file_name || '');
    const mimeType = String(args.mime_type || '');
    if (!fileName || !args.file_content || !mimeType) return errorResult('file_name, file_content et mime_type sont requis.');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(String(args.file_content), 'base64');
    } catch {
      return errorResult('file_content doit être un contenu encodé en base64 valide.');
    }
    if (buffer.length === 0) return errorResult('Fichier vide.');
    if (buffer.length > MAX_MCP_FILE_BYTES) {
      return errorResult(`Fichier trop volumineux (${Math.round(buffer.length / 1024 / 1024)} Mo, limite ${MAX_MCP_FILE_BYTES / 1024 / 1024} Mo).`);
    }
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), fileName);
    form.append('resource_type', resource);
    form.append('resource_id', resourceId);
    form.append('name', fileName);
    if (args.category) form.append('category', String(args.category));
    else form.append('category', 'Autre');
    if (args.description) form.append('description', String(args.description));
    try {
      const res = await fetch(`${baseUrl}/api/documents`, { method: 'POST', headers: internalHeaders(auth), body: form as any });
      const data: any = await res.json().catch(() => null);
      if (!res.ok) return errorResult(data?.error || `Échec du dépôt (${res.status}).`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          id: data.id, file_name: fileName, mime_type: mimeType, size: data.size_bytes ?? buffer.length, uploaded_at: data.uploaded_at,
        }) }],
      };
    } catch (e: any) {
      return errorResult(e?.message || 'Dépôt impossible.');
    }
  }

  if (name === 'list_documents') {
    const docs = await fetchAttachedDocuments(baseUrl, auth, resource, resourceId);
    return { content: [{ type: 'text' as const, text: JSON.stringify(docs.map(toSummary)) }] };
  }

  const documentId = String(args.document_id || '');
  if (!documentId) return errorResult('document_id est requis.');
  const docs = await fetchAttachedDocuments(baseUrl, auth, resource, resourceId);
  const doc = docs.find(d => String(d.id) === documentId);
  if (!doc) return errorResult('Document introuvable pour cette fiche.');

  if (name === 'get_document') {
    if (doc.size_bytes && doc.size_bytes > MAX_MCP_FILE_BYTES) {
      return errorResult(`Fichier trop volumineux pour être retéléchargé ici (${Math.round(doc.size_bytes / 1024 / 1024)} Mo, limite ${MAX_MCP_FILE_BYTES / 1024 / 1024} Mo).`);
    }
    try {
      const signedRes = await fetch(`${baseUrl}/api/storage/signed-url?url=${encodeURIComponent(doc.file_url)}`, { headers: internalHeaders(auth) });
      const signed: any = await signedRes.json().catch(() => null);
      if (!signedRes.ok || !signed?.url) return errorResult(signed?.error || 'Impossible de résoudre le fichier.');
      const fileRes = await fetch(signed.url.startsWith('http') ? signed.url : `${baseUrl}${signed.url}`);
      if (!fileRes.ok) return errorResult(`Fichier indisponible (${fileRes.status}).`);
      const arrayBuffer = await fileRes.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          id: doc.id, file_name: doc.name, mime_type: doc.mime_type, size: doc.size_bytes, uploaded_at: doc.uploaded_at, file_content: base64,
        }) }],
      };
    } catch (e: any) {
      return errorResult(e?.message || 'Téléchargement impossible.');
    }
  }

  if (name === 'delete_document') {
    if (args.confirm !== true) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          needs_confirmation: true,
          target: { id: doc.id, file_name: doc.name },
          instruction: "Ne supprime PAS maintenant : présente ce fichier à l'utilisateur et demande sa confirmation explicite. Ne rappelle delete_document avec confirm: true qu'après son accord.",
        }) }],
      };
    }
    return callApi(baseUrl, auth, 'DELETE', `/api/documents/${encodeURIComponent(documentId)}`);
  }

  return errorResult(`Outil inconnu : ${name}`);
}

const RICH_TOOLS: FunctionDeclarationLike[] = [
  {
    name: 'list_projects',
    description: "Liste les affaires (projets) du cabinet : id, nom, code, adresse, statut. Utilise-le pour retrouver l'id d'une affaire nommée avant d'appeler get_project.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_project',
    description: "Détail complet d'une affaire : contrat MOE, jalons, cotraitants, réserves. Nécessite l'id renvoyé par list_projects.",
    parametersJsonSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'] },
  },
  {
    name: 'list_tasks',
    description: "Tâches du cabinet, éventuellement filtrées par affaire. Utile pour un point d'avancement ou une liste de choses à faire.",
    parametersJsonSchema: { type: 'object', properties: { project_id: { type: 'string', description: "Optionnel — id d'affaire pour filtrer" } } },
  },
  {
    name: 'create_task',
    description: "Crée une tâche, éventuellement rattachée à une affaire. N'invente jamais de champ hors de ceux fournis ici.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        project_id: { type: 'string', description: 'Optionnel' },
        due_date: { type: 'string', description: 'Optionnel, format AAAA-MM-JJ' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_invoices',
    description: "Factures du cabinet et leur statut (brouillon, envoyée, payée, en retard). N'inclut pas le détail des lignes.",
    parametersJsonSchema: { type: 'object', properties: { project_id: { type: 'string', description: 'Optionnel — id d\'affaire pour filtrer' } } },
  },
];
const RICH_TOOL_NAMES = RICH_TOOLS.map(t => t.name);

async function executeRichTool(baseUrl: string, auth: InternalAuth, name: string, args: Record<string, any>) {
  switch (name) {
    case 'list_projects':
      return callApi(baseUrl, auth, 'GET', '/api/projects');
    case 'get_project':
      if (!args.project_id) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'project_id est requis.' }) }], isError: true };
      return callApi(baseUrl, auth, 'GET', `/api/projects/${encodeURIComponent(args.project_id)}/full`);
    case 'list_tasks':
      return callApi(baseUrl, auth, 'GET', `/api/tasks${args.project_id ? `?project_id=${encodeURIComponent(args.project_id)}` : ''}`);
    case 'create_task':
      if (!args.title) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'title est requis.' }) }], isError: true };
      return callApi(baseUrl, auth, 'POST', '/api/tasks', {
        title: args.title,
        project_id: args.project_id || null,
        due_date: args.due_date || null,
        start_date: args.due_date || new Date().toISOString().slice(0, 10),
        end_date: args.due_date || new Date().toISOString().slice(0, 10),
      });
    case 'list_invoices':
      return callApi(baseUrl, auth, 'GET', `/api/invoices${args.project_id ? `?project_id=${encodeURIComponent(args.project_id)}` : ''}`);
    default:
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Outil inconnu : ${name}` }) }], isError: true };
  }
}

// Toutes les ressources du cabinet (contacts, devis, appels d'offres,
// réunions, jalons, réserves, contrats MOE, bibliothèque d'ouvrages...),
// jamais la suppression d'un ENREGISTREMENT (delete_record), jamais l'envoi
// réel de mail (create_draft suffit), jamais fetch_url/consulter un
// collègue/publier au flux d'activité, jamais l'écriture du CCTP/DPGF
// (write_dpgf_article) — même prudence que pour la suppression : un outil
// MCP externe reste en lecture/écriture de fiches simples, jamais sur un
// document arborescent aux totaux dérivés.
//
// delete_document (ci-dessus) fait exception à dessein : retirer UNE pièce
// jointe n'a pas les mêmes conséquences que supprimer la fiche elle-même,
// et le geste reste soumis à la même confirmation en deux temps que le
// reste — jamais un delete_record déguisé.
const MCP_CAPS: AgentCapabilities = {
  actionScopes: AGENT_RESOURCES.map(r => r.key),
  webFetch: false,
  mailRead: true,
  mailSend: false,
  geo: true,
  docsRead: true,
  docsWrite: false,
  delegate: false,
  notifyUsers: false,
  webSearch: false,
  knowledge: false,
};

function genericTools(): FunctionDeclarationLike[] {
  const schema = describeAuthorizedResources(MCP_CAPS.actionScopes);
  return buildAgentTools(MCP_CAPS)
    .filter(t => t.name !== 'delete_record') // jamais depuis une liaison externe, quel que soit le connecteur
    .map(t => (
      ['create_record', 'update_record', 'search_records'].includes(t.name)
        ? { ...t, description: `${t.description}\n\nSCHÉMA DES RESSOURCES :\n${schema}` }
        : t
    ));
}

export const MCP_TOOLS: FunctionDeclarationLike[] = [...RICH_TOOLS, ...DOCUMENT_TOOLS, ...genericTools()];
export const MCP_TOOL_NAMES = MCP_TOOLS.map(t => t.name);

export async function executeMcpTool(baseUrl: string, auth: InternalAuth, name: string, args: Record<string, any>) {
  if (name === 'delete_record') {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Action non autorisée depuis cette liaison.' }) }], isError: true };
  }
  if (RICH_TOOL_NAMES.includes(name)) return executeRichTool(baseUrl, auth, name, args);
  if (DOCUMENT_TOOL_NAMES.includes(name)) return executeDocumentTool(baseUrl, auth, name, args);

  const result = await executeAgentAction(baseUrl, auth, MCP_CAPS, { name, args });
  const isError = typeof (result.response as any)?.error === 'string';
  return { content: [{ type: 'text' as const, text: JSON.stringify(result.response) }], isError };
}
