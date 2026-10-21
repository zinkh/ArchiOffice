import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconX, IconDownload, IconSettings, IconLayout, IconLayoutRows, IconPalette, IconLetterCase, IconLayoutSidebar,
} from '@tabler/icons-react';
import type { Proposal, MafCostResult } from '../types';
import { useSettings } from '../hooks/useSettings';
import { useMafCost } from '../hooks/useMafCost';
import { MafCostBadge } from './MafCostBadge';
import { loadCotraitantIdentities } from '../lib/pdfLetterhead';
import { paginateFlow, PAGE_HEIGHT_MM, CONTENT_TOP_MM, CONTENT_BOTTOM_MM } from '../lib/pdfPagination';
import {
  ProposalPdfData, ProposalTemplate, ProposalSectionId, CotraitantIdentityPdf, DensityTokens, TableDensity,
  PROPOSAL_SECTION_DEFS, DENSITY_TOKENS, TABLE_DENSITY_OPTIONS, mapProposalToPdfData, getPdfStyles,
  loadStoredTemplate, saveStoredTemplate, applyPreset,
  exportProposalPdf, compressProposalLogo, formatCurrency, formatPercent,
} from '../lib/proposalExport';

// ─── PDF primitives ─────────────────────────────────────────────────────────
// Every box-model property here (padding/margin/border) MUST be inline, not a
// CSS class — Tailwind's Preflight is compiled with an artificially-boosted
// specificity (`*:not(#\#):not(#\#):not(#\#):not(#\#) { margin:0; padding:0;
// border:0 solid }`) that overrides any plain class/element CSS rule for
// those properties. Inline styles are the only reliable way to survive it.
// See getPdfStyles()'s doc comment in src/lib/proposalExport.ts for the full
// diagnosis. These primitives are rendered both in the live on-screen preview
// and captured by jsPDF for export (same DOM), so there's exactly one source
// of truth for spacing in both.
//
// Les attributs `data-pdf-*` pilotent la pagination (src/lib/pdfPagination.ts) :
// `data-pdf-keep` = bloc qu'on ne coupe pas, `data-pdf-heading` = titre qui garde
// de la place sous lui, `data-pdf-newpage` = début de section sur une nouvelle page.
// Les lignes de tableau sont repérées seules (jamais coupées en deux).

/** Marge latérale du contenu et des repères de page. */
const SIDE_MARGIN = '25mm';

/** Pour les cellules de montant : un nombre ne se coupe jamais en fin de ligne. */
const NOWRAP: React.CSSProperties = { whiteSpace: 'nowrap' };

const DensityContext = React.createContext<DensityTokens>(DENSITY_TOKENS.normal);
const useDensity = () => React.useContext(DensityContext);

