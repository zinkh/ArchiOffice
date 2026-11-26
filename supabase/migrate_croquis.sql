-- Migration : croquis de réunion et de compte-rendu de chantier.
--
-- Un croquis est un dessin rapide (feuille blanche, ou par-dessus un plan ou une
-- photo dont on règle l'opacité) rattaché à UNE réunion OU à UN compte-rendu de
-- chantier. Plusieurs croquis par réunion ou compte-rendu.
--
-- La scène (liste d'éléments sérialisables) vit en jsonb dans `scene`, sous la forme
-- { "version": 1, "elements": [...] } (voir src/lib/croquis/scene.ts). Le fond
-- (plan ou photo, réduit à 2600 px) et l'aperçu PNG sont des fichiers du cabinet
-- (`storeBusinessFile`, dossier « Croquis » de l'affaire) ; seules leurs références
-- sont ici. Voir server/routes/croquis.ts.
--
-- `project_id` est facultatif : une réunion peut porter sur une proposition ou un
-- appel d'offres, sans affaire.

CREATE TABLE IF NOT EXISTS croquis (
  id              TEXT PRIMARY KEY,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id      TEXT REFERENCES meetings(id) ON DELETE CASCADE,
  site_report_id  TEXT REFERENCES site_reports(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT 'Croquis',
  scene           JSONB NOT NULL DEFAULT '{"version":1,"elements":[]}'::jsonb,
  -- Référence du fond (file_url Supabase ou archioffice+external://), NULL = feuille blanche.
  bg_path         TEXT,
  bg_opacity      REAL NOT NULL DEFAULT 0.35 CHECK (bg_opacity >= 0.05 AND bg_opacity <= 1),
  -- Dimensions du fond une fois réduit, pour cadrer la vue avant son chargement.
  bg_width        INTEGER,
  bg_height       INTEGER,
  -- Aperçu PNG inséré dans les exports PDF et Word.
  preview_path    TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un croquis dépend d'une réunion OU d'un compte-rendu, jamais des deux.
  CONSTRAINT croquis_one_parent CHECK (meeting_id IS NULL OR site_report_id IS NULL)
);

-- Sur un poste local neuf, `schema.sql` (rejoué en premier) a déjà créé la table, sans la clé
-- vers `meetings` : elle est posée ici, une fois `meetings` présente. Sur une base où la
-- table a été créée par ce fichier, la clé existe déjà et rien ne change.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'croquis_meeting_id_fkey' AND conrelid = 'public.croquis'::regclass
  ) THEN
    ALTER TABLE croquis
      ADD CONSTRAINT croquis_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_croquis_tenant_meeting
  ON croquis(tenant_id, meeting_id) WHERE meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_croquis_tenant_site_report
  ON croquis(tenant_id, site_report_id) WHERE site_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_croquis_tenant_project
  ON croquis(tenant_id, project_id);

ALTER TABLE croquis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON croquis;
CREATE POLICY "tenant_isolation" ON croquis
  USING (tenant_id = my_tenant_id());

-- Table utilisée uniquement par les routes serveur (supabaseAdmin).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.croquis TO service_role';
  END IF;
END
$$;
