// Suivi des sollicitations de bureaux d'études sur un appel d'offres —
// onglet Partenaires (src/pages/TenderDetail.tsx). Pour une même spécialité
// (ex. "BET Structure"), le cabinet consulte souvent plusieurs entreprises
// pour n'en retenir qu'une : une ligne par (appel d'offres, contact
// sollicité), indépendante de tender_specialties qui ne porte, elle, que le
// membre finalement retenu. L'envoi de mail lui-même reste sur
// POST /api/send-email (déjà utilisé par factures/devis/notes
// d'honoraires) — cette route ne fait que consigner qu'un envoi a eu lieu,
// jamais l'envoi lui-même, pour ne pas dupliquer la résolution du compte
// mail (personnel puis SMTP du cabinet) que /api/send-email fait déjà.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const STATUSES = ['a_solliciter', 'sollicite', 'relance', 'accepte', 'decline'];

export function registerTenderPartnerSolicitationRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/tender-partner-solicitations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id } = req.query;
      if (!tender_id) return res.status(400).json({ error: "tender_id requis" });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_partner_solicitations').select('*').eq('tender_id', tender_id as string).order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tender partner solicitations" }); }
  });

  app.post("/api/tender-partner-solicitations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id, specialty_name, contact_id } = req.body;
      if (!tender_id || !(await assertTenantEntity(supabaseAdmin, 'tenders', tender_id, tenantId))) {
        return res.status(400).json({ error: "Appel d'offres introuvable pour ce cabinet." });
      }
      if (!specialty_name?.trim()) return res.status(400).json({ error: "La spécialité est requise." });
      if (!contact_id || !(await assertTenantEntity(supabaseAdmin, 'contacts', contact_id, tenantId))) {
        return res.status(400).json({ error: "Contact introuvable pour ce cabinet." });
      }
      const id = crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_partner_solicitations').insert({
        id, tender_id, specialty_name: specialty_name.trim(), contact_id, status: 'a_solliciter',
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create tender partner solicitation: " + e.message }); }
  });

  // Statut manuel (accepté / décliné / remis à "à solliciter") et note de
  // réponse libre — jamais sent_at/relance_count, réservés aux deux routes
  // ci-dessous pour rester la trace fidèle d'un envoi réellement effectué.
  app.put("/api/tender-partner-solicitations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { status, response_notes } = req.body;
      if (status && !STATUSES.includes(status)) return res.status(400).json({ error: "Statut invalide." });
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_partner_solicitations').update({
        ...(status ? { status } : {}),
        ...(response_notes !== undefined ? { response_notes: response_notes || null } : {}),
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update tender partner solicitation: " + e.message }); }
  });

  // Appelée par le frontend juste après un POST /api/send-email réussi (la
  // sollicitation initiale) — jamais avant, pour que le statut reflète un
  // mail réellement parti plutôt qu'une intention.
  app.post("/api/tender-partner-solicitations/:id/mark-sent", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_partner_solicitations').update({
        status: 'sollicite', sent_at: new Date().toISOString(),
      }).eq('id', id).select().single();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Sollicitation introuvable." });
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to mark solicitation as sent: " + e.message }); }
  });

  // Idem pour une relance : incrémente relance_count côté serveur plutôt que
  // de faire confiance à une valeur envoyée par le client.
  app.post("/api/tender-partner-solicitations/:id/mark-relance", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: current } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_partner_solicitations').select('relance_count').eq('id', id).maybeSingle();
      if (!current) return res.status(404).json({ error: "Sollicitation introuvable." });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_partner_solicitations').update({
        status: 'relance', last_relance_at: new Date().toISOString(), relance_count: ((current as any).relance_count || 0) + 1,
      }).eq('id', id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to mark solicitation as relaunched: " + e.message }); }
  });

  app.delete("/api/tender-partner-solicitations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_partner_solicitations').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete tender partner solicitation: " + e.message }); }
  });
}
