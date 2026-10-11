-- Durable, tenant-scoped outbox for Mistral Libraries publications.
-- Existing documents/contributions may be deleted; the remote deletion record MUST survive.
CREATE TABLE IF NOT EXISTS public.knowledge_remote_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  contribution_id uuid NOT NULL UNIQUE,
  library_id text NOT NULL,
  remote_name text NOT NULL,
  remote_document_id text,
  content_sha256 text NOT NULL,
  state text NOT NULL DEFAULT 'uploading'
    CHECK (state IN ('uploading','uncertain','published','delete_pending','deleting','deleted')),
  deletion_requested_at timestamptz,
  published_at timestamptz,
  deleted_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_remote_name_unique UNIQUE (library_id, remote_name),
  CONSTRAINT knowledge_remote_id_unique UNIQUE (library_id, remote_document_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_remote_pending
  ON public.knowledge_remote_documents (deletion_requested_at, state, updated_at)
  WHERE state <> 'deleted';
CREATE INDEX IF NOT EXISTS idx_knowledge_remote_tenant
  ON public.knowledge_remote_documents (tenant_id, state);

-- A publication reservation takes a share lock on the current opt-in row.
-- This serializes with consent withdrawal, preventing a new reservation
-- from escaping the withdrawal's deletion marker.
CREATE OR REPLACE FUNCTION public.knowledge_remote_check_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.knowledge_sharing_preferences
    WHERE tenant_id = NEW.tenant_id AND opted_in = true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No valid sharing consent' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM public.knowledge_contributions
    WHERE id = NEW.contribution_id AND tenant_id = NEW.tenant_id AND status = 'reviewed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Contribution not reviewed' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_knowledge_remote_check_insert ON public.knowledge_remote_documents;
CREATE TRIGGER trg_knowledge_remote_check_insert
  BEFORE INSERT ON public.knowledge_remote_documents
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_remote_check_insert();

CREATE OR REPLACE FUNCTION public.knowledge_request_remote_removal_on_optout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.opted_in IS DISTINCT FROM NEW.opted_in AND NEW.opted_in = false THEN
    UPDATE public.knowledge_remote_documents
      SET deletion_requested_at = COALESCE(deletion_requested_at, now()), updated_at = now()
      WHERE tenant_id = NEW.tenant_id AND state <> 'deleted';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_knowledge_remote_optout ON public.knowledge_sharing_preferences;
CREATE TRIGGER trg_knowledge_remote_optout
  AFTER UPDATE OF opted_in ON public.knowledge_sharing_preferences
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_request_remote_removal_on_optout();

-- Deleting a source document can cascade-delete its contribution.
-- Never discard an external deletion obligation on that cascade.
CREATE OR REPLACE FUNCTION public.knowledge_request_remote_removal_on_contribution_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.knowledge_remote_documents
    SET deletion_requested_at = COALESCE(deletion_requested_at, now()), updated_at = now()
    WHERE contribution_id = OLD.id AND tenant_id = OLD.tenant_id AND state <> 'deleted';
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_knowledge_remote_contribution_delete ON public.knowledge_contributions;
CREATE TRIGGER trg_knowledge_remote_contribution_delete
  AFTER DELETE ON public.knowledge_contributions
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_request_remote_removal_on_contribution_delete();

ALTER TABLE public.knowledge_remote_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.knowledge_remote_documents FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.knowledge_remote_documents FROM authenticated;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.knowledge_remote_check_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.knowledge_request_remote_removal_on_optout() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.knowledge_request_remote_removal_on_contribution_delete() FROM PUBLIC;
