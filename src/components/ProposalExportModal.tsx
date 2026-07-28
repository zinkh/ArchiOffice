import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconX, IconDownload, IconSettings, IconLayout, IconPalette, IconLetterCase,
} from '@tabler/icons-react';
import type { Proposal, MafCostResult } from '../types';
import { useSettings } from '../hooks/useSettings';
import { useMafCost } from '../hooks/useMafCost';
import { MafCostBadge } from './MafCostBadge';
import {
  ProposalPdfData, ProposalTemplate, ProposalSectionId,
  PROPOSAL_SECTION_DEFS, mapProposalToPdfData, getPdfStyles,
  loadStoredTemplate, saveStoredTemplate, applyPreset,
  exportProposalPdf, formatCurrency, formatPercent,
} from '../lib/proposalExport';

// ─── Gantt chart (ported as-is from the former ProposalModule.tsx — already JSX/SVG) ───

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
    <div className="pdf-header">
      <div>{d.agenceNom}</div>
      <div>Réf: {d.reference} | Ind: {d.indice}</div>
    </div>
  );
}

function PageFooter({ d, page }: { d: ProposalPdfData; page: number }) {
  return (
    <div className="pdf-footer">
      <div>{d.agenceNom} - {d.dateEmission}</div>
      <div>Page {page}</div>
    </div>
  );
}

// ─── Section renderers ──────────────────────────────────────────────────────
// One .pdf-page per enabled section — see exportProposalPdf's doc comment for
// why (pdf.html() doesn't auto-flow content across pages).

interface SectionCtx { mafCost: MafCostResult | null }
type SectionRenderer = (d: ProposalPdfData, t: ProposalTemplate, ctx: SectionCtx, page: number) => React.ReactNode;

const renderGarde: SectionRenderer = (d, t, _ctx, page) => (
  <div className="pdf-page fixed-height" key="garde">
    <div style={{ width: '100%', display: 'flex', justifyContent: t.visual.logoPosition === 'center' ? 'center' : 'flex-start' }}>
      {d.agenceLogo ? (
        <img src={d.agenceLogo} style={{ height: t.visual.logoSize === 'small' ? '15mm' : t.visual.logoSize === 'medium' ? '25mm' : '35mm' }} />
      ) : (
        <div style={{ fontSize: '24pt', fontWeight: 'bold', color: t.visual.primaryColor }}>{(d.agenceNom || '??').substring(0, 2).toUpperCase()}</div>
      )}
    </div>
    <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <h1 style={{ marginBottom: '5mm' }}>LETTRE DE MISSION</h1>
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
      <div className={`pdf-badge pdf-badge-${d.status.toLowerCase()}`}>{d.status.toUpperCase()}</div>
      <div style={{ marginTop: '3mm', fontSize: '9pt', color: '#94a3b8' }}>Émis le {d.dateEmission}</div>
    </div>
    <PageFooter d={d} page={page} />
  </div>
);

