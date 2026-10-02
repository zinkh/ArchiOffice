-- Modèles de mails personnalisables (Réglages > Communication).
--
-- Un mail envoyé depuis l'application (facture au client, sollicitation d'un
-- co-traitant sur un appel d'offres, relance de cette sollicitation) était
-- jusqu'ici un texte figé dans le code frontend (`Invoices.tsx`,
-- `TenderDetail.tsx`) : aucun moyen pour le cabinet de le reformuler sans
-- toucher au code. Une ligne par « genre » de mail (`kind`), au plus une par
-- cabinet — comme `document_templates`, mais sans notion de catégories
-- multiples ni de modèle par défaut : ici chaque genre EST le modèle, il n'y
-- en a qu'un à personnaliser, pas plusieurs variantes à choisir.
--
-- Éditable directement (pas de `editable=false` façon document_templates à
-- dupliquer avant modification) : ce n'est pas une pièce contractuelle, un
-- texte de mail se corrige sur place. Le texte auto-généré au premier accès
-- (voir server/seedEmailTemplates.ts) reste néanmoins récupérable via
-- POST /api/email_templates/:id/reset, qui le réécrit tel quel.

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- Au plus un modèle par genre et par cabinet — le genre identifie déjà le
-- modèle, une deuxième ligne du même genre ne serait qu'un doublon ambigu.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_tenant_kind ON email_templates(tenant_id, kind);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON email_templates USING (tenant_id = my_tenant_id());
