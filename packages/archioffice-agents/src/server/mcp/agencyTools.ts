// Choix de l'agence (cabinet) sur laquelle travaille UNE connexion MCP.
//
// Un architecte peut exercer dans plusieurs structures (AAZS, AACZ...). La
// sélection est stockée côté serveur, sur la ligne `mcp_connections` de la
// connexion authentifiée (store.ts, persistActiveAgency) : jamais en mémoire
// de processus, jamais partagée avec une autre connexion, jamais déduite du
// cabinet affiché dans le navigateur. L'identifiant d'agence fourni par le
// client n'est qu'une DEMANDE : l'appartenance est revérifiée contre
// `tenant_memberships` (annuaire injecté par server.ts) à chaque appel.
//
// Ces trois outils sont les seuls à fonctionner quand aucune agence n'est
// utilisable (accès révoqué, aucune sélection) : ce sont eux qui permettent d'en
// sortir.
import type { FunctionDeclarationLike } from '../toolTypes.js';
import {
  getMcpAgencyDirectory, persistActiveAgency, type McpAgency, type McpResolvedToken,
} from './store.js';

export type McpToolResult = {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

export const AGENCY_TOOL_NAMES = ['list_agencies', 'get_active_agency', 'switch_agency'];

/** Codes d'erreur stables, que l'assistant doit distinguer. */
export const AGENCY_ERROR = {
  /** Aucune agence ne correspond parmi celles auxquelles la personne a accès. */
  unknown: 'AGENCY_UNKNOWN',
  /** L'agence existe mais la personne n'y a pas (ou plus) accès. */
  denied: 'AGENCY_ACCESS_DENIED',
  /** Aucune agence n'est sélectionnée pour cette connexion. */
  notSelected: 'AGENCY_NOT_SELECTED',
  /** Le changement n'a pas pu être confirmé. */
  notConfirmed: 'AGENCY_SWITCH_NOT_CONFIRMED',
  /** `agency_id` fourni ne correspond pas à l'agence active. */
  mismatch: 'AGENCY_MISMATCH',
  /** Une confirmation après changement d'agence doit nommer son agence. */
  confirmationNeedsAgency: 'AGENCY_CONFIRMATION_REQUIRED',
} as const;

export const AGENCY_TOOLS: FunctionDeclarationLike[] = [
  {
    name: 'list_agencies',
    description:
      "Liste UNIQUEMENT les agences (cabinets) auxquelles l'utilisateur authentifié appartient réellement : id, nom, code court, son rôle dans chacune, et laquelle est active pour cette connexion. " +
      "À appeler avant tout changement d'agence, ou quand l'utilisateur demande « sur quelles agences je travaille ». Lecture seule.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_active_agency',
    description:
      "Rend l'agence actuellement utilisée par CETTE connexion MCP (id, nom, rôle), et si elle vient du consentement initial ou d'un switch_agency. " +
      "Vérifie-la avant une action qui écrit, ou si l'utilisateur doute de l'agence. Distingue « aucune agence sélectionnée » (AGENCY_NOT_SELECTED) et « accès à l'agence perdu » (AGENCY_ACCESS_DENIED). Lecture seule.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_agency',
    description:
      "Change l'agence sur laquelle travaille cette connexion MCP, sans reconnecter le compte. Ne déplace aucune donnée et n'accorde aucun droit : seules les agences listées par list_agencies sont possibles. " +
      "Donne agency_id (identifiant exact, prioritaire) OU query (nom, code court ou sigle, ex. « AACZ »). Si plusieurs agences correspondent à query, l'outil rend needs_clarification avec les candidats : demande alors laquelle à l'utilisateur, ne choisis pas. " +
      "N'annonce le changement à l'utilisateur QU'APRÈS une réponse switched: true. Après un changement, n'utilise plus aucun identifiant (affaire, contact, facture, document, curseur) obtenu dans l'agence précédente : ils ne sont valables que dans leur agence. " +
      "Erreurs : AGENCY_UNKNOWN (aucune agence accessible ne correspond), AGENCY_ACCESS_DENIED (l'agence existe mais l'utilisateur n'y a pas accès).",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        agency_id: { type: 'string', description: "Identifiant de l'agence, tel que renvoyé par list_agencies" },
        query: { type: 'string', description: "Nom, code court ou sigle de l'agence (ex. « AACZ »), cherché parmi les agences autorisées seulement" },
      },
    },
  },
];

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Sigle d'un nom : « Atelier d'Architecture Zomeno Sektaoui » → « aazs » (mots d'une lettre ignorés). */
function acronym(name: string): string {
  return normalize(name).split(' ').filter(w => w.length > 1).map(w => w[0]).join('');
}

export function agencyIdentity(agency: McpAgency | null) {
  return agency ? { id: agency.id, name: agency.name, slug: agency.slug } : null;
}

function result(payload: Record<string, unknown>, agency: McpAgency | null, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
    _meta: { agency: agencyIdentity(agency) },
  };
}

export function agencyError(code: string, message: string, agency: McpAgency | null, extra: Record<string, unknown> = {}): McpToolResult {
  return result({ error: message, code, ...extra }, agency, true);
}

/** Message et code de l'état d'une connexion dont l'agence n'est pas utilisable. */
export function unusableAgencyError(resolved: McpResolvedToken): McpToolResult {
  if (resolved.agencyState === 'access_lost') {
    return agencyError(
      AGENCY_ERROR.denied,
      "Accès refusé : vous n'appartenez plus à l'agence sélectionnée pour cette connexion. Appelle list_agencies puis switch_agency pour en choisir une autre.",
      null, { selected_agency_id: resolved.selectedTenantId },
    );
  }
  return agencyError(
    AGENCY_ERROR.notSelected,
    "Aucune agence n'est sélectionnée pour cette connexion. Appelle list_agencies puis switch_agency.",
    null,
  );
}

