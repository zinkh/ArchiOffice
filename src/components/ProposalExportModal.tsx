import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconX, IconDownload, IconSettings, IconLayout, IconPalette, IconLetterCase, IconLayoutSidebar,
} from '@tabler/icons-react';
import type { Proposal, MafCostResult } from '../types';
import { useSettings } from '../hooks/useSettings';
import { useMafCost } from '../hooks/useMafCost';
import { MafCostBadge } from './MafCostBadge';
import {
  ProposalPdfData, ProposalTemplate, ProposalSectionId,
  PROPOSAL_SECTION_DEFS, mapProposalToPdfData, getPdfStyles,
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

function PdfPage({ template, fixedHeight, children }: { template: ProposalTemplate; fixedHeight?: boolean; children: React.ReactNode }) {
  return (
    <div
      data-pdf-page="true"
      style={{
        position: 'relative',
        width: '210mm',
        minHeight: fixedHeight ? undefined : '297mm',
        height: fixedHeight ? '297mm' : undefined,
        padding: '20mm 25mm',
        background: '#fff',
        fontFamily: `"${template.visual.fontFamily}", sans-serif`,
        color: '#000',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
}

function H2({ template, children }: { template: ProposalTemplate; children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: '16pt', fontWeight: 'bold', color: template.visual.primaryColor,
      marginTop: '8mm', marginBottom: '5mm',
      borderBottom: `1.5px solid ${template.visual.primaryColor}`, paddingBottom: '2mm',
      clear: 'both', textTransform: 'uppercase',
    }}>
      {children}
    </h2>
  );
}

function H3({ style, children }: { style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: '11pt', fontWeight: 'bold', marginTop: '7mm', marginBottom: '3mm',
      textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1e293b',
      ...style,
    }}>
      {children}
    </h3>
  );
}

function P({ template, style, children }: { template: ProposalTemplate; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <p style={{
      marginTop: 0, marginBottom: '3mm', lineHeight: template.visual.lineHeight ?? 1.5,
      fontSize: '9.5pt', color: '#334155', ...style,
    }}>
      {children}
    </p>
  );
}

function Table({ style, children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      {...rest}
      style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm', fontSize: '9.5pt', tableLayout: 'fixed', ...style }}
    >
      {children}
    </table>
  );
}

function Th({ template, style, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { template: ProposalTemplate }) {
  return (
    <th
      {...rest}
      style={{
        border: '0.5px solid #e2e8f0', padding: '2.5mm 3.5mm', textAlign: 'left', wordWrap: 'break-word',
        background: '#f8fafc', fontWeight: 'bold', color: template.visual.primaryColor,
        textTransform: 'uppercase', fontSize: '8pt',
        ...style,
      }}
    />
  );
}

function Td({ style, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...rest}
      style={{ border: '0.5px solid #e2e8f0', padding: '2.5mm 3.5mm', textAlign: 'left', wordWrap: 'break-word', ...style }}
    />
  );
}

// ─── Gantt chart (already JSX/SVG, no box-model CSS involved) ──────────────

function GanttChart({ data }: { data: ProposalPdfData }) {
  const missions = data.calendrier;
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
    const missionData = data.missions.find(ms => ms.designation === m.mission);
    let color = '#3b82f6';
    if (missionData?.categorie === 'execution') color = '#22c55e';
    if (missionData?.categorie === 'complementaire') color = '#f59e0b';
    return { name: m.mission, x: labelWidth + start, y: i * rowHeight + 40, width, color };
  });

  return (
    <svg width="100%" viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ marginTop: '10mm' }}>
      {Array.from({ length: 13 }).map((_, i) => (
        <React.Fragment key={i}>
          <line x1={labelWidth + (i * timelineWidth) / 12} y1={0} x2={labelWidth + (i * timelineWidth) / 12} y2={chartHeight} stroke="#eee" strokeWidth={0.5} />
          <text x={labelWidth + (i * timelineWidth) / 12 + 2} y={20} fontSize={7} fill="#999">M{i + 1}</text>
        </React.Fragment>
      ))}
      {timeline.map((bar, i) => (
        <React.Fragment key={i}>
          <text x={0} y={bar.y + 15} fontSize={8} fill="#333">{bar.name.substring(0, 25)}</text>
          <rect x={bar.x} y={bar.y} width={bar.width} height={15} fill={bar.color} rx={2} />
        </React.Fragment>
      ))}
    </svg>
  );
}

