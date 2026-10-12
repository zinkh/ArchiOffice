import type { Express } from 'express';
import { tenantAllowsRemoteEmbeddings } from '../rag/embeddings';
import { retrieveRag, isSharedKnowledgeEnabled } from '../rag/retrieval';

interface RagRouteDeps {
  db: any;
  getTenantId: (userId: string) => Promise<string>;
  requireRole: (...roles: string[]) => (req: any,res: any,next: any) => Promise<void>;
}
export function registerRagRoutes(app: Express,{db,getTenantId,requireRole}: RagRouteDeps) {
  app.get('/api/rag/settings',requireRole('admin'),async(req:any,res:any)=>{
    try {
      const tenantId=await getTenantId(req.user.id);
      const enabled=await tenantAllowsRemoteEmbeddings(db,tenantId);
      const sharedEnabled=await isSharedKnowledgeEnabled(db,tenantId);
      const {data,error}=await db.from('rag_documents').select('status').eq('tenant_id',tenantId).limit(5000);
      if(error) throw error;
      const statuses={queued:0,processing:0,indexed:0,failed:0};
      for(const item of data||[]) if(item.status in statuses) (statuses as any)[item.status]++;
      res.json({external_embeddings_enabled:enabled, shared_knowledge_enabled:sharedEnabled, provider_configured:!!process.env.MISTRAL_API_KEY,documents:statuses});
    }catch(e:any){res.status(500).json({error:e?.message||'Index indisponible.'});}
  });

  app.patch('/api/rag/settings',requireRole('admin'),async(req:any,res:any)=>{
    try {
      const enabled=req.body?.external_embeddings_enabled;
      if(typeof enabled!=='boolean') return res.status(400).json({error:'Booléen requis.'});
      if(enabled && req.body?.confirm_external_transfer!==true) {
        return res.status(400).json({error:'Confirmer explicitement le transfert des passages documentaires et des questions vers Mistral.'});
      }
      if(enabled && !process.env.MISTRAL_API_KEY) return res.status(503).json({error:'Service d’embeddings non configuré.'});
      const tenantId=await getTenantId(req.user.id);
      const {error}=await db.from('tenants')
        .update({rag_external_embeddings_enabled:enabled}).eq('id',tenantId);
      if(error) throw error;
      res.json({external_embeddings_enabled:await tenantAllowsRemoteEmbeddings(db,tenantId)});
    }catch(e:any){res.status(500).json({error:e?.message||'Réglage impossible.'});}
  });

  app.patch('/api/rag/shared-settings', requireRole('admin'), async(req:any,res:any)=>{
    try {
      const enabled=req.body?.shared_knowledge_enabled;
      if(typeof enabled!=='boolean') return res.status(400).json({error:'Booléen requis.'});
      const tenantId=await getTenantId(req.user.id);
      const {error}=await db.from('tenants').update({rag_shared_knowledge_enabled:enabled})
        .eq('id',tenantId);
      if(error) throw error;
      res.json({shared_knowledge_enabled:await isSharedKnowledgeEnabled(db,tenantId)});
    }catch(e:any){res.status(500).json({error:e?.message||'Réglage impossible.'});}
  });

  // A stable passage reference never exposes the storage URL. Re-check
  // tenant, source document version, and current indexing status on every
  // request; invalidated citations return 404 after a version change.
  app.get('/api/rag/source/:chunkId',async(req:any,res:any)=>{
    try {
      const tenantId=await getTenantId(req.user.id);
      const id=String(req.params.chunkId||'');
      if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:'Référence invalide.'});
      const {data:chunk,error}=await db.from('rag_chunks')
        .select('id,rag_document_id,ordinal,page_number,section_title,content')
        .eq('id',id).eq('tenant_id',tenantId).maybeSingle();
      if(error) throw error;
      if(!chunk)return res.status(404).json({error:'Source introuvable.'});
      const {data:index}=await db.from('rag_documents')
        .select('document_id,indexed_version,status')
        .eq('id',chunk.rag_document_id).eq('tenant_id',tenantId).maybeSingle();
      if(!index||index.status!=='indexed') return res.status(404).json({error:'Source périmée.'});
      const {data:doc}=await db.from('documents')
        .select('id,name,version,project_id,phase,resource_type,resource_id')
        .eq('id',index.document_id).eq('tenant_id',tenantId).maybeSingle();
      if(!doc||index.indexed_version!==Number(doc.version||1)) return res.status(404).json({error:'Version périmée.'});
      // Agent knowledge is private to that agent even within the same tenant:
      // the owner is never inferred from a chunk UUID supplied by a user.
      if(doc.resource_type==='agents')return res.status(403).json({error:'Source réservée à la bibliothèque de l’agent.'});
      res.json({
        source:'cabinet',document_id:doc.id,document_name:doc.name,version:doc.version,
        project_id:doc.project_id,phase:doc.phase,chunk_id:chunk.id,
        ordinal:chunk.ordinal,page_number:chunk.page_number,
        section_title:chunk.section_title,excerpt:chunk.content,
      });
    }catch(e:any){res.status(503).json({error:e?.message||'Source indisponible.'});}
  });

  app.post('/api/rag/reindex',requireRole('admin'),async(req:any,res:any)=>{
    try {
      const tenantId=await getTenantId(req.user.id);
      const documentId=String(req.body?.document_id||'').trim();
      let q=db.from('rag_documents').update({
        status:'queued',attempts:0,next_attempt_at:new Date().toISOString(),lease_until:null,
      }).eq('tenant_id',tenantId);
      if(documentId) {
        const {data:doc}=await db.from('documents').select('id').eq('id',documentId)
          .eq('tenant_id',tenantId).maybeSingle();
        if(!doc) return res.status(404).json({error:'Document introuvable.'});
        q=q.eq('document_id',documentId);
      }
      const {error}=await q;
      if(error) throw error;
      res.json({queued:true});
    }catch(e:any){res.status(500).json({error:e?.message||'Relance impossible.'});}
  });

  // Read-only retrieval. The user's real authenticated tenant and the source
  // agent's document-read capability are revalidated here, not trusted from
  // an AI tool argument. No browser service-role token is ever exposed.
  app.post('/api/rag/search',async(req:any,res:any)=>{
    try {
      const tenantId=await getTenantId(req.user.id);
      const query=String(req.body?.query||'').trim();
      if(query.length<2||query.length>250) return res.status(400).json({error:'Question requise (2 à 250 caractères).'});
      const projectId=req.body?.project_id ? String(req.body.project_id) : null;
      const phase=req.body?.phase ? String(req.body.phase) : null;
      const agentId=req.body?.agent_id ? String(req.body.agent_id) : null;
      if(projectId) {
        const {data:project}=await db.from('projects').select('id')
          .eq('id',projectId).eq('tenant_id',tenantId).maybeSingle();
        if(!project) return res.status(404).json({error:'Affaire introuvable pour ce cabinet.'});
      }
      if(phase && phase.length>80) return res.status(400).json({error:'Phase invalide.'});
      if(agentId) {
        const {data:agent}=await db.from('agents').select('id')
          .eq('id',agentId).eq('tenant_id',tenantId).eq('is_active',true)
          .eq('docs_read_enabled',true).maybeSingle();
        if(!agent) return res.status(403).json({error:'Lecture documentaire désactivée pour cet agent.'});
      }

      const matches=await retrieveRag(db,{
        tenantId,query,projectId,phase,agentId,
        limit:Math.min(12,Math.max(1,Number(req.body?.limit)||8)),
        includeShared:req.body?.include_shared===true,
      });
      res.json(matches);
    }catch(e:any){res.status(503).json({error:e?.message||'Recherche indisponible.'});}
  });
}
