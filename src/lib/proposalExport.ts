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
import { isErpOperation } from './erp';
import { operationNature, surfaceExistante, surfaceRehabilitee, surfaceDePlancher, toSurface } from './proposalSurfaces';
import { autoSaveDocument } from './autoSaveDocument';
import { compressImage } from './imageCompression';
import { paginateFlow } from './pdfPagination';
import type { CotraitantIdentity } from './pdfLetterhead';

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
  /** Jour de démarrage depuis le début de la mission (0 = premier jour). */
  debutJours: number;
  /** Id de la mission qui précède, '' pour la première. Vide aussi quand la mission est menée en parallèle. */
  apres: string;
  /** Ids des missions avec lesquelles celle-ci est menée en parallèle (VISA, EXE, OPC). */
  avec: string[];
}

type PhaseMop = 'det' | 'aor' | 'visa' | 'exe' | 'opc';

// Reconnaît une phase par son identifiant, par son sigle (« D.E.T. », « (DET) ») ou,
// à défaut, par son intitulé : les missions d'une proposition sont renommables.
function phaseOf(id: string, designation: string): PhaseMop | null {
  const connues: PhaseMop[] = ['det', 'aor', 'visa', 'exe', 'opc'];
  const parId = id.toLowerCase();
  if ((connues as string[]).includes(parId)) return parId as PhaseMop;
  const sigles = (designation.match(/\b(?:[A-Za-z]\.){2,}|\b[A-Z]{2,5}\b/g) ?? []).map(s => s.replace(/\./g, '').toLowerCase());
  const parSigle = connues.find(p => sigles.includes(p));
  if (parSigle) return parSigle;
  if (/direction de l.ex[ée]cution/i.test(designation)) return 'det';
  if (/op[ée]rations de r[ée]ception/i.test(designation)) return 'aor';
  if (/^visa\b/i.test(designation)) return 'visa';
  if (/ordonnancement/i.test(designation)) return 'opc';
  if (/[ée]tudes? d.ex[ée]cution/i.test(designation)) return 'exe';
  return null;
}

/** Durée par défaut d'une mission, en jours : l'architecte l'ajuste ensuite à la main. */
export const DUREE_MISSION_PAR_DEFAUT_JOURS = 15;

/**
 * Enchaînement par défaut des missions : chacune démarre quand la précédente
 * s'achève (APS après ESQ, APD après APS...), sauf quatre qui se mènent pendant le
 * chantier : le VISA démarre avec la DET, l'EXE est mené en parallèle de la DET et
 * l'OPC en parallèle de la DET et de l'AOR (il court du début de la DET à la fin de
 * l'AOR). Sans DET dans la liste, rien n'est parallèle : tout s'enchaîne.
 */
export function planifierCalendrier(
  missions: Array<{ id: string; designation: string }>,
  duree = DUREE_MISSION_PAR_DEFAUT_JOURS,
): CalendrierItem[] {
  const phases = missions.map(m => phaseOf(m.id, m.designation));
  const detIndex = phases.indexOf('det');
  const parallele = (phase: PhaseMop | null) => detIndex !== -1 && (phase === 'visa' || phase === 'exe' || phase === 'opc');

  const items: CalendrierItem[] = missions.map(m => ({
    id: 'c_' + m.id, mission: m.designation, dureeJours: duree, debutJours: 0, apres: '', avec: [],
  }));

  // La chaîne : toutes les missions qui ne sont pas menées en parallèle, dans l'ordre de la liste.
  let fin = 0;
  let precedent = '';
  items.forEach((item, i) => {
    if (parallele(phases[i])) return;
    item.debutJours = fin;
    item.apres = precedent;
    fin += item.dureeJours;
    precedent = item.id;
  });

  // Les missions parallèles partent avec la DET ; l'OPC court jusqu'à la fin de l'AOR.
  if (detIndex !== -1) {
    const det = items[detIndex];
    const aorIndex = phases.indexOf('aor');
    items.forEach((item, i) => {
      if (!parallele(phases[i])) return;
      item.debutJours = det.debutJours;
      item.avec = [det.id];
      if (phases[i] === 'opc') {
        const aor = aorIndex !== -1 ? items[aorIndex] : null;
        item.dureeJours = Math.max(det.dureeJours, (aor ? aor.debutJours + aor.dureeJours : det.debutJours + det.dureeJours) - det.debutJours);
        if (aor) item.avec = [det.id, aor.id];
      }
    });
  }
  return items;
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

  isErp: boolean;
  nature: 'neuf' | 'rehabilitation';
  surfExistante: number;
  surfRehabilitee: number;
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

  cotraitants: Array<{ specialite: string; contact: string; role: string; contactId?: string }>;
  /** Identité de chaque cotraitant (fiche contact), par identifiant de contact. Chargée à part. */
  cotraitantIdentites?: Record<string, CotraitantIdentityPdf>;
  missions: MissionLine[];
  calendrier: CalendrierItem[];
  notes: string;

  agenceNom: string;
  agenceAdresse: string;
  agenceLogo?: string;
  /** Logos des cotraitants (data URLs), chargés à part depuis leurs fiches contact. */
  cotraitantLogos?: string[];
  architecteNom: string;
  oaNumber: string;
}

