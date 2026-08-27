-- ============================================================
-- MIGRATION : Rend admin_audit_log infalsifiable (audit de conformité
-- 2026-08 — NIS2/SOC 2). Deux mécanismes complémentaires :
--
-- 1. Chaînage de hash (comme un mini-ledger) : chaque ligne stocke le hash
--    de la précédente + le sien propre, calculé côté base par un trigger —
--    pas par le code applicatif, qui ne pourrait pas être digne de
--    confiance pour cette tâche précisément (c'est lui qu'on veut pouvoir
--    auditer). Toute ligne modifiée ou supprimée hors séquence casse la
--    chaîne de façon détectable par verify_admin_audit_log_chain() ci-dessous.
-- 2. Trigger BEFORE UPDATE OR DELETE qui lève une exception : empêche toute
--    modification/suppression, y compris via la clé service_role (le bypass
--    RLS de service_role ne contourne pas les triggers — il faudrait un
--    accès superuser/propriétaire de table pour les désactiver, hors de
--    portée d'une clé API compromise).
--
-- À exécuter dans le SQL Editor Supabase.
-- ============================================================

ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS row_hash TEXT;

CREATE OR REPLACE FUNCTION admin_audit_log_chain_hash()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  last_hash TEXT;
BEGIN
  IF NEW.created_at IS NULL THEN
    NEW.created_at := NOW();
  END IF;

  SELECT row_hash INTO last_hash FROM admin_audit_log ORDER BY created_at DESC, id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(last_hash, repeat('0', 64));
  NEW.row_hash := encode(
    digest(
      NEW.prev_hash ||
      COALESCE(NEW.actor_user_id::text, '') ||
      COALESCE(NEW.actor_email, '') ||
      NEW.action ||
      COALESCE(NEW.target_tenant_id::text, '') ||
      COALESCE(NEW.details::text, '') ||
      NEW.created_at::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_log_chain_hash_trigger ON admin_audit_log;
CREATE TRIGGER admin_audit_log_chain_hash_trigger
  BEFORE INSERT ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_chain_hash();

CREATE OR REPLACE FUNCTION admin_audit_log_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only — % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_log_append_only_trigger ON admin_audit_log;
CREATE TRIGGER admin_audit_log_append_only_trigger
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_append_only();

-- Walks the chain in order and returns the first row (if any) whose stored
-- row_hash doesn't match what recomputing it from prev_hash + its own
-- content produces — i.e. evidence of out-of-band tampering (a direct
-- superuser edit bypassing the triggers above). An empty result set means
-- the chain is intact. Run periodically, e.g. from a scheduled job.
CREATE OR REPLACE FUNCTION verify_admin_audit_log_chain()
RETURNS TABLE(id UUID, created_at TIMESTAMPTZ, expected_hash TEXT, stored_hash TEXT) LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r RECORD;
  running_prev TEXT := repeat('0', 64);
  computed TEXT;
BEGIN
  FOR r IN SELECT * FROM admin_audit_log ORDER BY created_at ASC, id ASC LOOP
    computed := encode(
      digest(
        running_prev ||
        COALESCE(r.actor_user_id::text, '') ||
        COALESCE(r.actor_email, '') ||
        r.action ||
        COALESCE(r.target_tenant_id::text, '') ||
        COALESCE(r.details::text, '') ||
        r.created_at::text,
        'sha256'
      ),
      'hex'
    );
    IF computed IS DISTINCT FROM r.row_hash OR running_prev IS DISTINCT FROM r.prev_hash THEN
      id := r.id; created_at := r.created_at; expected_hash := computed; stored_hash := r.row_hash;
      RETURN NEXT;
    END IF;
    running_prev := r.row_hash;
  END LOOP;
END;
$$;
