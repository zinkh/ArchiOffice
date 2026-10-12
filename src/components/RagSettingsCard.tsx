import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Status {
  external_embeddings_enabled: boolean;
  provider_configured: boolean;
  documents: { queued: number; processing: number; indexed: number; failed: number };
}
export function RagSettingsCard() {
  const [state,setState]=useState<Status|null>(null);
  const [consent,setConsent]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const refresh=async()=>setState(await apiFetch<Status>('/api/rag/settings'));
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
  const toggle=async(enabled:boolean)=>{
    setBusy(true);setError('');setNotice('');
    try {
      await apiFetch('/api/rag/settings',{
        method:'PATCH',
        body:JSON.stringify({external_embeddings_enabled:enabled,confirm_external_transfer:enabled&&consent}),
      });
      setConsent(false);setNotice(enabled?'Recherche sémantique autorisée pour le cabinet.':'Transfert désactivé et vecteurs locaux purgés.');
      await refresh();
    }catch(e:any){setError(e.message||'Réglage impossible.');}
    finally{setBusy(false);}
  };
  const reindex=async()=>{
    setBusy(true);setError('');setNotice('');
    try {
      await apiFetch('/api/rag/reindex',{method:'POST',body:JSON.stringify({})});
      setNotice('Les documents ont été placés dans la file de réindexation.');
      await refresh();
    }catch(e:any){setError(e.message||'Relance impossible.');}
    finally{setBusy(false);}
  };
  const card={background:'var(--tblr-surface)',border:'1px solid var(--tblr-border)'};
  return <section className="rounded-xl p-5 space-y-3" style={card}>
    <h2 className="text-sm font-bold uppercase tracking-wider" style={{color:'var(--tblr-muted)'}}>Recherche documentaire des agents (RAG)</h2>
    <p className="text-xs" style={{color:'var(--tblr-muted)'}}>Les documents du cabinet sont indexés localement dans Supabase. La recherche par mots-clés fonctionne sans transfert à un fournisseur externe.</p>
    {state && <>
      <p className="text-xs">
        Indexés : <strong>{state.documents.indexed}</strong> ·
        En attente : <strong>{state.documents.queued}</strong> ·
        En cours : <strong>{state.documents.processing}</strong> ·
        En erreur : <strong>{state.documents.failed}</strong>
      </p>
      <div className="rounded-lg p-3 space-y-2" style={{background:'var(--tblr-surface-2)'}}>
        <strong className="text-sm">Recherche sémantique Mistral : {state.external_embeddings_enabled?'autorisée':'désactivée'}</strong>
        <p className="text-xs" style={{color:'var(--tblr-muted)'}}>Cette option transmet les extraits indexés et les questions de recherche à Mistral afin de calculer leurs vecteurs. Elle est facultative et indépendante du partage documentaire mutualisé. Sans elle, seule la recherche lexicale est utilisée.</p>
        {!state.external_embeddings_enabled && <>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />
            J’autorise explicitement le transfert des extraits documentaires et des recherches de mon cabinet vers Mistral pour l’indexation sémantique.
          </label>
          <button type="button" disabled={busy||!consent||!state.provider_configured}
            onClick={()=>void toggle(true)} className="rounded-lg px-3 py-2 text-xs disabled:opacity-50"
            style={{border:'1px solid var(--tblr-border)'}}>Autoriser la recherche sémantique</button>
          {!state.provider_configured&&<p className="text-xs">Clé Mistral serveur indisponible.</p>}
        </>}
        {state.external_embeddings_enabled&&<button type="button" disabled={busy} onClick={()=>void toggle(false)}
          className="rounded-lg px-3 py-2 text-xs disabled:opacity-50" style={{border:'1px solid var(--tblr-border)'}}>
          Révoquer le transfert et supprimer les vecteurs</button>}
      </div>
      <button type="button" disabled={busy} onClick={()=>void reindex()} className="rounded-lg px-3 py-2 text-xs disabled:opacity-50"
        style={{border:'1px solid var(--tblr-border)'}}>Réindexer les documents du cabinet</button>
    </>}
    {error&&<p role="alert" className="text-xs" style={{color:'var(--tblr-danger)'}}>{error}</p>}
    {notice&&<p role="status" className="text-xs">{notice}</p>}
  </section>;
}
