// Gabarit HTML du dossier de références (rendu PDF par Chromium, voir render.ts).
// Fiche : A4, marges 11 mm (haut/bas) x 12 mm (côtés), fond blanc, Source Sans 3.
// Couleur d'accent unique #b2242a ; ni dégradé ni emoji.
import { sourceSansFontFaces } from './fonts';
import {
  classeNbImages, escapeHtml, nc, pageLabel, sheetTitle, surfaceBudgetLine,
} from './format';
import type { DossierAgency, DossierInput, DossierOrientation, ReferenceSheetData, SheetImage } from './types';

const ACCENT = '#b2242a';
const MAX_IMAGES = 6;
/** Lignes du tableau récapitulatif par page (6 ou 7 mm par ligne, titres compris). */
const ROWS_PER_PAGE: Record<DossierOrientation, number> = { portrait: 24, landscape: 14 };

const CSS = (orientation: DossierOrientation): string => `
@page { size: A4 ${orientation}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'Source Sans 3', Helvetica, Arial, sans-serif; color: #1a1a18; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: ${orientation === 'portrait' ? '210mm' : '297mm'}; height: ${orientation === 'portrait' ? '297mm' : '210mm'};
  padding: 11mm 12mm; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
.page:last-child { page-break-after: auto; break-after: auto; }

.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 8mm; padding-bottom: 3.5mm; border-bottom: 1.2pt solid #000; }
.head h1 { margin: 0; font-size: 13.5pt; line-height: 1.25; font-weight: 700; color: #1a1a18; text-transform: uppercase; letter-spacing: .01em; }
.head .logo { height: 11mm; width: auto; flex: none; display: block; }

.infos { margin: 3mm 0 0; padding: 0; }
.infos .row { display: grid; grid-template-columns: 26mm 1fr; column-gap: 12mm; padding: 1.9mm 0; border-bottom: .5pt solid #ddd9d2; align-items: baseline; }
.infos dt { margin: 0; font-size: 7pt; color: #8a857c; }
.infos dd { margin: 0; font-size: 8pt; line-height: 1.4; color: #1a1a18; }

.images { flex: 1; min-height: 0; margin-top: 5mm; display: grid; gap: 4mm; }
.images figure { margin: 0; min-width: 0; min-height: 0; border: .5pt solid #d6d2ca; overflow: hidden; background: #fff; }
.images img { display: block; width: 100%; height: 100%; object-fit: cover; }
.thumbs { display: grid; gap: 4mm; min-height: 0; }

/* Portrait : une grande image, puis les autres en dessous (gabarit de référence) */
.o-portrait.n1 { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.o-portrait.n2 { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
.o-portrait.n3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1.55fr 1fr; }
.o-portrait.n3 figure:first-child { grid-column: 1 / -1; }
.o-portrait.n4, .o-portrait.n5, .o-portrait.n6 { grid-template-columns: 1fr; }
.o-portrait.n4 { grid-template-rows: 1.55fr 1fr; }
.o-portrait.n5, .o-portrait.n6 { grid-template-rows: 1.55fr 2fr; }
.o-portrait.n4 .thumbs { grid-template-columns: repeat(3, 1fr); grid-template-rows: 1fr; }
.o-portrait.n5 .thumbs { grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, 1fr); }
.o-portrait.n6 .thumbs { grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); }
.o-portrait.n6 .thumbs figure:last-child { grid-column: span 2; }

/* Paysage : deux grandes images (hauteur 1,55), puis une rangée de vignettes */
.o-landscape.n1 { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.o-landscape.n2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; }
.o-landscape.n3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1.55fr 1fr; }
.o-landscape.n3 figure:last-child { grid-column: 1 / -1; }
.o-landscape.n4, .o-landscape.n5, .o-landscape.n6 { grid-template-columns: 1fr 1fr; grid-template-rows: 1.55fr 1fr; }
.o-landscape .thumbs { grid-column: 1 / -1; grid-template-rows: 1fr; }
.o-landscape.n4 .thumbs { grid-template-columns: repeat(2, 1fr); }
.o-landscape.n5 .thumbs { grid-template-columns: repeat(3, 1fr); }
.o-landscape.n6 .thumbs { grid-template-columns: repeat(4, 1fr); }
.images.vide { border: .5pt dashed #d6d2ca; align-items: center; justify-items: center; color: #8a857c; font-size: 8pt; }

.foot { margin-top: 4mm; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; font-size: 6.5pt; text-transform: uppercase; letter-spacing: .06em; color: #8a857c; }
.foot .proj { text-align: left; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.foot .acc { color: ${ACCENT}; font-weight: 600; text-align: center; }
.foot .num { text-align: right; }

/* Couverture */
.cover { padding-bottom: 12mm; }
.cover .brand { display: flex; align-items: flex-start; justify-content: space-between; }
.cover .brand img { height: 18mm; width: auto; display: block; }
.cover .titre { margin: ${orientation === 'portrait' ? '16mm' : '8mm'} 0 0; }
.cover .titre h1 { margin: 0; font-size: ${orientation === 'portrait' ? '40pt' : '34pt'}; line-height: 1; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; }
.cover .titre .filet { width: 22mm; height: 1.2pt; background: ${ACCENT}; margin: 5mm 0 4mm; }
.cover .titre p { margin: 0; font-size: 11pt; color: #1a1a18; }
.cover .titre p.sub { font-size: 8pt; color: #8a857c; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 1mm; }
.mosaique { flex: 1; min-height: 0; margin: 9mm 0 7mm; display: grid; gap: 3mm; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 1fr; }
.mosaique figure { margin: 0; border: .5pt solid #d6d2ca; overflow: hidden; min-height: 0; }
.mosaique img { width: 100%; height: 100%; object-fit: cover; display: block; }
.coords { border-top: 1.2pt solid #000; padding-top: 3mm; font-size: 8pt; line-height: 1.5; display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; }
.coords .nom { font-weight: 700; text-transform: uppercase; }
.coords .leg { color: #8a857c; }

/* Tableau récapitulatif */
table.liste { width: 100%; border-collapse: collapse; margin-top: 4mm; table-layout: fixed; }
table.liste th { text-align: left; font-size: 7pt; font-weight: 600; color: #8a857c; text-transform: uppercase; letter-spacing: .04em; padding: 0 2mm 1.5mm 0; border-bottom: .8pt solid #1a1a18; }
table.liste td { font-size: 8pt; line-height: 1.3; padding: 1.4mm 2mm 1.4mm 0; border-bottom: .5pt solid #ddd9d2; vertical-align: top; overflow: hidden; }
table.liste td.num, table.liste th.num { text-align: right; padding-right: 0; }
table.liste td .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
table.liste td.nom { font-weight: 600; }
.liste-fill { flex: 1; min-height: 0; }
`;

