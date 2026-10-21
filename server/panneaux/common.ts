// Briques communes aux gabarits de panneau : coque HTML et en-tête.
// Charte du cabinet : noir, blanc, nuances de gris, filet. Un panneau d'affichage
// n'a ni coordonnées de l'agence en pied ni pagination (une seule page, vue de loin).
import { escapeHtml } from '../referencesDossier/format';
import { sourceSansFontFaces } from '../referencesDossier/fonts';
import type { DossierAgency } from '../referencesDossier/types';
import type { PageSpec } from './pageSpec';

export { escapeHtml };

export function brandHtml(agency: DossierAgency): string {
  if (agency.logoDataUrl) return `<img class="brand-logo" src="${agency.logoDataUrl}" alt="${escapeHtml(agency.name)}">`;
  return `<div class="brand"><b>${escapeHtml(agency.acronym)}</b>${escapeHtml(agency.name)}</div>`;
}

export function headerHtml(agency: DossierAgency, rightLabel: string): string {
  return `<header class="head">${brandHtml(agency)}<div class="sign">${escapeHtml(rightLabel)}</div></header>`;
}

/** CSS commun : page à la taille de base, mise à l'échelle par `zoom`, zone `.body` bornée entre l'en-tête et le pied. */
export function baseCss(spec: PageSpec, bottomMm?: number): string {
  const landscape = spec.orientation === 'paysage';
  const bodyTop = landscape ? 62 : 78;
  const bodyBottom = bottomMm ?? (landscape ? 30 : 38);
  return `
@page{size:${spec.widthMm}mm ${spec.heightMm}mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html{zoom:${spec.zoom};}
html,body{background:#fff}
body{font-family:'Source Sans 3',Helvetica,Arial,sans-serif;color:#111;width:${spec.baseWidthMm}mm;height:${spec.baseHeightMm}mm;overflow:hidden}
.page{position:relative;width:${spec.baseWidthMm}mm;height:${spec.baseHeightMm}mm;overflow:hidden;page-break-after:avoid}
.head{position:absolute;left:38mm;right:38mm;top:${landscape ? 24 : 34}mm;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.2mm solid #111;padding-bottom:${landscape ? 6 : 9}mm}
.brand{font-size:${landscape ? 22 : 28}pt;line-height:1.15;letter-spacing:.04em}
.brand b{font-size:${landscape ? 36 : 46}pt;letter-spacing:.14em;display:block}
.brand-logo{height:${landscape ? 22 : 30}mm;max-width:150mm;object-fit:contain}
.sign{font-size:${landscape ? 22 : 26}pt;text-transform:uppercase;letter-spacing:.16em;text-align:right;font-weight:700;padding-top:4mm}
.body{position:absolute;left:38mm;right:38mm;top:${bodyTop}mm;bottom:${bodyBottom}mm;overflow:hidden}
`;
}

export function htmlShell(title: string, spec: PageSpec, css: string, inner: string, bottomMm?: number): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${sourceSansFontFaces()}${baseCss(spec, bottomMm)}${css}</style></head><body><div class="page">${inner}</div></body></html>`;
}
