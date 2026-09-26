import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { animate, motionValue, useReducedMotion, type MotionValue } from 'motion/react';
import { startPressDrag } from '../lib/pressDrag';
import { DEFAULT_SPRING, FLICK_SPRING, FLICK_VELOCITY, PANEL_SPRING, projectMomentum } from '../lib/motion';

/**
 * Glisser un élément d'une zone à une autre (une tâche d'une colonne du
 * Kanban à l'autre, un événement d'un jour à l'autre du calendrier).
 *
 * Pendant le geste, une copie de l'élément (« soulevée » : ombre, léger
 * agrandissement) suit le pointeur 1:1 depuis le point où on l'a saisie,
 * tandis que l'original reste à sa place, estompé par l'appelant via
 * `drag.id`. Au relâché, l'appelant déplace la donnée (`onDrop`, qui doit
 * mettre à jour son état de façon optimiste et synchrone) puis la copie
 * rejoint la nouvelle place de l'élément en gardant la vitesse du geste.
 * Hors d'une zone, ou avec Échap, elle revient à son point de départ.
 *
 * `project` choisit la zone d'arrivée sur le point PROJETÉ du geste plutôt
 * que sur la position du pointeur : une tâche lancée vers la colonne voisine
 * y termine sa course. À réserver aux zones larges (colonnes), pas à une
 * grille serrée comme les jours d'un mois.
 */

export interface DragState<Z extends string> {
  id: string;
  source: Z;
  over: Z | null;
  /** Hauteur de l'élément saisi, pour dessiner un emplacement à sa taille. */
  height: number;
}

interface Options<Z extends string> {
  onDrop: (id: string, zone: Z, source: Z) => void;
  project?: boolean;
  /** Conteneur qui défile tout seul quand le pointeur approche de ses bords. */
  scrollRef?: RefObject<HTMLElement | null>;
}

const PROJECTION_RATE = 0.99;
const NEAR_ZONE_PX = 120;
const EDGE_PX = 48;
const MAX_SCROLL_STEP = 14;
const LIFT_SHADOW = '0 14px 28px rgba(0,0,0,.22), 0 4px 8px rgba(0,0,0,.10)';

interface Flight {
  clone: HTMLElement;
  rect: DOMRect;
  x: MotionValue<number>;
  y: MotionValue<number>;
  s: MotionValue<number>;
  pointer: { x: number; y: number };
  raf: number;
}

