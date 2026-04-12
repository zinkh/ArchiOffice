import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  FileText, 
  Download, 
  Settings, 
  Eye, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  XCircle,
  ChevronRight,
  Plus,
  Trash2,
  Layout,
  Type,
  Palette,
  Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

// --- TYPES ---

export interface MissionLine {
  id: string;
  designation: string;
  categorie: 'base' | 'execution' | 'complementaire';
  montantHT: number;
  relPct: number;
  intervenants: Array<{
    nom: string;
    montantBase: number;
    pctBase: number;
    montantExe: number;
    pctExe: number;
    montantComp: number;
    pctComp: number;
  }>;
}

export interface CalendrierItem {
  id: string;
  mission: string;
  dureeJours: number;
  apres: string; // ID of the previous mission
  dateDebut?: string;
  dateFin?: string;
}

export interface ProposalData {
  // 01 - Informations générales
  reference: string;
  titre: string;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Rejected';
  indice: string;

  // 02 - Client
  clientNom: string;
  entreprise: boolean;
  nomSociete: string;
  rcs: string;
  representant: string;
  qualite: string;
  adresse: string;
  codePostal: string;
  ville: string;
  telephone: string;
  portable: string;
  email: string;

  // 03 - Projet
  detailProjet: string;
  descriptionGenerale: string;

  // 04 - Terrain
  adresseTerrain: string;
  cpTerrain: string;
  villeTerrain: string;
  refCadastrale: string;
  zonePLU: string;
  surfaceParcelle: number;
  nomEtablissement: string;
  avantTravaux: string;
  apresTravaux: string;
  typeEtCat: string;
  type: string;
  categorie: string;

  // 05 - Surfaces
  surfPlancher: number;
  surfExtension: number;
  surfERP: number;
  surfERT: number;
  effectifPublic: number;
  effectifPersonnel: number;
  dateModif: string;

  // 07 - Honoraires
  montantTravaux: number;
  tauxComplexite: number;
  pctHonorairesBase: number;
  montantHonorairesHT: number;
  pctAvecExe: number;
  pctMissionsComp: number;
  tauxTVA: number;
  montantTVA: number;
  montantTTC: number;

  // 08 - Cotraitants
  cotraitants: Array<{ specialite: string; contact: string; role: string }>;

  // 10 - Répartition honoraires
  missions: MissionLine[];

  // 09 - Calendrier
  calendrier: CalendrierItem[];

  // Signataires
  agenceNom: string;
  agenceAdresse: string;
  agenceLogo?: string; // base64
  architecteNom: string;
  architecteSignature?: string; // base64
  dateEmission: string;
}

export interface ProposalTemplate {
  pages: {
    garde: boolean;
    objet: boolean;
    surfaces: boolean;
    honoraires: boolean;
    repartition: boolean;
    cotraitants: boolean;
    calendrier: boolean;
    signatures: boolean;
  };
  clauses: {
    reglement: string;
    revision: string;
    resiliation: string;
    cotraitance: string;
  };
  visual: {
    primaryColor: string;
    fontFamily: 'Helvetica' | 'Times New Roman' | 'Arial';
    logoSize: 'small' | 'medium' | 'large';
    logoPosition: 'left' | 'center';
  };
}

// --- UTILS ---

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
};

const formatPercent = (value: number) => {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' %';
};

// --- PDF STYLES ---

