// Mise en page continue d'un document A4 rendu en HTML puis capturé par jsPDF.
//
// jsPDF.html() ne sait pas couper proprement un contenu : une ligne de tableau
// ou un titre à cheval sur deux pages est tranché. Ce module pose donc, AVANT la
// capture, des espaceurs qui repoussent chaque bloc sur la page suivante quand il
// ne tient pas, de sorte que la coupure de jsPDF (tous les 297 mm) tombe toujours
// dans une marge, jamais dans un texte.
//
// Géométrie d'une page : [en-tête | fenêtre de contenu | pied de page]. Le contenu
// ne s'imprime que dans la fenêtre ; les deux bandes sont réservées à l'en-tête
// et au pied (dessinés en HTML par le composant, voir ProposalExportModal).

export const PAGE_HEIGHT_MM = 297;
/** Bande haute réservée à l'en-tête de page. */
export const CONTENT_TOP_MM = 26;
/** Bande basse réservée au pied de page et à la pagination « P1|2 ». */
export const CONTENT_BOTTOM_MM = 20;
/** Place minimale à garder sous un titre : jamais de titre seul en bas de page. */
export const HEADING_KEEP_MM = 24;

const PX_PER_MM = 96 / 25.4;
const EPS_MM = 0.2;

export interface PageGeometry {
  pageHeight: number;
  contentTop: number;
  contentBottom: number;
}

export const DEFAULT_GEOMETRY: PageGeometry = {
  pageHeight: PAGE_HEIGHT_MM,
  contentTop: CONTENT_TOP_MM,
  contentBottom: CONTENT_BOTTOM_MM,
};

export interface ShiftOptions {
  /** Le bloc doit commencer en haut d'une page (début de section). */
  newPage?: boolean;
  /** Hauteur à garder visible sous le haut du bloc (titre + début de ce qui suit). */
  keepExtent?: number;
}

/**
 * Décalage vertical (mm) à appliquer à un bloc pour qu'il ne chevauche ni la
 * coupure de page ni les bandes d'en-tête et de pied. `top` est le haut du bloc
 * en mm depuis le haut du document, `height` sa hauteur. Rend 0 quand il tient.
 *
 * Un bloc plus haut qu'une fenêtre entière ne peut pas tenir : il n'est déplacé
 * que s'il commence dans une bande, sinon il est laissé et coupé par la page.
 */
export function pageShiftMm(
  top: number,
  height: number,
  options: ShiftOptions = {},
  geometry: PageGeometry = DEFAULT_GEOMETRY,
): number {
  const { pageHeight, contentTop, contentBottom } = geometry;
  const page = Math.max(0, Math.floor((top + EPS_MM) / pageHeight));
  const windowTop = page * pageHeight + contentTop;
  const windowBottom = (page + 1) * pageHeight - contentBottom;
  const nextWindowTop = (page + 1) * pageHeight + contentTop;

  if (options.newPage) {
    if (top <= windowTop + EPS_MM) return Math.max(0, windowTop - top);
    return nextWindowTop - top;
  }
  if (top < windowTop - EPS_MM) return windowTop - top;
  if (top >= windowBottom - EPS_MM) return nextWindowTop - top;

  const extent = Math.max(height, options.keepExtent ?? 0);
  const windowHeight = windowBottom - windowTop;
  if (top + extent > windowBottom + EPS_MM && extent <= windowHeight) return nextWindowTop - top;
  return 0;
}

/** Nombre de pages occupées par un document de cette hauteur (mm). */
export function pageCountForHeight(heightMm: number, pageHeight = PAGE_HEIGHT_MM): number {
  return Math.max(1, Math.ceil((heightMm - EPS_MM) / pageHeight));
}

// ── Partie DOM ───────────────────────────────────────────────────────────────

const SPACER_ATTR = 'data-pdf-spacer';
/**
 * Blocs qu'on ne coupe pas : tout élément marqué `data-pdf-keep`, les titres
 * (`data-pdf-heading`), les débuts de section (`data-pdf-newpage`) et les lignes
 * de tableau. Les lignes d'un bloc `data-pdf-keep` ne sont pas traitées une à une.
 */
const UNIT_SELECTOR = '[data-pdf-keep], [data-pdf-heading], [data-pdf-newpage], tbody > tr, tfoot > tr';

const toMm = (px: number): number => px / PX_PER_MM;

function removeSpacers(flow: HTMLElement): void {
  flow.querySelectorAll(`[${SPACER_ATTR}]`).forEach(node => node.remove());
}

function columnCount(table: HTMLTableElement): number {
  const first = table.rows[0];
  if (!first) return 1;
  return Math.max(1, Array.from(first.cells).reduce((sum, cell) => sum + (cell.colSpan || 1), 0));
}

function blockSpacer(marginTopPx: number): HTMLElement {
  const spacer = document.createElement('div');
  spacer.setAttribute(SPACER_ATTR, 'true');
  // La marge négative annule la marge haute du bloc suivant : il se pose en haut
  // de la fenêtre, sans le blanc qu'il garde au milieu d'une page.
  spacer.style.cssText = `height:0;margin:0 0 -${marginTopPx}px;padding:0;border:0;`;
  return spacer;
}

function rowSpacer(table: HTMLTableElement): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.setAttribute(SPACER_ATTR, 'true');
  const cell = document.createElement('td');
  cell.colSpan = columnCount(table);
  cell.style.cssText = 'height:0;padding:0;border:0;line-height:0;font-size:0;';
  row.appendChild(cell);
  return row;
}

