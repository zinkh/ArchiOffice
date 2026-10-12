-- RAG 3-5: only the *current* indexed version may be quoted or retrieved.
-- v2 avoids changing the original API signature while older servers deploy.
CREATE OR REPLACE FUNCTION public.rag_search_private_v2(
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
  WHERE d.tenant_id=p_tenant_id AND d.status='indexed' AND d.indexed_version=COALESCE(doc.version,1)
    AND (p_project_id IS NULL OR doc.project_id=p_project_id)
    AND (p_phase IS NULL OR doc.phase=p_phase)
    AND (COALESCE(doc.resource_type,'projects') <> 'agents'
         OR (p_agent_id IS NOT NULL AND doc.resource_id=p_agent_id::text))
), words AS (
  SELECT websearch_to_tsquery('french',LEFT(TRIM(p_query),250)) AS q
), lexical AS (
  SELECT v.chunk_id, row_number() OVER
    (ORDER BY ts_rank_cd(v.search_vector,w.q) DESC, v.ordinal,v.chunk_id) AS r
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

REVOKE ALL ON FUNCTION public.rag_search_private_v2(uuid,text,text,text,uuid,extensions.vector,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rag_search_private_v2(uuid,text,text,text,uuid,extensions.vector,integer) TO service_role;

-- Opt-in to reading strictly anonymized/published shared knowledge.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS rag_shared_knowledge_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.agent_missions ADD COLUMN IF NOT EXISTS rag_references jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.agent_missions ADD COLUMN IF NOT EXISTS specialist_rag_references jsonb NOT NULL DEFAULT '[]'::jsonb;

-- This is a read-only, service-role-only mirror of the *published* and
-- *reviewed* Mistral contributions; directly uploaded Mistral test files are
-- deliberately excluded. Withdrawing a contributor's opt-in or marking a
-- remote deletion instantly revokes visibility even before remote deletion.
CREATE OR REPLACE FUNCTION public.rag_search_mutualized(
  p_reader_tenant_id uuid, p_library_id text, p_query text, p_limit integer DEFAULT 5
) RETURNS TABLE (
  remote_document_id text, citation_id uuid, content text, score double precision
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH permitted AS (
  SELECT r.remote_document_id, r.contribution_id,
         c.sanitized_text,
         websearch_to_tsquery('french', LEFT(TRIM(p_query), 250)) AS terms
  FROM public.knowledge_remote_documents r
  JOIN public.knowledge_contributions c
    ON c.id=r.contribution_id AND c.tenant_id=r.tenant_id AND c.status='reviewed'
  JOIN public.knowledge_sharing_preferences src
    ON src.tenant_id=r.tenant_id AND src.opted_in=true
  JOIN public.tenants reader
    ON reader.id=p_reader_tenant_id AND reader.rag_shared_knowledge_enabled=true
  WHERE r.library_id=p_library_id AND r.state='published'
    AND r.deletion_requested_at IS NULL AND r.remote_document_id IS NOT NULL
    AND char_length(c.sanitized_text)>=40
)
SELECT p.remote_document_id, p.contribution_id AS citation_id,
       LEFT(p.sanitized_text,2400) AS content,
       ts_rank_cd(to_tsvector('french',p.sanitized_text),p.terms)::double precision AS score
FROM permitted p
WHERE to_tsvector('french',p.sanitized_text) @@ p.terms
ORDER BY score DESC, p.contribution_id
LIMIT LEAST(GREATEST(p_limit,1),8)
$$;
REVOKE ALL ON FUNCTION public.rag_search_mutualized(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rag_search_mutualized(uuid,text,text,integer) TO service_role;
