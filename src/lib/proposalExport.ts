// Unified proposal PDF export — data model, DB mapper, section metadata,
// template presets and jsPDF pipeline. Replaces the two former, independent
// systems (src/components/ProposalGenerator.tsx and
// src/components/ProposalModule.tsx): the first produced a "courte/détaillée"
// PDF from almost entirely hardcoded content, the second produced a
// section-toggleable PDF that read real proposal data but printed via
// window.print() (no Blob, so it never reached autoSaveDocument) and still
// hardcoded the agency/architect identity.
//
// This file is intentionally React-free — JSX section rendering lives in
// src/components/ProposalExportModal.tsx, which is the only place that needs it.
import type { Proposal, ProposalSpecialty } from '../types';
import { autoSaveDocument } from './autoSaveDocument';
import { compressImage } from './imageCompression';

// ─── Agency settings (as returned by GET /api/settings) ────────────────────
// server.ts's toCamel map only covers a subset of columns (see
// server.ts:6424-6436) — everything else (address, phone, maf_enabled, ...)
// passes through as raw snake_case. Reflect that exactly, don't invent a
// fully-camelCase shape that doesn't match the real response.
export interface AgencySettings {
  agencyName?: string;
  address?: string;
  phone?: string;
  email?: string;
  siret?: string;
  ape?: string;
  vatNumber?: string;
  logoUrl?: string;
  currency?: string;
  language?: string;
  architectName?: string;
  oaNumber?: string;
  maf_enabled?: boolean;
  maf_taux_contrat_permil?: number | string;
  maf_numero_adherent?: string;
  maf_declaration_year?: number;
  [key: string]: unknown;
}

// ─── Data model consumed by the PDF sections ────────────────────────────────

export interface MissionIntervenant {
  contactId: string; // 'architect' for the agency's own share
  nom: string;
  pct: number;
  montant: number;
}

export interface MissionLine {
  id: string;
  designation: string;
  categorie: 'base' | 'execution' | 'complementaire';
  montantHT: number;
  relPct: number;
  intervenants: MissionIntervenant[];
}

export interface CalendrierItem {
  id: string;
  mission: string;
  dureeJours: number;
  apres: string; // id of the previous mission, '' if first
}

export interface ProposalPdfData {
  reference: string;
  titre: string;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Rejected';
  indice: string;
  dateEmission: string;

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
  email: string;

  detailProjet: string;
  descriptionGenerale: string;
  nomEtablissement: string;

  adresseTerrain: string;
  cpTerrain: string;
  villeTerrain: string;
  refCadastrale: string;
  zonePLU: string;
  surfaceParcelle: number;
  avantTravaux: string;
  apresTravaux: string;
  typeEtCat: string;
  type: string;
  categorie: string;

  surfPlancher: number;
  surfExtension: number;
  surfERP: number;
  surfERT: number;
  effectifPublic: number;
  effectifPersonnel: number;

  montantTravaux: number;
  tauxComplexite: number;
  ratioRehab: number;
  ratioExtension: number;
  pctHonorairesBase: number;
  pctAvecExe: number;
  pctMissionsComp: number;
  montantHonorairesHT: number;
  tauxTVA: number;
  montantTVA: number;
  montantTTC: number;

  cotraitants: Array<{ specialite: string; contact: string; role: string }>;
  missions: MissionLine[];
  calendrier: CalendrierItem[];
  notes: string;

  agenceNom: string;
  agenceAdresse: string;
  agenceLogo?: string;
  architecteNom: string;
  oaNumber: string;
}

// ─── Template (sections + clauses + visual style) ──────────────────────────

export type ProposalSectionId =
  | 'garde' | 'objet' | 'surfaces' | 'honoraires' | 'repartition'
  | 'cotraitants' | 'calendrier' | 'mafCost' | 'signatures';

export interface ProposalTemplate {
  detailLevel: 'court' | 'detaille';
  pages: Record<ProposalSectionId, boolean>;
  clauses: {
    reglement: string;
    revision: string;
    resiliation: string;
    cotraitance: string;
    missionsText: string; // free-text mission checklist, ported from the old "courte/détaillée" generator
    appendixNotes: string; // insurance/tax boilerplate, ported from the old "courte/détaillée" generator
  };
  visual: {
    primaryColor: string;
    fontFamily: 'Helvetica' | 'Times New Roman' | 'Arial';
    logoSize: 'small' | 'medium' | 'large';
    logoPosition: 'left' | 'center';
    lineHeight: number;
  };
}

