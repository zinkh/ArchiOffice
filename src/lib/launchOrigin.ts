/**
 * Fait naître une modale depuis l'élément qui l'a ouverte plutôt que depuis
 * son centre : le lien spatial entre le bouton et la fenêtre reste lisible,
 * et la fermeture reprend le même chemin en sens inverse.
 *
 * Le dernier appui (pointerdown) est mémorisé au niveau du document ; au
 * montage, `launchOriginRef` convertit ce point en `transform-origin` relatif
 * à la boîte de la modale. Motion n'écrit `transform-origin` que si l'on
 * anime `originX`/`originY`, donc la valeur posée ici n'est pas écrasée.
 *
 * Deux garde-fous :
 * - un appui trop ancien (ouverture au clavier, par un effet, après un
 *   chargement) laisse l'origine au centre ;
 * - seul un élément posé dans une couche `position: fixed` (le calque d'une
 *   modale) est concerné, pour qu'une liste qui s'anime au chargement d'une
 *   page ne semble pas jaillir du lien de navigation cliqué juste avant.
 */

const MAX_AGE_MS = 800;
const MAX_FIXED_DEPTH = 4;

let lastPress: { x: number; y: number; t: number } | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => { lastPress = { x: e.clientX, y: e.clientY, t: performance.now() }; },
    { capture: true, passive: true },
  );
}

function isInFixedLayer(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  for (let i = 0; node && i <= MAX_FIXED_DEPTH; i++, node = node.parentElement) {
    if (getComputedStyle(node).position === 'fixed') return true;
  }
  return false;
}

export function launchOriginRef(el: HTMLElement | null): void {
  if (!el || !lastPress || performance.now() - lastPress.t > MAX_AGE_MS) return;
  if (!isInFixedLayer(el)) return;
  // getBoundingClientRect inclut l'échelle initiale, appliquée autour du
  // centre : on en déduit la boîte non transformée à partir de ce centre.
  const rect = el.getBoundingClientRect();
  const left = rect.left + rect.width / 2 - el.offsetWidth / 2;
  const top = rect.top + rect.height / 2 - el.offsetHeight / 2;
  el.style.transformOrigin = `${lastPress.x - left}px ${lastPress.y - top}px`;
}