/** Page de garde : une page entière à elle seule, hors pagination. */
function Cover({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-pdf-cover="true"
      style={{
        position: 'relative',
        width: '210mm',
        height: `${PAGE_HEIGHT_MM}mm`,
        padding: '20mm 25mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  const { blockGap } = useDensity();
  return <section style={{ marginBottom: blockGap }}>{children}</section>;
}

function H2({ template, newPage, children }: { template: ProposalTemplate; newPage: boolean; children: React.ReactNode }) {
  const density = useDensity();
  return (
    <h2
      data-pdf-heading="true"
      {...(newPage ? { 'data-pdf-newpage': 'true' } : {})}
      style={{
        fontSize: '16pt', fontWeight: 'bold', color: template.visual.primaryColor,
        // En haut de page le titre ne porte aucune marge : la hauteur de la bande d'en-tête suffit.
        marginTop: newPage ? 0 : '8mm', marginBottom: density.tableMarginBottom,
        borderBottom: `1.5px solid ${template.visual.primaryColor}`, paddingBottom: '2mm',
        clear: 'both', textTransform: 'uppercase',
      }}
    >
      {children}
    </h2>
  );
}

function H3({ style, children }: { style?: React.CSSProperties; children: React.ReactNode }) {
  const density = useDensity();
  return (
    <h3
      data-pdf-heading="true"
      style={{
        fontSize: '11pt', fontWeight: 'bold',
        marginTop: density.headingMarginTop, marginBottom: density.headingMarginBottom,
        textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1e293b',
        ...style,
      }}
    >
      {children}
    </h3>
  );
}

function P({ template, style, children }: { template: ProposalTemplate; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <p data-pdf-keep="true" style={{
      marginTop: 0, marginBottom: '3mm', lineHeight: template.visual.lineHeight ?? 1.5,
      fontSize: '9.5pt', color: '#334155', ...style,
    }}>
      {children}
    </p>
  );
}

function Table({ style, children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  const density = useDensity();
  return (
    <table
      {...rest}
      style={{
        width: '100%', borderCollapse: 'collapse', marginBottom: density.tableMarginBottom,
        fontSize: density.cellFont, tableLayout: 'fixed', ...style,
      }}
    >
      {children}
    </table>
  );
}

function Th({ template, style, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { template: ProposalTemplate }) {
  const density = useDensity();
  return (
    <th
      {...rest}
      style={{
        border: '0.5px solid #e2e8f0', padding: density.cellPadding, textAlign: 'left', wordWrap: 'break-word',
        background: '#f8fafc', fontWeight: 'bold', color: template.visual.primaryColor,
        textTransform: 'uppercase', fontSize: density.headFont, lineHeight: density.cellLineHeight,
        ...style,
      }}
    />
  );
}

function Td({ style, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  const density = useDensity();
  return (
    <td
      {...rest}
      style={{
        border: '0.5px solid #e2e8f0', padding: density.cellPadding, textAlign: 'left', wordWrap: 'break-word',
        lineHeight: density.cellLineHeight, ...style,
      }}
    />
  );
}

// ─── Gantt chart (already JSX/SVG, no box-model CSS involved) ──────────────

// Dessiné en HTML et non en SVG : l'export masque les SVG (jsPDF ne sait pas les
// imprimer, ce sont les icônes), si bien que l'ancien diagramme apparaissait dans
// l'aperçu mais jamais dans le PDF, et que l'aperçu avait une page de plus que lui.
function GanttChart({ data }: { data: ProposalPdfData }) {
  const missions = data.calendrier;
  // Mêmes proportions que l'ancien dessin : un repère de 600 unités, 150 pour les libellés.
  const chartWidth = 600;
  const labelWidth = 150;
  const timelineWidth = chartWidth - labelWidth;
  const percent = (value: number) => `${(value / chartWidth) * 100}%`;

  const timeline = missions.map((m, i) => {
    let start = 0;
    if (m.apres) {
      const prevIdx = missions.findIndex(ms => ms.id === m.apres);
      if (prevIdx !== -1) start = (prevIdx + 1) * 15;
    } else {
      start = i * 5;
    }
    const width = Math.max(m.dureeJours / 1.5, 30);
    const missionData = data.missions.find(ms => ms.designation === m.mission);
    let color = '#3b82f6';
    if (missionData?.categorie === 'execution') color = '#22c55e';
    if (missionData?.categorie === 'complementaire') color = '#f59e0b';
    return { name: m.mission, x: labelWidth + start, width, color };
  });

  return (
    <div style={{ position: 'relative', width: '100%', paddingTop: '6mm', overflow: 'hidden' }}>
      {Array.from({ length: 13 }, (_, i) => {
        const x = labelWidth + (i * timelineWidth) / 12;
        return (
          <React.Fragment key={i}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: percent(x), width: '0.2mm', background: '#e5e7eb' }} />
            <div style={{ position: 'absolute', top: '1mm', left: percent(x + 2), fontSize: '5.5pt', color: '#999' }}>M{i + 1}</div>
          </React.Fragment>
        );
      })}
      {timeline.map((bar, i) => (
        <div key={i} style={{ position: 'relative', height: '6.5mm' }}>
          {/* Pas de `overflow: hidden` : jsPDF imprime le texte un peu plus bas que sa boîte et la rognerait. */}
          <div style={{ position: 'absolute', top: '0.6mm', left: 0, whiteSpace: 'nowrap', fontSize: '6.5pt', lineHeight: 1.2, color: '#333' }}>{bar.name.substring(0, 25)}</div>
          <div style={{ position: 'absolute', top: '1.2mm', left: percent(bar.x), width: percent(bar.width), height: '4mm', background: bar.color, borderRadius: '0.6mm' }} />
        </div>
      ))}
    </div>
  );
}

// ─── Per-page chrome ────────────────────────────────────────────────────────
// En-tête, pied et pagination ne sont plus posés dans chaque page : le document
// est un seul bloc continu, et ces repères sont dessinés par-dessus, page après
// page, dans les bandes que la pagination leur réserve (voir pdfPagination.ts).

function PageHeader({ d }: { d: ProposalPdfData }) {
  return (
    <div style={{
      position: 'absolute', top: '12mm', left: SIDE_MARGIN, right: SIDE_MARGIN,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      borderBottom: '0.5px solid #cbd5e1', paddingBottom: '3mm',
      fontSize: '8.5pt', color: '#475569',
    }}>
      <div>{d.agenceNom}</div>
      <div>Réf: {d.reference} | Ind: {d.indice}</div>
    </div>
  );
}

function PageFooter({ d, page, total }: { d: ProposalPdfData; page: number; total: number }) {
  return (
    <div style={{
      position: 'absolute', bottom: '10mm', left: SIDE_MARGIN, right: SIDE_MARGIN,
      display: 'flex', justifyContent: 'space-between', fontSize: '7pt',
      color: '#94a3b8', borderTop: '0.5px solid #e2e8f0', paddingTop: '2mm',
    }}>
      <div>{d.agenceNom} - {d.dateEmission}</div>
      {/* Pagination du cabinet : P1|2 */}
      <div style={{ fontWeight: 'bold', color: '#111827' }}>P{page}|{total}</div>
    </div>
  );
}

function PageChrome({ d, pageCount, hasCover }: { d: ProposalPdfData; pageCount: number; hasCover: boolean }) {
  return (
    <>
      {Array.from({ length: pageCount }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, right: 0, top: `${index * PAGE_HEIGHT_MM}mm`, height: `${PAGE_HEIGHT_MM}mm`, pointerEvents: 'none' }}
        >
          {!(hasCover && index === 0) && <PageHeader d={d} />}
          <PageFooter d={d} page={index + 1} total={pageCount} />
          {index > 0 && (
            // Repère de coupure visible à l'écran seulement : l'export le masque.
            <div data-pdf-screen-only="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, borderTop: '1px dashed #94a3b8' }}>
              <span style={{ position: 'absolute', right: '3mm', top: '1mm', fontSize: '7pt', color: '#94a3b8' }}>Page {index + 1}</span>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

const BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f1f5f9', fg: '#475569' },
  sent: { bg: '#eff6ff', fg: '#2563eb' },
  accepted: { bg: '#f0fdf4', fg: '#16a34a' },
  rejected: { bg: '#fef2f2', fg: '#dc2626' },
};

// ─── Section renderers ──────────────────────────────────────────────────────
// Une section est un bloc de contenu continu : c'est la pagination qui la répartit
// sur les pages. `newPage` dit si son titre doit s'ouvrir sur une page neuve
// (réglage « saut de page entre les sections », et toujours la première section).

interface SectionCtx { mafCost: MafCostResult | null }
type SectionRenderer = (d: ProposalPdfData, t: ProposalTemplate, ctx: SectionCtx, newPage: boolean) => React.ReactNode;

const renderGarde = (d: ProposalPdfData, t: ProposalTemplate): React.ReactNode => {
  const badgeColor = BADGE_COLORS[d.status.toLowerCase()] ?? BADGE_COLORS.draft;
  const partnerLogos = t.layout.cotraitantIdentity ? d.cotraitantLogos ?? [] : [];
  return (
    <Cover key="garde">
      <div style={{ width: '100%', display: 'flex', justifyContent: t.visual.logoPosition === 'center' ? 'center' : 'flex-start' }}>
        {d.agenceLogo ? (
          <img src={d.agenceLogo} style={{ height: t.visual.logoSize === 'small' ? '15mm' : t.visual.logoSize === 'medium' ? '25mm' : '35mm' }} />
        ) : (
          <div style={{ fontSize: '24pt', fontWeight: 'bold', color: t.visual.primaryColor }}>{(d.agenceNom || '??').substring(0, 2).toUpperCase()}</div>
        )}
      </div>
      {partnerLogos.length > 0 && (
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6mm', marginTop: '4mm', justifyContent: t.visual.logoPosition === 'center' ? 'center' : 'flex-start' }}>
          <span style={{ fontSize: '7pt', color: '#666' }}>En groupement avec</span>
          {partnerLogos.map((src, i) => (
            <img key={i} src={src} style={{ height: '12mm', maxWidth: '40mm', objectFit: 'contain' }} />
          ))}
        </div>
      )}
      <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <h1 style={{ margin: 0, marginBottom: '5mm', fontSize: '28pt', fontWeight: 'bold', textAlign: 'center', color: '#000', textTransform: 'uppercase' }}>LETTRE DE MISSION</h1>
        <div style={{ fontSize: '12pt', color: '#666' }}>Réf: {d.reference} | Indice: {d.indice}</div>
      </div>
      <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10mm', marginBottom: '20mm' }}>
        <div style={{ background: '#f8fafc', padding: '6mm', borderRadius: '2mm', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '8pt', fontWeight: 'bold', color: t.visual.primaryColor, textTransform: 'uppercase', marginBottom: '3mm', letterSpacing: '1px' }}>Le Projet</div>
          <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '2mm' }}>{d.titre}</div>
          <div style={{ fontSize: '10pt', lineHeight: 1.4, color: '#475569' }}>{d.adresseTerrain}<br />{d.cpTerrain} {d.villeTerrain}</div>
          <div style={{ marginTop: '4mm', fontSize: '10pt', fontWeight: 'bold', color: '#1e293b' }}>Surface Plancher: {d.surfPlancher} m²</div>
        </div>
        <div style={{ background: '#f8fafc', padding: '6mm', borderRadius: '2mm', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '8pt', fontWeight: 'bold', color: t.visual.primaryColor, textTransform: 'uppercase', marginBottom: '3mm', letterSpacing: '1px' }}>Le Client</div>
          <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '2mm' }}>{d.entreprise ? d.nomSociete : d.clientNom}</div>
          <div style={{ fontSize: '10pt', lineHeight: 1.4, color: '#475569' }}>{d.adresse}<br />{d.codePostal} {d.ville}</div>
        </div>
      </div>
      <div style={{ width: '100%', textAlign: 'center', borderTop: '1px solid #eee', paddingTop: '10mm' }}>
        <div style={{ fontSize: '11pt', fontWeight: 'bold', marginBottom: '1mm' }}>{d.agenceNom}</div>
        <div style={{ fontSize: '9pt', color: '#666' }}>{d.agenceAdresse}</div>
        <div style={{ marginTop: '3mm', fontSize: '10pt', fontWeight: 500 }}>Architecte: {d.architecteNom}{d.oaNumber ? `, Ordre des Architectes n° ${d.oaNumber}` : ''}</div>
      </div>
      <div style={{ width: '100%', textAlign: 'center', marginTop: '10mm' }}>
        <div style={{ display: 'inline-block', padding: '1mm 3mm', borderRadius: '1mm', fontSize: '8pt', fontWeight: 'bold', textTransform: 'uppercase', background: badgeColor.bg, color: badgeColor.fg }}>{d.status.toUpperCase()}</div>
        <div style={{ marginTop: '3mm', fontSize: '9pt', color: '#94a3b8' }}>Émis le {d.dateEmission}</div>
      </div>
    </Cover>
  );
};

const renderObjet: SectionRenderer = (d, t, _ctx, newPage) => {
  const missionsList = t.clauses.missionsText.split('\n').filter(Boolean);
  return (
    <Section key="objet">
      <H2 template={t} newPage={newPage}>01. Objet de la Mission</H2>
      <H3>Désignation du Maître d'Ouvrage</H3>
      <Table>
        <tbody>
          <tr><Td width="30%">Nom / Société</Td><Td>{d.entreprise ? d.nomSociete : d.clientNom}</Td></tr>
          {d.entreprise && <tr><Td>RCS / SIRET</Td><Td>{d.rcs}</Td></tr>}
          {t.detailLevel === 'detaille' && <tr><Td>Représentant</Td><Td>{d.representant} ({d.qualite})</Td></tr>}
          <tr><Td>Adresse</Td><Td>{d.adresse}, {d.codePostal} {d.ville}</Td></tr>
          <tr><Td>Contact</Td><Td>{d.email} | {d.telephone}</Td></tr>
        </tbody>
      </Table>

      <H3>Désignation de l'Opération</H3>
      <div data-pdf-keep="true" style={{ background: '#f9f9f9', padding: '4mm', borderLeft: `3px solid ${t.visual.primaryColor}` }}>
        <div style={{ fontWeight: 'bold', marginBottom: '2mm' }}>{d.titre}</div>
        <P template={t}>{d.detailProjet}</P>
      </div>
      <P template={t} style={{ marginTop: '4mm' }}>{d.descriptionGenerale}</P>

      <H3>Situation du Terrain</H3>
      <Table>
        <tbody>
          <tr><Td width="30%">Adresse</Td><Td>{d.adresseTerrain}, {d.cpTerrain} {d.villeTerrain}</Td></tr>
          <tr><Td>Réf. Cadastrale</Td><Td>{d.refCadastrale}</Td></tr>
          <tr><Td>Surface Parcelle</Td><Td>{d.surfaceParcelle} m²</Td></tr>
          {t.detailLevel === 'detaille' && <tr><Td>Zone PLU</Td><Td>{d.zonePLU}</Td></tr>}
        </tbody>
      </Table>

      {t.detailLevel === 'detaille' && (
        <>
          <H3>Caractéristiques de l'Ouvrage</H3>
          <Table>
            <thead><tr><Th template={t}>État</Th><Th template={t}>Description</Th></tr></thead>
            <tbody>
              <tr><Td>Avant Travaux</Td><Td>{d.avantTravaux}</Td></tr>
              <tr><Td>Après Travaux</Td><Td>{d.apresTravaux}</Td></tr>
              <tr><Td>Type / Catégorie</Td><Td>{d.typeEtCat} ({d.type} - {d.categorie})</Td></tr>
            </tbody>
          </Table>

          {missionsList.length > 0 && (
            <>
              <H3>Missions Proposées</H3>
              <ul style={{ fontSize: '9pt', paddingLeft: '5mm' }}>
                {missionsList.map((m, i) => <li key={i} data-pdf-keep="true">{m}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </Section>
  );
};

const renderSurfaces: SectionRenderer = (d, t, _ctx, newPage) => (
  <Section key="surfaces">
    <H2 template={t} newPage={newPage}>02. Surfaces & Programme</H2>
    <H3>Tableau des Surfaces</H3>
    <Table>
      <thead><tr><Th template={t}>Désignation</Th><Th template={t}>Surface (m²)</Th></tr></thead>
      <tbody>
        <tr><Td>Surface de Plancher</Td><Td>{d.surfPlancher} m²</Td></tr>
        <tr><Td>Surface d'Extension</Td><Td>{d.surfExtension} m²</Td></tr>
        <tr><Td>Surface ERP</Td><Td>{d.surfERP} m²</Td></tr>
        <tr><Td>Surface ERT</Td><Td>{d.surfERT} m²</Td></tr>
      </tbody>
    </Table>
    <H3>Effectifs</H3>
    <Table>
      <tbody>
        <tr><Td width="50%">Public admissible</Td><Td>{d.effectifPublic} personnes</Td></tr>
        <tr><Td>Personnel</Td><Td>{d.effectifPersonnel} personnes</Td></tr>
      </tbody>
    </Table>
    <H3>Budget & Programme</H3>
    <div data-pdf-keep="true" style={{ marginTop: '6mm', padding: '5mm', border: '1px solid #eee', borderRadius: '2mm' }}>
      <div style={{ fontSize: '10pt', fontWeight: 'bold', color: t.visual.primaryColor, marginBottom: '2mm' }}>Montant estimatif des travaux</div>
      <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>{formatCurrency(d.montantTravaux)} HT</div>
      <div style={{ fontSize: '8pt', color: '#666', marginTop: '1mm' }}>
        Taux de complexité {d.tauxComplexite}
        {(d.ratioRehab > 0 || d.ratioExtension > 0) && `, réhabilitation ${d.ratioRehab} % / extension ${d.ratioExtension} %`}
      </div>
    </div>
  </Section>
);

const renderHonoraires: SectionRenderer = (d, t, ctx, newPage) => {
  const density = DENSITY_TOKENS[t.layout.tableDensity];
  return (
    <Section key="honoraires">
      <H2 template={t} newPage={newPage}>03. Étendue de la Mission & Honoraires</H2>

      {t.detailLevel === 'detaille' && (
        <>
          <div data-pdf-keep="true" style={{ marginBottom: density.tableMarginBottom }}>
            <P template={t}>Le Maître d'Ouvrage confie à l'Architecte une mission portant sur les phases suivantes :</P>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2mm', marginTop: '2mm' }}>
              {d.missions.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '2mm', fontSize: '8pt', ...(m.montantHT === 0 ? { color: '#ccc', fontStyle: 'italic' } : {}) }}>
                  {/* Carré dessiné : ☑ et ☐ n'existent pas dans la police du PDF (ils sortent en « & »). */}
                  <span
                    aria-hidden="true"
                    style={{
                      // `top` : jsPDF imprime le texte un peu plus bas qu'à l'écran, le carré le suit.
                      display: 'inline-block', width: '2.4mm', height: '2.4mm', flexShrink: 0, position: 'relative', top: '0.9mm',
                      border: `0.3mm solid ${m.montantHT > 0 ? '#334155' : '#cbd5e1'}`,
                      background: m.montantHT > 0 ? '#334155' : 'transparent',
                    }}
                  />
                  {m.designation}
                </div>
              ))}
            </div>
          </div>

          <H3>Calcul des Honoraires</H3>
          {/* Pas de colonne « Catégorie » : elle restait vide sur chaque ligne de mission et
              réduisait la désignation à une étroite colonne ; la catégorie est une ligne de titre. */}
          <Table>
            <thead>
              <tr>
                <Th template={t} style={{ width: '60%' }}>Mission</Th>
                <Th template={t} style={{ width: '15%' }}>%</Th>
                <Th template={t} style={{ width: '25%' }}>Montant HT</Th>
              </tr>
            </thead>
            <tbody>
              {(['base', 'execution', 'complementaire'] as const).map(cat => {
                const catMissions = d.missions.filter(m => m.categorie === cat);
                if (catMissions.length === 0) return null;
                const subtotal = catMissions.reduce((acc, m) => acc + m.montantHT, 0);
                const catLabel = cat === 'base' ? 'Missions de Base' : cat === 'execution' ? "Missions d'Exécution" : 'Missions Complémentaires';
                return (
                  <React.Fragment key={cat}>
                    <tr data-pdf-keep-next="true" style={{ background: '#f1f5f9' }}><Td colSpan={3} style={{ fontWeight: 'bold' }}>{catLabel}</Td></tr>
                    {catMissions.map(m => (
                      <tr key={m.id} style={m.montantHT === 0 ? { color: '#999', fontStyle: 'italic' } : undefined}>
                        <Td>{m.designation}</Td>
                        <Td style={NOWRAP}>{formatPercent(m.relPct)}</Td>
                        <Td style={NOWRAP}>{formatCurrency(m.montantHT)}</Td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 'bold' }}>
                      <Td colSpan={2} style={{ textAlign: 'right' }}>Sous-total {catLabel.toLowerCase()}</Td>
                      <Td style={NOWRAP}>{formatCurrency(subtotal)}</Td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </Table>
        </>
      )}

      <div data-pdf-keep="true" style={{ marginTop: density.blockGap, marginLeft: 'auto', width: '60mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1mm 0' }}>
          <span>Total Honoraires HT</span>
          <span style={{ fontWeight: 'bold' }}>{formatCurrency(d.montantHonorairesHT)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1mm 0', borderBottom: '1px solid #eee' }}>
          <span>TVA ({d.tauxTVA}%)</span>
          <span>{formatCurrency(d.montantTVA)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2mm 0', fontSize: '11pt', fontWeight: 'bold', color: t.visual.primaryColor }}>
          <span>TOTAL TTC</span>
          <span>{formatCurrency(d.montantTTC)}</span>
        </div>
      </div>

      {t.pages.mafCost && ctx.mafCost && (
        <div data-pdf-keep="true" style={{ marginTop: '6mm' }}>
          <MafCostBadge result={ctx.mafCost} showDetails />
        </div>
      )}
    </Section>
  );
};

const renderRepartition: SectionRenderer = (d, t, _ctx, newPage) => {
  const allIntervenants = Array.from(new Set(d.missions.flatMap(m => m.intervenants.map(i => i.nom))));

  if (t.detailLevel === 'court') {
    return (
      <Section key="repartition">
        <H2 template={t} newPage={newPage}>04. Répartition des Honoraires</H2>
        <div data-pdf-keep="true" style={{ marginTop: '6mm', width: '80mm' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1mm 0' }}>
            <span>Total Honoraires HT</span><span style={{ fontWeight: 'bold' }}>{formatCurrency(d.montantHonorairesHT)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1mm 0' }}>
            <span>TVA ({d.tauxTVA}%)</span><span>{formatCurrency(d.montantTVA)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2mm 0', fontWeight: 'bold', color: t.visual.primaryColor }}>
            <span>TOTAL TTC</span><span>{formatCurrency(d.montantTTC)}</span>
          </div>
        </div>
      </Section>
    );
  }

  // Une colonne par intervenant (deux sous-colonnes) : plus il y en a, plus le corps
  // du texte baisse, sans quoi le tableau dépasserait la largeur de la page.
  const fontSize = allIntervenants.length >= 6 ? '6pt' : allIntervenants.length >= 5 ? '6.5pt' : '7pt';
  // Dès trois intervenants les marges des cellules se resserrent aussi : ce sont elles qui
  // empêchaient les montants de tenir et réduisaient la désignation à une colonne étroite.
  const tight = allIntervenants.length >= 3 ? { padding: '0.4mm 1.2mm 1.2mm' } : {};
  const head = { fontSize, ...tight };
  const money = { ...NOWRAP, ...tight };
  // Largeur souhaitée de la désignation : le reste est réparti selon le contenu des colonnes.
  const designationWidth = { ...head, width: '22%' };
  return (
    <Section key="repartition">
      <H2 template={t} newPage={newPage}>04. Répartition des Honoraires</H2>
      {/* Mise en page automatique : des colonnes de largeur égale coupaient la désignation
          en pleine lettre et les montants en deux. Les montants ne se coupent plus. */}
      <Table style={{ fontSize, tableLayout: 'auto' }}>
        <thead>
          <tr>
            <Th template={t} rowSpan={2} style={designationWidth}>Désignation</Th>
            <Th template={t} rowSpan={2} style={head}>Montant HT</Th>
            <Th template={t} rowSpan={2} style={head}>Rel%</Th>
            {allIntervenants.map(name => <Th template={t} key={name} colSpan={2} style={{ ...head, textAlign: 'center' }}>{name}</Th>)}
          </tr>
          <tr>
            {allIntervenants.map(name => <React.Fragment key={name}><Th template={t} style={head}>%</Th><Th template={t} style={head}>€</Th></React.Fragment>)}
          </tr>
        </thead>
        <tbody>
          {d.missions.map(m => (
            <tr key={m.id}>
              <Td style={{ fontWeight: 'bold', ...tight }}>{m.designation}</Td>
              <Td style={money}>{formatCurrency(m.montantHT)}</Td>
              <Td style={money}>{formatPercent(m.relPct)}</Td>
              {allIntervenants.map(name => {
                const i = m.intervenants.find(int => int.nom === name);
                return (
                  <React.Fragment key={name}>
                    <Td style={money}>{formatPercent(i?.pct || 0)}</Td>
                    <Td style={money}>{formatCurrency(i?.montant || 0)}</Td>
                  </React.Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 'bold', background: '#f1f5f9' }}>
            <Td style={tight}>TOTAL GÉNÉRAL HT</Td>
            <Td style={money}>{formatCurrency(d.montantHonorairesHT)}</Td>
            <Td style={money}>{formatPercent(100)}</Td>
            {allIntervenants.map(name => {
              const total = d.missions.reduce((acc, m) => acc + (m.intervenants.find(i => i.nom === name)?.montant || 0), 0);
              return <Td key={name} colSpan={2} style={{ ...money, textAlign: 'right' }}>{formatCurrency(total)}</Td>;
            })}
          </tr>
        </tfoot>
      </Table>
    </Section>
  );
};

/** Cotraitants avec leur identité : logo, raison sociale, coordonnées et SIRET de la fiche contact. */
function CotraitantsIdentityTable({ d, t }: { d: ProposalPdfData; t: ProposalTemplate }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th template={t} style={{ width: '17%' }}>Logo</Th>
          <Th template={t} style={{ width: '21%' }}>Spécialité</Th>
          <Th template={t} style={{ width: '26%' }}>Société / Contact</Th>
          <Th template={t} style={{ width: '36%' }}>Coordonnées</Th>
        </tr>
      </thead>
      <tbody>
        {d.cotraitants.map((c, i) => {
          const identite = c.contactId ? d.cotraitantIdentites?.[c.contactId] : undefined;
          return (
            <tr key={i}>
              <Td style={{ textAlign: 'center' }}>
                {identite?.logo && (
                  <img src={identite.logo} alt="" style={{ display: 'block', margin: '0 auto', maxHeight: '13mm', maxWidth: '100%', objectFit: 'contain' }} />
                )}
              </Td>
              <Td style={{ fontWeight: 'bold' }}>{c.specialite}</Td>
              <Td>
                <div style={{ fontWeight: 'bold' }}>{identite?.titre || c.contact}</div>
                {identite?.sousTitre && <div style={{ color: '#475569' }}>{identite.sousTitre}</div>}
              </Td>
              <Td style={{ color: '#334155' }}>
                {identite?.adresse && <div>{identite.adresse}</div>}
                {identite?.telephone && <div>Tél : {identite.telephone}</div>}
                {identite?.email && <div>{identite.email}</div>}
                {identite?.siret && <div>SIRET : {identite.siret}</div>}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

const renderCotraitants: SectionRenderer = (d, t, _ctx, newPage) => (
  <Section key="cotraitants">
    <H2 template={t} newPage={newPage}>05. Cotraitants & Spécialités</H2>
    <P template={t}>Pour la réalisation de cette mission, l'Architecte s'entoure des compétences suivantes :</P>
    {t.layout.cotraitantIdentity ? (
      <CotraitantsIdentityTable d={d} t={t} />
    ) : (
      <Table>
        <thead><tr><Th template={t}>Spécialité</Th><Th template={t}>Contact / Société</Th><Th template={t}>Rôle</Th></tr></thead>
        <tbody>
          {d.cotraitants.map((c, i) => (
            <tr key={i}>
              <Td style={{ fontWeight: 'bold' }}>{c.specialite}</Td>
              <Td>{c.contact}</Td>
              <Td>{c.role}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    )}
    <H3>Clause de Cotraitance</H3>
    <div data-pdf-keep="true" style={{ whiteSpace: 'pre-wrap', fontSize: '8pt', color: '#444', textAlign: 'justify' }}>{t.clauses.cotraitance}</div>
  </Section>
);

const renderCalendrier: SectionRenderer = (d, t, _ctx, newPage) => (
  <Section key="calendrier">
    <H2 template={t} newPage={newPage}>06. Calendrier Prévisionnel</H2>
    <div data-pdf-keep="true" style={{ width: '100%', marginTop: '10mm' }}><GanttChart data={d} /></div>
    <H3 style={{ marginTop: '10mm' }}>Récapitulatif des Durées</H3>
    <Table>
      <thead><tr><Th template={t}>Mission</Th><Th template={t}>Durée (jours)</Th><Th template={t}>Précédent</Th></tr></thead>
      <tbody>
        {d.calendrier.map(c => (
          <tr key={c.id}>
            <Td>{c.mission}</Td>
            <Td>{c.dureeJours} jours</Td>
            <Td>{c.apres ? d.calendrier.find(ms => ms.id === c.apres)?.mission : 'Début'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  </Section>
);

const renderMafCost: SectionRenderer = (_d, t, ctx, newPage) => (
  <Section key="mafCost">
    <H2 template={t} newPage={newPage}>Coût Assurance MAF</H2>
    <div data-pdf-keep="true">{ctx.mafCost && <MafCostBadge result={ctx.mafCost} showDetails />}</div>
  </Section>
);

const renderSignatures: SectionRenderer = (d, t, _ctx, newPage) => {
  // Une note annexe est un paragraphe de plus : la pagination peut couper entre deux.
  const appendixBlocks = t.clauses.appendixNotes.split(/\n{2,}/).filter(block => block.trim());
  return (
    <Section key="signatures">
      <H2 template={t} newPage={newPage}>07. Conditions Générales & Signatures</H2>
      <div data-pdf-keep="true" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10mm' }}>
        <div><H3>Modalités de Règlement</H3><P template={t} style={{ fontSize: '8pt' }}>{t.clauses.reglement}</P></div>
        <div><H3>Révision des Honoraires</H3><P template={t} style={{ fontSize: '8pt' }}>{t.clauses.revision}</P></div>
      </div>
      <div data-pdf-keep="true" style={{ marginTop: '6mm' }}>
        <H3>Résiliation</H3>
        <P template={t} style={{ fontSize: '8pt' }}>{t.clauses.resiliation}</P>
      </div>

      <div data-pdf-keep="true" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20mm', marginTop: '20mm' }}>
        <div style={{ border: '0.5px solid #eee', padding: '5mm', height: '40mm', position: 'relative' }}>
          <div style={{ fontSize: '7pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999', marginBottom: '2mm' }}>Le Maître d'Ouvrage</div>
          <div style={{ fontWeight: 'bold' }}>{d.entreprise ? d.nomSociete : d.clientNom}</div>
          <div style={{ fontSize: '7pt' }}>{d.representant} - {d.qualite}</div>
          <div style={{ position: 'absolute', bottom: '2mm', left: '5mm', fontSize: '7pt', fontStyle: 'italic' }}>"Lu et approuvé"</div>
        </div>
        <div style={{ border: '0.5px solid #eee', padding: '5mm', height: '40mm', position: 'relative' }}>
          <div style={{ fontSize: '7pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999', marginBottom: '2mm' }}>L'Architecte</div>
          <div style={{ fontWeight: 'bold' }}>{d.agenceNom}</div>
          <div style={{ fontSize: '7pt' }}>{d.architecteNom}{d.oaNumber ? `, OA n° ${d.oaNumber}` : ''}</div>
          <div style={{ position: 'absolute', bottom: '2mm', left: '5mm', fontSize: '7pt', fontStyle: 'italic' }}>"Lu et approuvé"</div>
        </div>
      </div>

      <div data-pdf-keep="true" style={{ marginTop: '10mm', textAlign: 'right', fontSize: '9pt' }}>Fait à {d.ville}, le {d.dateEmission}</div>

      {t.detailLevel === 'detaille' && appendixBlocks.length > 0 && (
        <div style={{ marginTop: '10mm', fontSize: '7.5pt', color: '#666' }}>
          <P template={t} style={{ fontStyle: 'italic' }}>Rappel des frais et coûts annexes à la charge du maître d'ouvrage, non compris dans la prestation</P>
          {appendixBlocks.map((block, i) => (
            <P key={i} template={t} style={{ whiteSpace: 'pre-wrap' }}>{block}</P>
          ))}
        </div>
      )}
    </Section>
  );
};

/** Sections du corps du document (la page de garde est à part). */
type BodySectionId = Exclude<ProposalSectionId, 'garde'>;

const SECTION_RENDERERS: Record<BodySectionId, SectionRenderer> = {
  objet: renderObjet,
  surfaces: renderSurfaces,
  honoraires: renderHonoraires,
  repartition: renderRepartition,
  cotraitants: renderCotraitants,
  calendrier: renderCalendrier,
  mafCost: renderMafCost,
  signatures: renderSignatures,
};

/** Une section sans matière (aucun cotraitant, pas de calendrier...) n'est pas imprimée. */
const SECTION_AVAILABLE: Record<BodySectionId, (d: ProposalPdfData, ctx: SectionCtx) => boolean> = {
  objet: () => true,
  surfaces: () => true,
  honoraires: () => true,
  repartition: () => true,
  cotraitants: d => d.cotraitants.length > 0,
  calendrier: d => d.calendrier.length > 0,
  mafCost: (_d, ctx) => !!ctx.mafCost,
  signatures: () => true,
};

// ─── Sidebar: section toggles + preset + visual + clauses ──────────────────

function TemplateEditorPanel({
  template, onChange, mafAvailable, open, onCloseMobile,
}: { template: ProposalTemplate; onChange: (t: ProposalTemplate) => void; mafAvailable: boolean; open: boolean; onCloseMobile: () => void }) {
  const visibleSections = PROPOSAL_SECTION_DEFS.filter(s => s.id !== 'mafCost' || mafAvailable);

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto
      w-80 max-w-[85vw] fixed inset-y-0 left-0 z-20 transition-transform duration-200
      ${open ? 'translate-x-0' : '-translate-x-full'}
      md:static md:translate-x-0 md:z-auto`}>
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconSettings size={18} className="text-zinc-400" />
          <h2 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Éditeur de Modèle</h2>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="md:hidden p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 rounded-lg"
          aria-label="Fermer l'éditeur de modèle"
        >
          <IconX size={18} />
        </button>
      </div>

      <div className="p-4 space-y-8">
        <section className="space-y-3">
          <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">Version</h3>
          <div className="flex rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 text-xs font-medium">
            <button
              type="button"
              onClick={() => onChange(applyPreset(template, 'court'))}
              className={`flex-1 py-2 ${template.detailLevel === 'court' ? 'bg-blue-600 text-white' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}
            >
              Courte
            </button>
            <button
              type="button"
              onClick={() => onChange(applyPreset(template, 'detaille'))}
              className={`flex-1 py-2 ${template.detailLevel === 'detaille' ? 'bg-blue-600 text-white' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}
            >
              Détaillée
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <IconLayout size={14} />
            <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest">Sections</h3>
          </div>
          <div className="space-y-2">
            {visibleSections.map(({ id, label }) => (
              <label key={id} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <span className="text-xs text-zinc-600 dark:text-zinc-400">{label}</span>
                <input
                  type="checkbox"
                  checked={template.pages[id]}
                  onChange={(e) => onChange({ ...template, pages: { ...template.pages, [id]: e.target.checked } })}
                  className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <IconLayoutRows size={14} />
            <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest">Mise en page</h3>
          </div>
          <div className="space-y-2">
            <label className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              <span className="text-xs text-zinc-600 dark:text-zinc-400">Saut de page avant chaque section</span>
              <input
                type="checkbox"
                checked={template.layout.sectionBreaks}
                onChange={(e) => onChange({ ...template, layout: { ...template.layout, sectionBreaks: e.target.checked } })}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
              />
            </label>
            <label className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              <span className="text-xs text-zinc-600 dark:text-zinc-400">Identité et logo des cotraitants</span>
              <input
                type="checkbox"
                checked={template.layout.cotraitantIdentity}
                onChange={(e) => onChange({ ...template, layout: { ...template.layout, cotraitantIdentity: e.target.checked } })}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
              />
            </label>
            <div className="space-y-1">
              <label htmlFor="proposal-table-density" className="text-[0.6875rem] font-bold text-zinc-400 uppercase">Place des tableaux</label>
              <select
                id="proposal-table-density"
                value={template.layout.tableDensity}
                onChange={(e) => onChange({ ...template, layout: { ...template.layout, tableDensity: e.target.value as TableDensity } })}
                className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs"
              >
                {TABLE_DENSITY_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <IconPalette size={14} />
            <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest">Personnalisation Visuelle</h3>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[0.6875rem] font-bold text-zinc-400 uppercase">Couleur Principale</label>
              <div className="flex gap-2">
                <input type="color" value={template.visual.primaryColor} onChange={(e) => onChange({ ...template, visual: { ...template.visual, primaryColor: e.target.value } })} className="w-10 h-8 rounded border-0 p-0 bg-transparent cursor-pointer" />
                <input type="text" value={template.visual.primaryColor} onChange={(e) => onChange({ ...template, visual: { ...template.visual, primaryColor: e.target.value } })} className="flex-1 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[0.6875rem] font-bold text-zinc-400 uppercase">Police de caractères</label>
              <select value={template.visual.fontFamily} onChange={(e) => onChange({ ...template, visual: { ...template.visual, fontFamily: e.target.value as ProposalTemplate['visual']['fontFamily'] } })} className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs">
                <option value="Helvetica">Helvetica / Sans-serif</option>
                <option value="Times New Roman">Times New Roman / Serif</option>
                <option value="Arial">Arial</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[0.6875rem] font-bold text-zinc-400 uppercase">Taille Logo</label>
                <select value={template.visual.logoSize} onChange={(e) => onChange({ ...template, visual: { ...template.visual, logoSize: e.target.value as ProposalTemplate['visual']['logoSize'] } })} className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs">
                  <option value="small">Petit</option>
                  <option value="medium">Moyen</option>
                  <option value="large">Grand</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[0.6875rem] font-bold text-zinc-400 uppercase">Position Logo</label>
                <select value={template.visual.logoPosition} onChange={(e) => onChange({ ...template, visual: { ...template.visual, logoPosition: e.target.value as ProposalTemplate['visual']['logoPosition'] } })} className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs">
                  <option value="left">Gauche</option>
                  <option value="center">Centre</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <IconLetterCase size={14} />
            <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest">Clauses & Textes</h3>
          </div>
          <div className="space-y-4">
            {([
              ['reglement', 'Modalités de règlement'],
              ['revision', 'Révision des honoraires'],
              ['resiliation', 'Résiliation'],
              ['cotraitance', 'Clause de cotraitance'],
              ['missionsText', 'Missions proposées (une par ligne)'],
              ['appendixNotes', 'Notes annexes (assurances, taxes...)'],
            ] as const).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <label className="text-[0.6875rem] font-bold text-zinc-400 uppercase">{label}</label>
                <textarea
                  value={template.clauses[key]}
                  onChange={(e) => onChange({ ...template, clauses: { ...template.clauses, [key]: e.target.value } })}
                  className="w-full h-24 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[0.6875rem] resize-none focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Main modal ──────────────────────────────────────────────────────────────

/** Les logos de cotraitants s'impriment à 13 mm de haut au plus : inutile de les garder plus grands. */
const PARTNER_LOGO_MAX_W = 600;
const PARTNER_LOGO_MAX_H = 300;

export function ProposalExportModal({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [template, setTemplate] = useState<ProposalTemplate>(() => loadStoredTemplate());
  const [isGenerating, setIsGenerating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    saveStoredTemplate(template);
  }, [template]);

  const mafCost = useMafCost({
    project: proposal,
    proposal,
    mafEnabled: !!settings?.maf_enabled,
    tauxContratPermil: parseFloat(String(settings?.maf_taux_contrat_permil ?? 0)),
  });

  const rawData = useMemo(() => mapProposalToPdfData(proposal, settings || {}), [proposal, settings]);

  // Logos are often uploaded at native camera/design-tool resolution — jsPDF
  // embeds <img> sources at their native pixel size regardless of CSS
  // display size, so an uncompressed logo can balloon export size by 100x+.
  // Compressing here (once) means the on-screen preview and the exported
  // PDF both use the same downscaled image — one source of truth.
  const [compressedLogo, setCompressedLogo] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (rawData.agenceLogo) {
      compressProposalLogo(rawData.agenceLogo).then(url => { if (alive) setCompressedLogo(url ?? undefined); });
    } else {
      setCompressedLogo(undefined);
    }
    return () => { alive = false; };
  }, [rawData.agenceLogo]);

  // Identité des cotraitants (raison sociale, coordonnées, SIRET, logo), lue sur
  // leurs fiches contact (best effort). Leurs logos sont réduits comme celui du cabinet.
  const [identities, setIdentities] = useState<Record<string, CotraitantIdentityPdf>>({});
  useEffect(() => {
    let alive = true;
    loadCotraitantIdentities(proposal.specialties_list).then(async list => {
      const entries = await Promise.all(list.map(async ({ logo, ...identity }) => {
        const reduced = logo ? await compressProposalLogo(logo.dataUrl, PARTNER_LOGO_MAX_W, PARTNER_LOGO_MAX_H) : null;
        return [identity.contactId, { ...identity, logo: reduced ?? undefined }] as const;
      }));
      if (alive) setIdentities(Object.fromEntries(entries));
    });
    return () => { alive = false; };
  }, [proposal.specialties_list]);

  const data = useMemo<ProposalPdfData>(() => {
    // Logos de la page de garde : ceux des cotraitants, dans l'ordre du groupement, sans doublon.
    const cotraitantLogos = [...new Set(
      rawData.cotraitants
        .map(c => (c.contactId ? identities[c.contactId]?.logo : undefined))
        .filter((logo): logo is string => !!logo),
    )];
    return {
      ...rawData,
      ...(compressedLogo ? { agenceLogo: compressedLogo } : {}),
      cotraitantIdentites: identities,
      cotraitantLogos,
    };
  }, [rawData, compressedLogo, identities]);

  const handleExport = async () => {
    if (!previewRef.current) return;
    setIsGenerating(true);
    try {
      await exportProposalPdf(previewRef.current, data);
    } catch (err) {
      console.error('PDF Generation Error:', err);
      alert(t('proposal_export_modal_pdf_error'));
    } finally {
      setIsGenerating(false);
    }
  };

  // Le contenu, la densité des tableaux ou l'arrivée d'un logo changent les
  // hauteurs : on repagine après chaque rendu (idempotent, voir paginateFlow).
  const repaginate = () => {
    if (!flowRef.current) return;
    const pages = paginateFlow(flowRef.current);
    setPageCount(current => (current === pages ? current : pages));
  };
  useLayoutEffect(repaginate);
  // Les polices peuvent arriver après le premier rendu et décaler les lignes.
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) repaginate(); });
    return () => { alive = false; };
  }, []);

  const hasCover = template.pages.garde;
  const sectionCtx: SectionCtx = { mafCost: template.pages.mafCost ? mafCost : null };
  const bodySections = PROPOSAL_SECTION_DEFS
    .filter((def): def is { id: BodySectionId; label: string } => def.id !== 'garde')
    .filter(({ id }) => template.pages[id] && SECTION_AVAILABLE[id](data, sectionCtx))
    // La première section s'ouvre toujours en haut d'une page (derrière la garde) ;
    // les suivantes seulement si le réglage « saut de page entre sections » est actif.
    .map(({ id }, index) => SECTION_RENDERERS[id](data, template, sectionCtx, index === 0 || template.layout.sectionBreaks));

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 w-full h-full flex flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(o => !o)}
              className="md:hidden p-1.5 -ml-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 rounded-lg"
              aria-label="Basculer l'éditeur de modèle"
            >
              <IconLayoutSidebar size={20} />
            </button>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Export PDF de la Proposition</h2>
              <p className="text-[0.6875rem] text-zinc-500 uppercase tracking-wider">{data.reference} | {data.indice} | {pageCount} page{pageCount > 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={isGenerating}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-bold transition"
            >
              <IconDownload size={16} />
              {isGenerating ? 'Génération...' : 'Exporter PDF'}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 rounded-lg transition-colors">
              <IconX size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden relative">
          {sidebarOpen && (
            <div className="fixed inset-0 z-10 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
          )}
          <TemplateEditorPanel
            template={template}
            onChange={setTemplate}
            mafAvailable={!!settings?.maf_enabled}
            open={sidebarOpen}
            onCloseMobile={() => setSidebarOpen(false)}
          />

          <div className="flex-1 overflow-auto p-8 bg-zinc-100 dark:bg-zinc-950">
            <style dangerouslySetInnerHTML={{ __html: getPdfStyles() }} />
            <div ref={previewRef} className="flex flex-col items-center gap-6">
              <DensityContext.Provider value={DENSITY_TOKENS[template.layout.tableDensity]}>
                {/* L'ombre est sur l'enveloppe : jsPDF ne sait pas la dessiner. */}
                <div style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.25)' }}>
                  <div
                    ref={flowRef}
                    data-pdf-flow="true"
                    onLoadCapture={repaginate}
                    style={{
                      position: 'relative',
                      width: '210mm',
                      background: '#fff',
                      color: '#000',
                      fontFamily: `"${template.visual.fontFamily}", sans-serif`,
                      boxSizing: 'border-box',
                    }}
                  >
                    {hasCover && renderGarde(data, template)}
                    <div data-pdf-body="true" style={{ padding: `${CONTENT_TOP_MM}mm ${SIDE_MARGIN} ${CONTENT_BOTTOM_MM}mm`, boxSizing: 'border-box' }}>
                      {bodySections}
                    </div>
                    <PageChrome d={data} pageCount={pageCount} hasCover={hasCover} />
                  </div>
                </div>
              </DensityContext.Provider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
