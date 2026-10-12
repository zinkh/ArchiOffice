-- Invalidate shared-library results when the reviewed excerpt differs from the actual published content.
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
    -- Do not expose an edited/renormalized excerpt that was never approved
    -- and published in this exact state. Fail closed on hash mismatch.
    AND r.content_sha256 = encode(sha256(convert_to(c.sanitized_text,'UTF8')),'hex')
)
SELECT p.remote_document_id, p.contribution_id AS citation_id,
       LEFT(p.sanitized_text,2400) AS content,
       ts_rank_cd(to_tsvector('french',p.sanitized_text),p.terms)::double precision AS score
FROM permitted p
WHERE to_tsvector('french',p.sanitized_text) @@ p.terms
ORDER BY score DESC, p.contribution_id
LIMIT LEAST(GREATEST(p_limit,1),8)
$$;
