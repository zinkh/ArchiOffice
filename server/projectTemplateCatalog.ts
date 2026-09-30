// Catalogue de démarrage des modèles de projet : des trames courantes de
// maîtrise d'œuvre que le cabinet installe d'un clic puis adapte. Sans lui,
// la page « Modèles de projet » s'ouvre vide et personne ne se donne la peine
// de tout saisir à la main.
//
// Les délais sont RELATIFS à la date de démarrage de l'affaire (jours
// calendaires) : ce sont des ordres de grandeur à ajuster, pas des promesses.
// Les délais d'instruction d'un permis sont en revanche réglementaires
// (Code de l'urbanisme) : 1 mois pour une déclaration préalable, 2 mois pour
// un permis de construire de maison individuelle, 3 mois pour les autres.
//
// Les jalons portent volontairement des intitulés d'événements (dépôt,
// décision, réception) et jamais le nom d'une mission du contrat MOE
// (« Esquisse (ESQ) »...) : ProjectDetail crée un jalon par mission incluse
// et apparie par titre, un doublon de nom serait fusionné avec lui.
import type {
  ContratMOEMission,
  ProjectTemplateCatalogEntry,
  TemplateLot,
  TemplateMarcheType,
  TemplateMilestone,
  TemplateOperationType,
  TemplateTask,
} from '../src/types';
import { MARCHE_LABELS, OPERATION_LABELS } from '../src/lib/projectTemplates';

const numberLots = (titles: string[]): TemplateLot[] =>
  titles.map((lot_title, i) => ({ lot_number: String(i + 1).padStart(2, '0'), lot_title }));

const LOTS_NEUF = numberLots([
  'Terrassements et VRD',
  'Fondations et gros œuvre',
  'Charpente',
  'Couverture et étanchéité',
  'Façades et isolation thermique par l\'extérieur',
  'Menuiseries extérieures',
  'Cloisons et doublages',
  'Menuiseries intérieures',
  'Revêtements de sols et faïences',
  'Peintures',
  'Plomberie et sanitaires',
  'Chauffage et ventilation',
  'Électricité courants forts et faibles',
  'Aménagements extérieurs',
]);

const LOTS_REHAB = numberLots([
  'Installation de chantier, démolitions et curage',
  'Désamiantage et déplombage',
  'Gros œuvre et reprises en sous-œuvre',
  'Charpente et couverture',
  'Façades et ravalement',
  'Menuiseries extérieures',
  'Cloisons et doublages',
  'Menuiseries intérieures',
  'Revêtements de sols et faïences',
  'Peintures',
  'Plomberie et sanitaires',
  'Chauffage et ventilation',
  'Électricité courants forts et faibles',
]);

const LOTS_EXTENSION = numberLots([
  'Terrassements et fondations',
  'Gros œuvre et raccordement à l\'existant',
  'Charpente et couverture',
  'Façades et isolation',
  'Menuiseries extérieures',
  'Cloisons, doublages et plâtrerie',
  'Menuiseries intérieures',
  'Revêtements de sols et faïences',
  'Peintures',
  'Plomberie, chauffage et ventilation',
  'Électricité',
]);

const LOTS_MAISON = numberLots([
  'Terrassements et VRD',
  'Fondations et gros œuvre',
  'Charpente',
  'Couverture',
  'Isolation et doublages',
  'Menuiseries extérieures',
  'Plâtrerie et cloisons',
  'Menuiseries intérieures',
  'Carrelage et faïences',
  'Peintures',
  'Plomberie et sanitaires',
  'Chauffage et ventilation',
  'Électricité',
  'Aménagements extérieurs',
]);


const mission = (
  id: string, name: string, pct: number,
  category: ContratMOEMission['category'] = 'base', incluse = true,
): ContratMOEMission => ({ id, name, pct, incluse, category });

// Mêmes identifiants et intitulés que le contrat MOE (Contrats.tsx), pour que
// `ProjectDetail` retrouve la phase de chaque mission. Le total des missions
// incluses fait toujours 100 % (verrouillé par un test).
const OPC_ET_DIAG_EN_OPTION = [
  mission('opc', 'OPC', 0, 'complementaire', false),
  mission('diag', 'Diagnostic', 0, 'complementaire', false),
];

