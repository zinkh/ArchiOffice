import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { IconPlus, IconX, IconCheck, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { cn } from '../lib/utils';

// Set up worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Marker {
  id: string;
  x: number;
  y: number;
  number?: number;
  title?: string;
}

interface PlanAnnotatorProps {
  fileUrl: string;
  markers: Marker[];
  onAddMarker: (x: number, y: number) => void;
  onSelectMarker?: (id: string) => void;
  isAddingMode?: boolean;
}

export const PlanAnnotator: React.FC<PlanAnnotatorProps> = ({ 
  fileUrl, 
  markers, 
  onAddMarker, 
  onSelectMarker,
  isAddingMode = false
}) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const containerRef = useRef<HTMLDivElement>(null);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!isAddingMode || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    onAddMarker(x, y);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-100 dark:bg-zinc-950 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button 
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber(prev => prev - 1)}
              className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded disabled:opacity-30"
            >
              <IconChevronLeft size={18} />
            </button>
            <span className="text-xs font-medium">
              Page {pageNumber} sur {numPages || '?'}
            </span>
            <button 
              disabled={pageNumber >= (numPages || 1)}
              onClick={() => setPageNumber(prev => prev + 1)}
              className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded disabled:opacity-30"
            >
              <IconChevronRight size={18} />
            </button>
          </div>
          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex items-center gap-2">
            <button onClick={() => setScale(prev => Math.max(0.5, prev - 0.1))} className="text-xs px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">-</button>
            <span className="text-xs font-medium">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale(prev => Math.min(3, prev + 0.1))} className="text-xs px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">+</button>
          </div>
        </div>
        {isAddingMode && (
          <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-bold uppercase tracking-wider animate-pulse">
            Mode Annotation Actif - Cliquez sur le plan
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-8 flex justify-center items-start relative bg-zinc-200 dark:bg-zinc-900/50">
        <div 
          ref={containerRef}
          className="relative shadow-2xl bg-white dark:bg-zinc-900"
          onClick={handleCanvasClick}
          style={{ cursor: isAddingMode ? 'crosshair' : 'default' }}
        >
          <Document
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={<div className="p-20 text-zinc-500 italic">Chargement du plan...</div>}
            error={<div className="p-20 text-red-500 italic">Erreur lors du chargement du plan.</div>}
          >
            <Page 
              pageNumber={pageNumber} 
              scale={scale} 
              renderAnnotationLayer={false}
              renderTextLayer={false}
            />
          </Document>

          {/* Markers */}
          {markers.map((marker) => (
            <div
              key={marker.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectMarker?.(marker.id);
              }}
              className={cn(
                "absolute w-6 h-6 -ml-3 -mt-3 rounded-full flex items-center justify-center text-[10px] font-bold shadow-lg cursor-pointer transition-transform hover:scale-110",
                "bg-red-600 text-white border-2 border-white"
              )}
              style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
              title={marker.title}
            >
              {marker.number || '?'}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
