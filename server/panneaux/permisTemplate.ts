// Gabarit HTML du panneau d'affichage d'un permis de construire (ou d'une
// déclaration préalable). Fonctions pures, testées : tests/panneauxPermis.test.ts.
// Deux états : brouillon (champs à compléter en pointillés, bandeau « brouillon »)
// et définitif (aucun bandeau). Un format dont un côté fait 80 cm ou moins n'est
// pas réglementaire : il reçoit un filigrane « aperçu non réglementaire ».
import { escapeHtml, headerHtml, htmlShell } from './common';
import { formatSurface } from '../referencesDossier/format';
import { AFFICHAGE_LISIBLE, DROIT_DE_RECOURS_TEXTE, DROIT_DE_RECOURS_TITRE, TITRES_PERMIS } from './mentionsLegales';
import { isRegulatorySize, type PageSpec } from './pageSpec';
import type { PermisPanelData } from './types';

interface Row { label: string; value: string | null; required: boolean }

function rows(d: PermisPanelData): Row[] {
  const mairie = [d.mairieNom, d.mairieAdresse].filter(Boolean).join(', ') || null;
  const hauteur = d.hauteurM !== null ? `${String(d.hauteurM).replace('.', ',')} m` : null;
  return [
    { label: 'Bénéficiaire', value: d.beneficiaire, required: true },
    { label: 'Architecte auteur du projet', value: d.architecte, required: true },
    { label: d.permitType === 'PC' ? 'Permis n°' : 'Décision n°', value: d.numero, required: true },
    { label: 'Délivré le', value: d.dateDelivrance, required: true },
    { label: 'Nature du projet', value: d.natureProjet, required: true },
    { label: 'Adresse du terrain', value: d.adresseTerrain, required: false },
    { label: 'Superficie du terrain', value: formatSurface(d.superficieTerrainM2), required: true },
    { label: 'Surface de plancher autorisée', value: formatSurface(d.surfacePlancherM2), required: false },
    { label: 'Nombre maximum de logements', value: d.nombreLogements !== null ? String(d.nombreLogements) : null, required: false },
    { label: 'Hauteur de la construction par rapport au sol naturel', value: hauteur, required: false },
    { label: 'Dossier consultable en mairie', value: mairie, required: true },
  ];
}

export function permisWatermarks(d: PermisPanelData, spec: PageSpec): string[] {
  const out: string[] = [];
  if (d.etat === 'brouillon') out.push('Brouillon, à compléter à la délivrance');
  if (!isRegulatorySize(spec.format)) out.push('Aperçu non réglementaire');
  return out;
}

export function buildPermisHtml(d: PermisPanelData, spec: PageSpec): string {
  const landscape = spec.orientation === 'paysage';
  const draft = d.etat === 'brouillon';
  const rendered = rows(d)
    .filter(r => r.value || (draft && r.required))
    .map(r => `<div class="row"><div class="lab">${escapeHtml(r.label)}</div><div class="val">${r.value ? escapeHtml(r.value) : '<span class="blank">………………………………</span>'}</div></div>`)
    .join('');
  const marks = permisWatermarks(d, spec).map(w => `<div class="wm">${escapeHtml(w)}</div>`).join('');

  const inner = `${headerHtml(d.agency, 'Affichage réglementaire')}
<div class="body">
  <div class="top"><div class="kicker">Autorisation d’urbanisme</div><h1>${escapeHtml(TITRES_PERMIS[d.permitType])}</h1></div>
  <div class="rows">${rendered}</div>
  <div class="recours"><div class="rt">${escapeHtml(DROIT_DE_RECOURS_TITRE)}</div><p>${escapeHtml(DROIT_DE_RECOURS_TEXTE)}</p><p class="lisible">${escapeHtml(AFFICHAGE_LISIBLE)}</p></div>
</div>${marks ? `<div class="wmbox">${marks}</div>` : ''}`;

  const css = `
.body{display:flex;flex-direction:column;gap:${landscape ? 8 : 14}mm}
.top{border:1.4mm solid #111;padding:${landscape ? '10mm 16mm' : '16mm 20mm'}}
.kicker{font-size:${landscape ? 22 : 30}pt;letter-spacing:.22em;text-transform:uppercase;color:#555;font-weight:600}
h1{font-size:${landscape ? 100 : 132}pt;font-weight:700;line-height:1.02;letter-spacing:-.01em;margin-top:4mm}
.rows{display:grid;grid-template-columns:${landscape ? '1fr 1fr' : '1fr'};gap:${landscape ? '6mm 14mm' : '11mm'};flex:1;align-content:space-evenly}
.row{border-bottom:.6mm solid #999;padding-bottom:${landscape ? 3 : 7}mm;break-inside:avoid}
.lab{font-size:${landscape ? 20 : 28}pt;text-transform:uppercase;letter-spacing:.14em;color:#555;font-weight:700}
.val{font-size:${landscape ? 44 : 60}pt;font-weight:700;line-height:1.12;margin-top:1.5mm}
.blank{color:#888;font-weight:400;letter-spacing:.1em}
.recours{border:1.2mm solid #111;padding:${landscape ? 6 : 10}mm ${landscape ? 10 : 14}mm;margin-top:auto}
.rt{font-size:${landscape ? 26 : 36}pt;font-weight:700;text-transform:uppercase;letter-spacing:.14em;margin-bottom:3mm}
.recours p{font-size:${landscape ? 22 : 32}pt;line-height:1.3;color:#222}
.recours .lisible{margin-top:3mm;color:#555;font-size:${landscape ? 17 : 24}pt}
.wmbox{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12mm;pointer-events:none}
.wm{transform:rotate(-24deg);font-size:${landscape ? 64 : 82}pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(0,0,0,.11);text-align:center;line-height:1.1;max-width:90%}
`;
  return htmlShell(`${TITRES_PERMIS[d.permitType]} ${d.numero ?? ''}`.trim(), spec, css, inner);
}