const MISSIONS_MOP: ContratMOEMission[] = [
  mission('esquisse', 'Esquisse (ESQ)', 10),
  mission('aps', 'Avant-Projet Sommaire (APS)', 12),
  mission('apd', 'Avant-Projet Détaillé (APD)', 14),
  mission('pro', 'Projet (PRO)', 18),
  mission('act', 'Assistance Contrats de Travaux (ACT)', 7),
  mission('visa', 'Visa', 7, 'exe'),
  mission('det', 'Direction de l\'Exécution des Travaux (DET)', 25, 'exe'),
  mission('aor', 'Assistance aux Opérations de Réception (AOR)', 7, 'exe'),
  ...OPC_ET_DIAG_EN_OPTION,
];

// Une réhabilitation commence par relever et diagnostiquer l'existant : une
// mission à part entière, prise sur le reste de la répartition.
const MISSIONS_REHAB: ContratMOEMission[] = [
  mission('diag', 'Diagnostic et relevé de l\'existant', 5),
  mission('esquisse', 'Esquisse (ESQ)', 8),
  mission('aps', 'Avant-Projet Sommaire (APS)', 10),
  mission('apd', 'Avant-Projet Détaillé (APD)', 12),
  mission('pro', 'Projet (PRO)', 16),
  mission('act', 'Assistance Contrats de Travaux (ACT)', 7),
  mission('visa', 'Visa', 7, 'exe'),
  mission('det', 'Direction de l\'Exécution des Travaux (DET)', 28, 'exe'),
  mission('aor', 'Assistance aux Opérations de Réception (AOR)', 7, 'exe'),
  mission('opc', 'OPC', 0, 'complementaire', false),
];

const MISSIONS_MAISON: ContratMOEMission[] = [
  mission('esquisse', 'Esquisse (ESQ)', 10),
  mission('aps', 'Avant-Projet Sommaire (APS)', 12),
  mission('apd', 'Avant-Projet Détaillé (APD)', 14),
  mission('pro', 'Projet (PRO)', 14),
  mission('act', 'Assistance Contrats de Travaux (ACT)', 5),
  mission('visa', 'Visa', 7, 'exe'),
  mission('det', 'Direction de l\'Exécution des Travaux (DET)', 30, 'exe'),
  mission('aor', 'Assistance aux Opérations de Réception (AOR)', 8, 'exe'),
  ...OPC_ET_DIAG_EN_OPTION,
];

const MISSIONS_PERMIS: ContratMOEMission[] = [
  mission('esquisse', 'Esquisse (ESQ)', 30),
  mission('aps', 'Avant-Projet Sommaire (APS)', 30),
  mission('pc', 'Dossier de demande de permis de construire', 40),
];

interface ChantierProfile {
  lots: TemplateLot[];
  missions: ContratMOEMission[];
  /** Jour de dépôt de l'autorisation d'urbanisme. */
  permisDepot: number;
  /** Délai d'instruction réglementaire, en jours. */
  permisDelay: number;
  /** Jour de remise du DCE. */
  dce: number;
  /** Durée prévisionnelle des travaux, en jours. */
  chantier: number;
  /** Libellé de l'autorisation d'urbanisme. */
  autorisation: string;
  /** Étapes propres au type d'opération, avant le dépôt de l'autorisation. */
  upstreamMilestones: TemplateMilestone[];
  upstreamTasks: TemplateTask[];
}

function chantierMilestones(p: ChantierProfile, marche: TemplateMarcheType): TemplateMilestone[] {
  const decision = p.permisDepot + p.permisDelay;
  let consultationEnd: number;
  const consultation: TemplateMilestone[] = [];
  if (marche === 'public') {
    const publication = p.dce + 10;
    const remise = publication + 35;
    const analyse = remise + 21;
    consultationEnd = analyse + 15;
    consultation.push(
      { title: 'Remise du DCE au maître d\'ouvrage public', due_date_offset_days: p.dce },
      { title: 'Publication de l\'avis de marché', due_date_offset_days: publication },
      { title: 'Date limite de remise des offres', due_date_offset_days: remise },
      { title: 'Commission d\'analyse des offres', due_date_offset_days: analyse },
      { title: 'Notification des marchés de travaux', due_date_offset_days: consultationEnd },
    );
  } else {
    const envoi = p.dce + 5;
    const remise = envoi + 21;
    consultationEnd = remise + 14;
    consultation.push(
      { title: 'Remise du DCE', due_date_offset_days: p.dce },
      { title: 'Envoi de la consultation aux entreprises', due_date_offset_days: envoi },
      { title: 'Date limite de remise des offres', due_date_offset_days: remise },
      { title: 'Choix des entreprises par le maître d\'ouvrage', due_date_offset_days: consultationEnd },
    );
  }
  const os = Math.max(consultationEnd + 30, decision + 15);
  const reception = os + p.chantier;
  return [
    ...p.upstreamMilestones,
    { title: `Dépôt ${p.autorisation}`, due_date_offset_days: p.permisDepot },
    { title: `Décision attendue sur ${p.autorisation}`, due_date_offset_days: decision },
    ...consultation,
    { title: 'Démarrage du chantier (ordre de service)', due_date_offset_days: os },
    { title: 'Réception des travaux', due_date_offset_days: reception },
    { title: 'Levée des réserves', due_date_offset_days: reception + 30 },
    { title: 'Remise du DOE', due_date_offset_days: reception + 45 },
  ];
}