export const PROPOSAL_SECTION_DEFS: { id: ProposalSectionId; label: string }[] = [
  { id: 'garde', label: 'Page de garde' },
  { id: 'objet', label: 'Objet de la mission' },
  { id: 'surfaces', label: 'Surfaces & Programme' },
  { id: 'honoraires', label: 'Honoraires' },
  { id: 'repartition', label: 'Répartition des honoraires' },
  { id: 'cotraitants', label: 'Cotraitants & spécialités' },
  { id: 'calendrier', label: 'Calendrier prévisionnel' },
  { id: 'mafCost', label: 'Coût assurance MAF' },
  { id: 'signatures', label: 'Conditions générales & signatures' },
];

export const PRESET_COURT: ProposalTemplate['pages'] = {
  garde: false, objet: true, surfaces: false, honoraires: true,
  repartition: false, cotraitants: false, calendrier: true,
  mafCost: false, signatures: true,
};

export const PRESET_DETAILLE: ProposalTemplate['pages'] = {
  garde: true, objet: true, surfaces: true, honoraires: true,
  repartition: true, cotraitants: true, calendrier: true,
  mafCost: false, signatures: true,
};

const DEFAULT_MISSIONS_TEXT = [
  "Visite initiale de prise de connaissance du programme du client et du site de construction",
  "Prise en compte des caractéristiques physiques et réglementaires du site",
  "Relevé dimensionnel et altimétrique d'existant en complément des plans fournis par le M.O.",
  "Mise au point esquisses en concertation avec le Maître d'Ouvrage",
  "Mise au point avant projet en concertation avec le Maître d'Ouvrage, les services instructeurs et intégrant les incidences techniques existant et programme",
  "Etablissement des pièces écrites et graphiques de la demande d'Autorisation",
  "Suivi de l'instruction du dossier, et réponses aux questions éventuelles",
  "Modification et compléments d'informations demandés par les services instructeurs",
].join('\n');

const DEFAULT_APPENDIX_NOTES = "Assurances obligatoires\nAssurance dommages-ouvrage (DO) : 1,5 à 3 % du coût des travaux HT\nAssurance CNR (uniquement si vente dans les 10 ans) : variable\n\nÉtudes techniques obligatoires\nÉtude géotechnique de sol (G2-AVP) pour le dimensionnement des fondations : 1 500 à 2 000 € HT\nÉtude thermique et fluides RE2020 (au dépôt du permis de construire et à l'achèvement) : 1 500 à 2 000 € HT\nÉtude de structure (béton, charpente, fondations) : 2 000 à 3 000 € HT - Facultatif mais fortement conseillé\n\nTaxes et participations\nTaxe d'aménagement (TA) : calculée sur la surface taxable × valeur forfaitaire × taux communal/départemental\nParticipation raccordement réseaux (eau, assainissement, électricité, gaz, télécom) : 3 000 à 15 000 € selon commune";

export function buildDefaultTemplate(detailLevel: 'court' | 'detaille' = 'detaille'): ProposalTemplate {
  return {
    detailLevel,
    pages: { ...(detailLevel === 'court' ? PRESET_COURT : PRESET_DETAILLE) },
    clauses: {
      reglement: "Les honoraires sont payables à réception de facture. Tout retard de paiement entraînera l'application d'intérêts moratoires au taux légal en vigueur.",
      revision: "Les honoraires sont révisables annuellement selon l'indice BT01 en vigueur à la date de signature du contrat.",
      resiliation: "Chaque partie peut résilier le présent contrat par lettre recommandée avec accusé de réception, moyennant un préavis de 30 jours.",
      cotraitance: "Les cotraitants sont solidaires de l'Architecte pour l'exécution technique de leurs missions respectives. Chaque cotraitant est responsable de sa propre assurance professionnelle.",
      missionsText: DEFAULT_MISSIONS_TEXT,
      appendixNotes: DEFAULT_APPENDIX_NOTES,
    },
    visual: {
      primaryColor: '#2563eb',
      fontFamily: 'Helvetica',
      logoSize: 'medium',
      logoPosition: 'left',
      lineHeight: 1.5,
    },
  };
}

const STORAGE_KEY = 'proposalTemplate';

export function loadStoredTemplate(): ProposalTemplate {
  const defaults = buildDefaultTemplate('detaille');
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaults;
  try {
    const parsed = JSON.parse(saved);
    return {
      ...defaults,
      ...parsed,
      pages: { ...defaults.pages, ...parsed.pages },
      clauses: { ...defaults.clauses, ...parsed.clauses },
      visual: { ...defaults.visual, ...parsed.visual },
    };
  } catch {
    return defaults;
  }
}

export function saveStoredTemplate(t: ProposalTemplate): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

export function applyPreset(t: ProposalTemplate, level: 'court' | 'detaille'): ProposalTemplate {
  return { ...t, detailLevel: level, pages: { ...(level === 'court' ? PRESET_COURT : PRESET_DETAILLE) } };
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount || 0);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0) + ' %';
}

// ─── DB mapper ───────────────────────────────────────────────────────────────

