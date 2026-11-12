// Classes Tailwind partagées par les pièces de l'éditeur de croquis.
// Interface en noir et nuances de gris : seules les pastilles de couleur du
// trait portent de la couleur (donnée du dessin, pas décor).

/** Barre flottante (haut gauche, haut droite, outils en bas). */
export const BAR =
  'absolute flex items-center gap-0.5 rounded-xl border border-neutral-200 bg-neutral-50 p-1 shadow-md';

/** Bouton icône : cible de 44 px au doigt, noir quand il est actif. */
export const ICON_BTN =
  'grid h-11 w-11 shrink-0 place-items-center rounded-lg text-neutral-900 hover:bg-neutral-200/70 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ' +
  'aria-pressed:bg-neutral-900 aria-pressed:text-white disabled:cursor-default disabled:text-neutral-400 disabled:hover:bg-transparent';

/** Bouton texte de la barre du haut (Fond, Style). */
export const TEXT_BTN =
  'h-11 rounded-lg px-3 text-sm font-medium text-neutral-900 hover:bg-neutral-200/70 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ' +
  'aria-expanded:bg-neutral-900 aria-expanded:text-white';

export const SEPARATOR = 'mx-1 h-6 w-px shrink-0 bg-neutral-300';

/** Panneau déroulant sous la barre du haut. */
export const PANEL =
  'absolute left-2.5 top-16 flex max-h-[calc(100%-9.5rem)] w-[min(292px,calc(100%-1.25rem))] flex-col gap-3 overflow-y-auto ' +
  'rounded-xl border border-neutral-200 bg-neutral-50 p-3 shadow-md';

export const LABEL = 'flex justify-between text-[11px] font-medium uppercase tracking-wider text-neutral-500';

/** Groupe de choix exclusifs (trait, épaisseur, remplissage). */
export const SEGMENT = 'flex gap-0.5 rounded-lg bg-neutral-200/70 p-0.5';
export const SEGMENT_BTN =
  'h-9 flex-1 whitespace-nowrap rounded-md px-1 text-[13px] text-neutral-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900 ' +
  'aria-pressed:bg-white aria-pressed:font-medium aria-pressed:shadow-[0_0_0_1px_#dcdcd8]';

export const FULL_BTN =
  'h-11 w-full rounded-lg border border-neutral-300 bg-white text-sm font-medium text-neutral-900 hover:border-neutral-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900';

export const CHIP =
  'h-9 rounded-full border border-neutral-300 bg-white px-3 text-[12.5px] text-neutral-900 hover:border-neutral-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900';