function chantierTasks(p: ChantierProfile, marche: TemplateMarcheType): TemplateTask[] {
  const decision = p.permisDepot + p.permisDelay;
  const pub = marche === 'public';
  const consultationStart = p.dce + (pub ? 10 : 5);
  const consultationLen = pub ? 71 : 35;
  const consultationEnd = consultationStart + consultationLen;
  const os = Math.max(consultationEnd + 30, decision + 15);
  const reception = os + p.chantier;
  return [
    ...p.upstreamTasks,
    { title: `Constitution du dossier ${p.autorisation}`, start_offset_days: Math.max(p.permisDepot - 30, 0), duration_days: 30, priority: 'high' },
    { title: `Dépôt en mairie et suivi de l'instruction`, description: 'Répondre aux demandes de pièces complémentaires dans le mois qui suit leur réception.', start_offset_days: p.permisDepot, duration_days: p.permisDelay, priority: 'high' },
    { title: 'Coordination des bureaux d\'études', start_offset_days: p.permisDepot, duration_days: 45 },
    { title: 'Rédaction des pièces écrites (CCTP, DPGF)', start_offset_days: p.dce - 30, duration_days: 25 },
    pub
      ? { title: 'Rédaction du règlement de consultation et du CCAP', start_offset_days: p.dce - 10, duration_days: 10 }
      : { title: 'Constitution du DCE', start_offset_days: p.dce - 10, duration_days: 10 },
    pub
      ? { title: 'Publication de l\'avis de marché et réponses aux questions des candidats', start_offset_days: consultationStart, duration_days: 35 }
      : { title: 'Consultation des entreprises et réponses aux questions', start_offset_days: consultationStart, duration_days: 21 },
    pub
      ? { title: 'Rapport d\'analyse des offres et notification', start_offset_days: consultationStart + 35, duration_days: 36, priority: 'high' }
      : { title: 'Analyse des offres et mise au point des marchés', start_offset_days: consultationStart + 21, duration_days: 14, priority: 'high' },
    { title: 'Visa des études d\'exécution et préparation du chantier', start_offset_days: os - 30, duration_days: 30 },
    { title: 'Réunions de chantier hebdomadaires', start_offset_days: os, duration_days: p.chantier, priority: 'high' },
    { title: 'Opérations préalables à la réception', start_offset_days: reception - 10, duration_days: 10 },
    { title: 'Réception et levée des réserves', start_offset_days: reception, duration_days: 30, priority: 'high' },
    { title: 'Constitution du DOE et déclaration d\'achèvement (DAACT)', start_offset_days: reception, duration_days: 45 },
  ];
}

const PROFILE_NEUF: ChantierProfile = {
  lots: LOTS_NEUF,
  missions: MISSIONS_MOP,
  permisDepot: 90,
  permisDelay: 90,
  dce: 150,
  chantier: 365,
  autorisation: 'du permis de construire',
  upstreamMilestones: [
    { title: 'Validation du programme par le maître d\'ouvrage', due_date_offset_days: 14 },
    { title: 'Validation du projet d\'ensemble par le maître d\'ouvrage', due_date_offset_days: 45 },
  ],
  upstreamTasks: [
    { title: 'Réunion de lancement et recueil du programme', start_offset_days: 0, duration_days: 7, priority: 'high' },
    { title: 'Relevé topographique et étude de sol', start_offset_days: 7, duration_days: 30 },
    { title: 'Analyse du PLU et des servitudes', start_offset_days: 7, duration_days: 14 },
    { title: 'Études de conception et présentation au maître d\'ouvrage', start_offset_days: 14, duration_days: 45 },
  ],
};

