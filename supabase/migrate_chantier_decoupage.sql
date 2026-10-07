-- Chantier en plusieurs bâtiments et plusieurs phases.
--
-- `projects.chantier_decoupage` : le registre (bâtiments, phases) de l'opération,
-- même forme que `DecoupageDocument` du CCTP/DPGF (multiBatiments, multiPhases,
-- batiments[], phases[]). Écrit par sa propre route (PUT /api/projects/:id/
-- chantier-decoupage), jamais par l'enregistrement automatique de la fiche.
--
-- `site_reports` et `observations` portent le bâtiment et la phase auxquels ils se
-- rapportent. Ce sont des identifiants du registre, sans clé étrangère : le registre
-- est du jsonb, et retirer un bâtiment ne doit pas supprimer ses observations.
-- NULL = toute l'opération. Rejouable.
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS chantier_decoupage JSONB;
ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS batiment_id TEXT;
ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS phase_id TEXT;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS batiment_id TEXT;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS phase_id TEXT;
