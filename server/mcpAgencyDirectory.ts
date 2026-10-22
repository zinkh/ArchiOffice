// Annuaire des agences d'une personne pour le connecteur MCP.
//
// Le paquet des agents n'importe rien de server/ : il reçoit cet annuaire au
// démarrage (setMcpAgencyDirectory, voir server.ts). Il ne fait que présenter
// server/tenantMemberships.ts, seule source de vérité de l'appartenance : un
// ajout ou une révocation d'adhésion se voit donc au prochain appel MCP, sans
// cache intermédiaire.
import type { McpAgency, McpAgencyDirectory } from '@zinkh/archioffice-agents/server';
import { findMembership, listMemberships, type Membership } from './tenantMemberships';

async function tenantRows(supabaseAdmin: any, ids: string[]): Promise<Map<string, { name: string | null; slug: string | null }>> {
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin.from('tenants').select('id, name, slug').in('id', ids);
  return new Map((data || []).map((t: any) => [t.id, { name: t.name ?? null, slug: t.slug ?? null }]));
}

function toAgency(m: Membership, tenant?: { name: string | null; slug: string | null }): McpAgency {
  return { id: m.tenantId, name: tenant?.name ?? null, slug: tenant?.slug ?? null, role: m.systemRole, roleLabel: m.role };
}

export function createMcpAgencyDirectory(supabaseAdmin: any): McpAgencyDirectory {
  return {
    async list(userId) {
      const memberships = await listMemberships(supabaseAdmin, userId);
      const tenants = await tenantRows(supabaseAdmin, memberships.map(m => m.tenantId));
      return memberships.map(m => toAgency(m, tenants.get(m.tenantId)));
    },
    async find(userId, tenantId) {
      const membership = await findMembership(supabaseAdmin, userId, tenantId);
      if (!membership) return null;
      const tenants = await tenantRows(supabaseAdmin, [tenantId]);
      return toAgency(membership, tenants.get(tenantId));
    },
    async exists(tenantId) {
      const { data } = await supabaseAdmin.from('tenants').select('id').eq('id', tenantId).maybeSingle();
      return !!data;
    },
  };
}