interface FeeDistributionMission {
  id: string;
  name?: string;
  category?: string;
  amount?: number;
  default_pct?: number;
  percentages?: Record<string, number>;
}

function categoryFromLabel(label: unknown): MissionLine['categorie'] {
  const s = String(label ?? '').toLowerCase();
  if (s.includes('exécution') || s.includes('execution')) return 'execution';
  if (s.includes('bas') || s.includes('base')) return 'base';
  return 'complementaire';
}

// Builds the per-intervenant split for one mission from
// fee_distribution.missions[].percentages (keyed by contact_id, plus the
// implicit 'architect' key — same convention as mafUtils.computePartInteret
// and Proposals.tsx's FeeDistributionGrid). The architect's own share
// defaults to "100 - Σ(cotraitants)" when not explicitly set.
function buildIntervenants(mission: FeeDistributionMission, specialties: ProposalSpecialty[]): MissionIntervenant[] {
  const amt = mission.amount || 0;
  const pcts = mission.percentages || {};
  const cotraitants: MissionIntervenant[] = [];
  let assignedPct = 0;
  for (const s of specialties) {
    const key = s.contact_id || s.id;
    const pct = pcts[key] ?? 0;
    cotraitants.push({ contactId: key, nom: s.contact_name || s.specialty_name, pct, montant: (amt * pct) / 100 });
    assignedPct += pct;
  }
  const architectPct = pcts['architect'] ?? Math.max(0, 100 - assignedPct);
  return [
    { contactId: 'architect', nom: 'Architecte', pct: architectPct, montant: (amt * architectPct) / 100 },
    ...cotraitants,
  ];
}

export function mapProposalToPdfData(p: Proposal, settings: AgencySettings): ProposalPdfData {
  let missions: MissionLine[] = [];
  try {
    const feeData = JSON.parse(p.fee_distribution || '{}');
    if (Array.isArray(feeData.missions)) {
      missions = feeData.missions.map((m: FeeDistributionMission) => ({
        id: m.id,
        designation: m.name || '',
        categorie: categoryFromLabel(m.category),
        montantHT: m.amount || 0,
        relPct: m.default_pct || 0,
        intervenants: buildIntervenants(m, p.specialties_list || []),
      }));
    }
  } catch {
    // fee_distribution absent or malformed — sections relying on it render empty, not broken
  }

  const cpTerrain = p.cp_ville_terrain ? p.cp_ville_terrain.split(' ')[0] : '';
  const villeTerrain = p.cp_ville_terrain
    ? p.cp_ville_terrain.split(' ').slice(1).join(' ')
    : (p.site_city || '');

  const amount = p.amount || 0;
  const vatRate = p.vat_rate ?? 20;

  return {
    reference: p.reference || p.project_code || 'N/A',
    titre: p.title || 'Sans titre',
    status: p.status || 'Draft',
    indice: p.ind || 'A',
    dateEmission: new Date().toLocaleDateString('fr-FR'),

    clientNom: p.is_entreprise ? (p.nom_societe || p.client_name || '') : (p.client_name || ''),
    entreprise: !!p.is_entreprise,
    nomSociete: p.nom_societe || '',
    rcs: p.rcs || '',
    representant: p.representant || '',
    qualite: p.qualite || '',
    adresse: p.adresse_client || '',
    codePostal: p.cp_client || '',
    ville: p.ville_client || '',
    telephone: p.telephone || p.portable || '',
    email: p.email_client || '',

    detailProjet: p.projet_detail || '',
    descriptionGenerale: p.description || '',
    nomEtablissement: p.nom_etablissement || '',

    adresseTerrain: p.adresse_terrain || '',
    cpTerrain,
    villeTerrain,
    refCadastrale: p.ref_cadastrale || '',
    zonePLU: p.zone_plu || '',
    surfaceParcelle: Number(p.surface_parcelle) || 0,
    avantTravaux: p.avant_trav || '',
    apresTravaux: p.apres_trav || '',
    typeEtCat: p.type_et_cat || '',
    type: p.type_projet || '',
    categorie: p.categorie_projet || '',

    surfPlancher: Number(p.surface_plancher) || 0,
    surfExtension: Number(p.surface_plancher_ext) || 0,
    surfERP: Number(p.surface_erp) || 0,
    surfERT: Number(p.surface_ert) || 0,
    effectifPublic: Number(p.effectif_public) || 0,
    effectifPersonnel: Number(p.effectif_personnel) || 0,

    montantTravaux: p.construction_cost || 0,
    tauxComplexite: p.complexity_rate || 1,
    ratioRehab: p.ratio_rehab || 0,
    ratioExtension: p.ratio_extension || 0,
    pctHonorairesBase: p.base_fee_percent || 0,
    pctAvecExe: p.exe_fee_percent || 0,
    pctMissionsComp: p.comp_fee_percent || 0,
    montantHonorairesHT: amount,
    tauxTVA: vatRate,
    montantTVA: amount * (vatRate / 100),
    montantTTC: amount * (1 + vatRate / 100),

    cotraitants: (p.specialties_list || []).map(s => ({
      specialite: s.specialty_name,
      contact: s.contact_name || '',
      role: '',
    })),
    missions,
    calendrier: missions.map(m => ({ id: 'c_' + m.id, mission: m.designation, dureeJours: 15, apres: '' })),
    notes: p.notes || '',

    agenceNom: settings.agencyName || '',
    agenceAdresse: settings.address || '',
    agenceLogo: settings.logoUrl,
    architecteNom: settings.architectName || '',
    oaNumber: settings.oaNumber || '',
  };
}

