-- Partage d'une affaire avec un confrère : le confrère se choisit dans les contacts du cabinet.
--
-- `project_shares.confrere_contact_id` garde la fiche contact choisie à l'invitation. Elle alimente
-- le suivi : l'onglet « Affaires » de la fiche contact (GET /api/contacts/:id/projects) liste les
-- opérations sur lesquelles on collabore avec ce confrère.
--
-- Clé simple en SET NULL : supprimer la fiche ne retire pas le partage (l'accès tient au compte, pas
-- à la fiche), il perd seulement son lien. L'appartenance de la fiche au cabinet est contrôlée par la
-- route qui écrit la colonne (POST /api/projects/:id/shares).
--
-- La fusion de contacts rattache cette colonne : elle figure dans `v_refs` de merge_contacts
-- (migrate_merge_contacts.sql, tests/contactMergeReferences.test.ts). Sur une base où la fonction est
-- déjà posée, le bloc DO final y ajoute l'entrée sans rejouer tout le fichier.
--
-- Idempotent : peut être rejoué sans effet.

ALTER TABLE project_shares ADD COLUMN IF NOT EXISTS confrere_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_shares_confrere_contact ON project_shares(tenant_id, confrere_contact_id) WHERE confrere_contact_id IS NOT NULL;

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'merge_contacts';
  -- Fonction absente (fusion non migrée) ou entrée déjà présente : rien à faire.
  IF v_def IS NULL OR position('confrere_contact_id' IN v_def) > 0 THEN RETURN; END IF;
  IF position('[''project_lots'',''contact_id''],' IN v_def) = 0 THEN
    RAISE NOTICE 'merge_contacts : liste v_refs non reconnue, ajouter [project_shares, confrere_contact_id] à la main';
    RETURN;
  END IF;
  EXECUTE replace(v_def, '[''project_lots'',''contact_id''],', '[''project_lots'',''contact_id''],' || E'\n    ' || '[''project_shares'',''confrere_contact_id''],');
END $$;
