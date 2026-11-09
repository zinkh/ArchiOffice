import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { resolveSignedUrl } from '../lib/signedStorageUrl';
import { texteSurCouleur } from '../lib/reserveCouleurs';

// Self-hosted worker (bundled by Vite) instead of a public CDN, so the
// annotator keeps working offline (Electron build) and isn't at the mercy
// of unpkg.com availability or version drift with the installed pdfjs-dist.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Marker {
  id: string;
  x: number;
  y: number;
  number?: number;
  title?: string;
  /** `#rrggbb` : couleur du responsable. Sans elle, le repère reste rouge comme avant. */
  couleur?: string;
}

interface PlanAnnotatorProps {
  fileUrl: string;
  markers: Marker[];
  onAddMarker: (x: number, y: number) => void;
  onSelectMarker?: (id: string) => void;
  isAddingMode?: boolean;
  /** Not-yet-saved marker position (e.g. while filling out the "new reserve" form) — rendered distinctly from saved markers. */
  pendingMarker?: { x: number; y: number } | null;
  /** Repère mis en avant (anneau bleu) et ramené au centre de la vue quand il change. */
  selectedMarkerId?: string | null;
  /** Le plan occupe toute la largeur disponible au lieu de sa taille d'origine (le zoom se compose avec). */
  fitWidth?: boolean;
  /** Marges réduites autour du plan : la vue par plan veut chaque pixel. */
  compact?: boolean;
}

export const PlanAnnotator: React.FC<PlanAnnotatorProps> = ({
  fileUrl,
  markers,
  onAddMarker,
  onSelectMarker,
  isAddingMode = false,
  pendingMarker = null,
  selectedMarkerId = null,
  fitWidth = false,
  compact = false,
}) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [imgNaturalWidth, setImgNaturalWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  // Largeur utile de la zone défilante, suivie quand la fenêtre ou le volet change de taille.
  useEffect(() => {
    if (!fitWidth) return;
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitWidth]);
  const marges = compact ? 16 : 64;
  const largeurAjustee = fitWidth && viewportWidth > marges ? Math.floor(viewportWidth - marges) : null;

  // Plan uploads accept any file type (see handlePlanUpload in ProjectDetail),
  // so a "plan" can be a scanned image rather than a PDF — fall back to a
  // plain <img> in that case instead of feeding a non-PDF into react-pdf.
  // Checked against the stable stored reference, not the resolved signed URL
  // (whose token query string doesn't change the file extension it's built
  // from, but there's no reason to wait on the resolve just to know this).
  const isPdf = fileUrl.includes('application/pdf') || /\.pdf(\?|$)/i.test(fileUrl);

  // The `plans` bucket is private — fileUrl is a stable reference, not a
  // directly fetchable URL, so it's exchanged for a short-lived signed URL
  // before being handed to react-pdf/<img>.
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResolvedUrl(null);
    resolveSignedUrl(fileUrl)
      .then((url) => { if (!cancelled) setResolvedUrl(url); })
      .catch((err) => console.error('[PlanAnnotator] Failed to resolve plan URL:', err));
    return () => { cancelled = true; };
  }, [fileUrl]);

  // Ramène le repère sélectionné au centre de la zone défilante. Le défilement est calculé à la main :
  // scrollIntoView ferait aussi défiler la page entière quand le plan est dans un volet.
  useEffect(() => {
    if (!selectedMarkerId) return;
    const zone = scrollRef.current;
    const repere = containerRef.current?.querySelector<HTMLElement>(`[data-marker-id="${selectedMarkerId.replace(/"/g, '\\"')}"]`);
    if (!zone || !repere) return;
    const z = zone.getBoundingClientRect();
    const m = repere.getBoundingClientRect();
    zone.scrollTo({
      left: zone.scrollLeft + (m.left - z.left) - zone.clientWidth / 2 + m.width / 2,
      top: zone.scrollTop + (m.top - z.top) - zone.clientHeight / 2 + m.height / 2,
      behavior: 'smooth',
    });
  }, [selectedMarkerId, numPages, imgNaturalWidth, resolvedUrl, largeurAjustee]);

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
      <div className={cn('border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-900', compact ? 'px-3 py-2' : 'p-4')}>
        <div className="flex items-center gap-4">
          {isPdf && (
            <>
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
            </>
          )}
          <div className="flex items-center gap-2">
            <button onClick={() => setScale(prev => Math.max(0.5, prev - 0.1))} className="text-xs px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">-</button>
            <span className="text-xs font-medium">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale(prev => Math.min(3, prev + 0.1))} className="text-xs px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">+</button>
          </div>
        </div>
        {isAddingMode && (
          <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider animate-pulse">
            Mode Annotation Actif - Cliquez sur le plan
          </div>
        )}
      </div>

      <div ref={scrollRef} className={cn('flex-1 min-h-0 overflow-auto flex items-start relative bg-zinc-200 dark:bg-zinc-900/50', compact ? 'p-2' : 'p-8')}>
        {/* mx-auto plutôt que justify-center : un plan zoomé plus large que la zone reste atteignable à gauche. */}
        <div
          ref={containerRef}
          className="relative mx-auto shrink-0 shadow-2xl bg-white dark:bg-zinc-900"
          onClick={handleCanvasClick}
          style={{ cursor: isAddingMode ? 'crosshair' : 'default' }}
        >
          {!resolvedUrl ? (
            <div className="p-20 text-zinc-500 italic">Chargement du plan...</div>
          ) : isPdf ? (
            <Document
              file={resolvedUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={<div className="p-20 text-zinc-500 italic">Chargement du plan...</div>}
              error={<div className="p-20 text-red-500 italic">Erreur lors du chargement du plan.</div>}
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                width={largeurAjustee ?? undefined}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
            </Document>
          ) : (
            <img
              src={resolvedUrl}
              alt="Plan"
              draggable={false}
              onLoad={(e) => setImgNaturalWidth(e.currentTarget.naturalWidth)}
              style={largeurAjustee ? { width: `${largeurAjustee * scale}px`, maxWidth: 'none' } : imgNaturalWidth ? { width: `${imgNaturalWidth * scale}px` } : undefined}
            />
          )}

          {/* Markers */}
          {markers.map((marker) => {
            const selectionne = marker.id === selectedMarkerId;
            return (
            <div
              key={marker.id}
              data-marker-id={marker.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectMarker?.(marker.id);
              }}
              className={cn(
                "absolute w-6 h-6 -ml-3 -mt-3 rounded-full flex items-center justify-center text-[0.6875rem] font-bold shadow-lg cursor-pointer transition-transform hover:scale-110 border-2 border-white",
                // Un filet sombre garde visible une pastille claire sur le fond blanc d'un plan.
                selectionne ? "z-10 scale-125 ring-4 ring-blue-500" : marker.couleur ? "ring-1 ring-zinc-900/50" : "bg-red-600 text-white",
                selectionne && !marker.couleur && "bg-red-600 text-white"
              )}
              style={{
                left: `${marker.x}%`,
                top: `${marker.y}%`,
                ...(marker.couleur ? { backgroundColor: marker.couleur, color: texteSurCouleur(marker.couleur) } : {}),
              }}
              title={marker.title}
            >
              {marker.number || '?'}
            </div>
            );
          })}

          {pendingMarker && (
            <div
              className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-2 border-dashed border-blue-600 bg-blue-100/70 dark:bg-blue-900/40 animate-pulse pointer-events-none"
              style={{ left: `${pendingMarker.x}%`, top: `${pendingMarker.y}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
