import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { retrieveRag, formatRagForAgent, isSharedKnowledgeEnabled } from '../server/rag/retrieval';

let app: Express;
beforeAll(async()=>{app=await getTestApp();});
afterEach(()=>vi.unstubAllEnvs());

describe('RAG citations, versions et référentiel mutualisé',()=>{
  it('une citation devient introuvable dès qu’une nouvelle version remplace le fichier',async()=>{
    const tenant=makeTenant({rag_external_embeddings_enabled:false});
    const {token}=makeUser(tenant,'user');
    const cid=crypto.randomUUID(), rid=crypto.randomUUID();
    fakeSupabaseAdmin.seed('documents',[{
      id:'rag-version-doc',tenant_id:tenant,name:'CCTP toiture',version:2,project_id:null,resource_type:'projects',
    }]);
    fakeSupabaseAdmin.seed('rag_documents',[{
      id:rid,tenant_id:tenant,document_id:'rag-version-doc',indexed_version:1,status:'indexed',
    }]);
    fakeSupabaseAdmin.seed('rag_chunks',[{
      id:cid,tenant_id:tenant,rag_document_id:rid,ordinal:0,
      content:'Support de couverture en OSB.',section_title:'Couverture',page_number:null,
    }]);
    const stale=await request(app).get('/api/rag/source/'+cid).set(authHeader(token));
    expect(stale.status).toBe(404);
    fakeSupabaseAdmin.getTable('rag_documents').find(x=>x.id===rid)!.indexed_version=2;
    const fresh=await request(app).get('/api/rag/source/'+cid).set(authHeader(token));
    expect(fresh.status).toBe(200);
    expect(fresh.body).toMatchObject({
      document_id:'rag-version-doc',version:2,excerpt:'Support de couverture en OSB.',
      section_title:'Couverture',page_number:null,
    });
  });

  it('la citation ne contourne ni la séparation des cabinets ni la confidentialité propre à un agent',async()=>{
    const owner=makeTenant();
    const outsider=makeTenant();
    const {token:otherToken}=makeUser(outsider,'user');
    const {token:ownerToken}=makeUser(owner,'user');
    const cid=crypto.randomUUID(),rid=crypto.randomUUID();
    fakeSupabaseAdmin.seed('documents',[{
      id:'rag-agent-private',tenant_id:owner,name:'Connaissances',version:1,
      resource_type:'agents',resource_id:crypto.randomUUID(),
    }]);
    fakeSupabaseAdmin.seed('rag_documents',[{
      id:rid,tenant_id:owner,document_id:'rag-agent-private',indexed_version:1,status:'indexed',
    }]);
    fakeSupabaseAdmin.seed('rag_chunks',[{
      id:cid,tenant_id:owner,rag_document_id:rid,content:'Confidentiel agent',ordinal:0,
    }]);
    expect((await request(app).get('/api/rag/source/'+cid).set(authHeader(otherToken))).status).toBe(404);
    expect((await request(app).get('/api/rag/source/'+cid).set(authHeader(ownerToken))).status).toBe(403);
  });

  it('un collaborateur ne peut activer le référentiel mutualisé par une fausse entête admin',async()=>{
    const tenant=makeTenant({rag_shared_knowledge_enabled:false});
    const {token}=makeUser(tenant,'user');
    const r=await request(app).patch('/api/rag/shared-settings').set(authHeader(token))
      .set('x-user-role','admin').send({shared_knowledge_enabled:true});
    expect(r.status).toBe(403);
    expect(await isSharedKnowledgeEnabled(fakeSupabaseAdmin,tenant)).toBe(false);
  });

  it('le lecteur décide séparément si les passages Mistral déjà publiés sont consultables',async()=>{
    const tenant=makeTenant({rag_external_embeddings_enabled:false,rag_shared_knowledge_enabled:false});
    const calls:any[]=[];
    const orig=(fakeSupabaseAdmin as any).rpc;
    const prev=process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID;
    vi.stubEnv('MISTRAL_KNOWLEDGE_LIBRARY_ID','01a12a77-dd1c-77eb-84b0-25cac8adccf4');
    (fakeSupabaseAdmin as any).rpc=async(name:string,args:any)=>{
      calls.push([name,args]);
      if(name==='rag_search_mutualized') return {data:[{
        remote_document_id:'doc-anonymise',citation_id:crypto.randomUUID(),
        content:'Enduit de protection avec armature en fibres minérales.',score:0.4,
      }],error:null};
      return {data:[],error:null};
    };
    try {
      const disabled=await retrieveRag(fakeSupabaseAdmin,{
        tenantId:tenant,query:'enduit de protection',includeShared:true,
      });
      expect(disabled.results).toEqual([]);
      expect(calls.map(x=>x[0])).toEqual(['rag_search_private_v2']);
      fakeSupabaseAdmin.getTable('tenants').find(x=>x.id===tenant)!.rag_shared_knowledge_enabled=true;
      const enabled=await retrieveRag(fakeSupabaseAdmin,{
        tenantId:tenant,query:'enduit de protection',includeShared:true,
      });
      expect(enabled.shared_enabled).toBe(true);
      expect(enabled.results[0]).toMatchObject({
        source:'mutualized',document_name:'Référentiel technique mutualisé',
      });
      expect(calls.find(x=>x[0]==='rag_search_mutualized')![1].p_reader_tenant_id).toBe(tenant);
      expect(enabled.results[0]).not.toHaveProperty('tenant_id');
      expect(formatRagForAgent(enabled.results)).toContain('Référentiel technique mutualisé');
    } finally {
      (fakeSupabaseAdmin as any).rpc=orig;
      if(prev===undefined) delete process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID;
      else process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID=prev;
    }
  });

  it('les extraits complémentaires ne sont jamais présentés comme une source permettant une écriture',()=>{
    const text=formatRagForAgent([{
      source:'cabinet',document_name:'Notice chantier',document_id:'doc-1',
      version:3,chunk_id:crypto.randomUUID(),ordinal:2,score:0.12,
      excerpt:'Une hypothèse documentaire sans validation.',
    }]);
    expect(text).toContain('SOURCE INITIALE');
    expect(text).toContain('v3');
    expect(text).not.toContain('p.0');
  });
});
