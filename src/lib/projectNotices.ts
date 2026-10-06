import type { DocumentPhase, Project } from '../types';

export type ProjectNoticeKind = 'architectural' | 'accessibility' | 'security';

export interface ProjectNotice {
  id: string;
  project_id: string;
  kind: ProjectNoticeKind;
  phase: string;
  content: string;
  instructions: string;
  status: 'a_rediger' | 'redige';
  generated_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const PROJECT_NOTICE_KINDS: readonly ProjectNoticeKind[] = [
  'architectural', 'accessibility', 'security',
];

export const ARCHITECTURAL_NOTICE_PHASES: readonly DocumentPhase[] = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE'];

export const PROJECT_NOTICE_PHASES: readonly string[] = [
  'ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR',
];

const ARCHITECTURAL_OUTLINES: Record<string, readonly string[]> = {
  ESQ: [
    'Objet de l’opération et programme',
    'Contexte, site et état existant',
    'Parti architectural et intentions',
    'Implantation, volumétrie et organisation générale',
    'Surfaces et principales fonctionnalités',
    'Matériaux, ambiance et relation au contexte',
    'Principes environnementaux et techniques',
    'Points à confirmer pour la phase suivante',
  ],
  APS: [
    'Objet, programme et données de référence',
    'Analyse du site et de l’existant',
    'Parti architectural retenu',
    'Implantation, volumétrie et insertion',
    'Organisation fonctionnelle, accès et flux',
    'Enveloppe, matériaux et expression architecturale',
    'Principes structurels et techniques',
    'Principes d’accessibilité et de sécurité',
    'Performance environnementale et sobriété',
    'Surfaces, économie et points restant à arbitrer',
  ],
  APD: [
    'Présentation générale du projet développé',
    'Implantation, volumétrie et relation au site',
    'Organisation fonctionnelle et flux',
    'Composition des façades, toitures et enveloppe',
    'Matériaux, finitions et ambiances',
    'Principes structurels et dispositions techniques',
    'Accessibilité, usages et sécurité',
    'Approche environnementale et énergétique',
    'Surfaces et cohérence avec le programme',
    'Arbitrages, interfaces et points à finaliser',
  ],
  PC: [
    'État initial du terrain et de ses abords',
    'Présentation et destination du projet',
    'Implantation, organisation et composition des volumes',
    'Traitement des constructions, façades et toitures',
    'Matériaux et couleurs',
    'Aménagement des espaces extérieurs et plantations',
    'Accès, desserte, stationnement et cheminements',
    'Insertion du projet dans son environnement',
  ],
  PRO: [
    'Objet et synthèse du projet définitif',
    'Implantation et dispositions architecturales',
    'Organisation fonctionnelle et détails d’usage',
    'Façades, toitures, enveloppe et performances',
    'Matériaux, finitions et prescriptions architecturales',
    'Principes structurels et interfaces',
    'Lots techniques et coordination',
    'Accessibilité et sécurité',
    'Performance environnementale',
    'Points de vigilance pour le DCE et l’exécution',
  ],
  DCE: [
    'Objet et synthèse du dossier de consultation',
    'Dispositions architecturales définitives',
    'Organisation fonctionnelle et exigences d’usage',
    'Enveloppe, façades et toitures',
    'Matériaux, finitions et niveaux de prestation',
    'Principes structurels et interfaces entre lots',
    'Coordination des lots techniques',
    'Accessibilité et sécurité',
    'Exigences environnementales et performances',
    'Points de vigilance pour la consultation et l’exécution',
  ],
};

const ACCESSIBILITY_OUTLINE = [
  'Objet de la notice et données générales',
  'Classement, activité et effectifs connus',
  'Accès au site, stationnement et cheminements extérieurs',
  'Accès aux bâtiments et accueil',
  'Circulations horizontales',
  'Circulations verticales',
  'Portes, sas et dispositifs de commande',
  'Locaux, équipements et mobiliers accessibles',
  'Sanitaires et équipements spécifiques',
  'Signalétique, éclairage et information des usagers',
  'Dispositions particulières, dérogations éventuelles et points à vérifier',
] as const;

const SECURITY_OUTLINE = [
  'Objet de la notice et données générales',
  'Classement, activité et effectifs connus',
  'Implantation, desserte et accès des secours',
  'Construction, isolement et stabilité au feu',
  'Distribution intérieure, recoupement et compartimentage',
  'Dégagements, sorties et évacuation',
  'Désenfumage',
  'Installations techniques et risques particuliers',
  'Installations électriques et éclairage de sécurité',
  'Moyens de secours, alarme et système de sécurité incendie',
  'Consignes, contrôles et points à vérifier',
] as const;

export function projectNoticeOutline(kind: ProjectNoticeKind, phase = 'PC'): readonly string[] {
  if (kind === 'accessibility') return ACCESSIBILITY_OUTLINE;
  if (kind === 'security') return SECURITY_OUTLINE;
  return ARCHITECTURAL_OUTLINES[phase] || ARCHITECTURAL_OUTLINES.PRO;
}

export function projectNoticeOutlineText(kind: ProjectNoticeKind, phase = 'PC'): string {
  return projectNoticeOutline(kind, phase).map((title, index) => `${index + 1}. ${title}\n`).join('\n');
}

export function projectNoticeTitle(kind: ProjectNoticeKind, phase = 'PC'): string {
  if (kind === 'accessibility') return 'Notice d’accessibilité';
  if (kind === 'security') return 'Notice de sécurité incendie';
  return `Notice architecturale — ${phase}`;
}

function fact(label: string, value: unknown, suffix = ''): string | null {
  if (value == null || value === '' || value === false) return null;
  const text = typeof value === 'number'
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
    : String(value).trim();
  return text ? `${label} : ${text}${suffix}` : null;
}

/**
 * Contexte factuel envoyé au modèle. Il ne fabrique rien : chaque ligne vient
 * de la fiche affaire. Le prompt serveur impose « à vérifier » dès qu'une
 * information réglementaire ou technique n'est pas présente ici.
 */
export function projectNoticeFacts(project: Partial<Project>): string {
  const p = project as any;
  const rows = [
    fact('Opération', p.name),
    fact('Client', p.client),
    fact('Objet', p.description),
    fact('Programme / contraintes', p.programme),
    fact('Détail du projet', p.projet_detail),
    fact('Type de projet', p.type_projet),
    fact('Catégorie de projet', p.categorie_projet || p.category),
    fact('Établissement', p.nom_etablissement),
    fact('Adresse du site', p.adresse_terrain || p.address),
    fact('Commune', [p.site_postcode, p.site_city].filter(Boolean).join(' ')),
    fact('Référence cadastrale', p.ref_cadastrale),
    fact('Zone PLU', p.zone_plu),
    fact('Surface de parcelle', p.surface_parcelle, ' m²'),
    fact('État avant travaux', p.avant_trav),
    fact('État après travaux', p.apres_trav),
    fact('Surface de plancher', p.surface_plancher || p.surface, ' m²'),
    fact('Surface extension', p.surface_plancher_ext, ' m²'),
    fact('Surface ERP', p.surface_erp, ' m²'),
    fact('Surface ERT', p.surface_ert, ' m²'),
    fact('Type / catégorie ERP', p.type_et_cat),
    fact('Effectif public', p.effectif_public),
    fact('Effectif personnel', p.effectif_personnel),
    fact('Montant prévisionnel des travaux', p.construction_cost, ' € HT'),
  ].filter(Boolean) as string[];

  return rows.join('\n');
}

export function isProjectNoticeKind(value: unknown): value is ProjectNoticeKind {
  return typeof value === 'string' && (PROJECT_NOTICE_KINDS as readonly string[]).includes(value);
}

export function isProjectNoticePhase(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_NOTICE_PHASES.includes(value);
}
