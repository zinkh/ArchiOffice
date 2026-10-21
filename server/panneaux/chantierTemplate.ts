// Gabarit HTML du panneau de chantier (A0 de référence, portrait ou paysage).
// Fonctions pures, testées : tests/panneauxChantier.test.ts.
import { escapeHtml, headerHtml, htmlShell } from './common';
import { qrSvg } from './qr';
import type { ChantierPanelData, ChantierPanelOptions, PanelLogo, PanelParty } from './types';
import type { PanneauOrientation } from './pageSpec';

/** Colonnes de cartes de lots : s'adaptent au nombre de lots pour que tout tienne sur une page. */
export function lotColumns(count: number, orientation: PanneauOrientation): number {
  if (count <= 27) return 3;
  if (count <= (orientation === 'portrait' ? 48 : 40)) return 4;
  return 5;
}

export function density(columns: number): 'm' | 's' | 'xs' {
  return columns <= 3 ? 'm' : columns === 4 ? 's' : 'xs';
}

function titleClass(title: string): 'l' | 'm' | 's' {
  return title.length <= 40 ? 'l' : title.length <= 80 ? 'm' : 's';
}

function logoImg(logo: PanelLogo | null, show: boolean, cls: string, alt: string): string {
  return show && logo ? `<img class="${cls}" src="${logo.dataUrl}" alt="${escapeHtml(alt)}">` : '';
}

const adr = (lines: string[]) => lines.map(escapeHtml).join('<br>');

function partyCard(p: PanelParty, opts: ChantierPanelOptions): string {
  const showLogo = opts.logos && !opts.hiddenLogos.has(p.key);
  return `<div class="party">${logoImg(p.logo, showLogo, 'plogo', p.name)}<div class="role">${escapeHtml(p.role)}</div><div class="name">${escapeHtml(p.name)}</div>${p.address.length ? `<div class="adr">${adr(p.address)}</div>` : ''}</div>`;
}

