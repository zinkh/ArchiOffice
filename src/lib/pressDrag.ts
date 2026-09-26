/**
 * Démarrage d'un glisser au pointeur, commun au Kanban, au calendrier et au
 * planning. Remplace le glisser-déposer HTML5 natif, qui ne suit pas le doigt
 * (une image figée, ou rien du tout selon le téléphone) et ne laisse aucune
 * prise sur l'animation.
 *
 * - Souris : le glisser commence dès que le pointeur a bougé de quelques
 *   pixels, pour qu'un simple clic reste un clic.
 * - Doigt : il faut un appui d'un court instant pour « soulever » l'élément ;
 *   un doigt qui bouge avant ce délai fait défiler la page normalement.
 * - Une fois soulevé, l'élément suit le pointeur 1:1, la page ne défile plus
 *   sous le doigt, et Échap annule.
 * - Au relâché, la vitesse des 100 dernières millisecondes est rendue, pour
 *   que l'animation d'arrivée reparte de la vitesse du geste.
 */

export const LONG_PRESS_MS = 220;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 4;
const VELOCITY_WINDOW_MS = 100;

export interface PressDragPoint { x: number; y: number }

export interface PressDragHandlers {
  /** L'élément vient d'être soulevé (seuil franchi ou appui long). */
  onLift: (start: PressDragPoint, current: PressDragPoint) => void;
  /** Déplacement après soulèvement. */
  onMove: (current: PressDragPoint) => void;
  /** Fin du geste : `cancelled` pour Échap ou une interruption système. */
  onEnd: (end: PressDragPoint & { vx: number; vy: number; cancelled: boolean }) => void;
}

/** Les contrôles d'un élément déplaçable gardent leur propre comportement. */
const INTERACTIVE = 'input, select, textarea, button, a, [data-no-drag]';

export function startPressDrag(
  e: PointerEvent | { nativeEvent: PointerEvent; currentTarget: EventTarget | null; target: EventTarget | null; button: number },
  handlers: PressDragHandlers,
): void {
  const native = 'nativeEvent' in e ? e.nativeEvent : e;
  if (e.button !== 0) return;
  const host = e.currentTarget as HTMLElement | null;
  const hit = (e.target as HTMLElement | null)?.closest?.(INTERACTIVE);
  if (hit && hit !== host) return;

  const pointerId = native.pointerId;
  const touch = native.pointerType !== 'mouse';
  const start = { x: native.clientX, y: native.clientY };
  let current = { ...start };
  let lifted = false;
  let timer = 0;
  const hist: { t: number; x: number; y: number }[] = [];
  const prevUserSelect = document.body.style.userSelect;

  const record = () => {
    const t = performance.now();
    hist.push({ t, x: current.x, y: current.y });
    while (hist.length > 2 && t - hist[0].t > VELOCITY_WINDOW_MS) hist.shift();
  };

  const lift = () => {
    if (lifted) return;
    lifted = true;
    document.body.style.userSelect = 'none';
    try { navigator.vibrate?.(8); } catch { /* retour haptique facultatif */ }
    handlers.onLift(start, current);
    record();
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    current = { x: ev.clientX, y: ev.clientY };
    if (!lifted) {
      const dist = Math.hypot(current.x - start.x, current.y - start.y);
      if (touch) { if (dist > TOUCH_SLOP) cleanup(); return; }
      if (dist <= MOUSE_SLOP) return;
      lift();
    }
    ev.preventDefault();
    record();
    handlers.onMove(current);
  };

  const finish = (cancelled: boolean) => {
    const wasLifted = lifted;
    cleanup();
    if (!wasLifted) return;
    let vx = 0, vy = 0;
    if (hist.length >= 2) {
      const a = hist[0], b = hist[hist.length - 1], dt = b.t - a.t;
      if (dt > 8 && performance.now() - b.t < 80) { vx = (b.x - a.x) / dt * 1000; vy = (b.y - a.y) / dt * 1000; }
    }
    // Le clic qui suit un glisser n'est pas un clic : il ouvrirait la fiche.
    const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    handlers.onEnd({ ...current, vx, vy, cancelled });
  };

  const onUp = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finish(false); };
  const onCancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finish(true); };
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && lifted) finish(true); };
  // Une fois soulevé, le doigt déplace l'élément au lieu de faire défiler.
  const onTouchMove = (ev: TouchEvent) => { if (lifted) ev.preventDefault(); };
  const onContextMenu = (ev: Event) => ev.preventDefault();

  function cleanup() {
    clearTimeout(timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('contextmenu', onContextMenu);
    document.body.style.userSelect = prevUserSelect;
  }

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  if (touch) {
    window.addEventListener('contextmenu', onContextMenu);
    timer = window.setTimeout(lift, LONG_PRESS_MS);
  }
}
