import { useRef, type TouchEvent } from 'react';

interface Options {
  onPrev: () => void;
  onNext: () => void;
  /** Désactive le geste (ex. pendant un glisser-déposer). */
  disabled?: boolean;
}

const MIN_DISTANCE = 60;

/**
 * Balayage horizontal au doigt : vers la gauche = période suivante, vers la
 * droite = période précédente. Un geste plutôt vertical (défilement) ou trop
 * court est ignoré. À la souris, rien ne change : les boutons restent la
 * navigation du poste de bureau.
 */
export function useSwipeNav({ onPrev, onNext, disabled }: Options) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: TouchEvent) => {
      if (disabled || e.touches.length !== 1) { start.current = null; return; }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || disabled) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onNext(); else onPrev();
    },
    onTouchCancel: () => { start.current = null; },
  };
}
