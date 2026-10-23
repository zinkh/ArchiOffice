import { useRef, useState } from 'react';
import type React from 'react';

function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Glisser-déposer de fichiers image sur une zone. Sans `preventDefault` sur `dragover`
 * le navigateur refuse le dépôt (et ouvre l'image dans l'onglet) : c'est ce qui manquait.
 * Le compteur d'entrées évite le clignotement quand le pointeur passe sur un enfant.
 */
export function useImageDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);

  const dropProps = enabled
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth.current += 1;
          setIsOver(true);
        },
        onDragOver: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setIsOver(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth.current = 0;
          setIsOver(false);
          const images = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
          if (images.length) onFiles(images);
        },
      }
    : {};
  return { isOver: enabled && isOver, dropProps };
}