const getPdfStyles = (template: ProposalTemplate) => `
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
  }

  /* Base Page Styles */
  .page-section {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    height: auto;
    padding: 20mm 25mm;
    background: #fff;
    font-family: "${template.visual.fontFamily}", sans-serif;
    color: #000;
    display: flex;
    flex-direction: column;
  }

  .page-section.fixed-height {
    height: 297mm;
  }

  /* Preview Specific Styles */
  .preview-container .page-section {
    margin: 0 auto 15mm auto;
    box-shadow: 0 4px 24px rgba(0,0,0,0.10);
    padding: 20mm 25mm 25mm 25mm !important;
    min-height: 297mm;
    width: 210mm;
    box-sizing: border-box;
  }

  /* Print Specific Styles */
  @media print {
    @page {
      size: A4;
      margin: 0;
    }
    body {
      margin: 0;
      padding: 0;
      counter-reset: page;
    }
    .page-section {
      page-break-after: always;
      margin: 0 !important;
      box-shadow: none !important;
      counter-increment: page;
    }
    .no-print { display: none !important; }
  }

  h1 { 
    font-size: 28pt; 
    font-weight: bold; 
    text-align: center; 
    margin: 0;
    color: #000;
    text-transform: uppercase;
  }
  h2 { 
    font-size: 16pt; 
    font-weight: bold; 
    color: ${template.visual.primaryColor}; 
    margin-top: 8mm; 
    margin-bottom: 5mm;
    border-bottom: 1.5px solid ${template.visual.primaryColor};
    padding-bottom: 2mm;
    clear: both;
    text-transform: uppercase;
  }
  h3 { 
    font-size: 11pt; 
    font-weight: bold; 
    margin-top: 7mm; 
    margin-bottom: 3mm;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #1e293b;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 0.5px solid #cbd5e1;
    padding-bottom: 3mm;
    font-size: 8.5pt;
    color: #475569;
    margin-bottom: 12mm;
    width: 100%;
  }

  .footer {
    position: absolute;
    bottom: 10mm;
    left: 25mm;
    right: 25mm;
    display: flex;
    justify-content: space-between;
    font-size: 7pt;
    color: #94a3b8;
    border-top: 0.5px solid #e2e8f0;
    padding-top: 2mm;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6mm;
    font-size: 9.5pt;
    table-layout: fixed;
  }
  th, td {
    border: 0.5px solid #e2e8f0;
    padding: 2.5mm 3.5mm;
    text-align: left;
    word-wrap: break-word;
  }
  th {
    background: #f8fafc;
    font-weight: bold;
    color: ${template.visual.primaryColor};
    text-transform: uppercase;
    font-size: 8pt;
  }

  p {
    margin: 0 0 3mm 0;
    line-height: 1.5;
    font-size: 9.5pt;
    color: #334155;
  }

  .badge {
    display: inline-block;
    padding: 1mm 3mm;
    border-radius: 1mm;
    font-size: 8pt;
    font-weight: bold;
    text-transform: uppercase;
  }
  .badge-draft { background: #f1f5f9; color: #475569; }
  .badge-sent { background: #eff6ff; color: #2563eb; }
  .badge-accepted { background: #f0fdf4; color: #16a34a; }
  .badge-rejected { background: #fef2f2; color: #dc2626; }

  .signature-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20mm;
    margin-top: 20mm;
  }
  .signature-box {
    border: 0.5px solid #eee;
    padding: 5mm;
    height: 40mm;
    position: relative;
  }
  .signature-label {
    font-size: 7pt;
    font-weight: bold;
    text-transform: uppercase;
    color: #999;
    margin-bottom: 2mm;
  }
  .signature-img {
    max-height: 25mm;
    max-width: 100%;
    display: block;
    margin: 2mm auto;
  }

  .gantt-container {
    width: 100%;
    height: 100mm;
    margin-top: 10mm;
  }
`;

// --- COMPONENTS ---

const GanttChart = ({ data, template }: { data: ProposalData, template: ProposalTemplate }) => {
  const missions = data.calendrier;
  const chartWidth = 600;
  const chartHeight = missions.length * 30 + 40;
  const rowHeight = 30;
  const labelWidth = 150;
  const timelineWidth = chartWidth - labelWidth;
  
  // Simple logic to place bars
  const timeline = missions.map((m, i) => {
    let start = 0;
    if (m.apres) {
      const prevIdx = missions.findIndex(ms => ms.id === m.apres);
      if (prevIdx !== -1) {
        // This is a simplification for the SVG preview
        start = (prevIdx + 1) * 20; 
      }
    } else {
      start = i * 10;
    }
    
    const width = Math.max(m.dureeJours / 2, 20);
    const missionData = data.missions.find(ms => ms.designation === m.mission);
    let color = '#3b82f6'; // base
    if (missionData?.categorie === 'execution') color = '#22c55e';
    if (missionData?.categorie === 'complementaire') color = '#f59e0b';

    return {
      name: m.mission,
      x: labelWidth + start,
      y: i * rowHeight + 40,
      width,
      color
    };
  });

  return (
    <svg width="100%" viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
      {/* Grid */}
      {Array.from({ length: 13 }).map((_, i) => (
        <line 
          key={i} 
          x1={labelWidth + (i * timelineWidth) / 12} 
          y1={0} 
          x2={labelWidth + (i * timelineWidth) / 12} 
          y2={chartHeight} 
          stroke="#e5e7eb" 
          strokeWidth="0.5" 
        />
      ))}
      
      {/* Months */}
      {Array.from({ length: 12 }).map((_, i) => (
        <text 
          key={i} 
          x={labelWidth + (i * timelineWidth) / 12 + 5} 
          y={20} 
          fontSize="8" 
          fill="#9ca3af"
        >
          M{i + 1}
        </text>
      ))}

      {/* Bars */}
      {timeline.map((bar, i) => (
        <g key={i}>
          <text x={10} y={bar.y + 15} fontSize="9" fill="currentColor" className="text-zinc-600 dark:text-zinc-400">
            {bar.name.length > 20 ? bar.name.substring(0, 18) + '...' : bar.name}
          </text>
          <rect 
            x={bar.x} 
            y={bar.y} 
            width={bar.width} 
            height={20} 
            fill={bar.color} 
            rx="4"
          />
        </g>
      ))}
    </svg>
  );
};

