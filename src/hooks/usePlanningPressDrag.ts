import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import { startPressDrag, type PressDragHandlers } from '../lib/pressDrag';

/** Une seule session ; interruption au changement d'affaire et au démontage. */
export function usePlanningPressDrag(scope: string) {
  const annuler = useRef<(() => void) | null>(null);
  useEffect(() => () => { annuler.current?.(); annuler.current = null; }, [scope]);
  return useCallback((event: PointerEvent<HTMLElement>, handlers: PressDragHandlers) => {
    annuler.current?.();
    annuler.current = startPressDrag(event, handlers);
  }, []);
}