/**
 * Règle la hauteur d'un espaceur (déjà inséré avant `block`) pour que `block`
 * se retrouve à `targetMm` du haut du document.
 *
 * Avec 1 px de hauteur l'espaceur sort du régime où les marges se confondent : la
 * hauteur à ajouter est alors linéaire, une seule mesure suffit.
 */
function settleSpacer(
  flow: HTMLElement,
  block: HTMLElement,
  targetMm: number,
  setHeight: (px: number) => void,
): void {
  setHeight(1);
  const currentMm = toMm(block.getBoundingClientRect().top - flow.getBoundingClientRect().top);
  setHeight(1 + Math.max(0, (targetMm - currentMm) * PX_PER_MM));
}

/**
 * Pagine le document : repousse sur la page suivante les blocs qui ne tiennent
 * pas, répète l'en-tête d'un tableau coupé, et fixe la hauteur du document à un
 * nombre entier de pages. Rend ce nombre de pages. Idempotent : les espaceurs
 * précédents sont retirés avant de recalculer.
 *
 * À rappeler dès que le contenu ou sa mise en forme change (le composant le fait
 * après chaque rendu), et dans l'export quand il masque des éléments.
 */
export function paginateFlow(flow: HTMLElement, geometry: PageGeometry = DEFAULT_GEOMETRY): number {
  removeSpacers(flow);
  flow.style.height = '';

  // Seul le corps est paginé : la page de garde est une page entière à part.
  const body = flow.querySelector<HTMLElement>('[data-pdf-body]') ?? flow;
  const units = Array.from(body.querySelectorAll<HTMLElement>(UNIT_SELECTOR))
    .filter(el => !el.parentElement?.closest('[data-pdf-keep]'));

  for (const [index, el] of units.entries()) {
    const flowTop = flow.getBoundingClientRect().top;
    const rect = el.getBoundingClientRect();
    const isRow = el.tagName === 'TR';
    const marginTopPx = isRow ? 0 : parseFloat(getComputedStyle(el).marginTop) || 0;
    const top = toMm(rect.top - flowTop - marginTopPx);
    const height = toMm(rect.height + marginTopPx);

    // Un titre ne reste jamais seul en bas de page : il suit le premier bloc de contenu
    // qui vient après lui (un sous-titre ne compte pas, il a besoin du même contenu).
    // Une ligne `data-pdf-keep-next` (titre de groupe dans un tableau) suit sa voisine.
    let keepExtent = el.hasAttribute('data-pdf-heading') ? headingExtentMm(units, index, top, flowTop) : undefined;
    if (el.hasAttribute('data-pdf-keep-next')) {
      const next = el.nextElementSibling;
      keepExtent = height + (next ? toMm(next.getBoundingClientRect().height) : 0);
    }

    const shift = pageShiftMm(top, height, {
      newPage: el.hasAttribute('data-pdf-newpage'),
      keepExtent,
    }, geometry);
    if (shift < 0.05) continue;

    const targetMm = top + shift;
    if (isRow) {
      const table = el.closest('table');
      if (!table) continue;
      const spacerRow = rowSpacer(table);
      const spacerCell = spacerRow.firstElementChild as HTMLElement;
      el.parentElement?.insertBefore(spacerRow, el);
      settleSpacer(flow, el, targetMm, px => { spacerCell.style.height = `${px}px`; });

      // Le tableau continue sur la page suivante : on y répète son en-tête.
      const head = table.tHead;
      if (head && el.parentElement?.tagName !== 'THEAD') {
        let anchor: Node = spacerRow;
        Array.from(head.rows).forEach(headRow => {
          const copy = headRow.cloneNode(true) as HTMLTableRowElement;
          copy.setAttribute(SPACER_ATTR, 'true');
          anchor.parentNode?.insertBefore(copy, anchor.nextSibling);
          anchor = copy;
        });
      }
    } else {
      const spacer = blockSpacer(marginTopPx);
      el.parentElement?.insertBefore(spacer, el);
      settleSpacer(flow, el, targetMm, px => { spacer.style.height = `${px}px`; });
    }
  }

  const pages = pageCountForHeight(contentBottomMm(flow, body), geometry.pageHeight);
  flow.style.height = `${pages * geometry.pageHeight}mm`;
  return pages;
}

/**
 * Hauteur (mm) à garder visible sous le haut d'un titre : jusqu'au bas du premier
 * bloc de contenu qui le suit. Les autres titres et les blocs vides (un graphique
 * masqué à l'export) sont traversés.
 */
function headingExtentMm(units: HTMLElement[], index: number, topMm: number, flowTop: number): number {
  for (let next = index + 1; next < units.length; next++) {
    const unit = units[next];
    if (unit.hasAttribute('data-pdf-heading')) continue;
    const rect = unit.getBoundingClientRect();
    if (rect.height < 1) continue;
    return toMm(rect.bottom - flowTop) - topMm;
  }
  return HEADING_KEEP_MM;
}

/**
 * Bas du dernier contenu, en mm depuis le haut du document. La marge basse du corps
 * n'en fait pas partie : sans cela un contenu qui finit près du bas d'une page
 * ouvrait une page blanche de plus.
 */
function contentBottomMm(flow: HTMLElement, body: HTMLElement): number {
  const flowTop = flow.getBoundingClientRect().top;
  const last = body.lastElementChild;
  // Corps vide (page de garde seule) : le document s'arrête au haut du corps.
  const bottom = last ? last.getBoundingClientRect().bottom : body.getBoundingClientRect().top;
  return toMm(bottom - flowTop);
}
