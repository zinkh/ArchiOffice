import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * Remplace un libellé par un autre en fondu enchaîné (« Enregistrer » puis
 * « Enregistrement... » puis « Enregistré ») au lieu d'une substitution
 * sèche. Court et sans rebond : c'est un retour d'état, pas une fête.
 *
 * Le libellé sortant est retiré du flux pendant son fondu (`popLayout`) :
 * le parent doit être `position: relative`.
 */
export function SwapText({ swapKey, children, className }: { swapKey: string; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={swapKey}
        className={className ?? 'inline-flex items-center gap-1.5'}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}
