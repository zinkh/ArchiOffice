// Les cabinets d'une personne, et la bascule de l'un à l'autre.
//
// Un architecte exerce parfois dans deux structures (la sienne et une SCPA,
// un groupement, une agence associée). Ces routes servent le sélecteur de
// cabinet de l'en-tête : lister ses cabinets, désigner celui sur lequel on
// travaille, et quitter celui qu'on ne fréquente plus.
//
// La bascule elle-même n'a rien de transactionnel : c'est l'en-tête
// X-Tenant-Id envoyé à chaque requête qui décide du cabinet (voir
// server/tenantContext.ts). Cette route ne fait qu'enregistrer le choix comme
// cabinet PAR DÉFAUT, pour que rouvrir l'application sur un autre poste
// reprenne là où on s'est arrêté.
import type { Express } from 'express';
import {
  listMembershipsWithTenants,
  findMembership,
  setDefaultTenant,
  removeMembership,
  listTenantMemberIds,
  getMemberRole,
  notMemberError,
} from '../tenantMemberships';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerTenantMembershipRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/tenants/mine', async (req: any, res: any) => {
    try {
      const memberships = await listMembershipsWithTenants(supabaseAdmin, req.user.id);
      // Le cabinet actif est celui de l'en-tête s'il y en a un, sinon le
      // défaut — exactement ce que getTenantId() retiendra pour les autres
      // routes, pour que le sélecteur affiche le cabinet réellement servi.
      const activeTenantId = memberships.length
        ? (req.activeTenantId || memberships[0].tenantId)
        : null;
      res.json({
        activeTenantId,
        tenants: memberships.map(m => ({
          tenantId: m.tenantId,
          name: m.tenantName,
          role: m.role,
          systemRole: m.systemRole,
          isDefault: m.isDefault,
          isActive: m.tenantId === activeTenantId,
        })),
      });
    } catch (e: any) {
      console.error('[GET /api/tenants/mine]', e);
      res.status(e.status || 500).json({ error: e.message, code: e.code });
    }
  });

  app.post('/api/tenants/switch', async (req: any, res: any) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'Cabinet requis' });
      // setDefaultTenant refuse un cabinet dont on n'est pas membre : la
      // vérification d'appartenance ne dépend pas du client.
      await setDefaultTenant(supabaseAdmin, req.user.id, tenantId);
      const { data: tenant } = await supabaseAdmin.from('tenants').select('id, name').eq('id', tenantId).maybeSingle();
      const membership = await getMemberRole(supabaseAdmin, tenantId, req.user.id);
      res.json({
        success: true,
        tenantId,
        name: (tenant as any)?.name ?? null,
        role: membership?.role ?? null,
        systemRole: membership?.systemRole ?? null,
      });
    } catch (e: any) {
      console.error('[POST /api/tenants/switch]', e);
      res.status(e.status || 500).json({ error: e.message, code: e.code });
    }
  });

  app.delete('/api/tenants/:tenantId/membership', async (req: any, res: any) => {
    try {
      const { tenantId } = req.params;
      const membership = await findMembership(supabaseAdmin, req.user.id, tenantId);
      if (!membership) throw notMemberError();

      const mine = await listMembershipsWithTenants(supabaseAdmin, req.user.id);
      if (mine.length <= 1) {
        return res.status(409).json({
          error: "C'est votre seul cabinet. Utilisez la fermeture de cabinet dans Réglages > Zone dangereuse pour en supprimer les données.",
        });
      }

      // Un cabinet sans administrateur n'a plus personne pour inviter,
      // facturer ou fermer : on ne laisse pas le dernier partir.
      if (membership.systemRole === 'admin') {
        const memberIds = await listTenantMemberIds(supabaseAdmin, tenantId);
        let otherAdmins = 0;
        for (const id of memberIds) {
          if (id === req.user.id) continue;
          const other = await getMemberRole(supabaseAdmin, tenantId, id);
          if (other?.systemRole === 'admin') otherAdmins++;
        }
        if (otherAdmins === 0) {
          return res.status(409).json({ error: "Vous êtes le seul administrateur de ce cabinet. Nommez un autre administrateur avant de le quitter." });
        }
      }

      await removeMembership(supabaseAdmin, req.user.id, tenantId);
      const remaining = await listMembershipsWithTenants(supabaseAdmin, req.user.id);
      res.json({ success: true, activeTenantId: remaining[0]?.tenantId ?? null });
    } catch (e: any) {
      console.error('[DELETE /api/tenants/:tenantId/membership]', e);
      res.status(e.status || 500).json({ error: e.message, code: e.code });
    }
  });

  // Le cabinet servi à cette requête, sans lister les autres — utile aux
  // écrans qui n'ont besoin que de son nom.
  app.get('/api/tenants/active', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: tenant } = await supabaseAdmin.from('tenants').select('id, name, plan').eq('id', tenantId).maybeSingle();
      const membership = await getMemberRole(supabaseAdmin, tenantId, req.user.id);
      res.json({
        tenantId,
        name: (tenant as any)?.name ?? null,
        plan: (tenant as any)?.plan ?? null,
        role: membership?.role ?? null,
        systemRole: membership?.systemRole ?? null,
      });
    } catch (e: any) {
      console.error('[GET /api/tenants/active]', e);
      res.status(e.status || 500).json({ error: e.message, code: e.code });
    }
  });
}