const PROFILE_REHAB: ChantierProfile = {
  lots: LOTS_REHAB,
  missions: MISSIONS_REHAB,
  permisDepot: 75,
  permisDelay: 90,
  dce: 135,
  chantier: 300,
  autorisation: 'de l\'autorisation d\'urbanisme (DP ou PC)',
  upstreamMilestones: [
    { title: 'Relevé et état des lieux validés', due_date_offset_days: 21 },
    { title: 'Diagnostics (amiante, plomb, structure) remis', due_date_offset_days: 30 },
    { title: 'Validation du programme de travaux par le maître d\'ouvrage', due_date_offset_days: 45 },
  ],
  upstreamTasks: [
    { title: 'Réunion de lancement et visite du bâtiment existant', start_offset_days: 0, duration_days: 7, priority: 'high' },
    { title: 'Relevé du bâti existant et restitution des plans', start_offset_days: 7, duration_days: 14 },
    { title: 'Commande et réception des diagnostics (amiante, plomb, structure)', description: 'Un repérage amiante avant travaux est obligatoire et doit être joint au dossier de consultation.', start_offset_days: 7, duration_days: 23, priority: 'high' },
    { title: 'Consultation de l\'architecte des bâtiments de France si secteur protégé', start_offset_days: 30, duration_days: 30 },
    { title: 'Études de conception et programme de travaux', start_offset_days: 21, duration_days: 35 },
  ],
};

const PROFILE_EXTENSION: ChantierProfile = {
  lots: LOTS_EXTENSION,
  missions: MISSIONS_MOP,
  permisDepot: 60,
  permisDelay: 60,
  dce: 110,
  chantier: 180,
  autorisation: 'de l\'autorisation d\'urbanisme (DP ou PC)',
  upstreamMilestones: [
    { title: 'Relevé de l\'existant validé', due_date_offset_days: 14 },
    { title: 'Validation du projet d\'extension par le maître d\'ouvrage', due_date_offset_days: 35 },
  ],
  upstreamTasks: [
    { title: 'Réunion de lancement et visite de l\'existant', start_offset_days: 0, duration_days: 5, priority: 'high' },
    { title: 'Relevé de l\'existant et analyse du PLU', description: 'Vérifier l\'emprise, la hauteur et le seuil de surface qui décide entre déclaration préalable et permis de construire.', start_offset_days: 5, duration_days: 14 },
    { title: 'Études de conception et présentation au maître d\'ouvrage', start_offset_days: 14, duration_days: 28 },
  ],
};

const PROFILE_MAISON: ChantierProfile = {
  lots: LOTS_MAISON,
  missions: MISSIONS_MAISON,
  permisDepot: 60,
  permisDelay: 60,
  dce: 100,
  chantier: 270,
  autorisation: 'du permis de construire',
  upstreamMilestones: [
    { title: 'Validation du programme par les maîtres d\'ouvrage', due_date_offset_days: 10 },
    { title: 'Validation du projet par les maîtres d\'ouvrage', due_date_offset_days: 35 },
  ],
  upstreamTasks: [
    { title: 'Rendez-vous de lancement et visite du terrain', start_offset_days: 0, duration_days: 5, priority: 'high' },
    { title: 'Relevé topographique, étude de sol et analyse du PLU', description: 'L\'étude de sol est obligatoire pour construire en zone d\'argiles à risque.', start_offset_days: 5, duration_days: 25 },
    { title: 'Études de conception et présentation aux maîtres d\'ouvrage', start_offset_days: 10, duration_days: 25 },
    { title: 'Attestation thermique et environnementale (RE2020)', start_offset_days: 35, duration_days: 20 },
  ],
};

const PERMIS_SEUL_MILESTONES: TemplateMilestone[] = [
  { title: 'Relevés et analyse du PLU terminés', due_date_offset_days: 10 },
  { title: 'Validation du projet par le maître d\'ouvrage', due_date_offset_days: 30 },
  { title: 'Dépôt du dossier de permis de construire en mairie', due_date_offset_days: 45 },
  { title: 'Fin du délai de demande de pièces manquantes (1 mois après le dépôt)', due_date_offset_days: 75 },
  { title: 'Décision attendue sur le permis de construire', due_date_offset_days: 105 },
  { title: 'Fin du délai de recours des tiers', due_date_offset_days: 165 },
];

