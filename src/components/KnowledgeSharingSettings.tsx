import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { KnowledgeSharingPanel } from './KnowledgeSharingPanel';

interface CandidateDocument { id: string; name: string }

/**
 * Mémoire technique collective, dans les paramètres du cabinet. Le panneau a besoin des noms des
 * documents de la GED (journal des extraits, partage manuel) : ce wrapper les lit lui-même, puisque
 * les paramètres ne chargent pas la liste des documents.
 */
export function KnowledgeSharingSettings() {
  const [documents, setDocuments] = useState<CandidateDocument[]>([]);
  useEffect(() => {
    let current = true;
    apiFetch<CandidateDocument[]>('/api/documents')
      .then(list => { if (current && Array.isArray(list)) setDocuments(list.map(d => ({ id: d.id, name: d.name }))); })
      .catch(() => { /* le panneau fonctionne sans les noms : il affiche « ce document » */ });
    return () => { current = false; };
  }, []);
  return <KnowledgeSharingPanel documents={documents} />;
}