function section(title: string, inner: string): string {
  return `<section class="sec"><h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

export function buildChantierHtml(data: ChantierPanelData, opts: ChantierPanelOptions): string {
  const landscape = opts.page.orientation === 'paysage';
  const visible = <T extends { key: string }>(rows: T[]) => rows.filter(r => !opts.hidden.has(r.key));
  const moa = visible(data.maitriseOuvrage);
  const moe = visible(data.maitriseOeuvre);
  const lots = visible(data.lots);
  const title = (opts.title && opts.title.trim()) || data.projectName;
  const cols = lotColumns(lots.length, opts.page.orientation);

  const facts = data.facts.length
    ? `<dl class="facts">${data.facts.map(f => `<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`).join('')}</dl>`
    : '';
  const titleBlock = `<div class="title"><div class="kicker">${escapeHtml(data.kicker)}</div><h1 class="t-${titleClass(title)}">${escapeHtml(title)}</h1>${facts}</div>`;
  const image = data.image ? `<div class="pic"><img src="${data.image.dataUrl}" alt="${escapeHtml(title)}"></div>` : '';
  const hero = `<div class="hero${data.image ? '' : ' nopic'}">${titleBlock}${image}</div>`;

  const moaSection = moa.length ? section('Maîtrise d’ouvrage', `<div class="grid g-moa n${Math.min(moa.length, 3)}">${moa.map(p => partyCard(p, opts)).join('')}</div>`) : '';
  const moeSection = moe.length ? section('Maîtrise d’œuvre et intervenants', `<div class="grid g-moe">${moe.map(p => partyCard(p, opts)).join('')}</div>`) : '';
  const lotCards = lots.map(l => {
    const showLogo = opts.logos && !opts.hiddenLogos.has(l.key);
    const body = l.company
      ? `<div class="name">${escapeHtml(l.company)}</div>${l.address.length ? `<div class="adr">${adr(l.address)}</div>` : ''}`
      : '<div class="tbd">Entreprise à désigner</div>';
    return `<div class="lot"><div class="num">${escapeHtml(l.number)}</div><div class="txt"><div class="trade">${escapeHtml(l.title)}</div>${body}</div>${logoImg(l.logo, showLogo, 'llogo', l.company ?? '')}</div>`;
  }).join('');
  const lotsSection = lots.length ? section('Lots et entreprises', `<div class="grid lots">${lotCards}</div>`) : '';

  const qrBlock = opts.qrUrl
    ? `<div class="qr"><div class="qrtxt"><b>Liste des entreprises intervenant sur le chantier</b>Flashez ce code pour consulter, gratuitement et sans compte, le nom et l’adresse des entreprises présentes sur ce chantier.</div><div class="qrimg">${qrSvg(opts.qrUrl)}</div></div>`
    : '';
  const inner = landscape
    ? `${headerHtml(data.agency, 'Panneau de chantier')}<div class="body ls"><div class="colL">${hero}${moaSection}</div><div class="colR">${moeSection}${lotsSection}</div></div>${qrBlock}`
    : `${headerHtml(data.agency, 'Panneau de chantier')}<div class="body pt">${hero}${moaSection}${moeSection}${lotsSection}</div>${qrBlock}`;

  return htmlShell(`Panneau de chantier ${data.projectName}`, opts.page, chantierCss(opts, cols, density(cols)), inner, opts.qrUrl ? (landscape ? 90 : 120) : undefined);
}

function chantierCss(opts: ChantierPanelOptions, cols: number, dens: 'm' | 's' | 'xs'): string {
  const landscape = opts.page.orientation === 'paysage';
  const lot = {
    m: landscape ? { name: 28, adr: 20, trade: 18, num: 27, box: 29, min: 45 } : { name: 26, adr: 19, trade: 17, num: 25, box: 27, min: 41 },
    s: { name: 21, adr: 15, trade: 13, num: 20, box: 21, min: 30 },
    xs: { name: 18, adr: 13, trade: 12, num: 17, box: 18, min: 26 },
  }[dens];
  const logoH = { m: 22, s: 19, xs: 16 }[dens];
  return `
.body{display:flex;flex-direction:column;gap:${landscape ? 10 : 14}mm}
.body.ls{display:grid;grid-template-columns:${landscape ? 400 : 0}mm 1fr;gap:16mm;align-items:start}
.colL,.colR{display:flex;flex-direction:column;gap:10mm;min-width:0}
.hero{display:grid;grid-template-columns:1fr ${landscape ? '1fr' : '450mm'};border:1.2mm solid #111;${landscape ? 'grid-template-columns:1fr;' : `min-height:${cols >= 4 ? 230 : 300}mm;`}}
.hero.nopic{grid-template-columns:1fr}
.title{padding:${landscape ? '12mm 14mm' : '20mm 18mm'};display:flex;flex-direction:column;gap:8mm;justify-content:center}
.kicker{font-size:${landscape ? 22 : 30}pt;letter-spacing:.22em;text-transform:uppercase;color:#555;font-weight:600}
h1{font-weight:700;letter-spacing:-.01em;line-height:1.04}
h1.t-l{font-size:${landscape ? 64 : 104}pt}h1.t-m{font-size:${landscape ? 52 : 84}pt}h1.t-s{font-size:${landscape ? 42 : 68}pt}
.facts{display:grid;gap:3mm;margin-top:2mm}
.facts dt{font-size:${landscape ? 14 : 19}pt;text-transform:uppercase;letter-spacing:.14em;color:#555;font-weight:700}
.facts dd{font-size:${landscape ? 20 : 26}pt;font-weight:600}
.pic{min-height:0}
.pic img{width:100%;height:100%;object-fit:cover;display:block;${landscape ? 'max-height:250mm;' : ''}}
.sec h2{font-size:${landscape ? 24 : 34}pt;text-transform:uppercase;letter-spacing:.2em;font-weight:700;display:flex;align-items:center;gap:8mm;margin-bottom:${landscape ? 5 : 8}mm}
.sec h2:after{content:"";flex:1;height:1mm;background:#111}
.grid{display:grid;gap:6mm}
.g-moa{grid-template-columns:repeat(${landscape ? 1 : 2},1fr)}
.g-moa.n3{grid-template-columns:repeat(${landscape ? 1 : 3},1fr)}
.g-moe{grid-template-columns:repeat(${landscape ? 3 : 5},1fr)}
.party{border:.8mm solid #111;padding:${landscape ? 6 : 8}mm ${landscape ? 7 : 9}mm;border-radius:3mm;display:flex;flex-direction:column;gap:2mm;min-width:0}
.plogo{height:${landscape ? 16 : 20}mm;max-width:100%;object-fit:contain;object-position:left;margin-bottom:3mm}
.role{font-size:${landscape ? 14 : 20}pt;text-transform:uppercase;letter-spacing:.16em;color:#555;font-weight:700}
.name{font-size:${landscape ? 21 : 30}pt;font-weight:700;line-height:1.15}
.adr{font-size:${landscape ? 15 : 21}pt;line-height:1.3;color:#333}
.lots{grid-template-columns:repeat(${cols},1fr);gap:5mm 6mm}
.lot{display:flex;gap:5mm;border:.6mm solid #999;border-radius:3mm;padding:4mm 5mm;align-items:flex-start;min-height:${lot.min}mm;min-width:0;break-inside:avoid}
.num{flex:0 0 ${lot.box}mm;height:${lot.box}mm;background:#111;color:#fff;font-weight:700;font-size:${lot.num}pt;display:flex;align-items:center;justify-content:center;border-radius:2mm}
.txt{flex:1;min-width:0}
.trade{font-size:${lot.trade}pt;text-transform:uppercase;letter-spacing:.06em;color:#555;font-weight:700;line-height:1.2;margin-bottom:1.5mm}
.lot .name{font-size:${lot.name}pt}.lot .adr{font-size:${lot.adr}pt;margin-top:1mm}
.llogo{flex:0 0 auto;height:${logoH}mm;max-width:${Math.round(logoH * 2.4)}mm;object-fit:contain;align-self:flex-start}
.tbd{font-size:${lot.name - 3}pt;font-style:italic;color:#888;margin-top:1mm}
.qr{position:absolute;right:38mm;bottom:${landscape ? 14 : 20}mm;display:flex;align-items:center;gap:8mm;border-top:1.2mm solid #111;padding-top:6mm;left:38mm;justify-content:flex-end}
.qrtxt{max-width:${landscape ? 330 : 520}mm;text-align:right;font-size:${landscape ? 17 : 22}pt;line-height:1.35;color:#222}
.qrtxt b{display:block;font-size:${landscape ? 20 : 27}pt;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2mm;color:#111}
.qrimg{flex:0 0 auto;width:${landscape ? 60 : 80}mm;height:${landscape ? 60 : 80}mm;border:.6mm solid #111}
.qrimg svg{display:block;width:100%;height:100%}
${opts.colorLogos ? '' : '.plogo,.llogo,.brand-logo{filter:grayscale(1) contrast(1.05)}'}
`;
}
