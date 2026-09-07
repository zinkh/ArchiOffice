-- ── Offres reçues sur un DPGF ─────────────────────────────────────────────────
-- Le DPGF gagne la même capacité que le BPU : recevoir les bordereaux chiffrés
-- renvoyés par les entreprises, et les verser au comparatif ACT. Même
-- raisonnement qu'à l'ouverture de bpu_data (migrate_add_bpu.sql) : les offres
-- vivent dans une colonne SÉPARÉE de `data`, parce que l'éditeur DPGF
-- réécrit ce champ en bloc à l'autosauvegarde — une offre logée dedans serait
-- effacée par la sauvegarde suivant son import.
ALTER TABLE dpgfs ADD COLUMN IF NOT EXISTS offres JSONB NOT NULL DEFAULT '[]'::jsonb;

-- `dpgfs` n'a jamais eu l'unicité que ses propres routes supposent déjà
-- (server/routes/dpgf.ts lit avec .single() sur (tenant_id, project_id)) —
-- exactement le défaut que migrate_add_bpu.sql avait relevé sans le corriger
-- ici. On le corrige à l'occasion de cette migration : les données existantes
-- ont été vérifiées sans doublon avant d'appliquer l'index.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dpgfs_tenant_project ON dpgfs(tenant_id, project_id);