export function useDragToZone<Z extends string>({ onDrop, project = false, scrollRef }: Options<Z>) {
  const reduce = useReducedMotion();
  const [drag, setDrag] = useState<DragState<Z> | null>(null);
  const zones = useRef(new Map<Z, HTMLElement>());
  const latest = useRef({ onDrop, project, scrollRef, reduce });
  latest.current = { onDrop, project, scrollRef, reduce };
  const flight = useRef<Flight | null>(null);
  const zoneRefs = useRef(new Map<Z, (el: HTMLElement | null) => void>());

  useEffect(() => () => {
    // Démontage en plein geste : ne pas laisser la copie flotter à l'écran.
    if (flight.current) { cancelAnimationFrame(flight.current.raf); flight.current.clone.remove(); }
  }, []);

  const zoneAt = useCallback((x: number, y: number, near: boolean): Z | null => {
    let best: Z | null = null;
    let bestDist = near ? NEAR_ZONE_PX : 0.5;
    zones.current.forEach((el, zone) => {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < bestDist) { bestDist = d; best = zone; }
    });
    return best;
  }, []);

  const findItem = (id: string): HTMLElement | null => {
    for (const el of zones.current.values()) {
      const hit = el.querySelector<HTMLElement>(`[data-drag-id="${CSS.escape(id)}"]`);
      if (hit) return hit;
    }
    return null;
  };

  const zoneProps = useCallback((zone: Z) => {
    let ref = zoneRefs.current.get(zone);
    if (!ref) {
      ref = (el: HTMLElement | null) => { if (el) zones.current.set(zone, el); else zones.current.delete(zone); };
      zoneRefs.current.set(zone, ref);
    }
    return { ref };
  }, []);

  const itemProps = useCallback((id: string, source: Z, opts: { disabled?: boolean } = {}) => ({
    'data-drag-id': id,
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (opts.disabled || flight.current) return;
      const el = e.currentTarget;
      let origin = { x: 0, y: 0 };
      startPressDrag(e, {
        onLift: (start, current) => {
          origin = start;
          const rect = el.getBoundingClientRect();
          const clone = el.cloneNode(true) as HTMLElement;
          clone.removeAttribute('data-drag-id');
          clone.setAttribute('aria-hidden', 'true');
          clone.removeAttribute('tabindex');
          clone.removeAttribute('id');
          Object.assign(clone.style, {
            position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
            width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
            zIndex: '9999', pointerEvents: 'none', boxShadow: LIFT_SHADOW,
            transition: 'none', opacity: '1', cursor: 'grabbing', willChange: 'transform',
            // L'agrandissement se fait autour du point saisi : l'élément ne
            // glisse pas sous le doigt en se soulevant.
            transformOrigin: `${start.x - rect.left}px ${start.y - rect.top}px`,
          });
          document.body.appendChild(clone);
          const x = motionValue(current.x - start.x);
          const y = motionValue(current.y - start.y);
          const s = motionValue(1);
          const render = () => { clone.style.transform = `translate3d(${x.get()}px, ${y.get()}px, 0) scale(${s.get()})`; };
          x.on('change', render); y.on('change', render); s.on('change', render);
          render();
          if (!latest.current.reduce) animate(s, 1.03, DEFAULT_SPRING);
          const f: Flight = { clone, rect, x, y, s, pointer: current, raf: 0 };
          flight.current = f;

          // Défilement automatique près des bords du conteneur et de la fenêtre.
          const step = (dist: number) => MAX_SCROLL_STEP * (1 - Math.max(0, dist) / EDGE_PX);
          const tick = () => {
            const scroller = latest.current.scrollRef?.current;
            const p = f.pointer;
            if (scroller) {
              const r = scroller.getBoundingClientRect();
              if (p.x < r.left + EDGE_PX) scroller.scrollLeft -= step(p.x - r.left);
              else if (p.x > r.right - EDGE_PX) scroller.scrollLeft += step(r.right - p.x);
              if (p.y < r.top + EDGE_PX) scroller.scrollTop -= step(p.y - r.top);
              else if (p.y > r.bottom - EDGE_PX) scroller.scrollTop += step(r.bottom - p.y);
            }
            if (p.y < EDGE_PX) window.scrollBy(0, -step(p.y));
            else if (p.y > window.innerHeight - EDGE_PX) window.scrollBy(0, step(window.innerHeight - p.y));
            const over = zoneAt(p.x, p.y, false);
            setDrag(d => (d && d.over !== over ? { ...d, over } : d));
            f.raf = requestAnimationFrame(tick);
          };
          f.raf = requestAnimationFrame(tick);
          setDrag({ id, source, over: source, height: rect.height });
        },

        onMove: (p) => {
          const f = flight.current; if (!f) return;
          f.pointer = p;
          f.x.set(p.x - origin.x);
          f.y.set(p.y - origin.y);
        },

        onEnd: ({ x: px, y: py, vx, vy, cancelled }) => {
          const f = flight.current; if (!f) return;
          cancelAnimationFrame(f.raf);
          const { onDrop: drop, project: useProjection, reduce: reduced } = latest.current;

          let zone: Z | null = null;
          if (!cancelled) {
            if (useProjection) {
              zone = zoneAt(px + projectMomentum(vx, PROJECTION_RATE), py + projectMomentum(vy, PROJECTION_RATE), true);
            }
            zone = zone ?? zoneAt(px, py, false);
          }
          const moved = zone !== null && zone !== source;
          // La donnée change de place tout de suite (état optimiste de
          // l'appelant) : la copie peut alors viser la nouvelle position.
          flushSync(() => {
            if (moved) drop(id, zone as Z, source);
            setDrag(null);
          });

          const target = findItem(id);
          const done = () => {
            f.clone.remove();
            if (target) target.style.visibility = '';
            if (flight.current === f) flight.current = null;
          };
          if (reduced) { done(); return; }

          let dest: { left: number; top: number } | null = null;
          if (target) dest = target.getBoundingClientRect();
          else if (moved) {
            // L'élément n'est pas affiché dans sa nouvelle zone (liste
            // tronquée) : la copie s'y pose puis s'efface.
            const r = zones.current.get(zone as Z)?.getBoundingClientRect();
            if (r) dest = { left: r.left + 4, top: r.top + 4 };
          }
          if (!dest) {
            f.clone.style.transition = 'opacity .15s';
            f.clone.style.opacity = '0';
            setTimeout(done, 160);
            return;
          }
          if (target) target.style.visibility = 'hidden';
          const spring = Math.hypot(vx, vy) > FLICK_VELOCITY ? FLICK_SPRING : PANEL_SPRING;
          const fadeOut = !target;
          Promise.all([
            animate(f.x, dest.left - f.rect.left, { ...spring, velocity: vx }),
            animate(f.y, dest.top - f.rect.top, { ...spring, velocity: vy }),
            animate(f.s, fadeOut ? 0.6 : 1, DEFAULT_SPRING),
          ]).then(done, done);
          if (fadeOut) { f.clone.style.transition = 'opacity .25s'; f.clone.style.opacity = '0'; }
        },
      });
    },
  }), [zoneAt]);

  return { drag, itemProps, zoneProps };
}
