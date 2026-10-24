// Proactive "next steps" suggestions for the global copilot badge
// (packages/archioffice-agents/src/client/AgentChat.tsx). Rule-based only —
// no Gemini call, no AI credit consumed. Reuses the same rule engine as the
// Dashboard's "Suggestions IA" widget (src/lib/copilotSuggestions.ts) so the
// two surfaces never drift out of sync. Computed on every request — no
// background job, matching how the Dashboard already recomputes on load.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { archivedProjectIds, sansAffairesArchivees } from '../archivedProjects';
import { computeCopilotSuggestions } from '../../src/lib/copilotSuggestions';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerCopilotSuggestionRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/copilot/suggestions', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);

      const [projectsRes, milestonesRes, invoicesRes, tasksRes, proposalsRes, tendersRes] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('id, name, client, status, start_date, end_date, progression, address, project_code, project_manager, surface, construction_cost'),
        tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').select('id, project_id, title, due_date, completed'),
        supabaseAdmin.from('invoices').select('id, invoice_number, status, total_amount, amount, due_date, issue_date, created_at, project_id, projects(name)').eq('tenant_id', tenantId),
        tenantScopedFrom(supabaseAdmin, tenantId, 'tasks').select('id, project_id, title, status, progress, due_date, end_date, assignee_id'),
        tenantScopedFrom(supabaseAdmin, tenantId, 'proposals').select('id, title, reference, nom_societe, status, created_at'),
        tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('id, title, client, status, submission_deadline, archived'),
      ]);
      if (projectsRes.error) throw projectsRes.error;
      if (milestonesRes.error) throw milestonesRes.error;
      if (invoicesRes.error) throw invoicesRes.error;
      // Tâches, devis et appels d'offres enrichissent seulement les suggestions : un échec n'empêche pas les autres.

      const invoices = (invoicesRes.data || []).map((inv: any) => {
        const { projects: p, ...rest } = inv;
        return { ...rest, project_name: p?.name || null };
      });

      // Lectures facultatives : une table absente (instance non migrée) ou en
      // erreur rend `undefined`, et la règle correspondante se tait.
      const optional = async (table: string, columns: string) => {
        const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, table).select(columns);
        if (error) return undefined;
        return data || [];
      };
      // `rge_required` n'existe qu'après la migration : repli sur les colonnes d'origine.
      const readLots = async () =>
        (await optional('project_lots', 'id, project_id, contact_id, lot_number, lot_title, rge_required'))
        ?? optional('project_lots', 'id, project_id, contact_id, lot_number, lot_title');
      const markets = await optional('marches_entreprises', 'id, project_id, entreprise_nom, contact_id, act_entreprise_id, lot_numero, type_marche, statut, statut_signature, date_notification');
      const [meetings, reserves, contracts, feeNotes, permits, lots] = await Promise.all([
        optional('meetings', 'id, title, date, notes'),
        optional('reserves', 'id, project_id, status, due_date'),
        optional('contrats_moe', 'id, project_id, status, numero, intitule_projet, date_debut, created_at'),
        optional('notes_honoraires', 'project_id, contrat_id'),
        optional('permits', 'id, project_id, type, reference, submission_date, status'),
        readLots(),
      ]);

      // Entreprises titulaires d'un lot ou d'un marché : leurs fiches et qualifications seulement.
      const lotContactIds = [...new Set([...(lots || []), ...(markets || [])].map((l: any) => l.contact_id).filter(Boolean))] as string[];
      const byIds = async (table: string, columns: string) => {
        if (lotContactIds.length === 0) return [];
        const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, table).select(columns).in(table === 'contacts' ? 'id' : 'contact_id', lotContactIds);
        return error ? undefined : data || [];
      };
      const [orders, situations, observations] = await Promise.all([
        optional('ordres_de_service', 'id, project_id, status, date'),
        optional('situations', 'id, project_id, etat, date_situation'),
        optional('observations', 'id, project_id, statut, due_date'),
      ]);
      const contacts = lots ? await byIds('contacts', 'id, first_name, last_name, company_name, email, email_work, phone, phone_mobile, phone_work, siret') : undefined;
      const qualifications = lots ? await byIds('contact_qualifications', 'id, contact_id, organisme, reference, libelle, domaines, date_fin, source, verified_at') : undefined;

      // Assurances : marchés notifiés, pièces reçues de l'ACT et documents d'assurance de ces affaires.
      const consultations = markets ? await optional('act_data', 'project_id, consultation') : undefined;
      const marketProjectIds = [...new Set((markets || []).map((m: any) => m.project_id).filter(Boolean))] as string[];
      let documents: any[] | undefined = [];
      if (markets && marketProjectIds.length > 0) {
        const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents')
          .select('project_id, contact_id, name, description, doc_type')
          .in('project_id', marketProjectIds)
          .or('name.ilike.%assurance%,name.ilike.%décennale%,name.ilike.%decennale%,description.ilike.%assurance%,description.ilike.%décennale%,doc_type.ilike.%assurance%');
        documents = error ? undefined : data || [];
      }

      // Noms des personnes surchargées : seulement celles qui dépassent le seuil.
      const openByAssignee = new Map<string, number>();
      (tasksRes.data || []).forEach((t: any) => {
        if (t.assignee_id && t.status !== 'done' && (t.progress ?? 0) < 100) openByAssignee.set(t.assignee_id, (openByAssignee.get(t.assignee_id) || 0) + 1);
      });
      const busyIds = [...openByAssignee].filter(([, n]) => n > 15).map(([id]) => id);
      let people: { id: string; name: string }[] = [];
      if (busyIds.length) {
        const { data } = await supabaseAdmin.from('profiles').select('id, name').in('id', busyIds);
        people = data || [];
      }

      // Une affaire archivée est rangée : aucune suggestion sur elle.
      const archivees = await archivedProjectIds(supabaseAdmin, tenantId);
      const sans = <T extends Record<string, any>>(rows: T[] | undefined) => sansAffairesArchivees(rows, archivees);

      const suggestions = computeCopilotSuggestions({
        contacts, qualifications, people,
        orders: sans(orders), situations: sans(situations), observations: sans(observations),
        markets: sans(markets), consultations: sans(consultations), documents: sans(documents),
        meetings, reserves: sans(reserves), contracts: sans(contracts), feeNotes: sans(feeNotes),
        permits: sans(permits), lots: sans(lots),
        projects: sansAffairesArchivees(projectsRes.data || [], archivees, 'id') || [],
        milestones: sans(milestonesRes.data || []) || [],
        invoices: sans(invoices) || [],
        tasks: tasksRes.error ? [] : sans(tasksRes.data || []) || [],
        proposals: proposalsRes.error ? [] : proposalsRes.data || [],
        tenders: tendersRes.error ? [] : tendersRes.data || [],
      });
      res.json(suggestions);
    } catch (e: any) {
      console.error('Failed to compute copilot suggestions:', e);
      res.status(500).json({ error: 'Failed to compute copilot suggestions' });
    }
  });
}