function describe(agency: McpAgency, activeId: string | null) {
  return { id: agency.id, name: agency.name, slug: agency.slug, role: agency.role, role_label: agency.roleLabel, active: agency.id === activeId };
}

export async function executeAgencyTool(
  supabaseAdmin: any, resolved: McpResolvedToken, name: string, args: Record<string, any>,
): Promise<McpToolResult> {
  const directory = getMcpAgencyDirectory();
  if (!directory) return agencyError(AGENCY_ERROR.denied, "Le choix d'agence n'est pas disponible sur cette instance.", null);
  const activeId = resolved.agencyState === 'selected' ? resolved.tenantId : null;

  if (name === 'list_agencies') {
    const agencies = await directory.list(resolved.userId);
    return result({
      agencies: agencies.map(a => describe(a, activeId)),
      count: agencies.length,
      active_agency_id: activeId,
      agency_state: resolved.agencyState,
    }, resolved.agency);
  }

  if (name === 'get_active_agency') {
    if (resolved.agencyState !== 'selected') return unusableAgencyError(resolved);
    return result({
      active_agency: { ...describe(resolved.agency!, activeId) },
      selection_source: resolved.selectionSource,
      note: resolved.selectionSource === 'consent'
        ? "Agence choisie à la connexion du connecteur ; elle ne suit pas l'agence affichée dans le navigateur."
        : 'Agence choisie depuis ce connecteur avec switch_agency.',
    }, resolved.agency);
  }

  if (name === 'switch_agency') return switchAgency(supabaseAdmin, resolved, args);
  return agencyError(AGENCY_ERROR.unknown, `Outil inconnu : ${name}`, resolved.agency);
}

async function switchAgency(supabaseAdmin: any, resolved: McpResolvedToken, args: Record<string, any>): Promise<McpToolResult> {
  const directory = getMcpAgencyDirectory()!;
  const activeId = resolved.agencyState === 'selected' ? resolved.tenantId : null;
  const requestedId = String(args.agency_id || '').trim();
  const query = String(args.query || '').trim();
  if (!requestedId && !query) {
    return agencyError(AGENCY_ERROR.unknown, 'Fournis agency_id (voir list_agencies) ou query (nom ou sigle de l\'agence).', resolved.agency);
  }

  const agencies = await directory.list(resolved.userId);
  let target: McpAgency | undefined;

  if (requestedId) {
    target = agencies.find(a => a.id === requestedId);
    if (!target) {
      // Un identifiant n'est jamais une autorisation : l'agence peut exister
      // sans que la personne en soit membre, ce que l'on dit sans rien révéler de plus.
      const exists = await directory.exists(requestedId).catch(() => false);
      return exists
        ? agencyError(AGENCY_ERROR.denied, "Accès refusé : vous n'appartenez pas à cette agence.", resolved.agency)
        : agencyError(AGENCY_ERROR.unknown, "Agence inconnue : aucun identifiant ne correspond. Appelle list_agencies.", resolved.agency);
    }
  } else {
    const q = normalize(query);
    const exact = agencies.filter(a => [a.name, a.slug, a.id].some(v => v && normalize(v) === q) || (a.name && acronym(a.name) === q));
    const partial = q.length >= 2
      ? agencies.filter(a => [a.name, a.slug].some(v => v && normalize(v).includes(q)))
      : [];
    const matches = exact.length ? exact : partial;
    if (matches.length === 0) {
      return agencyError(
        AGENCY_ERROR.unknown,
        `Agence inconnue : aucune de vos agences ne correspond à « ${query} ». Appelle list_agencies pour voir celles auxquelles vous avez accès.`,
        resolved.agency,
      );
    }
    if (matches.length > 1) {
      return result({
        needs_clarification: true,
        message: `Plusieurs agences correspondent à « ${query} » : demande à l'utilisateur laquelle choisir, puis rappelle switch_agency avec agency_id.`,
        candidates: matches.map(a => describe(a, activeId)),
      }, resolved.agency);
    }
    target = matches[0];
  }

  if (activeId === target.id) {
    return result({ switched: true, changed: false, agency: agencyIdentity(target), role: target.role, selection_source: resolved.selectionSource, message: 'Cette agence est déjà active.' }, target);
  }

  const persisted = await persistActiveAgency(supabaseAdmin, { connectionId: resolved.connectionId, userId: resolved.userId, tenantId: target.id });
  if (persisted.unavailable) {
    return agencyError(AGENCY_ERROR.notConfirmed, "Le changement d'agence n'est pas disponible sur cette instance (migration migrate_mcp_active_agency.sql non appliquée). Rien n'a changé.", resolved.agency);
  }
  // Le changement n'est annoncé que s'il est réellement enregistré ET que
  // l'appartenance tient toujours au moment de la confirmation.
  const stillMember = persisted.confirmed ? await directory.find(resolved.userId, target.id) : null;
  if (!persisted.confirmed || !stillMember) {
    return agencyError(AGENCY_ERROR.notConfirmed, "Le changement d'agence n'a pas pu être confirmé (sélection modifiée en parallèle ou accès révoqué). Vérifie avec get_active_agency avant de continuer.", resolved.agency);
  }
  return result({
    switched: true,
    changed: true,
    agency: agencyIdentity(stillMember),
    role: stillMember.role,
    previous_agency: agencyIdentity(resolved.agency),
    selection_source: 'switch',
    message: "Agence changée. N'utilise plus les identifiants obtenus dans l'agence précédente.",
  }, stillMember);
}
