-- Migration : planning de chantier (Gantt par lot, onglet DET)
--
-- Une ligne par affaire. Le contenu est du jsonb (PlanningChantier,
-- src/lib/planningChantier.ts) : tâches rattachées à un lot (project_lots.id,
-- sans clé étrangère : retirer un lot ne doit pas détruire un planning), dates
-- AAAA-MM-JJ, avancement, origine (ia | manuel) et hypothèses de la dernière
-- génération. Écrit par ses propres routes (server/routes/planningChantier.ts),
-- jamais par l'enregistrement automatique de la fiche.
--
-- Hors SYNC_TABLES, comme project_phase_notes. Rejouable.

CREATE TABLE IF NOT EXISTS project_chantier_planning (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{"version":1,"taches":[],"hypotheses":[],"genereLe":null}'::jsonb,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_chantier_planning_tenant
  ON project_chantier_planning(tenant_id);

ALTER TABLE project_chantier_planning ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON project_chantier_planning;
CREATE POLICY "tenant_isolation" ON project_chantier_planning
  USING (tenant_id = my_tenant_id());
