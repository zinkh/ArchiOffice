-- ============================================================
-- ArchiOffice — Migration : réglages plateforme (platform_settings)
-- ============================================================
-- Le fournisseur IA actif se réglait uniquement par variables
-- d'environnement (AI_PROVIDER / AI_MODEL), ce qui imposait un redémarrage du
-- serveur pour en changer. Cette table le rend modifiable depuis le
-- back-office plateforme (/admin), sans redéploiement.
--
-- Table clé/valeur volontairement générique : les réglages d'exploitation de
-- ce type sont peu nombreux, rarement lus et jamais joints, et une table par
-- réglage coûterait une migration à chacun. Une seule clé est utilisée
-- aujourd'hui, "ai_provider", de forme {"provider": "...", "model": "..."}.

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Comme admin_audit_log, cette table n'est pas rattachée à un tenant : aucune
-- politique tenant_isolation ne s'y applique. RLS est activé sans aucune
-- politique, de sorte que seule la clé service_role (supabaseAdmin) y accède.
-- Un réglage plateforme ne doit jamais être lisible depuis le navigateur d'un
-- utilisateur, ni a fortiori modifiable.
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE platform_settings IS
  'Réglages d''exploitation de la plateforme, modifiables depuis /admin. Accès service_role uniquement.';
COMMENT ON COLUMN platform_settings.key IS
  'Identifiant du réglage. Clés connues : ai_provider.';
