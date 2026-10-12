import { createHash } from 'node:crypto';
import { extractDocumentSource, MAX_SOURCE_BYTES } from '../knowledge/documentSource';
import { chunkRagText } from './chunks';
import { embedTexts, tenantAllowsRemoteEmbeddings, vectorLiteral } from './embeddings';

const LEASE_MS = 20 * 60_000;
const TICK_MS = 60_000;
const MAX_ATTEMPTS = 3;

async function claim(db: any, candidate: any): Promise<any | null> {
  let q = db.from('rag_documents')
    .update({ status: 'processing', lease_until: new Date(Date.now() + LEASE_MS).toISOString(), updated_at: new Date().toISOString() })
    .eq('id', candidate.id).eq('tenant_id', candidate.tenant_id)
    .eq('source_version',candidate.source_version).eq('status',candidate.status);
  if (candidate.status === 'processing') q=q.eq('lease_until',candidate.lease_until);
  const {data,error}=await q.select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function transition(db: any, row: any, changes: Record<string, unknown>): Promise<boolean> {
  const { data,error }=await db.from('rag_documents')
    .update({ ...changes, lease_until: null, updated_at: new Date().toISOString() })
    .eq('id',row.id).eq('tenant_id',row.tenant_id)
    .eq('source_version',row.source_version).eq('status','processing')
    .eq('lease_until',row.lease_until).select('id').maybeSingle();
  if(error) throw error;
  return !!data;
}

/** Durable document indexing; index is never searchable while replacement runs. */
export async function indexRagDocument(db: any, candidate: any): Promise<boolean> {
  const row = await claim(db,candidate);
  if (!row) return false;
  try {
    const {data:doc,error} = await db.from('documents')
      .select('id,name,file_url,mime_type,size_bytes,version')
      .eq('tenant_id',row.tenant_id).eq('id',row.document_id).maybeSingle();
    if(error) throw error;
    if(!doc || Number(doc.version || 1)!==row.source_version) {
      // A concurrent edit has already queued the new version, or deleted it.
      return false;
    }
    if (!doc.file_url || Number(doc.size_bytes || 0)>MAX_SOURCE_BYTES) {
      throw new Error('Document absent ou supérieur à 15 Mo.');
    }
    // The existing extractor reads own or connected tenant storage, not remote
    // Nomic parsing. No extracted bytes reach Mistral unless opted in.
    const extracted = await extractDocumentSource(db,row.tenant_id,doc);
    if(!extracted.text?.trim()) throw new Error('Contenu textuel illisible.');
    const digest=createHash('sha256').update(extracted.text).digest('hex');
    const remoteAllowed = await tenantAllowsRemoteEmbeddings(db,row.tenant_id);
    if (row.content_sha256 === digest && row.indexed_version !== null && !remoteAllowed) {
      return await transition(db,row,{ status:'indexed', indexed_version:row.source_version, last_error:null });
    }
    const chunks=chunkRagText(extracted.text);
    if(!chunks.length) throw new Error('Document sans passage indexable.');

    // Prepare search text locally before asking for any external embeddings.
    let embeddings: number[][] | null = null;
    let embeddingWarning: string | null = null;
    if(remoteAllowed) {
      try { embeddings=await embedTexts(chunks.map(c=>c.content)); }
      catch(e: any) {
        // Lexical search remains available when embedding API is unavailable.
        embeddingWarning='Embeddings indisponibles ; recherche lexicale seulement.';
        console.warn('[rag] embedding failed for tenant',row.tenant_id,e?.message);
      }
    }

    // Prevent processing an obsolete version if a new upload happened meanwhile.
    const {data:fresh}=await db.from('rag_documents').select('status,source_version,lease_until')
      .eq('id',row.id).eq('tenant_id',row.tenant_id).maybeSingle();
    if (!fresh || fresh.status!=='processing' || fresh.source_version!==row.source_version ||
        fresh.lease_until!==row.lease_until) return false;

    const {error:delError}=await db.from('rag_chunks').delete()
      .eq('rag_document_id',row.id).eq('tenant_id',row.tenant_id);
    if(delError) throw delError;
    for(let i=0;i<chunks.length;i+=20) {
      const batch=chunks.slice(i,i+20).map((c,j)=>({
        tenant_id:row.tenant_id,rag_document_id:row.id,ordinal:c.ordinal,
        content:c.content,page_number:c.page_number,section_title:c.section_title,
        embedding:embeddings ? vectorLiteral(embeddings[i+j]) : null,
      }));
      const {error:insertError}=await db.from('rag_chunks').insert(batch);
      if(insertError) throw insertError;
    }
    return await transition(db,row,{
      status:'indexed', indexed_version:row.source_version,
      content_sha256:digest,indexed_at:new Date().toISOString(),
      attempts:0,last_error:embeddingWarning,
    });
  } catch(e: any) {
    const attempts=(row.attempts||0)+1;
    const retry=attempts<MAX_ATTEMPTS;
    await transition(db,row,{
      status:retry?'queued':'failed',attempts,
      next_attempt_at:new Date(Date.now()+60_000*Math.pow(2,attempts)).toISOString(),
      last_error:String(e?.message||'Indexation échouée').slice(0,400),
    }).catch(err=>console.error('[rag] retry update failed',err?.message));
    return false;
  }
}

export async function runDueRagIndex(db: any): Promise<number> {
  const now=new Date().toISOString();
  const [queue,expired]=await Promise.all([
    db.from('rag_documents').select('*').eq('status','queued')
      .lte('next_attempt_at',now).order('updated_at',{ascending:true}).limit(3),
    db.from('rag_documents').select('*').eq('status','processing')
      .lt('lease_until',now).limit(3),
  ]);
  if(queue.error) throw queue.error;
  if(expired.error) throw expired.error;
  let done=0;
  for(const row of [...(expired.data||[]),...(queue.data||[])].slice(0,3)) {
    if(await indexRagDocument(db,row)) done++;
  }
  return done;
}

export function startRagIndexing(db: any): void {
  let busy=false, warned=false;
  const tick=async()=>{
    if(busy)return;
    busy=true;
    try {
      // A deploy before migration must not crash the application.
      const {error}=await db.from('rag_documents').select('id').limit(1);
      if(error) {
        if(!warned) console.warn('[rag] migration manquante, indexeur en attente.');
        warned=true;
        return;
      }
      warned=false;
      await runDueRagIndex(db);
    } catch(e:any){console.error('[rag] indexing:',e?.message);}
    finally {busy=false;}
  };
  void tick();
  setInterval(()=>{void tick();},TICK_MS);
}
