-- Remplace tenders.entreprise_retenue (une seule valeur texte) par une table
-- à une ligne par membre du groupement retenu : un marché de maîtrise
-- d'œuvre est souvent attribué à un groupement (architecte mandataire +
-- bureaux d'études + économiste), pas à une entreprise unique. Sur le
-- modèle de tender_specialties : rôle libre + contact_id optionnel (quand le
-- membre est déjà une fiche Contact du cabinet) + nom libre en repli.
--
-- contact_id est ce qui permettra, plus tard, de retrouver les opérations
-- sur lesquelles un bureau d'études donné a déjà été retenu, pour le
-- proposer par similarité avec l'affaire en cours (voir
-- GET /api/tenders/:id/candidatures-similaires, server/routes/tenders.ts).
CREATE TABLE IF NOT EXISTS tender_groupement_membres (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tender_id   TEXT REFERENCES tenders(id) ON DELETE CASCADE NOT NULL,
  role        TEXT NOT NULL,
  contact_id  TEXT,
  name        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tender_groupement_membres_tender ON tender_groupement_membres(tenant_id, tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_groupement_membres_contact ON tender_groupement_membres(tenant_id, contact_id);

ALTER TABLE tender_groupement_membres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON tender_groupement_membres;
CREATE POLICY "tenant_isolation" ON tender_groupement_membres
  USING (tenant_id = my_tenant_id());

ALTER TABLE tenders DROP COLUMN IF EXISTS entreprise_retenue;
