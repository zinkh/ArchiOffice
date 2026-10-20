// Briques communes aux gabarits de panneau : coque HTML, en-tête, pied de page.
// Même charte que les exports du cabinet : noir, blanc, nuances de gris, filet,
// coordonnées de l'agence en pied et pagination « P1|1 » en bas à droite.
import { escapeHtml } from '../referencesDossier/format';
import { sourceSansFontFaces } from '../referencesDossier/fonts';
import type { DossierAgency } from '../referencesDossier/types';
import type { PageSpec } from './pageSpec';

export { escapeHtml };

export function formatPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return /^0\d{9}$/.test(digits) ? digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim() : phone;
}

export function brandHtml(agency: DossierAgency): string {
  if (agency.logoDataUrl) return `<img class="brand-logo" src="${agency.logoDataUrl}" alt="${escapeHtml(agency.name)}">`;
  return `<div class="brand"><b>${escapeHtml(agency.acronym)}</b>${escapeHtml(agency.name)}</div>`;
}

export function headerHtml(agency: DossierAgency, rightLabel: string): string {
  return `<header class="head">${brandHtml(agency)}<div class="sign">${escapeHtml(rightLabel)}</div></header>`;
}

export function footerHtml(agency: DossierAgency, pageLabel = 'P1|1'): string {
  const contact = [agency.address, formatPhone(agency.phone) ? `Tél : ${formatPhone(agency.phone)}` : null, agency.email].filter(Boolean).join(' · ');
  const legal = [
    agency.siret ? `SIRET ${agency.siret}` : null,
    agency.oaNumber ? `OA : ${agency.oaNumber}` : null,
    agency.vatNumber ? `TVA : ${agency.vatNumber}` : null,
  ].filter(Boolean).join(' · ');
  return `<footer class="foot"><div><b>${escapeHtml(agency.name.toUpperCase())}</b>${contact ? `<br>${escapeHtml(contact)}` : ''}${legal ? `<br>${escapeHtml(legal)}` : ''}</div><div class="pn">${escapeHtml(pageLabel)}</div></footer>`;
}

/** CSS commun : page à la taille de base, mise à l'échelle par `zoom`, zone `.body` bornée entre l'en-tête et le pied. */
export function baseCss(spec: PageSpec): string {
  const landscape = spec.orientation === 'paysage';
  const bodyTop = landscape ? 62 : 78;
  const bodyBottom = landscape ? 66 : 82;
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
.foot{position:absolute;left:38mm;right:38mm;bottom:${landscape ? 16 : 22}mm;border-top:1.2mm solid #111;padding-top:6mm;display:flex;justify-content:space-between;align-items:flex-end;font-size:${landscape ? 16 : 19}pt;color:#222;line-height:1.5}
.foot b{font-size:${landscape ? 18 : 21}pt}
.pn{font-size:30pt;font-weight:700}
`;
}

export function htmlShell(title: string, spec: PageSpec, css: string, inner: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${sourceSansFontFaces()}${baseCss(spec)}${css}</style></head><body><div class="page">${inner}</div></body></html>`;
}
