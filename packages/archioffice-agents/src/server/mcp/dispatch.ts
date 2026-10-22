// Point de passage unique d'un appel d'outil MCP : c'est ici, et nulle part
// ailleurs, que l'agence d'un appel est fixée.
//
// Chaque appel reçoit un instantané de la résolution (store.ts,
// resolveAccessToken) pris à son début : l'agence et la preuve d'appartenance
// y sont figées pour toute l'exécution. Le cabinet est ensuite transmis aux
// appels internes vers /api par l'en-tête X-Tenant-Id (InternalAuth), que le
// middleware revalide sans le croire sur parole. Un switch_agency survenu
// pendant l'exécution n'a donc aucun effet sur un appel déjà démarré, et ne
// peut pas le rediriger vers une autre agence.
import type { InternalAuth } from '../internalApi.js';
import { executeMcpTool, type McpToolResult } from './tools.js';
import {
  AGENCY_ERROR, AGENCY_TOOL_NAMES, agencyError, agencyIdentity, executeAgencyTool, unusableAgencyError,
} from './agencyTools.js';
import type { McpResolvedToken } from './store.js';

export interface ConnectionCall {
  supabaseAdmin: any;
  baseUrl: string;
  /** L'en-tête Authorization du client MCP, repris sur les appels internes. */
  authorization: string;
  resolved: McpResolvedToken;
  name: string;
  args: Record<string, any>;
}

/**
 * Ajoute l'agence effectivement utilisée à une réponse, sans rien retirer :
 *  - toujours `_meta.agency` ({ id, name, slug }) ;
 *  - un champ `agency` en tête d'un résultat JSON de type objet ;
 *  - pour un résultat qui est une liste (qu'on ne peut pas enrichir sans
 *    changer sa forme) ou du texte libre, un second bloc de contenu.
 * Le premier bloc de contenu garde donc exactement la forme d'avant.
 */
export function withAgencyContext(result: McpToolResult, resolved: McpResolvedToken): McpToolResult {
  if (result._meta && 'agency' in result._meta) return result;
  const identity = agencyIdentity(resolved.agencyState === 'selected' ? resolved.agency : null);
  const out: McpToolResult = { ...result, _meta: { ...(result._meta || {}), agency: identity } };
  const first = result.content?.[0];
  let parsed: unknown;
  try { parsed = first ? JSON.parse(first.text) : undefined; } catch { parsed = undefined; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (!('agency' in (parsed as Record<string, unknown>))) {
      out.content = [{ type: 'text', text: JSON.stringify({ ...(parsed as Record<string, unknown>), agency: identity }) }, ...result.content.slice(1)];
    }
  } else {
    out.content = [...(result.content || []), { type: 'text', text: JSON.stringify({ agency: identity }) }];
  }
  return out;
}

export async function executeMcpToolForConnection(call: ConnectionCall): Promise<McpToolResult> {
  const { resolved, name } = call;
  const args = { ...(call.args || {}) };

  if (AGENCY_TOOL_NAMES.includes(name)) {
    return withAgencyContext(await executeAgencyTool(call.supabaseAdmin, resolved, name, args), resolved);
  }

  if (resolved.agencyState !== 'selected' || !resolved.tenantId) {
    return withAgencyContext(unusableAgencyError(resolved), resolved);
  }

  // Garde-fou facultatif du client : « j'agis pour CETTE agence ».
  const claimed = args.agency_id === undefined || args.agency_id === null ? '' : String(args.agency_id).trim();
  delete args.agency_id;
  if (claimed && claimed !== resolved.tenantId) {
    return withAgencyContext(agencyError(
      AGENCY_ERROR.mismatch,
      "L'agence active a changé depuis que tu as obtenu cet identifiant ou cette demande de confirmation : rien n'a été exécuté. Vérifie avec get_active_agency, puis recommence dans la bonne agence.",
      resolved.agency, { requested_agency_id: claimed, active_agency_id: resolved.tenantId },
    ), resolved);
  }
  // Une confirmation engagée avant un changement d'agence ne doit jamais
  // s'appliquer à l'autre : une fois la connexion passée d'une agence à
  // l'autre, `confirm: true` doit nommer l'agence qu'il confirme.
  if (args.confirm === true && resolved.hasSwitched && !claimed) {
    return withAgencyContext(agencyError(
      AGENCY_ERROR.confirmationNeedsAgency,
      "Cette connexion a changé d'agence : pour confirmer (confirm: true), fournis aussi agency_id (celui de la demande de confirmation). Rien n'a été exécuté.",
      resolved.agency, { active_agency_id: resolved.tenantId },
    ), resolved);
  }

  const auth: InternalAuth = { authorization: call.authorization, tenantId: resolved.tenantId };
  return withAgencyContext(await executeMcpTool(call.baseUrl, auth, name, args), resolved);
}