// ─── Per-page chrome ────────────────────────────────────────────────────────

function PageHeader({ d }: { d: ProposalPdfData }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      borderBottom: '0.5px solid #cbd5e1', paddingBottom: '3mm',
      fontSize: '8.5pt', color: '#475569', marginBottom: '12mm', width: '100%',
    }}>
      <div>{d.agenceNom}</div>
      <div>Réf: {d.reference} | Ind: {d.indice}</div>
    </div>
  );
}

function PageFooter({ d, page }: { d: ProposalPdfData; page: number }) {
  return (
    <div style={{
      position: 'absolute', bottom: '10mm', left: '25mm', right: '25mm',
      display: 'flex', justifyContent: 'space-between', fontSize: '7pt',
      color: '#94a3b8', borderTop: '0.5px solid #e2e8f0', paddingTop: '2mm',
    }}>
      <div>{d.agenceNom} - {d.dateEmission}</div>
      <div>Page {page}</div>
    </div>
  );
}

const BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f1f5f9', fg: '#475569' },
  sent: { bg: '#eff6ff', fg: '#2563eb' },
  accepted: { bg: '#f0fdf4', fg: '#16a34a' },
  rejected: { bg: '#fef2f2', fg: '#dc2626' },
};

// ─── Section renderers ──────────────────────────────────────────────────────
// One PDF page per enabled section — see exportProposalPdf's doc comment for
// why (pdf.html() doesn't auto-flow content across pages).

interface SectionCtx { mafCost: MafCostResult | null }
type SectionRenderer = (d: ProposalPdfData, t: ProposalTemplate, ctx: SectionCtx, page: number) => React.ReactNode;

const renderGarde: SectionRenderer = (d, t, _ctx, page) => {
  const badgeColor = BADGE_COLORS[d.status.toLowerCase()] ?? BADGE_COLORS.draft;
  return (
    <PdfPage template={t} fixedHeight key="garde">
      <div style={{ width: '100%', display: 'flex', justifyContent: t.visual.logoPosition === 'center' ? 'center' : 'flex-start' }}>
        {d.agenceLogo ? (
          <img src={d.agenceLogo} style={{ height: t.visual.logoSize === 'small' ? '15mm' : t.visual.logoSize === 'medium' ? '25mm' : '35mm' }} />
        ) : (
          <div style={{ fontSize: '24pt', fontWeight: 'bold', color: t.visual.primaryColor }}>{(d.agenceNom || '??').substring(0, 2).toUpperCase()}</div>
        )}
      </div>
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
        <div style={{ marginTop: '3mm', fontSize: '10pt', fontWeight: 500 }}>Architecte: {d.architecteNom}{d.oaNumber ? ` — Ordre des Architectes n° ${d.oaNumber}` : ''}</div>
      </div>
      <div style={{ width: '100%', textAlign: 'center', marginTop: '10mm' }}>
        <div style={{ display: 'inline-block', padding: '1mm 3mm', borderRadius: '1mm', fontSize: '8pt', fontWeight: 'bold', textTransform: 'uppercase', background: badgeColor.bg, color: badgeColor.fg }}>{d.status.toUpperCase()}</div>
        <div style={{ marginTop: '3mm', fontSize: '9pt', color: '#94a3b8' }}>Émis le {d.dateEmission}</div>
      </div>
      <PageFooter d={d} page={page} />
    </PdfPage>
  );
};

