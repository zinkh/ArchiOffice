-- Temps par phase, temps facturable et coût horaire par membre : la base de la
-- rentabilité par phase (honoraires de la phase face au coût du temps passé).
-- Additif et rejouable : aucune ligne existante ne change de sens.

-- Phase de mission sur laquelle le temps est imputé (ESQ, APS, APD, PC, PRO,
-- DCE, ACT, VISA, DET, AOR). NULL = temps non imputé à une phase.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS phase TEXT;

-- Temps facturable ou non (réunion interne, prospection...). Vrai par défaut :
-- tout le temps déjà saisi reste facturable.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS billable BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_time_entries_tenant_project_phase
  ON time_entries(tenant_id, project_id, phase);

-- Coût horaire chargé du membre DANS ce cabinet, en centimes d'euro. Sur
-- l'adhésion et non sur le profil : la même personne n'a pas le même coût d'un
-- cabinet à l'autre, et l'autre cabinet ne doit pas le lire. NULL = non
-- renseigné (le coût du temps de cette personne compte alors pour 0).
ALTER TABLE tenant_memberships ADD COLUMN IF NOT EXISTS hourly_cost_cents INTEGER
  CHECK (hourly_cost_cents IS NULL OR hourly_cost_cents >= 0);
