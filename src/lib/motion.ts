/**
 * Réglages de mouvement partagés, exprimés comme chez Apple en amortissement
 * et temps de réponse plutôt qu'en durée fixe : un ressort part toujours de
 * la valeur affichée et de la vitesse courantes, donc une animation reste
 * interruptible et réversible à tout instant.
 *
 * `bounce: 0` équivaut à un amortissement de 1 (aucun dépassement) : c'est le
 * réglage par défaut. Un léger rebond n'est justifié que lorsqu'un geste a
 * lancé l'élément (un glissement relâché avec de l'élan).
 */
import type { Transition } from 'motion/react';

/** Ressort par défaut de l'application (modales, menus, apparitions). */
export const DEFAULT_SPRING: Transition = { type: 'spring', bounce: 0, visualDuration: 0.3 };

/** Panneau ou tiroir qui rentre ou sort, sans geste. */
export const PANEL_SPRING: Transition = { type: 'spring', bounce: 0, visualDuration: 0.35 };

/** Panneau relâché avec de l'élan : un léger rebond, porté par le geste. */
export const FLICK_SPRING: Transition = { type: 'spring', bounce: 0.2, visualDuration: 0.35 };

/**
 * Point d'arrivée projeté d'un geste relâché (décélération exponentielle,
 * comme le défilement d'iOS). On choisit la destination à partir de ce point
 * et non de la position au relâchement : un geste court mais rapide suffit
 * alors à fermer un panneau.
 */
export function projectMomentum(velocityPxPerS: number, decelerationRate = 0.998): number {
  return (velocityPxPerS / 1000) * decelerationRate / (1 - decelerationRate);
}

/** Vitesse au-delà de laquelle un relâché compte comme un geste lancé. */
export const FLICK_VELOCITY = 400;
