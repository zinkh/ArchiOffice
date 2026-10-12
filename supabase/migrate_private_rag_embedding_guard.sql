-- Protect consent revocation against a concurrent worker still uploading embeddings.
-- Lock the tenant row for the duration of the INSERT/UPDATE transaction:
-- the opt-out UPDATE must wait and then scrub every vector committed before it.
CREATE OR REPLACE FUNCTION public.rag_enforce_embedding_consent()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.embedding IS NOT NULL THEN
    PERFORM 1 FROM public.tenants
      WHERE id=NEW.tenant_id AND rag_external_embeddings_enabled=true
      FOR SHARE;
    IF NOT FOUND THEN NEW.embedding=NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rag_enforce_chunk_consent ON public.rag_chunks;
CREATE TRIGGER rag_enforce_chunk_consent
BEFORE INSERT OR UPDATE OF embedding ON public.rag_chunks
FOR EACH ROW EXECUTE FUNCTION public.rag_enforce_embedding_consent();
