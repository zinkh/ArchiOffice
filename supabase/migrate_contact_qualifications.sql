-- ============================================================
-- ArchiOffice — Migration : qualifications et certifications des entreprises
-- ============================================================
-- Une entreprise consultée pour un lot doit pouvoir justifier de sa
-- qualification (Qualibat, Qualifelec, RGE...). Jusqu'ici rien ne la portait :
-- `contacts.corps_etat` dit quel métier l'entreprise exerce, pas ce qui le
-- certifie ni jusqu'à quand.
--
-- Une ligne par qualification détenue. Une entreprise en porte souvent
-- plusieurs chez le même organisme (un code Qualibat par spécialité), d'où la
-- clé d'unicité (contact, organisme, référence) : c'est elle qui permet de
-- rejouer l'import ADEME sans créer de doublon.
--
-- `source` dit d'où vient la ligne, `verified_at` si quelqu'un a contrôlé le
-- certificat. Les deux sont indépendants : une ligne importée d'une base
-- ouverte n'est pas pour autant vérifiée par l'architecte, et inversement une
-- ligne saisie à la main peut l'avoir été.
--
-- Le jeu de colonnes laisse la place à une alimentation par l'API Entreprise
-- (source 'api_entreprise') si le cabinet obtient un jour l'habilitation, sans
-- nouvelle migration.
CREATE TABLE IF NOT EXISTS contact_qualifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  organisme   TEXT NOT NULL
              CHECK (organisme IN ('qualibat', 'qualifelec', 'qualit_enr', 'certibat', 'rge', 'autre')),
  reference   TEXT NOT NULL DEFAULT '',
  libelle     TEXT,
  domaines    TEXT,
  date_debut  DATE,
  date_fin    DATE,
  source      TEXT NOT NULL DEFAULT 'saisie'
              CHECK (source IN ('saisie', 'ademe', 'api_entreprise')),
  verified_at TIMESTAMPTZ,
  verified_by TEXT,
  notes       TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contact_id, organisme, reference)
);

CREATE INDEX IF NOT EXISTS idx_contact_qualifications_contact
  ON contact_qualifications(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_qualifications_date_fin
  ON contact_qualifications(tenant_id, date_fin);

ALTER TABLE contact_qualifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON contact_qualifications;
CREATE POLICY "tenant_isolation" ON contact_qualifications
  FOR ALL USING (tenant_id = my_tenant_id());
