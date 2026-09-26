import { useRef, type ReactNode } from 'react';
import { motion, AnimatePresence, animate, useMotionValue, useReducedMotion } from 'motion/react';
import { PANEL_SPRING, FLICK_SPRING, FLICK_VELOCITY, projectMomentum } from '../lib/motion';

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Largeur de `w-72` (18 rem) tant que le tiroir n'a pas encore été mesuré. */
const FALLBACK_WIDTH = 288;

/**
 * Tiroir de navigation mobile, qu'on referme en le repoussant vers la gauche.
 *
 * Le tiroir suit le doigt au pixel près pendant le geste, résiste
 * (effet élastique) si on le tire vers la droite, et au relâché la décision
 * se prend sur le point d'arrivée PROJETÉ du geste plutôt que sur la position
 * du doigt : un geste court mais rapide suffit à le fermer. Le ressort de
 * retour repart de la vitesse du doigt, sans à-coup entre le geste et
 * l'animation.
 *
 * Avec « Réduire les animations », le glissement disparaît au profit d'un
 * fondu, et le geste est désactivé.
 */
export function MobileNavDrawer({ open, onClose, children }: MobileNavDrawerProps) {
  const reduce = useReducedMotion();
  const x = useMotionValue<number | string>(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false);
  const width = () => panelRef.current?.offsetWidth || FALLBACK_WIDTH;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="mobile-nav-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={onClose}
          />
          <motion.div
            key="mobile-nav-drawer"
            ref={panelRef}
            initial={reduce ? { opacity: 0 } : { x: '-100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: -width() }}
            transition={PANEL_SPRING}
            drag={reduce ? false : 'x'}
            dragDirectionLock
            dragConstraints={{ left: -10000, right: 0 }}
            dragElastic={{ left: 0, right: 0.15 }}
            dragMomentum={false}
            onDragStart={() => { draggedRef.current = true; }}
            onDragEnd={(_, info) => {
              const current = Number(x.get()) || 0;
              if (current + projectMomentum(info.velocity.x) < -width() / 2) {
                onClose();
              } else {
                const spring = Math.abs(info.velocity.x) > FLICK_VELOCITY ? FLICK_SPRING : PANEL_SPRING;
                animate(x, 0, { ...spring, velocity: info.velocity.x });
              }
              // Le clic qui suit la fin d'un glissement n'est pas un choix de lien.
              setTimeout(() => { draggedRef.current = false; }, 0);
            }}
            onClickCapture={(e) => {
              if (draggedRef.current) { e.preventDefault(); e.stopPropagation(); }
            }}
            className="fixed inset-y-0 left-0 z-50 w-72 md:hidden flex flex-col overflow-y-auto overscroll-contain"
            style={{ x, background: 'var(--tblr-surface)', borderRight: '1px solid var(--tblr-border)', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingLeft: 'env(safe-area-inset-left, 0px)' }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
