import React, { useState, useEffect } from 'react';
import { IconFileDescription, IconDownload, IconExternalLink, IconAlertCircle, IconLoader2, IconChevronRight, IconFileTypePdf } from '@tabler/icons-react';

interface GPUDocument {
  id: string;
  type: string;
  name: string;
  status: string;
  uploadDate: string;
  updateDate: string;
}

interface GPUDocumentDetails extends GPUDocument {
  archiveUrl?: string;
  files?: Array<{
    name: string;
    url: string;
  }>;
  writingMaterials?: Record<string, string>;
}

interface UrbanPlanningInfoProps {
  insee: string;
  coords?: { lat: number; lon: number } | null;
}

export function UrbanPlanningInfo({ insee, coords }: UrbanPlanningInfoProps) {
  const [documents, setDocuments] = useState<GPUDocumentDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!insee) return;

    const fetchUrbanPlanning = async () => {
      setLoading(true);
      setError('');
      try {
        // 1. Search for documents using both grid and partition for better coverage
        // Grid search is broader, partition is more specific for PLU/POS
        const gridUrl = `https://www.geoportail-urbanisme.gouv.fr/api/document?grid=${insee}&status=document.production`;
        const partitionUrl = `https://www.geoportail-urbanisme.gouv.fr/api/document?partition=DU_${insee}&status=document.production`;
        
        const [gridRes, partRes] = await Promise.all([
          fetch(gridUrl),
          fetch(partitionUrl)
        ]);

        const gridData = gridRes.ok ? await gridRes.json() : [];
        const partData = partRes.ok ? await partRes.json() : [];

        // Merge results and remove duplicates by ID
        const allDocs = [...(Array.isArray(gridData) ? gridData : []), ...(Array.isArray(partData) ? partData : [])];
        const uniqueDocsMap = new Map();
        allDocs.forEach(doc => {
          if (doc && doc.id) uniqueDocsMap.set(doc.id, doc);
        });
        
        const docs = Array.from(uniqueDocsMap.values());

        if (docs.length === 0) {
          setDocuments([]);
          return;
        }

        // 2. Fetch details for each document
        const detailedDocs = await Promise.all(
          docs.slice(0, 5).map(async (doc) => {
            try {
              const detailsRes = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document/${doc.id}/details`);
              if (!detailsRes.ok) return { ...doc };
              const details = await detailsRes.json();
              
              // Map writingMaterials to files if available
              const files = details.writingMaterials 
                ? Object.entries(details.writingMaterials).map(([name, url]) => ({ name, url: url as string }))
                : [];

              return { ...doc, ...details, files };
            } catch (e) {
              return { ...doc };
            }
          })
        );

        setDocuments(detailedDocs);
      } catch (err: any) {
        console.error('GPU API error:', err);
        setError('Could not retrieve urban planning info');
      } finally {
        setLoading(false);
      }
    };

    fetchUrbanPlanning();
  }, [insee]);

  if (!insee) return null;

  return (
    <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] font-bold rounded uppercase tracking-wider">Urbanisme (GPU)</span>
        </div>
        {loading && <IconLoader2 size={14} className="animate-spin text-blue-500" />}
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <IconAlertCircle size={14} />
          <span>{error}</span>
        </div>
      ) : documents.length > 0 ? (
        <div className="space-y-4">
          {documents.map((doc) => (
            <div key={doc.id} className="space-y-2 border-b border-zinc-200 dark:border-zinc-700 pb-3 last:border-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                    <IconFileDescription size={14} className="text-blue-500" />
                    {doc.type} - {doc.name}
                  </h4>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Updated: {new Date(doc.updateDate).toLocaleDateString()}</p>
                </div>
                {doc.archiveUrl && (
                  <a 
                    href={doc.archiveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <IconDownload size={12} />
                    Archive (ZIP)
                  </a>
                )}
              </div>

              {doc.files && doc.files.length > 0 && (
                <div className="grid grid-cols-1 gap-1 mt-2">
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-tight mb-1">Documents principaux :</p>
                  {doc.files?.slice(0, 5).map((file, idx) => (
                    <a 
                      key={idx}
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between group px-2 py-1.5 bg-white dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded hover:border-blue-200 dark:hover:border-blue-800 transition-all"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <IconFileTypePdf size={12} className="text-red-500 shrink-0" />
                        <span className="text-[10px] text-zinc-600 dark:text-zinc-400 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">{file.name}</span>
                      </div>
                      <IconChevronRight size={10} className="text-zinc-300 group-hover:text-blue-400 shrink-0" />
                    </a>
                  ))}
                  {doc.files.length > 5 && (
                    <p className="text-[9px] text-zinc-400 italic mt-1">+{doc.files.length - 5} more files in archive</p>
                  )}
                </div>
              )}
            </div>
          ))}
          <p className="text-[9px] text-zinc-400 bg-zinc-50 dark:bg-zinc-900/50 p-2 rounded border border-zinc-100 dark:border-zinc-800">
            Note: Document availability depends on the commune's publication status on the Géoportail de l'Urbanisme.
          </p>
          <a 
            href={coords ? `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${coords.lon}&lat=${coords.lat}&zoom=16` : `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${insee}&lat=${insee}&zoom=13`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors mt-2"
          >
            <IconExternalLink size={14} />
            Consulter sur le GPU
          </a>
        </div>
      ) : !loading && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-400 italic">No urban planning documents found for this commune ({insee}).</p>
          <a 
            href={coords ? `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${coords.lon}&lat=${coords.lat}&zoom=16` : `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${insee}&lat=${insee}&zoom=13`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-bold transition-colors"
          >
            <IconExternalLink size={14} />
            Search manually on GPU
          </a>
        </div>
      )}
    </div>
  );
}
