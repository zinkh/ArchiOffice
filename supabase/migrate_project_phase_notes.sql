-- Migration : journal de l'opération (notes datées, rattachées à une phase MOP)
--
-- La fiche affaire n'avait que deux champs d'observations (études, chantier),
-- partagés par toutes les phases : une note sur un changement de programme en
-- APS était écrasée par celle de l'APD. Chaque entrée porte désormais sa
-- phase, son type, sa date, son auteur, et pour un dépassement de budget
-- l'estimation des travaux avant et après. Voir server/routes/projectPhaseNotes.ts
-- et src/components/projectDetail/PhaseJournal.tsx.
--
-- Hors SYNC_TABLES, comme project_phase_history.

CREATE TABLE IF NOT EXISTS project_phase_notes (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  phase TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'observation'
    CHECK (kind IN ('programme', 'budget', 'decision_moa', 'attention', 'observation')),
  body TEXT NOT NULL,
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  budget_before NUMERIC,
  budget_after NUMERIC,
  author_id UUID,
  author_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_phase_notes_tenant_project
  ON project_phase_notes(tenant_id, project_id, occurred_on DESC);

ALTER TABLE project_phase_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON project_phase_notes;
CREATE POLICY "tenant_isolation" ON project_phase_notes
  USING (tenant_id = my_tenant_id());

-- Reprise des observations existantes : une entrée par champ non vide, sur la
-- dernière phase connue de la famille (études ou chantier), à défaut ESQ ou
-- DET. Identifiant déterministe : rejouer la migration ne duplique rien. Les
-- colonnes projects.etudes_notes / chantier_notes ne sont pas supprimées.
INSERT INTO project_phase_notes (id, tenant_id, project_id, phase, kind, body, occurred_on, author_name)
SELECT
  'legacy-etudes-' || p.id, p.tenant_id, p.id,
  COALESCE((
    SELECT h.phase FROM project_phase_history h
    WHERE h.project_id = p.id AND h.phase IN ('ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE')
    ORDER BY h.entered_at DESC LIMIT 1
  ), 'ESQ'),
  'observation', p.etudes_notes, CURRENT_DATE, 'Reprise de la fiche'
FROM projects p
WHERE p.tenant_id IS NOT NULL AND NULLIF(btrim(p.etudes_notes), '') IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_phase_notes (id, tenant_id, project_id, phase, kind, body, occurred_on, author_name)
SELECT
  'legacy-chantier-' || p.id, p.tenant_id, p.id,
  COALESCE((
    SELECT h.phase FROM project_phase_history h
    WHERE h.project_id = p.id AND h.phase IN ('ACT', 'VISA', 'DET', 'AOR')
    ORDER BY h.entered_at DESC LIMIT 1
  ), 'DET'),
  'observation', p.chantier_notes, CURRENT_DATE, 'Reprise de la fiche'
FROM projects p
WHERE p.tenant_id IS NOT NULL AND NULLIF(btrim(p.chantier_notes), '') IS NOT NULL
ON CONFLICT (id) DO NOTHING;