function imgTag(image: SheetImage, alt: string): string {
  return `<img src="${image.dataUrl}" alt="${escapeHtml(alt)}">`;
}

function figures(images: SheetImage[], alt: string): string {
  return images.map(i => `<figure>${imgTag(i, alt)}</figure>`).join('');
}

/** Zone d'images d'une fiche : mise en page selon le nombre d'images (1 à 6) et l'orientation. */
export function imagesBlock(imagesIn: SheetImage[], orientation: DossierOrientation, alt: string): string {
  const images = imagesIn.slice(0, MAX_IMAGES);
  const cls = classeNbImages(images.length);
  if (!cls) return '<div class="images vide">Aucune image</div>';
  const lead = orientation === 'portrait' ? 1 : 2;
  // `.thumbs` n'existe qu'à partir de 4 images ; en dessous, les figures s'insèrent directement dans la grille.
  const withThumbs = images.length >= 4;
  const inner = withThumbs
    ? `${figures(images.slice(0, lead), alt)}<div class="thumbs">${figures(images.slice(lead), alt)}</div>`
    : figures(images, alt);
  return `<div class="images ${cls} o-${orientation}">${inner}</div>`;
}

function infoRow(label: string, value: string): string {
  return `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function footer(project: string, acronym: string, page: number, total: number): string {
  return `<footer class="foot"><span class="proj">${escapeHtml(project)}</span><span class="acc">${escapeHtml(acronym)}</span><span class="num">${pageLabel(page, total)}</span></footer>`;
}

function logoTag(agency: DossierAgency): string {
  return agency.logoDataUrl ? `<img class="logo" src="${agency.logoDataUrl}" alt="${escapeHtml(agency.name)}">` : '';
}

export function ficheHtml(r: ReferenceSheetData, agency: DossierAgency, orientation: DossierOrientation, page: number, total: number): string {
  const rows = [
    infoRow('Programme', nc(r.programme)),
    infoRow('Labels / distinctions', nc(r.labels)),
    infoRow('Maître d’ouvrage', nc(r.maitreOuvrage)),
    infoRow('Maître d’œuvre', nc(r.maitreOeuvre)),
    infoRow('Mission', nc(r.mission)),
    infoRow('Phase', nc(r.phase)),
    infoRow('Surface / Budget', surfaceBudgetLine(r)),
  ].join('');
  return `<section class="page fiche">
<header class="head"><h1>${escapeHtml(sheetTitle(r))}</h1>${logoTag(agency)}</header>
<dl class="infos">${rows}</dl>
${imagesBlock(r.images, orientation, r.name)}
${footer(r.name, agency.acronym, page, total)}
</section>`;
}

function coverHtml(input: DossierInput): string {
  const { agency, references, orientation } = input;
  const mosaicCount = orientation === 'portrait' ? 6 : 6;
  const photos = references.map(r => r.images[0]).filter((i): i is SheetImage => !!i).slice(0, mosaicCount);
  const mosaic = photos.length
    ? `<div class="mosaique">${photos.map(p => `<figure>${imgTag(p, 'Réalisation')}</figure>`).join('')}</div>`
    : '<div class="mosaique" style="border:.5pt dashed #d6d2ca"></div>';
  const legal = [
    agency.siret ? `SIRET ${agency.siret}` : '',
    agency.oaNumber ? `OA ${agency.oaNumber}` : '',
    agency.vatNumber ? `TVA ${agency.vatNumber}` : '',
  ].filter(Boolean).join(' · ');
  const contact = [agency.phone ? `Tél : ${agency.phone}` : '', agency.email ?? ''].filter(Boolean).join(' · ');
  return `<section class="page cover">
<div class="brand">${agency.logoDataUrl ? `<img src="${agency.logoDataUrl}" alt="${escapeHtml(agency.name)}">` : `<strong>${escapeHtml(agency.name)}</strong>`}</div>
<div class="titre"><h1>Références</h1><div class="filet"></div>${agency.manager ? `<p class="sub">Gérant</p><p>${escapeHtml(agency.manager)}</p>` : ''}</div>
${mosaic}
<div class="coords">
<div><div class="nom">${escapeHtml(agency.name)}</div>${agency.address ? `<div>${escapeHtml(agency.address)}</div>` : ''}</div>
<div>${contact ? `<div>${escapeHtml(contact)}</div>` : ''}${legal ? `<div class="leg">${escapeHtml(legal)}</div>` : ''}</div>
</div>
</section>`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const LIST_COLUMNS: Array<{ label: string; width: string; num?: boolean }> = [
  { label: 'Projet', width: '30%' },
  { label: 'Ville', width: '16%' },
  { label: 'Maître d’ouvrage', width: '20%' },
  { label: 'Mission', width: '16%' },
  { label: 'Année', width: '7%', num: true },
  { label: 'Montant', width: '11%', num: true },
];

function amountCell(r: ReferenceSheetData): string {
  if (r.amount !== null) return `${Math.round(r.amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} € HT`;
  return nc(null);
}

function listPageHtml(rows: ReferenceSheetData[], agency: DossierAgency, orientation: DossierOrientation, page: number, total: number, first: boolean): string {
  const head = LIST_COLUMNS.map(c => `<th class="${c.num ? 'num' : ''}" style="width:${c.width}">${c.label}</th>`).join('');
  const body = rows.map(r => {
    const city = r.city ? (r.department ? `${r.city} (${r.department})` : r.city) : null;
    return `<tr><td class="nom"><div class="clamp">${escapeHtml(r.name)}</div></td><td><div class="clamp">${escapeHtml(nc(city))}</div></td><td><div class="clamp">${escapeHtml(nc(r.maitreOuvrage))}</div></td><td><div class="clamp">${escapeHtml(nc(r.mission))}</div></td><td class="num">${escapeHtml(nc(r.year))}</td><td class="num">${escapeHtml(amountCell(r))}</td></tr>`;
  }).join('');
  return `<section class="page liste-page">
<header class="head"><h1>${first ? 'Liste des références' : 'Liste des références (suite)'}</h1>${logoTag(agency)}</header>
<table class="liste"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<div class="liste-fill"></div>
${footer('Références', agency.acronym, page, total)}
</section>`;
}

export function buildDossierHtml(input: DossierInput): string {
  const { agency, references, orientation } = input;
  const includeCover = input.includeCover !== false;
  const includeList = input.includeList !== false;
  const listChunks = includeList ? chunk(references, ROWS_PER_PAGE[orientation]) : [];
  const total = (includeCover ? 1 : 0) + listChunks.length + references.length;
  let page = includeCover ? 1 : 0;

  const parts: string[] = [];
  if (includeCover) parts.push(coverHtml(input));
  listChunks.forEach((rows, i) => { page += 1; parts.push(listPageHtml(rows, agency, orientation, page, total, i === 0)); });
  for (const r of references) { page += 1; parts.push(ficheHtml(r, agency, orientation, page, total)); }

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Références ${escapeHtml(agency.name)}</title>
<style>${sourceSansFontFaces()}${CSS(orientation)}</style></head><body>${parts.join('\n')}</body></html>`;
}
