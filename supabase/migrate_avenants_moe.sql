-- Migration : sépare les avenants au contrat MOE des ordres de service
--
-- ordres_de_service.type = 'contrat_moe' faisait vivre les avenants au
-- contrat de maîtrise d'œuvre de l'agence dans la même table que les
-- ordres de service travaux (qui s'adressent à une entreprise sur un
-- marché de travaux) — deux objets sans rapport confondus dans un même
-- type, comme documenté dans migrate_ordres_de_service_type.sql. Un ordre
-- de service doit être adressé à une entreprise sur un marché de travaux
-- (marches_entreprises) ; un avenant MOE modifie le contrat de
-- l'architecte (contrats_moe). Cette migration les sépare :
--
--   1. crée avenants_moe, rattachée à contrats_moe, avec les colonnes
--      réellement utilisées par les avenants (le sous-ensemble MOE de
--      ordres_de_service : ni lot, ni entreprise, ni marché) ;
--   2. reprend les lignes existantes type='contrat_moe' dans cette
--      nouvelle table, puis les retire de ordres_de_service ;
--   3. ajoute ordres_de_service.marche_id, la liaison vers
--      marches_entreprises qui n'existait nulle part jusqu'ici — march_number
--      n'était qu'un champ texte libre, jamais rapproché d'un marché réel.

CREATE TABLE IF NOT EXISTS avenants_moe (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  contrat_moe_id UUID REFERENCES contrats_moe(id) ON DELETE CASCADE,
  project_id TEXT,
  os_number TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',
  origine_demande TEXT,
  objet TEXT,
  date_signature TEXT,
  incidences_delais_type TEXT,
  incidences_delais_details TEXT,
  delai_execution INTEGER,
  montant_devis_presente NUMERIC,
  montant_devis_accepte NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_avenants_moe_tenant_project ON avenants_moe(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_avenants_moe_contrat ON avenants_moe(contrat_moe_id);

ALTER TABLE avenants_moe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON avenants_moe;
CREATE POLICY "tenant_isolation" ON avenants_moe USING (tenant_id = my_tenant_id());

-- Reprise des avenants existants, rattachés à leur contrat MOE si le projet
-- en a un (le premier contrat 'Signé', ou à défaut le premier) — même
-- logique de résolution implicite que ProjectDetail.tsx utilisait côté
-- client faute de sélecteur de contrat explicite sur le formulaire.
INSERT INTO avenants_moe (
  id, tenant_id, contrat_moe_id, project_id, os_number, title, date, description,
  status, origine_demande, objet, date_signature, incidences_delais_type,
  incidences_delais_details, delai_execution, montant_devis_presente, montant_devis_accepte
)
SELECT
  os.id, os.tenant_id,
  (SELECT c.id FROM contrats_moe c WHERE c.project_id = os.project_id AND c.tenant_id = os.tenant_id
   ORDER BY (c.status = 'Signé') DESC, c.created_at ASC LIMIT 1),
  os.project_id, os.os_number, os.title, os.date, os.description,
  os.status, os.origine_demande, os.objet, os.date_signature, os.incidences_delais_type,
  os.incidences_delais_details, os.delai_execution, os.montant_devis_presente, os.montant_devis_accepte
FROM ordres_de_service os
WHERE os.type = 'contrat_moe'
ON CONFLICT (id) DO NOTHING;

DELETE FROM ordres_de_service WHERE type = 'contrat_moe';

-- Liaison ordre de service -> marché travaux, absente jusqu'ici.
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS marche_id UUID REFERENCES marches_entreprises(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ordres_de_service_marche ON ordres_de_service(marche_id);
