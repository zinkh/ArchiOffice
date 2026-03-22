import React, { useState, useEffect } from 'react';
import { IconPlus, IconTrash, IconDeviceFloppy } from '@tabler/icons-react';
import { LigneOuvrage, ArticleType, DonneeChiffree } from '../types';
import { fetchJson } from '../lib/api';

interface Props {
  lotId: string;
  projectId: string;
}

export default function LigneOuvrageEditor({ lotId, projectId }: Props) {
  const [lignes, setLignes] = useState<LigneOuvrage[]>([]);
  const [articles, setArticles] = useState<ArticleType[]>([]);

  useEffect(() => {
    fetchArticles();
    fetchLignes();
  }, [lotId]);

  const fetchArticles = () => fetchJson('/api/articles-type').then(setArticles);
  const fetchLignes = () => fetchJson(`/api/lignes-ouvrages?lotId=${lotId}`).then(setLignes);

  const handleAddLigne = () => {
    const newLigne: LigneOuvrage = {
      id: crypto.randomUUID(),
      id_lot: lotId,
      id_article_type: articles[0]?.id || '',
      description_adaptee: '',
    };
    setLignes([...lignes, newLigne]);
  };

  const handleSave = async () => {
    await fetch('/api/lignes-ouvrages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lignes)
    });
    alert('Saved');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">Lignes d'Ouvrages</h3>
        <button onClick={handleAddLigne} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
          <IconPlus size={16} /> Ajouter
        </button>
      </div>
      <div className="space-y-2">
        {lignes.map(ligne => (
          <div key={ligne.id} className="grid grid-cols-4 gap-2 bg-zinc-50 p-4 rounded-lg border">
            <select 
              value={ligne.id_article_type}
              onChange={e => setLignes(lignes.map(l => l.id === ligne.id ? {...l, id_article_type: e.target.value} : l))}
              className="p-2 border rounded"
            >
              {articles.map(a => <option key={a.id} value={a.id}>{a.designation}</option>)}
            </select>
            <input 
              value={ligne.description_adaptee}
              onChange={e => setLignes(lignes.map(l => l.id === ligne.id ? {...l, description_adaptee: e.target.value} : l))}
              className="p-2 border rounded col-span-2"
              placeholder="Description adaptée..."
            />
            <button onClick={() => setLignes(lignes.filter(l => l.id !== ligne.id))} className="text-red-500">
              <IconTrash size={16} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm">
        <IconDeviceFloppy size={16} /> Enregistrer
      </button>
    </div>
  );
}
