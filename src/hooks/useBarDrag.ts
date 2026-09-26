import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { animate, motionValue, useReducedMotion, type MotionValue } from 'motion/react';
import { startPressDrag } from '../lib/pressDrag';
import { PANEL_SPRING } from '../lib/motion';

const LIFT_SHADOW = '0 8px 18px rgba(0,0,0,.22), 0 2px 4px rgba(0,0,0,.12)';

/**
 * Décaler une barre de planning dans le temps en la faisant glisser.
 *
 * La barre suit le pointeur 1:1 à l'horizontale pendant le geste, et
 * l'appelant affiche le décalage en cours (`drag.steps`, en jours). Au
 * relâché, elle se cale sur le jour le plus proche par un ressort qui repart
 * de la vitesse du geste, puis `onCommit` enregistre le décalage. Échap, ou
 * un relâché sans décalage, la ramène à sa place.
 *
 * La barre doit être positionnée par `left`/`width` (le style React) et non
 * par `transform`, que ce hook utilise pendant le geste. Son parent direct
 * est la ligne du planning : sa largeur divisée par `stepCount` donne la
 * largeur d'un jour.
 */
export function useBarDrag({ onCommit }: { onCommit: (id: string, steps: number) => void }) {
  const reduce = useReducedMotion();
  const [drag, setDrag] = useState<{ id: string; steps: number } | null>(null);
  const latest = useRef({ onCommit, reduce });
  latest.current = { onCommit, reduce };
  const active = useRef(false);

  const barProps = (id: string, stepCount: number) => ({
    'data-drag-id': id,
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (active.current) return;
      const el = e.currentTarget;
      const stepPx = () => (el.parentElement?.clientWidth || 0) / Math.max(1, stepCount);
      const saved = { transform: el.style.transform, boxShadow: el.style.boxShadow, zIndex: el.style.zIndex, cursor: el.style.cursor };
      let x: MotionValue<number> | null = null;
      let originX = 0;

      startPressDrag(e, {
        onLift: (start, current) => {
          active.current = true;
          originX = start.x;
          const mv = motionValue(current.x - start.x);
          x = mv;
          mv.on('change', v => {
            el.style.transform = `translateX(${v}px)`;
            const px = stepPx();
            const steps = px ? Math.round(v / px) : 0;
            setDrag(d => (d && d.steps !== steps ? { ...d, steps } : d));
          });
          el.style.transform = `translateX(${mv.get()}px)`;
          Object.assign(el.style, { boxShadow: LIFT_SHADOW, zIndex: '20', cursor: 'grabbing' });
          setDrag({ id, steps: 0 });
        },
        onMove: (p) => { x?.set(p.x - originX); },
        onEnd: ({ vx, cancelled }) => {
          const mv = x; if (!mv) return;
          const px = stepPx();
          const steps = cancelled || !px ? 0 : Math.round(mv.get() / px);
          const finish = () => {
            // La barre prend sa nouvelle position (left) dans le même rendu
            // que celui où elle perd son décalage (transform) : pas de saut.
            flushSync(() => {
              if (steps) latest.current.onCommit(id, steps);
              setDrag(null);
            });
            Object.assign(el.style, saved);
            active.current = false;
          };
          if (latest.current.reduce) { finish(); return; }
          animate(mv, steps * px, { ...PANEL_SPRING, velocity: vx }).then(finish, finish);
        },
      });
    },
  });

  return { drag, barProps };
}