const PERMIS_SEUL_TASKS: TemplateTask[] = [
  { title: 'Rendez-vous de lancement et recueil du programme', start_offset_days: 0, duration_days: 5, priority: 'high' },
  { title: 'Relevés du terrain et de l\'existant', start_offset_days: 3, duration_days: 7 },
  { title: 'Analyse du PLU, des servitudes et des risques', start_offset_days: 3, duration_days: 7 },
  { title: 'Conception du projet et présentation au maître d\'ouvrage', start_offset_days: 10, duration_days: 20, priority: 'high' },
  { title: 'Constitution du dossier (CERFA, plans PCMI, notice)', start_offset_days: 30, duration_days: 15, priority: 'high' },
  { title: 'Dépôt en mairie et suivi de l\'instruction', description: 'Délai d\'instruction : 2 mois pour une maison individuelle, 3 mois dans les autres cas. Répondre aux demandes de pièces dans le mois qui suit leur réception.', start_offset_days: 45, duration_days: 60, priority: 'high' },
  { title: 'Affichage du permis sur le terrain et constat d\'huissier', description: 'Le délai de recours des tiers de deux mois court à partir du premier jour d\'un affichage continu.', start_offset_days: 105, duration_days: 60 },
  { title: 'Transmission de l\'arrêté et du dossier au maître d\'ouvrage', start_offset_days: 105, duration_days: 5 },
];

function makeEntry(
  operation_type: TemplateOperationType,
  marche_type: TemplateMarcheType,
  profile: ChantierProfile | null,
  description: string,
): ProjectTemplateCatalogEntry {
  const name = operation_type === 'maison_individuelle' || operation_type === 'permis_seul'
    ? OPERATION_LABELS[operation_type]
    : `${OPERATION_LABELS[operation_type]}, ${MARCHE_LABELS[marche_type].toLowerCase()}`;
  return {
    catalog_key: `${operation_type}-${marche_type}`,
    name,
    description,
    operation_type,
    marche_type,
    default_status: 'Planning',
    default_budget: 0,
    default_description: description,
    default_missions: (profile ? profile.missions : MISSIONS_PERMIS).map(m => ({ ...m })),
    default_lots: profile ? profile.lots : [],
    default_milestones: profile ? chantierMilestones(profile, marche_type) : PERMIS_SEUL_MILESTONES,
    default_tasks: profile ? chantierTasks(profile, marche_type) : PERMIS_SEUL_TASKS,
  };
}

const PRIVE_NOTE = 'Consultation des entreprises sur invitation, choix libre par le maître d\'ouvrage.';
const PUBLIC_NOTE = 'Procédure de passation du code de la commande publique : avis de marché, analyse des offres, notification.';

export const PROJECT_TEMPLATE_CATALOG: ProjectTemplateCatalogEntry[] = [
  makeEntry('neuf', 'prive', PROFILE_NEUF, `Construction neuve en maîtrise d'œuvre complète, du programme à la réception. ${PRIVE_NOTE}`),
  makeEntry('neuf', 'public', PROFILE_NEUF, `Construction neuve pour un maître d'ouvrage public. ${PUBLIC_NOTE}`),
  makeEntry('rehabilitation', 'prive', PROFILE_REHAB, `Réhabilitation d'un bâtiment existant : relevés, diagnostics, programme de travaux. ${PRIVE_NOTE}`),
  makeEntry('rehabilitation', 'public', PROFILE_REHAB, `Réhabilitation d'un bâtiment pour un maître d'ouvrage public. ${PUBLIC_NOTE}`),
  makeEntry('extension', 'prive', PROFILE_EXTENSION, `Extension ou surélévation d'un bâtiment existant. ${PRIVE_NOTE}`),
  makeEntry('extension', 'public', PROFILE_EXTENSION, `Extension d'un bâtiment pour un maître d'ouvrage public. ${PUBLIC_NOTE}`),
  makeEntry('maison_individuelle', 'prive', PROFILE_MAISON, `Maison individuelle, de l'étude de sol à la réception. ${PRIVE_NOTE}`),
  makeEntry('permis_seul', 'prive', null, 'Mission limitée au dossier de permis de construire : relevés, conception, dépôt et suivi jusqu\'à la purge du recours des tiers. Aucun lot : pas de chantier suivi par le cabinet.'),
];

export function findCatalogEntry(key: string): ProjectTemplateCatalogEntry | undefined {
  return PROJECT_TEMPLATE_CATALOG.find(e => e.catalog_key === key);
}