// ─── Logo compression ───────────────────────────────────────────────────────
// jsPDF's pdf.html() embeds <img> sources at their NATIVE pixel resolution
// regardless of CSS display size — an uploaded high-resolution logo can
// balloon an export to tens of megabytes (confirmed: a 190KB/3000×2000 test
// image displayed at 142×94 CSS px produced an 18MB PDF). Cap at a fixed
// resolution covering the largest configured on-page logo size (35mm ≈
// 132px @96dpi) with headroom for print/retina fidelity. PNG (not JPEG) to
// preserve transparency — uploaded agency logos are very often PNGs with a
// transparent background (see Settings.tsx's logo upload, FileReader.readAsDataURL).
const LOGO_MAX_W = 1200;
const LOGO_MAX_H = 560;

export async function compressProposalLogo(dataUrlOrUrl: string): Promise<string | null> {
  const result = await compressImage(dataUrlOrUrl, LOGO_MAX_W, LOGO_MAX_H, 0.92, 'image/png');
  return result?.dataUrl ?? null;
}

// ─── PDF styles ─────────────────────────────────────────────────────────────
// Deliberately minimal: Tailwind's Preflight is compiled with an
// artificially-boosted-specificity universal selector
// (`*:not(#\#):not(#\#):not(#\#):not(#\#) { margin:0; padding:0; border:0 solid; box-sizing:border-box }`)
// that beats any plain class/element CSS rule for those properties — a class
// like `.pdf-page { padding: 20mm 25mm }` gets silently overridden back to 0
// the moment the app's real stylesheet is loaded (confirmed empirically:
// `getComputedStyle` on such an element measures `padding: 0px` in the real
// app, vs. the intended value in isolation). Box-model spacing (padding,
// margin, border) for every PDF section element is therefore set via React
// inline `style` props instead (see the PdfPage/H2/H3/P/Table/Th/Td wrapper
// components in ProposalExportModal.tsx) — inline styles always win over any
// stylesheet rule short of `!important`, which Preflight doesn't use.
export const getPdfStyles = (): string => `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
`;

// ─── jsPDF export pipeline ──────────────────────────────────────────────────
// Standardizes on jsPDF's pdf.html() against real DOM .pdf-page nodes — the
// same pattern already used by InvoiceGenerator.tsx and the former
// ProposalGenerator.tsx — instead of ProposalModule's iframe+window.print(),
// which never produced a Blob and so could never reach autoSaveDocument.
//
// Known limitation (shared with every pdf.html()-based exporter in this
// app): pages don't auto-flow — a .pdf-page whose rendered content exceeds
// one A4 height can get clipped. Each section renders on its own page to
// keep this risk low; genuinely oversized sections (many missions/cotraitants)
// should be checked manually after export.
export async function exportProposalPdf(container: HTMLElement, data: ProposalPdfData): Promise<void> {
  const icons = container.querySelectorAll('svg');
  icons.forEach(icon => ((icon as unknown as HTMLElement).style.display = 'none'));

  try {
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pages = container.querySelectorAll('[data-pdf-page]');

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] as HTMLElement;
      if (i > 0) pdf.addPage();
      await pdf.html(page, {
        x: 0,
        y: 0,
        width: pdfWidth,
        windowWidth: page.scrollWidth,
        margin: [0, 0, 0, 0],
        autoPaging: false,
      });
    }

    const clientLabel = (data.entreprise ? data.nomSociete : data.clientNom) || 'Client';
    const filename = `Proposition_${data.reference.replace(/\s+/g, '_')}_${clientLabel.replace(/\s+/g, '_')}.pdf`;
    pdf.save(filename);
    await autoSaveDocument({
      blob: pdf.output('blob'),
      filename,
      name: `Proposition - ${data.titre}`,
      phase: 'ESQ',
      category: 'Contract',
    });
  } finally {
    icons.forEach(icon => ((icon as unknown as HTMLElement).style.display = ''));
  }
}