export const ProposalGenerator = ({ data, template }: { data: ProposalData, template: ProposalTemplate }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleExport = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const content = renderPdfContent(data, template);
    const styles = getPdfStyles(template);

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Proposition - ${data.reference}</title>
          <style>${styles}</style>
        </head>
        <body style="margin: 0; padding: 0;">
          ${content}
          <script>
            function triggerPrint() {
              try {
                window.focus();
                window.print();
              } catch (e) {
                console.error("Print failed:", e);
              }
            }
            
            window.onload = function() {
              // Wait for all images to load
              const images = Array.from(document.getElementsByTagName('img'));
              if (images.length === 0) {
                setTimeout(triggerPrint, 1500);
                return;
              }
              
              let loadedCount = 0;
              const checkAllLoaded = () => {
                loadedCount++;
                if (loadedCount === images.length) {
                  setTimeout(triggerPrint, 1500);
                }
              };

              images.forEach(img => {
                if (img.complete) {
                  checkAllLoaded();
                } else {
                  img.onload = checkAllLoaded;
                  img.onerror = checkAllLoaded;
                }
              });
            };
          </script>
        </body>
      </html>
    `;

    // Using Blob and URL.createObjectURL for better reliability in some browsers
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    iframe.onload = () => {
      // The script inside the iframe will handle printing
      URL.revokeObjectURL(url);
    };
    
    iframe.src = url;
  };

  const renderPdfContent = (d: ProposalData, t: ProposalTemplate) => {
    let html = '';
    let pageNum = 0;

    const getHeader = () => `
      <div class="header">
        <div>${d.agenceNom}</div>
        <div>Réf: ${d.reference} | Ind: ${d.indice}</div>
      </div>
    `;

    const getFooter = (current: number) => `
      <div class="footer">
        <div>${d.agenceNom} - ${d.dateEmission}</div>
        <div>Page ${current}</div>
      </div>
    `;

    // Page 1: Garde (Keep as separate page)
    if (t.pages.garde) {
      pageNum++;
      html += `
        <div class="page-section fixed-height">
          <div style="width: 100%; display: flex; justify-content: ${t.visual.logoPosition === 'center' ? 'center' : 'flex-start'}">
            ${d.agenceLogo ? `<img src="${d.agenceLogo}" style="height: ${t.visual.logoSize === 'small' ? '15mm' : t.visual.logoSize === 'medium' ? '25mm' : '35mm'}" />` : `<div style="font-size: 24pt; font-weight: bold; color: ${t.visual.primaryColor}">${d.agenceNom.substring(0, 2).toUpperCase()}</div>`}
          </div>
          
          <div style="text-align: center; flex: 1; display: flex; flex-direction: column; justify-content: center;">
            <h1 style="margin-bottom: 5mm;">LETTRE DE MISSION</h1>
            <div style="font-size: 12pt; color: #666;">
              Réf: ${d.reference} | Indice: ${d.indice}
            </div>
          </div>

          <div style="width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-bottom: 20mm;">
            <div style="background: #f8fafc; padding: 6mm; border-radius: 2mm; border: 1px solid #e2e8f0;">
              <div style="font-size: 8pt; font-weight: bold; color: ${t.visual.primaryColor}; text-transform: uppercase; margin-bottom: 3mm; letter-spacing: 1px;">Le Projet</div>
              <div style="font-size: 12pt; font-weight: bold; margin-bottom: 2mm;">${d.titre}</div>
              <div style="font-size: 10pt; line-height: 1.4; color: #475569;">${d.adresseTerrain}<br/>${d.cpTerrain} ${d.villeTerrain}</div>
              <div style="margin-top: 4mm; font-size: 10pt; font-weight: bold; color: #1e293b;">Surface Plancher: ${d.surfPlancher} m²</div>
            </div>
            <div style="background: #f8fafc; padding: 6mm; border-radius: 2mm; border: 1px solid #e2e8f0;">
              <div style="font-size: 8pt; font-weight: bold; color: ${t.visual.primaryColor}; text-transform: uppercase; margin-bottom: 3mm; letter-spacing: 1px;">Le Client</div>
              <div style="font-size: 12pt; font-weight: bold; margin-bottom: 2mm;">${d.entreprise ? d.nomSociete : d.clientNom}</div>
              <div style="font-size: 10pt; line-height: 1.4; color: #475569;">${d.adresse}<br/>${d.codePostal} ${d.ville}</div>
            </div>
          </div>

          <div style="width: 100%; text-align: center; border-top: 1px solid #eee; padding-top: 10mm;">
            <div style="font-size: 11pt; font-weight: bold; margin-bottom: 1mm;">${d.agenceNom}</div>
            <div style="font-size: 9pt; color: #666;">${d.agenceAdresse}</div>
            <div style="margin-top: 3mm; font-size: 10pt; font-weight: 500;">Architecte: ${d.architecteNom}</div>
          </div>

          <div style="width: 100%; text-align: center; margin-top: 10mm;">
            <div class="badge badge-${d.status.toLowerCase()}" style="display: inline-block; padding: 2mm 6mm; border-radius: 10mm; font-weight: bold; font-size: 10pt;">${d.status.toUpperCase()}</div>
            <div style="margin-top: 3mm; font-size: 9pt; color: #94a3b8;">Émis le ${d.dateEmission}</div>
          </div>
        </div>
      `;
    }

    // Start Main Content Page
    html += `<div class="page-section">`;
    html += getHeader();

    // Section 01: Objet
    if (t.pages.objet) {
      html += `
        <section style="margin-bottom: 10mm;">
          <h2>01. Objet de la Mission</h2>
          
          <h3>Désignation du Maître d'Ouvrage</h3>
          <table>
            <tr><td width="30%">Nom / Société</td><td>${d.entreprise ? d.nomSociete : d.clientNom}</td></tr>
            ${d.entreprise ? `<tr><td>RCS / SIRET</td><td>${d.rcs}</td></tr>` : ''}
            <tr><td>Représentant</td><td>${d.representant} (${d.qualite})</td></tr>
            <tr><td>Adresse</td><td>${d.adresse}, ${d.codePostal} ${d.ville}</td></tr>
            <tr><td>Contact</td><td>${d.email} | ${d.portable || d.telephone}</td></tr>
          </table>

          <h3>Désignation de l'Opération</h3>
          <div style="background: #f9f9f9; padding: 4mm; border-left: 3px solid ${t.visual.primaryColor};">
            <div style="font-weight: bold; margin-bottom: 2mm;">${d.titre}</div>
            <p>${d.detailProjet}</p>
          </div>
          <p style="margin-top: 4mm;">${d.descriptionGenerale}</p>

          <h3>Situation du Terrain</h3>
          <table>
            <tr><td width="30%">Adresse</td><td>${d.adresseTerrain}, ${d.cpTerrain} ${d.villeTerrain}</td></tr>
            <tr><td>Réf. Cadastrale</td><td>${d.refCadastrale}</td></tr>
            <tr><td>Zone PLU</td><td>${d.zonePLU}</td></tr>
            <tr><td>Surface Parcelle</td><td>${d.surfaceParcelle} m²</td></tr>
          </table>

          <h3>Caractéristiques de l'Ouvrage</h3>
          <table>
            <thead><tr><th>État</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>Avant Travaux</td><td>${d.avantTravaux}</td></tr>
              <tr><td>Après Travaux</td><td>${d.apresTravaux}</td></tr>
              <tr><td>Type / Catégorie</td><td>${d.typeEtCat} (${d.type} - ${d.categorie})</td></tr>
            </tbody>
          </table>
        </section>
      `;
    }

    // Section 02: Surfaces
    if (t.pages.surfaces) {
      html += `
        <section style="margin-bottom: 10mm;">
          <h2>02. Surfaces & Programme</h2>
          
          <h3>Tableau des Surfaces</h3>
          <table>
            <thead><tr><th>Désignation</th><th>Surface (m²)</th></tr></thead>
            <tbody>
              <tr><td>Surface de Plancher</td><td>${d.surfPlancher} m²</td></tr>
              <tr><td>Surface d'Extension</td><td>${d.surfExtension} m²</td></tr>
              <tr><td>Surface ERP</td><td>${d.surfERP} m²</td></tr>
              <tr><td>Surface ERT</td><td>${d.surfERT} m²</td></tr>
            </tbody>
          </table>

          <h3>Effectifs</h3>
          <table>
            <tr><td width="50%">Public admissible</td><td>${d.effectifPublic} personnes</td></tr>
            <tr><td>Personnel</td><td>${d.effectifPersonnel} personnes</td></tr>
          </table>

          <h3>Budget & Programme</h3>
          <div style="margin-top: 6mm; padding: 5mm; border: 1px solid #eee; border-radius: 2mm;">
            <div style="font-size: 10pt; font-weight: bold; color: ${t.visual.primaryColor}; margin-bottom: 2mm;">Montant estimatif des travaux</div>
            <div style="font-size: 18pt; font-weight: bold;">${formatCurrency(d.montantTravaux)} HT</div>
            <div style="font-size: 8pt; color: #666; margin-top: 1mm;">Basé sur un taux de complexité de ${d.tauxComplexite}</div>
          </div>
        </section>
      `;
    }

    // Section 03: Honoraires
    if (t.pages.honoraires) {
      html += `
        <section style="margin-bottom: 10mm;">
          <h2>03. Étendue de la Mission & Honoraires</h2>
          
          <div style="margin-bottom: 6mm;">
            <p>Le Maître d'Ouvrage confie à l'Architecte une mission portant sur les phases suivantes :</p>
            <div style="display: grid; grid-template-cols: 1fr 1fr; gap: 2mm; margin-top: 2mm;">
              ${d.missions.map(m => `
                <div style="display: flex; items-center; gap: 2mm; font-size: 8pt; ${m.montantHT === 0 ? 'color: #ccc; font-style: italic;' : ''}">
                  <span style="font-family: Arial;">${m.montantHT > 0 ? '☑' : '☐'}</span> ${m.designation}
                </div>
              `).join('')}
            </div>
          </div>

          <h3>Calcul des Honoraires</h3>
          <table>
            <thead>
              <tr><th>Catégorie</th><th>Mission</th><th>%</th><th>Montant HT</th></tr>
            </thead>
            <tbody>
              ${['base', 'execution', 'complementaire'].map(cat => {
                const catMissions = d.missions.filter(m => m.categorie === cat);
                if (catMissions.length === 0) return '';
                const subtotal = catMissions.reduce((acc, m) => acc + m.montantHT, 0);
                return `
                  <tr style="background: #f1f5f9;"><td colspan="4" style="font-weight: bold;">${cat === 'base' ? 'Missions de Base' : cat === 'execution' ? 'Missions d\'Exécution' : 'Missions Complémentaires'}</td></tr>
                  ${catMissions.map(m => `
                    <tr style="${m.montantHT === 0 ? 'color: #999; font-style: italic;' : ''}">
                      <td></td>
                      <td>${m.designation}</td>
                      <td>${formatPercent(m.relPct)}</td>
                      <td>${formatCurrency(m.montantHT)}</td>
                    </tr>
                  `).join('')}
                  <tr style="font-weight: bold;">
                    <td colspan="3" style="text-align: right;">Sous-total ${cat}</td>
                    <td>${formatCurrency(subtotal)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <div style="margin-top: 10mm; margin-left: auto; width: 60mm;">
            <div style="display: flex; justify-content: space-between; padding: 1mm 0;">
              <span>Total Honoraires HT</span>
              <span style="font-weight: bold;">${formatCurrency(d.montantHonorairesHT)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 1mm 0; border-bottom: 1px solid #eee;">
              <span>TVA (${d.tauxTVA}%)</span>
              <span>${formatCurrency(d.montantTVA)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 2mm 0; font-size: 11pt; font-weight: bold; color: ${t.visual.primaryColor};">
              <span>TOTAL TTC</span>
              <span>${formatCurrency(d.montantTTC)}</span>
            </div>
          </div>
        </section>
      `;
    }

    // Section 04: Répartition
    if (t.pages.repartition) {
      const intervenants = d.missions[0]?.intervenants.map(i => i.nom) || [];
      html += `
        <section style="margin-bottom: 10mm;">
          <h2>04. Répartition des Honoraires</h2>
          
          <table style="font-size: 7pt;">
            <thead>
              <tr>
                <th rowspan="2">Désignation</th>
                <th rowspan="2">Montant HT</th>
                <th rowspan="2">Rel%</th>
                ${intervenants.map(name => `<th colspan="2" style="text-align: center;">${name}</th>`).join('')}
              </tr>
              <tr>
                ${intervenants.map(() => `<th>%</th><th>€</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${d.missions.map(m => `
                <tr>
                  <td style="font-weight: bold;">${m.designation}</td>
                  <td>${formatCurrency(m.montantHT)}</td>
                  <td>${formatPercent(m.relPct)}</td>
                  ${m.intervenants.map(i => `
                    <td>${formatPercent(m.categorie === 'base' ? i.pctBase : m.categorie === 'execution' ? i.pctExe : i.pctComp)}</td>
                    <td>${formatCurrency(m.categorie === 'base' ? i.montantBase : m.categorie === 'execution' ? i.montantExe : i.montantComp)}</td>
                  `).join('')}
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr style="font-weight: bold; background: #f1f5f9;">
                <td>TOTAL GÉNÉRAL HT</td>
                <td>${formatCurrency(d.montantHonorairesHT)}</td>
                <td>100.00 %</td>
                ${intervenants.map(name => {
                  const total = d.missions.reduce((acc, m) => {
                    const i = m.intervenants.find(int => int.nom === name);
                    return acc + (m.categorie === 'base' ? (i?.montantBase || 0) : m.categorie === 'execution' ? (i?.montantExe || 0) : (i?.montantComp || 0));
                  }, 0);
                  return `<td colspan="2" style="text-align: right;">${formatCurrency(total)}</td>`;
                }).join('')}
              </tr>
            </tfoot>
          </table>
        </section>
      `;
    }

    // Section 05: Cotraitants
    if (t.pages.cotraitants && d.cotraitants.length > 0) {
      html += `
        <section style="margin-bottom: 10mm;">
          <h2>05. Cotraitants & Spécialités</h2>
          
          <p>Pour la réalisation de cette mission, l'Architecte s'entoure des compétences suivantes :</p>
          
          <table>
            <thead><tr><th>Spécialité</th><th>Contact / Société</th><th>Rôle</th></tr></thead>
            <tbody>
              ${d.cotraitants.map(c => `
                <tr>
                  <td style="font-weight: bold;">${c.specialite}</td>
                  <td>${c.contact}</td>
                  <td>${c.role}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <h3>Clause de Cotraitance</h3>
          <div style="white-space: pre-wrap; font-size: 8pt; color: #444; text-align: justify;">
            ${t.clauses.cotraitance}
          </div>
        </section>
      `;
    }

    // Section 06: Calendrier
    if (t.pages.calendrier) {
      html += `
        <section style="margin-bottom: 10mm;">
          <h2>06. Calendrier Prévisionnel</h2>
          
          <div class="gantt-container">
            ${renderGanttSvg(d)}
          </div>

          <h3 style="margin-top: 10mm;">Récapitulatif des Durées</h3>
          <table>
            <thead><tr><th>Mission</th><th>Durée (jours)</th><th>Précédent</th></tr></thead>
            <tbody>
              ${d.calendrier.map(c => `
                <tr>
                  <td>${c.mission}</td>
                  <td>${c.dureeJours} jours</td>
                  <td>${c.apres ? d.calendrier.find(ms => ms.id === c.apres)?.mission : 'Début'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </section>
      `;
    }

    // Section 07: Signatures
    if (t.pages.signatures) {
      html += `
        <section style="margin-bottom: 10mm;">
          <h2>07. Conditions Générales & Signatures</h2>
          
          <div style="display: grid; grid-template-cols: 1fr 1fr; gap: 10mm;">
            <div>
              <h3>Modalités de Règlement</h3>
              <p style="font-size: 8pt;">${t.clauses.reglement}</p>
            </div>
            <div>
              <h3>Révision des Honoraires</h3>
              <p style="font-size: 8pt;">${t.clauses.revision}</p>
            </div>
          </div>

          <div style="margin-top: 6mm;">
            <h3>Résiliation</h3>
            <p style="font-size: 8pt;">${t.clauses.resiliation}</p>
          </div>

          <div class="signature-grid">
            <div class="signature-box">
              <div class="signature-label">Le Maître d'Ouvrage</div>
              <div style="font-weight: bold;">${d.entreprise ? d.nomSociete : d.clientNom}</div>
              <div style="font-size: 7pt;">${d.representant} - ${d.qualite}</div>
              <div style="position: absolute; bottom: 2mm; left: 5mm; font-size: 7pt; font-style: italic;">"Lu et approuvé"</div>
            </div>
            <div class="signature-box">
              <div class="signature-label">L'Architecte</div>
              <div style="font-weight: bold;">${d.agenceNom}</div>
              <div style="font-size: 7pt;">${d.architecteNom}</div>
              ${d.architecteSignature ? `<img src="${d.architecteSignature}" class="signature-img" />` : ''}
              <div style="position: absolute; bottom: 2mm; left: 5mm; font-size: 7pt; font-style: italic;">"Lu et approuvé"</div>
            </div>
          </div>

          <div style="margin-top: 10mm; text-align: right; font-size: 9pt;">
            Fait à ${d.ville}, le ${d.dateEmission}
          </div>
        </section>
      `;
    }

    html += `
          <div style="flex: 1;"></div>
          ${getFooter(pageNum)}
        </div>
    `;

    return html;
  };

  const renderGanttSvg = (d: ProposalData) => {
    const missions = d.calendrier;
    const chartWidth = 600;
    const rowHeight = 25;
    const chartHeight = missions.length * rowHeight + 40;
    const labelWidth = 150;
    const timelineWidth = chartWidth - labelWidth;
    
    const timeline = missions.map((m, i) => {
      let start = 0;
      if (m.apres) {
        const prevIdx = missions.findIndex(ms => ms.id === m.apres);
        if (prevIdx !== -1) start = (prevIdx + 1) * 15; 
      } else {
        start = i * 5;
      }
      
      const width = Math.max(m.dureeJours / 1.5, 30);
      const missionData = d.missions.find(ms => ms.designation === m.mission);
      let color = '#3b82f6';
      if (missionData?.categorie === 'execution') color = '#22c55e';
      if (missionData?.categorie === 'complementaire') color = '#f59e0b';

      return { name: m.mission, x: labelWidth + start, y: i * rowHeight + 40, width, color };
    });

    return `
      <svg width="100%" viewBox="0 0 ${chartWidth} ${chartHeight}">
        ${Array.from({ length: 13 }).map((_, i) => `
          <line x1="${labelWidth + (i * timelineWidth) / 12}" y1="0" x2="${labelWidth + (i * timelineWidth) / 12}" y2="${chartHeight}" stroke="#eee" stroke-width="0.5" />
          <text x="${labelWidth + (i * timelineWidth) / 12 + 2}" y="20" font-size="7" fill="#999">M${i + 1}</text>
        `).join('')}
        ${timeline.map(bar => `
          <text x="0" y="${bar.y + 15}" font-size="8" fill="#333">${bar.name.substring(0, 25)}</text>
          <rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="15" fill="${bar.color}" rx="2" />
        `).join('')}
      </svg>
    `;
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Aperçu de la Proposition</h2>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{data.reference} | {data.indice}</p>
          </div>
        </div>
        <button 
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-95"
        >
          <Download size={16} />
          Exporter PDF
        </button>
      </div>

      <div className="flex-1 overflow-auto p-8 bg-zinc-100 dark:bg-zinc-950">
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center',
          gap: '16px'
        }}>
          <style dangerouslySetInnerHTML={{ __html: getPdfStyles(template) }} />
          <div 
            className="preview-container"
            style={{
              width: '210mm',        // force la largeur A4
              minWidth: '210mm',     // empêche l'étirement
              overflow: 'visible',
              fontFamily: template.visual.fontFamily,
              fontSize: '9pt',
              color: '#1e293b'
            }}
            dangerouslySetInnerHTML={{ __html: renderPdfContent(data, template) }}
          />
        </div>
      </div>

      <iframe 
        ref={iframeRef} 
        style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '100%', 
          zIndex: -1, 
          opacity: 0, 
          pointerEvents: 'none' 
        }} 
        title="pdf-export" 
      />
    </div>
  );
};

export const TemplateEditor = ({ onSave }: { onSave: (t: ProposalTemplate) => void }) => {
  const [template, setTemplate] = useState<ProposalTemplate>(() => {
    const saved = localStorage.getItem('proposalTemplate');
    return saved ? JSON.parse(saved) : {
      pages: {
        garde: true,
        objet: true,
        surfaces: true,
        honoraires: true,
        repartition: true,
        cotraitants: true,
        calendrier: true,
        signatures: true,
      },
      clauses: {
        reglement: "Les honoraires sont payables à réception de facture. Tout retard de paiement entraînera l'application d'intérêts moratoires au taux légal en vigueur.",
        revision: "Les honoraires sont révisables annuellement selon l'indice BT01 en vigueur à la date de signature du contrat.",
        resiliation: "Chaque partie peut résilier le présent contrat par lettre recommandée avec accusé de réception, moyennant un préavis de 30 jours.",
        cotraitance: "Les cotraitants sont solidaires de l'Architecte pour l'exécution technique de leurs missions respectives. Chaque cotraitant est responsable de sa propre assurance professionnelle.",
      },
      visual: {
        primaryColor: '#2563eb',
        fontFamily: 'Helvetica',
        logoSize: 'medium',
        logoPosition: 'left',
      }
    };
  });

  useEffect(() => {
    localStorage.setItem('proposalTemplate', JSON.stringify(template));
    onSave(template);
  }, [template, onSave]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 w-80 overflow-y-auto">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
        <Settings size={18} className="text-zinc-400" />
        <h2 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Éditeur de Modèle</h2>
      </div>

      <div className="p-4 space-y-8">
        {/* Pages Toggle */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <Layout size={14} />
            <h3 className="text-[10px] font-bold uppercase tracking-widest">Structure du Document</h3>
          </div>
          <div className="space-y-2">
            {Object.entries(template.pages).map(([key, value]) => (
              <label key={key} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <span className="text-xs text-zinc-600 dark:text-zinc-400 capitalize">{key}</span>
                <input 
                  type="checkbox" 
                  checked={value} 
                  onChange={(e) => setTemplate({ ...template, pages: { ...template.pages, [key]: e.target.checked } })}
                  className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
              </label>
            ))}
          </div>
        </section>

        {/* Visual Customization */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <Palette size={14} />
            <h3 className="text-[10px] font-bold uppercase tracking-widest">Personnalisation Visuelle</h3>
          </div>
          
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[8px] font-bold text-zinc-400 uppercase">Couleur Principale</label>
              <div className="flex gap-2">
                <input 
                  type="color" 
                  value={template.visual.primaryColor}
                  onChange={(e) => setTemplate({ ...template, visual: { ...template.visual, primaryColor: e.target.value } })}
                  className="w-10 h-8 rounded border-0 p-0 bg-transparent cursor-pointer"
                />
                <input 
                  type="text" 
                  value={template.visual.primaryColor}
                  onChange={(e) => setTemplate({ ...template, visual: { ...template.visual, primaryColor: e.target.value } })}
                  className="flex-1 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[8px] font-bold text-zinc-400 uppercase">Police de caractères</label>
              <select 
                value={template.visual.fontFamily}
                onChange={(e) => setTemplate({ ...template, visual: { ...template.visual, fontFamily: e.target.value as any } })}
                className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs"
              >
                <option value="Helvetica">Helvetica / Sans-serif</option>
                <option value="Times New Roman">Times New Roman / Serif</option>
                <option value="Arial">Arial</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-zinc-400 uppercase">Taille Logo</label>
                <select 
                  value={template.visual.logoSize}
                  onChange={(e) => setTemplate({ ...template, visual: { ...template.visual, logoSize: e.target.value as any } })}
                  className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs"
                >
                  <option value="small">Petit</option>
                  <option value="medium">Moyen</option>
                  <option value="large">Grand</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-zinc-400 uppercase">Position Logo</label>
                <select 
                  value={template.visual.logoPosition}
                  onChange={(e) => setTemplate({ ...template, visual: { ...template.visual, logoPosition: e.target.value as any } })}
                  className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs"
                >
                  <option value="left">Gauche</option>
                  <option value="center">Centre</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Clauses Editor */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <Type size={14} />
            <h3 className="text-[10px] font-bold uppercase tracking-widest">Clauses Juridiques</h3>
          </div>
          
          <div className="space-y-4">
            {Object.entries(template.clauses).map(([key, value]) => (
              <div key={key} className="space-y-1">
                <label className="text-[8px] font-bold text-zinc-400 uppercase capitalize">{key.replace('_', ' ')}</label>
                <textarea 
                  value={value}
                  onChange={(e) => setTemplate({ ...template, clauses: { ...template.clauses, [key]: e.target.value } })}
                  className="w-full h-24 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] resize-none focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

// --- DEMO APP ---

const DEMO_DATA: ProposalData = {
  reference: "LM-2024-0042",
  titre: "Rénovation et Extension d'une Villa Contemporaine",
  status: 'Draft',
  indice: "A",
  dateEmission: "12 Avril 2024",

  clientNom: "Jean Dupont",
  entreprise: true,
  nomSociete: "SCI DU PARC",
  rcs: "842 153 697 R.C.S. PARIS",
  representant: "Jean Dupont",
  qualite: "Gérant",
  adresse: "15 Avenue des Champs-Élysées",
  codePostal: "75008",
  ville: "Paris",
  telephone: "01 45 22 33 44",
  portable: "06 12 34 56 78",
  email: "j.dupont@sciduparc.fr",

  detailProjet: "Le projet consiste en la rénovation thermique globale d'une villa des années 70 et la création d'une extension bois de 45m² accueillant un nouvel espace de vie ouvert sur le jardin.",
  descriptionGenerale: "L'intervention vise à moderniser l'image de la villa tout en améliorant ses performances énergétiques. L'extension sera traitée en ossature bois avec un bardage en claire-voie de mélèze. Les menuiseries existantes seront remplacées par des profilés aluminium à rupture de pont thermique. Une attention particulière sera portée à la continuité visuelle entre l'intérieur et l'extérieur via de larges baies vitrées.",

  adresseTerrain: "42 Rue de la Paix",
  cpTerrain: "92100",
  villeTerrain: "Boulogne-Billancourt",
  refCadastrale: "Section AB n°142",
  zonePLU: "UC - Zone Urbaine de Faible Densité",
  surfaceParcelle: 850,
  nomEtablissement: "Villa Bellevue",
  avantTravaux: "Maison individuelle R+1 avec garage attenant",
  apresTravaux: "Maison individuelle avec extension bois et terrasse",
  typeEtCat: "Habitation",
  type: "Individuel",
  categorie: "5ème catégorie",

  surfPlancher: 185,
  surfExtension: 45,
  surfERP: 0,
  surfERT: 0,
  effectifPublic: 0,
  effectifPersonnel: 0,
  dateModif: "10/04/2024",

  montantTravaux: 350000,
  tauxComplexite: 1.15,
  pctHonorairesBase: 12.5,
  montantHonorairesHT: 43750,
  pctAvecExe: 15.5,
  pctMissionsComp: 2,
  tauxTVA: 20,
  montantTVA: 8750,
  montantTTC: 52500,

  cotraitants: [
    { specialite: "BET Structure", contact: "IngéBois Concept", role: "Calculs de structure bois" },
    { specialite: "BET Thermique", contact: "EcoFluides", role: "Étude RE2020 et dimensionnement PAC" }
  ],

  missions: [
    {
      id: "m1",
      designation: "Esquisse (ESQ)",
      categorie: 'base',
      montantHT: 4375,
      relPct: 10,
      intervenants: [{ nom: "Architecte", montantBase: 4375, pctBase: 100, montantExe: 0, pctExe: 0, montantComp: 0, pctComp: 0 }]
    },
    {
      id: "m2",
      designation: "Avant-Projet Sommaire (APS)",
      categorie: 'base',
      montantHT: 6562.5,
      relPct: 15,
      intervenants: [{ nom: "Architecte", montantBase: 6562.5, pctBase: 100, montantExe: 0, pctExe: 0, montantComp: 0, pctComp: 0 }]
    },
    {
      id: "m3",
      designation: "Dossier de Permis de Construire (PC)",
      categorie: 'base',
      montantHT: 8750,
      relPct: 20,
      intervenants: [{ nom: "Architecte", montantBase: 8750, pctBase: 100, montantExe: 0, pctExe: 0, montantComp: 0, pctComp: 0 }]
    },
    {
      id: "m4",
      designation: "Direction de l'Exécution des Travaux (DET)",
      categorie: 'execution',
      montantHT: 17500,
      relPct: 40,
      intervenants: [{ nom: "Architecte", montantBase: 0, pctBase: 0, montantExe: 17500, pctExe: 100, montantComp: 0, pctComp: 0 }]
    }
  ],

  calendrier: [
    { id: "c1", mission: "Esquisse (ESQ)", dureeJours: 15, apres: "" },
    { id: "c2", mission: "Avant-Projet Sommaire (APS)", dureeJours: 21, apres: "c1" },
    { id: "c3", mission: "Dossier de Permis de Construire (PC)", dureeJours: 30, apres: "c2" },
    { id: "c4", mission: "Direction de l'Exécution des Travaux (DET)", dureeJours: 120, apres: "c3" }
  ],

  agenceNom: "ATELIER ARCHI-DESIGN",
  agenceAdresse: "8 Rue de Rivoli, 75004 Paris",
  architecteNom: "Marc Voisin",
};

export default function ProposalModule() {
  const [template, setTemplate] = useState<ProposalTemplate | null>(null);

  return (
    <div className="flex h-screen bg-zinc-100 dark:bg-zinc-950 overflow-hidden">
      {/* Sidebar Editor */}
      <TemplateEditor onSave={setTemplate} />

      {/* Main Preview & Export */}
      <div className="flex-1 h-full">
        {template ? (
          <ProposalGenerator data={DEMO_DATA} template={template} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 text-zinc-400">
              <Clock className="animate-spin" size={32} />
              <p className="text-sm font-medium">Chargement du modèle...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