const renderObjet: SectionRenderer = (d, t, _ctx, page) => {
  const missionsList = t.clauses.missionsText.split('\n').filter(Boolean);
  return (
    <div className="pdf-page" key="objet">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <h2>01. Objet de la Mission</h2>
        <h3>Désignation du Maître d'Ouvrage</h3>
        <table>
          <tbody>
            <tr><td width="30%">Nom / Société</td><td>{d.entreprise ? d.nomSociete : d.clientNom}</td></tr>
            {d.entreprise && <tr><td>RCS / SIRET</td><td>{d.rcs}</td></tr>}
            {t.detailLevel === 'detaille' && <tr><td>Représentant</td><td>{d.representant} ({d.qualite})</td></tr>}
            <tr><td>Adresse</td><td>{d.adresse}, {d.codePostal} {d.ville}</td></tr>
            <tr><td>Contact</td><td>{d.email} | {d.telephone}</td></tr>
          </tbody>
        </table>

        <h3>Désignation de l'Opération</h3>
        <div style={{ background: '#f9f9f9', padding: '4mm', borderLeft: `3px solid ${t.visual.primaryColor}` }}>
          <div style={{ fontWeight: 'bold', marginBottom: '2mm' }}>{d.titre}</div>
          <p>{d.detailProjet}</p>
        </div>
        <p style={{ marginTop: '4mm' }}>{d.descriptionGenerale}</p>

        <h3>Situation du Terrain</h3>
        <table>
          <tbody>
            <tr><td width="30%">Adresse</td><td>{d.adresseTerrain}, {d.cpTerrain} {d.villeTerrain}</td></tr>
            <tr><td>Réf. Cadastrale</td><td>{d.refCadastrale}</td></tr>
            <tr><td>Surface Parcelle</td><td>{d.surfaceParcelle} m²</td></tr>
            {t.detailLevel === 'detaille' && <tr><td>Zone PLU</td><td>{d.zonePLU}</td></tr>}
          </tbody>
        </table>

        {t.detailLevel === 'detaille' && (
          <>
            <h3>Caractéristiques de l'Ouvrage</h3>
            <table>
              <thead><tr><th>État</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td>Avant Travaux</td><td>{d.avantTravaux}</td></tr>
                <tr><td>Après Travaux</td><td>{d.apresTravaux}</td></tr>
                <tr><td>Type / Catégorie</td><td>{d.typeEtCat} ({d.type} - {d.categorie})</td></tr>
              </tbody>
            </table>

            {missionsList.length > 0 && (
              <>
                <h3>Missions Proposées</h3>
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
    </div>
  );
};

const renderSurfaces: SectionRenderer = (d, t, _ctx, page) => (
  <div className="pdf-page" key="surfaces">
    <PageHeader d={d} />
    <section style={{ marginBottom: '10mm' }}>
      <h2>02. Surfaces & Programme</h2>
      <h3>Tableau des Surfaces</h3>
      <table>
        <thead><tr><th>Désignation</th><th>Surface (m²)</th></tr></thead>
        <tbody>
          <tr><td>Surface de Plancher</td><td>{d.surfPlancher} m²</td></tr>
          <tr><td>Surface d'Extension</td><td>{d.surfExtension} m²</td></tr>
          <tr><td>Surface ERP</td><td>{d.surfERP} m²</td></tr>
          <tr><td>Surface ERT</td><td>{d.surfERT} m²</td></tr>
        </tbody>
      </table>
      <h3>Effectifs</h3>
      <table>
        <tbody>
          <tr><td width="50%">Public admissible</td><td>{d.effectifPublic} personnes</td></tr>
          <tr><td>Personnel</td><td>{d.effectifPersonnel} personnes</td></tr>
        </tbody>
      </table>
      <h3>Budget & Programme</h3>
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
  </div>
);

const renderHonoraires: SectionRenderer = (d, t, ctx, page) => (
  <div className="pdf-page" key="honoraires">
    <PageHeader d={d} />
    <section style={{ marginBottom: '10mm' }}>
      <h2>03. Étendue de la Mission & Honoraires</h2>

      {t.detailLevel === 'detaille' && (
        <>
          <div style={{ marginBottom: '6mm' }}>
            <p>Le Maître d'Ouvrage confie à l'Architecte une mission portant sur les phases suivantes :</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2mm', marginTop: '2mm' }}>
              {d.missions.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '2mm', fontSize: '8pt', ...(m.montantHT === 0 ? { color: '#ccc', fontStyle: 'italic' } : {}) }}>
                  <span>{m.montantHT > 0 ? '☑' : '☐'}</span> {m.designation}
                </div>
              ))}
            </div>
          </div>

          <h3>Calcul des Honoraires</h3>
          <table>
            <thead><tr><th>Catégorie</th><th>Mission</th><th>%</th><th>Montant HT</th></tr></thead>
            <tbody>
              {(['base', 'execution', 'complementaire'] as const).map(cat => {
                const catMissions = d.missions.filter(m => m.categorie === cat);
                if (catMissions.length === 0) return null;
                const subtotal = catMissions.reduce((acc, m) => acc + m.montantHT, 0);
                const catLabel = cat === 'base' ? 'Missions de Base' : cat === 'execution' ? "Missions d'Exécution" : 'Missions Complémentaires';
                return (
                  <React.Fragment key={cat}>
                    <tr style={{ background: '#f1f5f9' }}><td colSpan={4} style={{ fontWeight: 'bold' }}>{catLabel}</td></tr>
                    {catMissions.map(m => (
                      <tr key={m.id} style={m.montantHT === 0 ? { color: '#999', fontStyle: 'italic' } : undefined}>
                        <td></td>
                        <td>{m.designation}</td>
                        <td>{formatPercent(m.relPct)}</td>
                        <td>{formatCurrency(m.montantHT)}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 'bold' }}>
                      <td colSpan={3} style={{ textAlign: 'right' }}>Sous-total {cat}</td>
                      <td>{formatCurrency(subtotal)}</td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
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
  </div>
);

const renderRepartition: SectionRenderer = (d, t, _ctx, page) => {
  const allIntervenants = Array.from(new Set(d.missions.flatMap(m => m.intervenants.map(i => i.nom))));

  if (t.detailLevel === 'court') {
    return (
      <div className="pdf-page" key="repartition">
        <PageHeader d={d} />
        <section style={{ marginBottom: '10mm' }}>
          <h2>04. Répartition des Honoraires</h2>
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
      </div>
    );
  }

  return (
    <div className="pdf-page" key="repartition">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <h2>04. Répartition des Honoraires</h2>
        <table style={{ fontSize: '7pt' }}>
          <thead>
            <tr>
              <th rowSpan={2}>Désignation</th>
              <th rowSpan={2}>Montant HT</th>
              <th rowSpan={2}>Rel%</th>
              {allIntervenants.map(name => <th key={name} colSpan={2} style={{ textAlign: 'center' }}>{name}</th>)}
            </tr>
            <tr>
              {allIntervenants.map(name => <React.Fragment key={name}><th>%</th><th>€</th></React.Fragment>)}
            </tr>
          </thead>
          <tbody>
            {d.missions.map(m => (
              <tr key={m.id}>
                <td style={{ fontWeight: 'bold' }}>{m.designation}</td>
                <td>{formatCurrency(m.montantHT)}</td>
                <td>{formatPercent(m.relPct)}</td>
                {allIntervenants.map(name => {
                  const i = m.intervenants.find(int => int.nom === name);
                  return (
                    <React.Fragment key={name}>
                      <td>{formatPercent(i?.pct || 0)}</td>
                      <td>{formatCurrency(i?.montant || 0)}</td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 'bold', background: '#f1f5f9' }}>
              <td>TOTAL GÉNÉRAL HT</td>
              <td>{formatCurrency(d.montantHonorairesHT)}</td>
              <td>100.00 %</td>
              {allIntervenants.map(name => {
                const total = d.missions.reduce((acc, m) => acc + (m.intervenants.find(i => i.nom === name)?.montant || 0), 0);
                return <td key={name} colSpan={2} style={{ textAlign: 'right' }}>{formatCurrency(total)}</td>;
              })}
            </tr>
          </tfoot>
        </table>
      </section>
      <div style={{ flex: 1 }} />
      <PageFooter d={d} page={page} />
    </div>
  );
};

const renderCotraitants: SectionRenderer = (d, t, _ctx, page) => {
  if (d.cotraitants.length === 0) return null;
  return (
    <div className="pdf-page" key="cotraitants">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <h2>05. Cotraitants & Spécialités</h2>
        <p>Pour la réalisation de cette mission, l'Architecte s'entoure des compétences suivantes :</p>
        <table>
          <thead><tr><th>Spécialité</th><th>Contact / Société</th><th>Rôle</th></tr></thead>
          <tbody>
            {d.cotraitants.map((c, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 'bold' }}>{c.specialite}</td>
                <td>{c.contact}</td>
                <td>{c.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Clause de Cotraitance</h3>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '8pt', color: '#444', textAlign: 'justify' }}>{t.clauses.cotraitance}</div>
      </section>
      <div style={{ flex: 1 }} />
      <PageFooter d={d} page={page} />
    </div>
  );
};

const renderCalendrier: SectionRenderer = (d, _t, _ctx, page) => {
  if (d.calendrier.length === 0) return null;
  return (
    <div className="pdf-page" key="calendrier">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <h2>06. Calendrier Prévisionnel</h2>
        <div style={{ width: '100%', marginTop: '10mm' }}><GanttChart data={d} /></div>
        <h3 style={{ marginTop: '10mm' }}>Récapitulatif des Durées</h3>
        <table>
          <thead><tr><th>Mission</th><th>Durée (jours)</th><th>Précédent</th></tr></thead>
          <tbody>
            {d.calendrier.map(c => (
              <tr key={c.id}>
                <td>{c.mission}</td>
                <td>{c.dureeJours} jours</td>
                <td>{c.apres ? d.calendrier.find(ms => ms.id === c.apres)?.mission : 'Début'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div style={{ flex: 1 }} />
      <PageFooter d={d} page={page} />
    </div>
  );
};

const renderMafCost: SectionRenderer = (d, _t, ctx, page) => {
  if (!ctx.mafCost) return null;
  return (
    <div className="pdf-page" key="mafCost">
      <PageHeader d={d} />
      <section style={{ marginBottom: '10mm' }}>
        <h2>Coût Assurance MAF</h2>
        <MafCostBadge result={ctx.mafCost} showDetails />
      </section>
      <div style={{ flex: 1 }} />
      <PageFooter d={d} page={page} />
    </div>
  );
};

const renderSignatures: SectionRenderer = (d, t, _ctx, page) => (
  <div className="pdf-page" key="signatures">
    <PageHeader d={d} />
    <section style={{ marginBottom: '10mm' }}>
      <h2>07. Conditions Générales & Signatures</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10mm' }}>
        <div><h3>Modalités de Règlement</h3><p style={{ fontSize: '8pt' }}>{t.clauses.reglement}</p></div>
        <div><h3>Révision des Honoraires</h3><p style={{ fontSize: '8pt' }}>{t.clauses.revision}</p></div>
      </div>
      <div style={{ marginTop: '6mm' }}>
        <h3>Résiliation</h3>
        <p style={{ fontSize: '8pt' }}>{t.clauses.resiliation}</p>
      </div>

      <div className="signature-grid">
        <div className="signature-box">
          <div className="signature-label">Le Maître d'Ouvrage</div>
          <div style={{ fontWeight: 'bold' }}>{d.entreprise ? d.nomSociete : d.clientNom}</div>
          <div style={{ fontSize: '7pt' }}>{d.representant} - {d.qualite}</div>
          <div style={{ position: 'absolute', bottom: '2mm', left: '5mm', fontSize: '7pt', fontStyle: 'italic' }}>"Lu et approuvé"</div>
        </div>
        <div className="signature-box">
          <div className="signature-label">L'Architecte</div>
          <div style={{ fontWeight: 'bold' }}>{d.agenceNom}</div>
          <div style={{ fontSize: '7pt' }}>{d.architecteNom}{d.oaNumber ? ` — OA n° ${d.oaNumber}` : ''}</div>
          <div style={{ position: 'absolute', bottom: '2mm', left: '5mm', fontSize: '7pt', fontStyle: 'italic' }}>"Lu et approuvé"</div>
        </div>
      </div>

      <div style={{ marginTop: '10mm', textAlign: 'right', fontSize: '9pt' }}>Fait à {d.ville}, le {d.dateEmission}</div>

      {t.detailLevel === 'detaille' && t.clauses.appendixNotes && (
        <div style={{ marginTop: '10mm', fontSize: '7.5pt', color: '#666' }}>
          <p style={{ fontStyle: 'italic' }}>Rappel des frais et coûts annexes à la charge du maître d'ouvrage, non compris dans la prestation</p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{t.clauses.appendixNotes}</p>
        </div>
      )}
    </section>
    <div style={{ flex: 1 }} />
    <PageFooter d={d} page={page} />
  </div>
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
  template, onChange, mafAvailable,
}: { template: ProposalTemplate; onChange: (t: ProposalTemplate) => void; mafAvailable: boolean }) {
  const visibleSections = PROPOSAL_SECTION_DEFS.filter(s => s.id !== 'mafCost' || mafAvailable);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 w-80 overflow-y-auto">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
        <IconSettings size={18} className="text-zinc-400" />
        <h2 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Éditeur de Modèle</h2>
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

  const data = useMemo(() => mapProposalToPdfData(proposal, settings || {}), [proposal, settings]);

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
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Export PDF de la Proposition</h2>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{data.reference} | {data.indice}</p>
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

        <div className="flex-1 flex overflow-hidden">
          <TemplateEditorPanel template={template} onChange={setTemplate} mafAvailable={!!settings?.maf_enabled} />

          <div className="flex-1 overflow-auto p-8 bg-zinc-100 dark:bg-zinc-950">
            <style dangerouslySetInnerHTML={{ __html: getPdfStyles(template) }} />
            <div ref={previewRef} className="flex flex-col items-center gap-6">
              {pages}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