const renderObjet: SectionRenderer = (d, t, _ctx, page) => {
  const missionsList = t.clauses.missionsText.split('\n').filter(Boolean);
  return (
    <PdfPage template={t} key="objet">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <H2 template={t}>01. Objet de la Mission</H2>
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
        <div style={{ background: '#f9f9f9', padding: '4mm', borderLeft: `3px solid ${t.visual.primaryColor}` }}>
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
                  {missionsList.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </>
            )}
          </>
        )}
      </section>
      <div style={{ flex: 1 }} />
      <PageFooter d={d} page={page} />
    </PdfPage>
  );
};

const renderSurfaces: SectionRenderer = (d, t, _ctx, page) => (
  <PdfPage template={t} key="surfaces">
    <PageHeader d={d} />
    <section style={{ marginBottom: '10mm' }}>
      <H2 template={t}>02. Surfaces & Programme</H2>
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
      <div style={{ marginTop: '6mm', padding: '5mm', border: '1px solid #eee', borderRadius: '2mm' }}>
        <div style={{ fontSize: '10pt', fontWeight: 'bold', color: t.visual.primaryColor, marginBottom: '2mm' }}>Montant estimatif des travaux</div>
        <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>{formatCurrency(d.montantTravaux)} HT</div>
        <div style={{ fontSize: '8pt', color: '#666', marginTop: '1mm' }}>
          Taux de complexité {d.tauxComplexite}
          {(d.ratioRehab > 0 || d.ratioExtension > 0) && ` — Réhabilitation ${d.ratioRehab}% / Extension ${d.ratioExtension}%`}
        </div>
      </div>
    </section>
    <div style={{ flex: 1 }} />
    <PageFooter d={d} page={page} />
  </PdfPage>
);

const renderHonoraires: SectionRenderer = (d, t, ctx, page) => (
  <PdfPage template={t} key="honoraires">
    <PageHeader d={d} />
    <section style={{ marginBottom: '10mm' }}>
      <H2 template={t}>03. Étendue de la Mission & Honoraires</H2>

      {t.detailLevel === 'detaille' && (
        <>
          <div style={{ marginBottom: '6mm' }}>
            <P template={t}>Le Maître d'Ouvrage confie à l'Architecte une mission portant sur les phases suivantes :</P>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2mm', marginTop: '2mm' }}>
              {d.missions.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '2mm', fontSize: '8pt', ...(m.montantHT === 0 ? { color: '#ccc', fontStyle: 'italic' } : {}) }}>
                  <span>{m.montantHT > 0 ? '☑' : '☐'}</span> {m.designation}
                </div>
              ))}
            </div>
          </div>

          <H3>Calcul des Honoraires</H3>
          <Table>
            <thead><tr><Th template={t}>Catégorie</Th><Th template={t}>Mission</Th><Th template={t}>%</Th><Th template={t}>Montant HT</Th></tr></thead>
            <tbody>
              {(['base', 'execution', 'complementaire'] as const).map(cat => {
                const catMissions = d.missions.filter(m => m.categorie === cat);
                if (catMissions.length === 0) return null;
                const subtotal = catMissions.reduce((acc, m) => acc + m.montantHT, 0);
                const catLabel = cat === 'base' ? 'Missions de Base' : cat === 'execution' ? "Missions d'Exécution" : 'Missions Complémentaires';
                return (
                  <React.Fragment key={cat}>
                    <tr style={{ background: '#f1f5f9' }}><Td colSpan={4} style={{ fontWeight: 'bold' }}>{catLabel}</Td></tr>
                    {catMissions.map(m => (
                      <tr key={m.id} style={m.montantHT === 0 ? { color: '#999', fontStyle: 'italic' } : undefined}>
                        <Td></Td>
                        <Td>{m.designation}</Td>
                        <Td>{formatPercent(m.relPct)}</Td>
                        <Td>{formatCurrency(m.montantHT)}</Td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 'bold' }}>
                      <Td colSpan={3} style={{ textAlign: 'right' }}>Sous-total {cat}</Td>
                      <Td>{formatCurrency(subtotal)}</Td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </Table>
        </>
      )}

      <div style={{ marginTop: '10mm', marginLeft: 'auto', width: '60mm' }}>
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
        <div style={{ marginTop: '6mm' }}>
          <MafCostBadge result={ctx.mafCost} showDetails />
        </div>
      )}
    </section>
    <div style={{ flex: 1 }} />
    <PageFooter d={d} page={page} />
  </PdfPage>
);

