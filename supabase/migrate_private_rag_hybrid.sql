-- Private, tenant-isolated document retrieval. No document text leaves Supabase
-- unless the tenant administrator separately opts in to external embeddings.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS rag_external_embeddings_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.rag_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id text NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE CASCADE,
  source_version integer NOT NULL DEFAULT 1,
  indexed_version integer,
  content_sha256 text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','indexed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  indexed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rag_documents_due_idx ON public.rag_documents(status,next_attempt_at,lease_until);
CREATE INDEX IF NOT EXISTS rag_documents_tenant_idx ON public.rag_documents(tenant_id,document_id);

CREATE TABLE IF NOT EXISTS public.rag_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rag_document_id uuid NOT NULL REFERENCES public.rag_documents(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  page_number integer,
  section_title text,
  embedding extensions.vector(1024),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('french', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rag_chunks_position_unique UNIQUE (rag_document_id,ordinal)
);
CREATE INDEX IF NOT EXISTS rag_chunks_tenant_idx ON public.rag_chunks(tenant_id,rag_document_id);
CREATE INDEX IF NOT EXISTS rag_chunks_fts_idx ON public.rag_chunks USING GIN(search_vector);

-- All reads/writes go via trusted server-side service-role. No direct browser
-- access: tenant/resource filtering is mandatory in the server and RPC.
ALTER TABLE public.rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rag_documents, public.rag_chunks FROM anon, authenticated;
GRANT ALL ON public.rag_documents, public.rag_chunks TO service_role;

-- Every document update is automatically queued, including imports and all
-- future application entry points; deletion cascades through both RAG tables.
CREATE OR REPLACE FUNCTION public.rag_enqueue_document() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR
     NEW.version IS DISTINCT FROM OLD.version OR
     NEW.file_url IS DISTINCT FROM OLD.file_url OR
     NEW.name IS DISTINCT FROM OLD.name OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.phase IS DISTINCT FROM OLD.phase OR
     NEW.resource_type IS DISTINCT FROM OLD.resource_type OR
     NEW.resource_id IS DISTINCT FROM OLD.resource_id THEN
    INSERT INTO public.rag_documents (tenant_id,document_id,source_version,status)
    VALUES (NEW.tenant_id,NEW.id,COALESCE(NEW.version,1),'queued')
    ON CONFLICT (document_id) DO UPDATE SET
      tenant_id=EXCLUDED.tenant_id,
      source_version=EXCLUDED.source_version,
      status='queued', attempts=0, next_attempt_at=now(),
      lease_until=NULL, updated_at=now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rag_documents_enqueue ON public.documents;
CREATE TRIGGER rag_documents_enqueue
AFTER INSERT OR UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.rag_enqueue_document();

-- Consent changes take effect even for existing embeddings.
CREATE OR REPLACE FUNCTION public.rag_embedding_consent_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.rag_external_embeddings_enabled IS DISTINCT FROM OLD.rag_external_embeddings_enabled THEN
    IF NOT NEW.rag_external_embeddings_enabled THEN
      UPDATE public.rag_chunks SET embedding=NULL WHERE tenant_id=NEW.id AND embedding IS NOT NULL;
    ELSE
      UPDATE public.rag_documents SET status='queued', attempts=0, lease_until=NULL,
        next_attempt_at=now(), updated_at=now() WHERE tenant_id=NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rag_tenant_embedding_consent ON public.tenants;
CREATE TRIGGER rag_tenant_embedding_consent
AFTER UPDATE OF rag_external_embeddings_enabled ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.rag_embedding_consent_changed();

-- Backfill only metadata / work queue. Text extraction is performed by the
-- application background worker, not in the migration transaction.
INSERT INTO public.rag_documents (tenant_id,document_id,source_version,status)
SELECT tenant_id,id,COALESCE(version,1),'queued'
FROM public.documents WHERE file_url IS NOT NULL AND file_url <> ''
ON CONFLICT (document_id) DO NOTHING;

-- Hybrid reciprocal-rank fusion. p_embedding=NULL is a deliberate lexical-only
-- fallback for cabinets without consent or unavailable embedding provider.
CREATE OR REPLACE FUNCTION public.rag_search_private(
  p_tenant_id uuid, p_query text,
  p_project_id text DEFAULT NULL,
  p_phase text DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_embedding extensions.vector(1024) DEFAULT NULL,
  p_limit integer DEFAULT 8
) RETURNS TABLE (
  document_id text, document_name text, project_id text, phase text,
  document_version integer, chunk_id uuid, ordinal integer,
  page_number integer, section_title text, content text, score double precision
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH visible AS MATERIALIZED (
  SELECT c.id AS chunk_id,c.ordinal,c.page_number,c.section_title,c.content,
         c.search_vector,c.embedding,
         d.document_id,doc.name AS document_name,doc.project_id,doc.phase,
         d.indexed_version AS document_version
  FROM public.rag_chunks c
  JOIN public.rag_documents d ON d.id=c.rag_document_id AND d.tenant_id=c.tenant_id
  JOIN public.documents doc ON doc.id=d.document_id AND doc.tenant_id=d.tenant_id
  WHERE d.tenant_id=p_tenant_id AND d.status='indexed'
    AND (p_project_id IS NULL OR doc.project_id=p_project_id)
    AND (p_phase IS NULL OR doc.phase=p_phase)
    AND (COALESCE(doc.resource_type,'projects') <> 'agents'
         OR (p_agent_id IS NOT NULL AND doc.resource_id=p_agent_id::text))
), words AS (
  SELECT websearch_to_tsquery('french',LEFT(TRIM(p_query),250)) AS q
), lexical AS (
  SELECT v.chunk_id, row_number() OVER
    (ORDER BY ts_rank_cd(v.search_vector,w.q) DESC, v.ordinal) AS r
  FROM visible v CROSS JOIN words w
  WHERE v.search_vector @@ w.q OR position(lower(trim(p_query)) IN lower(v.content))>0
  LIMIT 60
), semantic AS (
  SELECT v.chunk_id, row_number() OVER
    (ORDER BY v.embedding OPERATOR(extensions.<=>) p_embedding, v.ordinal) AS r
  FROM visible v
  WHERE p_embedding IS NOT NULL AND v.embedding IS NOT NULL
  ORDER BY v.embedding OPERATOR(extensions.<=>) p_embedding, v.ordinal LIMIT 60
), scores AS (
  SELECT COALESCE(l.chunk_id,s.chunk_id) AS chunk_id,
     COALESCE(1.0/(60+l.r),0.0) + COALESCE(1.0/(60+s.r),0.0) AS score
  FROM lexical l FULL JOIN semantic s USING(chunk_id)
)
SELECT v.document_id,v.document_name,v.project_id,v.phase,v.document_version,
       v.chunk_id,v.ordinal,v.page_number,v.section_title,v.content,s.score
FROM scores s JOIN visible v USING(chunk_id)
ORDER BY s.score DESC, v.document_name, v.ordinal
LIMIT LEAST(GREATEST(p_limit,1),20)
$$;
REVOKE ALL ON FUNCTION public.rag_search_private(uuid,text,text,text,uuid,extensions.vector,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rag_search_private(uuid,text,text,text,uuid,extensions.vector,integer)
  TO service_role;
