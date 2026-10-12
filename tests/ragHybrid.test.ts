import { beforeAll,describe,expect,it,vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { chunkRagText } from '../server/rag/chunks';
import { vectorLiteral, tenantAllowsRemoteEmbeddings } from '../server/rag/embeddings';
import { buildAgentTools, executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import { capabilitiesFromAgent } from '../packages/archioffice-agents/src/types';
import { getTestApp, fakeSupabaseAdmin,makeTenant,makeUser,authHeader } from './testServer';

let app: Express;
beforeAll(async()=>{app=await getTestApp();});

describe('lot 1 — extraction locale',()=>{
  it('découpe les longs contenus en passages bornés sans inventer de pages',()=>{
    const text='Lot 04 - couverture\n\n'+('La couverture comporte un support OSB et une pente à vérifier. '.repeat(130));
    const chunks=chunkRagText(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every(c=>c.content.length<=5000&&c.page_number===null)).toBe(true);
    expect(chunks[0].content).toContain('Lot 04');
    expect(chunks.map(c=>c.ordinal)).toEqual(chunks.map((_,i)=>i));
  });
  it('borne le nombre de passages et neutralise une source vide',()=>{
    expect(chunkRagText('')).toEqual([]);
    expect(chunkRagText('Texte technique '.repeat(100000)).length).toBeLessThanOrEqual(160);
  });
  it('refuse un faux vecteur',()=>{
    expect(()=>vectorLiteral([0.2])).toThrow(/invalide/);
  });
});

describe('lot 2 — API et isolation',()=>{
  it('le transfert externe est désactivé sauf accord explicite du cabinet',async()=>{
    const tenant=makeTenant({rag_external_embeddings_enabled:false});
    expect(await tenantAllowsRemoteEmbeddings(fakeSupabaseAdmin,tenant)).toBe(false);
    const {token}=makeUser(tenant,'admin');
    const bad=await request(app).patch('/api/rag/settings').set(authHeader(token))
      .send({external_embeddings_enabled:true});
    expect(bad.status).toBe(400);
    expect(await tenantAllowsRemoteEmbeddings(fakeSupabaseAdmin,tenant)).toBe(false);
  });
  it('un membre ne peut autoriser le transfert même avec un faux rôle client',async()=>{
    const tenant=makeTenant({rag_external_embeddings_enabled:false});
    const {token}=makeUser(tenant,'user');
    const r=await request(app).patch('/api/rag/settings')
      .set(authHeader(token)).set('x-user-role','admin')
      .send({external_embeddings_enabled:true,confirm_external_transfer:true});
    expect(r.status).toBe(403);
  });
  it('la recherche refuse de lire la bibliothèque d’un agent sans docsRead',async()=>{
    const tenant=makeTenant({rag_external_embeddings_enabled:false});
    const {token}=makeUser(tenant,'user');
    const agentId=crypto.randomUUID();
    fakeSupabaseAdmin.seed('agents',[{
      id:agentId,tenant_id:tenant,is_active:true,docs_read_enabled:false,
    }]);
    const r=await request(app).post('/api/rag/search').set(authHeader(token))
      .send({query:'note de calcul',agent_id:agentId});
    expect(r.status).toBe(403);
  });
  it('les résultats de recherche sont obligatoirement filtrés par le cabinet authentifié',async()=>{
    const tenant=makeTenant({rag_external_embeddings_enabled:false});
    const other=makeTenant({rag_external_embeddings_enabled:false});
    const {token}=makeUser(tenant,'user');
    const calls:any[]=[];
    const fake=fakeSupabaseAdmin as any;
    const original=fake.rpc;
    fake.rpc=async(_name:string,args:any)=>{
      calls.push(args);
      return {data:[{
        document_id:'doc-1',document_name:'CCTP',project_id:null,phase:'PRO',
        document_version:1,chunk_id:crypto.randomUUID(),ordinal:0,
        page_number:null,section_title:'Lot 01',content:'Acrotère à reprendre',score:0.02,
      }],error:null};
    };
    try{
      const r=await request(app).post('/api/rag/search').set(authHeader(token))
        .send({query:'acrotère',tenant_id:other});
      expect(r.status).toBe(200);
      expect(calls[0].p_tenant_id).toBe(tenant);
      expect(calls[0].p_embedding).toBeNull();
      expect(r.body.mode).toBe('lexical');
      expect(r.body.results[0].excerpt).toContain('Acrotère');
    }finally{fake.rpc=original;}
  });
  it('search_knowledge est uniquement déclaré avec docsRead et refuse sans cette capacité',async()=>{
    const none=capabilitiesFromAgent({action_scopes:[],docs_read_enabled:false});
    const yes=capabilitiesFromAgent({action_scopes:[],docs_read_enabled:true});
    expect(buildAgentTools(none).some(t=>t.name==='search_knowledge')).toBe(false);
    expect(buildAgentTools(yes).some(t=>t.name==='search_knowledge')).toBe(true);
    const res=await executeAgentAction('http://localhost',undefined,none,
      {name:'search_knowledge',args:{query:'DTU'}});
    expect(res.response.error).toMatch(/pas activée/);
  });
});