/** Identité d'un cotraitant telle que le PDF l'imprime : le logo est une data URL déjà réduite. */
export type CotraitantIdentityPdf = Omit<CotraitantIdentity, 'logo'> & { logo?: string };

// ─── Template (sections + clauses + visual style) ──────────────────────────

export type TableDensity = 'normal' | 'compact' | 'dense';

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
  layout: {
    /** Une section commence sur une nouvelle page. Décoché : les sections se suivent. */
    sectionBreaks: boolean;
    /** Place prise par les tableaux : hauteur des lignes, corps du texte, espacements. */
    tableDensity: TableDensity;
    /** Raison sociale, coordonnées, SIRET et logo de chaque cotraitant. */
    cotraitantIdentity: boolean;
  };
}

/**
 * Mesures des tableaux selon la densité choisie. Utilisées en style en ligne par
 * les primitives du PDF (voir ProposalExportModal) : jamais en classe CSS, que le
 * Preflight de Tailwind écraserait.
 */
export interface DensityTokens {
  cellPadding: string;
  cellFont: string;
  headFont: string;
  cellLineHeight: number;
  tableMarginBottom: string;
  headingMarginTop: string;
  headingMarginBottom: string;
  blockGap: string;
}

// Les marges des cellules sont plus grandes en bas qu'en haut à dessein : jsPDF
// imprime le texte environ 1 mm plus bas que sa position à l'écran, et un texte
// symétriquement margé finit collé au filet du bas (queues des p, g, j coupées).
// La somme haut + bas est celle d'une marge symétrique.
export const DENSITY_TOKENS: Record<TableDensity, DensityTokens> = {
  normal: {
    cellPadding: '1.8mm 3.5mm 3.2mm', cellFont: '9.5pt', headFont: '8pt', cellLineHeight: 1.5,
    tableMarginBottom: '6mm', headingMarginTop: '7mm', headingMarginBottom: '3mm', blockGap: '10mm',
  },
  compact: {
    cellPadding: '0.8mm 2.5mm 1.8mm', cellFont: '8.5pt', headFont: '7.5pt', cellLineHeight: 1.3,
    tableMarginBottom: '4mm', headingMarginTop: '5mm', headingMarginBottom: '2mm', blockGap: '6mm',
  },
  dense: {
    cellPadding: '0.3mm 2mm 1.1mm', cellFont: '8pt', headFont: '7pt', cellLineHeight: 1.2,
    tableMarginBottom: '3mm', headingMarginTop: '4mm', headingMarginBottom: '1.5mm', blockGap: '4mm',
  },
};

export const TABLE_DENSITY_OPTIONS: { value: TableDensity; label: string }[] = [
  { value: 'normal', label: 'Normale' },
  { value: 'compact', label: 'Compacte' },
  { value: 'dense', label: 'Très compacte' },
];

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
      // Gris foncé par défaut (charte sobre du cabinet) ; la couleur reste réglable dans l'éditeur.
      primaryColor: '#111827',
      fontFamily: 'Helvetica',
      logoSize: 'medium',
      logoPosition: 'left',
      lineHeight: 1.5,
    },
    layout: {
      // Les sauts de page entre sections sont la mise en page historique : on ne
      // les retire que sur demande. Les tableaux, eux, sortent compacts d'office.
      sectionBreaks: true,
      tableDensity: 'compact',
      cotraitantIdentity: true,
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
      layout: { ...defaults.layout, ...parsed.layout },
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

// Intl sépare les milliers par une espace fine insécable (U+202F) et colle le « € »
// par une insécable (U+00A0). Les polices standard de jsPDF n'ont pas la première
// (elle sort en « / » : « 46 /000,00€ ») et rendent la seconde sans largeur. Une
// espace ordinaire est un caractère WinAnsi correctement mesuré ; les cellules qui
// ne doivent pas se couper portent `white-space: nowrap`.
const espacesOrdinaires = (texte: string): string => texte.replace(/[  ]/g, ' ');

export function formatCurrency(amount: number): string {
  return espacesOrdinaires(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount || 0));
}