const renderRepartition: SectionRenderer = (d, t, _ctx, page) => {
  const allIntervenants = Array.from(new Set(d.missions.flatMap(m => m.intervenants.map(i => i.nom))));

  if (t.detailLevel === 'court') {
    return (
      <PdfPage template={t} key="repartition">
        <PageHeader d={d} />
        <section style={{ marginBottom: '10mm' }}>
          <H2 template={t}>04. Répartition des Honoraires</H2>
          <div style={{ marginTop: '6mm', width: '80mm' }}>
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
        </section>
        <div style={{ flex: 1 }} />
        <PageFooter d={d} page={page} />
      </PdfPage>
    );
  }

  return (
    <PdfPage template={t} key="repartition">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <H2 template={t}>04. Répartition des Honoraires</H2>
        <Table style={{ fontSize: '7pt' }}>
          <thead>
            <tr>
              <Th template={t} rowSpan={2}>Désignation</Th>
              <Th template={t} rowSpan={2}>Montant HT</Th>
              <Th template={t} rowSpan={2}>Rel%</Th>
              {allIntervenants.map(name => <Th template={t} key={name} colSpan={2} style={{ textAlign: 'center' }}>{name}</Th>)}
            </tr>
            <tr>
              {allIntervenants.map(name => <React.Fragment key={name}><Th template={t}>%</Th><Th template={t}>€</Th></React.Fragment>)}
            </tr>
          </thead>
          <tbody>
            {d.missions.map(m => (
              <tr key={m.id}>
                <Td style={{ fontWeight: 'bold' }}>{m.designation}</Td>
                <Td>{formatCurrency(m.montantHT)}</Td>
                <Td>{formatPercent(m.relPct)}</Td>
                {allIntervenants.map(name => {
                  const i = m.intervenants.find(int => int.nom === name);
                  return (
                    <React.Fragment key={name}>
                      <Td>{formatPercent(i?.pct || 0)}</Td>
                      <Td>{formatCurrency(i?.montant || 0)}</Td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 'bold', background: '#f1f5f9' }}>
              <Td>TOTAL GÉNÉRAL HT</Td>
              <Td>{formatCurrency(d.montantHonorairesHT)}</Td>
              <Td>100.00 %</Td>
              {allIntervenants.map(name => {
                const total = d.missions.reduce((acc, m) => acc + (m.intervenants.find(i => i.nom === name)?.montant || 0), 0);
                return <Td key={name} colSpan={2} style={{ textAlign: 'right' }}>{formatCurrency(total)}</Td>;
              })}
            </tr>
          </tfoot>
        </Table>
      </section>
      <div style={{ flex: 1 }} />
      <PageFooter d={d} page={page} />
    </PdfPage>
  );
};

const renderCotraitants: SectionRenderer = (d, t, _ctx, page) => {
  if (d.cotraitants.length === 0) return null;
  return (
    <PdfPage template={t} key="cotraitants">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <H2 template={t}>05. Cotraitants & Spécialités</H2>
        <P template={t}>Pour la réalisation de cette mission, l'Architecte s'entoure des compétences suivantes :</P>
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
        <H3>Clause de Cotraitance</H3>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '8pt', color: '#444', textAlign: 'justify' }}>{t.clauses.cotraitance}</div>
      </section>
      <div style={{ flex: 1 }} />
      <PageFooter d={d} page={page} />
    </PdfPage>
  );
};

const renderCalendrier: SectionRenderer = (d, t, _ctx, page) => {
  if (d.calendrier.length === 0) return null;
  return (
    <PdfPage template={t} key="calendrier">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <H2 template={t}>06. Calendrier Prévisionnel</H2>
        <div style={{ width: '100%', marginTop: '10mm' }}><GanttChart data={d} /></div>
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
      </section>
      <div style={{ flex: 1 }} />
      <PageFooter d={d} page={page} />
    </PdfPage>
  );
};

const renderMafCost: SectionRenderer = (d, t, ctx, page) => {
  if (!ctx.mafCost) return null;
  return (
    <PdfPage template={t} key="mafCost">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <H2 template={t}>Coût Assurance MAF</H2>
        <MafCostBadge result={ctx.mafCost} showDetails />
      </section>
      <div style={{ flex: 1 }} />
      <PageFooter d={d} page={page} />
    </PdfPage>
  );
};

const renderSignatures: SectionRenderer = (d, t, _ctx, page) => (
  <PdfPage template={t} key="signatures">
    <PageHeader d={d} />
    <section style={{ marginBottom: '10mm' }}>
      <H2 template={t}>07. Conditions Générales & Signatures</H2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10mm' }}>
        <div><H3>Modalités de Règlement</H3><P template={t} style={{ fontSize: '8pt' }}>{t.clauses.reglement}</P></div>
        <div><H3>Révision des Honoraires</H3><P template={t} style={{ fontSize: '8pt' }}>{t.clauses.revision}</P></div>
      </div>
      <div style={{ marginTop: '6mm' }}>
        <H3>Résiliation</H3>
        <P template={t} style={{ fontSize: '8pt' }}>{t.clauses.resiliation}</P>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20mm', marginTop: '20mm' }}>
        <div style={{ border: '0.5px solid #eee', padding: '5mm', height: '40mm', position: 'relative' }}>
          <div style={{ fontSize: '7pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999', marginBottom: '2mm' }}>Le Maître d'Ouvrage</div>
          <div style={{ fontWeight: 'bold' }}>{d.entreprise ? d.nomSociete : d.clientNom}</div>
          <div style={{ fontSize: '7pt' }}>{d.representant} - {d.qualite}</div>
          <div style={{ position: 'absolute', bottom: '2mm', left: '5mm', fontSize: '7pt', fontStyle: 'italic' }}>"Lu et approuvé"</div>
        </div>
        <div style={{ border: '0.5px solid #eee', padding: '5mm', height: '40mm', position: 'relative' }}>
          <div style={{ fontSize: '7pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#999', marginBottom: '2mm' }}>L'Architecte</div>
          <div style={{ fontWeight: 'bold' }}>{d.agenceNom}</div>
          <div style={{ fontSize: '7pt' }}>{d.architecteNom}{d.oaNumber ? ` — OA n° ${d.oaNumber}` : ''}</div>
          <div style={{ position: 'absolute', bottom: '2mm', left: '5mm', fontSize: '7pt', fontStyle: 'italic' }}>"Lu et approuvé"</div>
        </div>
      </div>

      <div style={{ marginTop: '10mm', textAlign: 'right', fontSize: '9pt' }}>Fait à {d.ville}, le {d.dateEmission}</div>

      {t.detailLevel === 'detaille' && t.clauses.appendixNotes && (
        <div style={{ marginTop: '10mm', fontSize: '7.5pt', color: '#666' }}>
          <P template={t} style={{ fontStyle: 'italic' }}>Rappel des frais et coûts annexes à la charge du maître d'ouvrage, non compris dans la prestation</P>
          <P template={t} style={{ whiteSpace: 'pre-wrap' }}>{t.clauses.appendixNotes}</P>
        </div>
      )}
    </section>
    <div style={{ flex: 1 }} />
    <PageFooter d={d} page={page} />
  </PdfPage>
);

const SECTION_RENDERERS: Record<ProposalSectionId, SectionRenderer> = {
  garde: renderGarde,
  objet: renderObjet,
  surfaces: renderSurfaces,
  honoraires: renderHonoraires,
  repartition: renderRepartition,
  cotraitants: renderCotraitants,
  calendrier: renderCalendrier,
  mafCost: renderMafCost,
  signatures: renderSignatures,
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
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">Version</h3>
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
            <h3 className="text-[10px] font-bold uppercase tracking-widest">Sections</h3>
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

        <section className="space-y-4">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <IconPalette size={14} />
            <h3 className="text-[10px] font-bold uppercase tracking-widest">Personnalisation Visuelle</h3>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[8px] font-bold text-zinc-400 uppercase">Couleur Principale</label>
              <div className="flex gap-2">
                <input type="color" value={template.visual.primaryColor} onChange={(e) => onChange({ ...template, visual: { ...template.visual, primaryColor: e.target.value } })} className="w-10 h-8 rounded border-0 p-0 bg-transparent cursor-pointer" />
                <input type="text" value={template.visual.primaryColor} onChange={(e) => onChange({ ...template, visual: { ...template.visual, primaryColor: e.target.value } })} className="flex-1 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-bold text-zinc-400 uppercase">Police de caractères</label>
              <select value={template.visual.fontFamily} onChange={(e) => onChange({ ...template, visual: { ...template.visual, fontFamily: e.target.value as ProposalTemplate['visual']['fontFamily'] } })} className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs">
                <option value="Helvetica">Helvetica / Sans-serif</option>
                <option value="Times New Roman">Times New Roman / Serif</option>
                <option value="Arial">Arial</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-zinc-400 uppercase">Taille Logo</label>
                <select value={template.visual.logoSize} onChange={(e) => onChange({ ...template, visual: { ...template.visual, logoSize: e.target.value as ProposalTemplate['visual']['logoSize'] } })} className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs">
                  <option value="small">Petit</option>
                  <option value="medium">Moyen</option>
                  <option value="large">Grand</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-zinc-400 uppercase">Position Logo</label>
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
            <h3 className="text-[10px] font-bold uppercase tracking-widest">Clauses & Textes</h3>
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
                <label className="text-[8px] font-bold text-zinc-400 uppercase">{label}</label>
                <textarea
                  value={template.clauses[key]}
                  onChange={(e) => onChange({ ...template, clauses: { ...template.clauses, [key]: e.target.value } })}
                  className="w-full h-24 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] resize-none focus:ring-1 focus:ring-blue-500 outline-none"
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

export function ProposalExportModal({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const { settings } = useSettings();
  const [template, setTemplate] = useState<ProposalTemplate>(() => loadStoredTemplate());
  const [isGenerating, setIsGenerating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

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

  const data = useMemo(
    () => (compressedLogo ? { ...rawData, agenceLogo: compressedLogo } : rawData),
    [rawData, compressedLogo],
  );

  const handleExport = async () => {
    if (!previewRef.current) return;
    setIsGenerating(true);
    try {
      await exportProposalPdf(previewRef.current, data);
    } catch (err) {
      console.error('PDF Generation Error:', err);
      alert('Erreur lors de la génération du PDF. Veuillez réessayer.');
    } finally {
      setIsGenerating(false);
    }
  };

  let pageCounter = 0;
  const pages = PROPOSAL_SECTION_DEFS
    .filter(({ id }) => template.pages[id])
    .map(({ id }) => {
      const node = SECTION_RENDERERS[id](data, template, { mafCost: template.pages.mafCost ? mafCost : null }, pageCounter + 1);
      if (node) pageCounter++;
      return node;
    })
    .filter(Boolean);

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
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{data.reference} | {data.indice}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={isGenerating}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-bold transition-all"
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
              {pages}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
