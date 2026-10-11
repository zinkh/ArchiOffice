-- ============================================================
-- ArchiOffice — Migration : fournisseur IA par cabinet
-- ============================================================
-- Le fournisseur et le modèle IA se réglaient uniquement pour toute la
-- plateforme (platform_settings, clé « ai_provider »). Ces deux colonnes
-- permettent à l'opérateur d'attribuer un fournisseur différent à un cabinet.
--
-- NULL (le défaut) = le cabinet suit le réglage plateforme, comme avant : une
-- instance qui applique cette migration ne change de comportement pour
-- personne. ai_model NULL avec un ai_provider renseigné = modèle par défaut du
-- fournisseur. Les clés d'API restent dans l'environnement du serveur.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_provider TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_model    TEXT;

COMMENT ON COLUMN tenants.ai_provider IS
  'Fournisseur IA imposé à ce cabinet (gemini, anthropic, mistral). NULL = réglage plateforme.';
COMMENT ON COLUMN tenants.ai_model IS
  'Modèle IA imposé à ce cabinet. NULL = modèle par défaut du fournisseur (ou réglage plateforme si ai_provider est NULL).';