export function formatPercent(value: number): string {
  return espacesOrdinaires(new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)) + ' %';
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

    isErp: isErpOperation(p),
    nature: operationNature(p),
    surfExistante: toSurface(surfaceExistante(p)),
    surfRehabilitee: surfaceRehabilitee(p),
    surfPlancher: surfaceDePlancher(p),
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
      contactId: s.contact_id || undefined,
    })),
    missions,
    calendrier: planifierCalendrier(missions),
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

export async function compressProposalLogo(
  dataUrlOrUrl: string,
  maxWidth = LOGO_MAX_W,
  maxHeight = LOGO_MAX_H,
): Promise<string | null> {
  const result = await compressImage(dataUrlOrUrl, maxWidth, maxHeight, 0.92, 'image/png');
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
// Standardizes on jsPDF's pdf.html() against a real DOM node (the same pattern
// already used by InvoiceGenerator.tsx and the former ProposalGenerator.tsx)
// instead of ProposalModule's iframe+window.print(), which never produced a Blob
// and so could never reach autoSaveDocument.
//
// Le document est UN SEUL bloc `[data-pdf-flow]` haut de N pages A4. Il est mis en
// page par paginateFlow() (src/lib/pdfPagination.ts) : chaque bloc qui ne tient
// pas est repoussé sur la page suivante, donc la coupure de jsPDF, tous les 297 mm,
// tombe toujours dans une marge. Avant, chaque section était une page fixe et tout
// ce qui dépassait était tronqué. L'en-tête et le pied de page (avec « P1|N ») sont
// du HTML posé par le composant, ils font partie de la capture.
export interface ProposalPdfResult { blob: Blob; filename: string }

/**
 * Génère le PDF de la proposition, le range dans la GED et le rend. `download: false`
 * (envoi par e-mail) ne le télécharge pas : la personne le joint à son message.
 */
export async function exportProposalPdf(
  container: HTMLElement,
  data: ProposalPdfData,
  options: { download?: boolean } = {},
): Promise<ProposalPdfResult> {
  const { download = true } = options;
  const flow = container.querySelector<HTMLElement>('[data-pdf-flow]');
  if (!flow) throw new Error('Document introuvable : rien à exporter.');

  // Les icônes SVG ne sont pas rendues par jsPDF, et les repères de page ne
  // s'impriment pas. Masquer change les hauteurs : il faut repaginer ensuite.
  const hidden = [
    ...Array.from(container.querySelectorAll<HTMLElement | SVGElement>('svg')),
    ...Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-screen-only]')),
  ] as unknown as HTMLElement[];
  hidden.forEach(node => { node.style.display = 'none'; });

  try {
    paginateFlow(flow);
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF('p', 'mm', 'a4');
    await pdf.html(flow, {
      x: 0,
      y: 0,
      width: pdf.internal.pageSize.getWidth(),
      windowWidth: flow.scrollWidth,
      margin: [0, 0, 0, 0],
      autoPaging: 'slice',
    });

    const clientLabel = (data.entreprise ? data.nomSociete : data.clientNom) || 'Client';
    const filename = `Proposition_${data.reference.replace(/\s+/g, '_')}_${clientLabel.replace(/\s+/g, '_')}.pdf`;
    if (download) pdf.save(filename);
    const blob = pdf.output('blob');
    await autoSaveDocument({
      blob,
      filename,
      name: `Proposition - ${data.titre}`,
      phase: 'ESQ',
      category: 'Contract',
    });
    return { blob, filename };
  } finally {
    hidden.forEach(node => { node.style.display = ''; });
    paginateFlow(flow);
  }
}
