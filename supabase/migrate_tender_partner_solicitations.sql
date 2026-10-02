-- Exclusivité demandée aux cotraitants d'un appel d'offres (onglet
-- Partenaires, src/pages/TenderDetail.tsx) : certains règlements de
-- consultation interdisent à un cotraitant de répondre dans plusieurs
-- équipes (exclusivité totale) ou ne l'interdisent que sur le même lot
-- (exclusivité partielle) — nul quand le règlement n'impose rien.
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS exclusivite TEXT CHECK (exclusivite IN ('totale', 'partielle'));

-- Suivi des sollicitations de bureaux d'études : pour une même spécialité
-- (ex. "BET Structure"), le cabinet consulte souvent plusieurs entreprises
-- pour n'en retenir qu'une — une ligne par (appel d'offres, contact
-- sollicité), indépendante de tender_specialties qui ne porte, elle, que le
-- membre finalement retenu par spécialité.
CREATE TABLE IF NOT EXISTS tender_partner_solicitations (
  id               TEXT PRIMARY KEY,
  tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tender_id        TEXT REFERENCES tenders(id) ON DELETE CASCADE NOT NULL,
  specialty_name   TEXT NOT NULL,
  contact_id       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'a_solliciter' CHECK (status IN ('a_solliciter', 'sollicite', 'relance', 'accepte', 'decline')),
  sent_at          TIMESTAMPTZ,
  last_relance_at  TIMESTAMPTZ,
  relance_count    INTEGER NOT NULL DEFAULT 0,
  response_notes   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_partner_solicitations_tender ON tender_partner_solicitations(tenant_id, tender_id);

ALTER TABLE tender_partner_solicitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON tender_partner_solicitations;
CREATE POLICY "tenant_isolation" ON tender_partner_solicitations
  USING (tenant_id = my_tenant_id());
