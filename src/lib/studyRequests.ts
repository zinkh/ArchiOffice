// Demandes de consultation depuis la fiche affaire : étude de sol (géotechnicien),
// contrôle technique et coordination SPS (CSPS). Une seule définition par nature
// décrit les études, les champs du formulaire, les faits de l'affaire repris et les
// sections du message. Le formulaire écrit ses libellés via i18next ; le corps du
// message reste en français, comme les autres documents produits par l'agence.
//
// Une information absente s'écrit « à préciser » : rien n'est inventé.
import type { Project } from '../types';
import { normalizeCategory } from './contactCategories';

export type StudyKind = 'geotechnique' | 'controle_technique' | 'csps';
export const STUDY_KINDS: readonly StudyKind[] = ['geotechnique', 'controle_technique', 'csps'];

export const APROX_A_PRECISER = 'à préciser';

export type StudyValue = string | boolean;

export interface StudyStudyDef { id: string; libelle: string }
export interface StudyFieldDef { id: string; type: 'text' | 'number' | 'date' | 'textarea' | 'checkbox' }
export interface StudyGroupDef { id: string; champs: string[] }

export interface StudyProjet {
  name: string;
  reference?: string;
  maitreOuvrage?: string;
  adresse?: string;
  cpVille?: string;
  refCadastrale?: string;
  surfaceParcelle?: string;
  zonePlu?: string;
  sismicite?: string;
  retraitArgiles?: string;
  programme?: string;
  surfacePlancher?: string;
  typeProjet?: string;
  numeroPermis?: string;
  datePermis?: string;
}

export interface StudyRequest {
  projet: StudyProjet;
  moeNom?: string;
  moeEmail?: string;
  /** Identifiants des études cochées (voir `etudes` de la définition). */
  etudes: string[];
  values: Record<string, StudyValue>;
}

export interface StudySection { titre: string; lignes: string[] }

export interface StudyKindDef {
  kind: StudyKind;
  /** Préfixe des clés i18next : `study_<prefix>_...`. */
  prefix: 'geo' | 'ct' | 'csps';
  etudes: StudyStudyDef[];
  champs: StudyFieldDef[];
  groupes: StudyGroupDef[];
  /** Faits de l'affaire affichés dans le formulaire pour cette nature. */
  faits: (keyof StudyProjet)[];
  introMail: string;
  sections: (r: StudyRequest) => StudySection[];
}

const FAITS_FR: Record<keyof StudyProjet, string> = {
  name: 'Intitulé',
  reference: 'Référence',
  maitreOuvrage: 'Maître d’ouvrage',
  adresse: 'Adresse du terrain',
  cpVille: 'Code postal et ville',
  refCadastrale: 'Référence cadastrale',
  surfaceParcelle: 'Surface de la parcelle',
  zonePlu: 'Zone du PLU',
  sismicite: 'Zone de sismicité',
  retraitArgiles: 'Retrait-gonflement des argiles',
  programme: 'Programme',
  surfacePlancher: 'Surface de plancher envisagée',
  typeProjet: 'Type de projet',
  numeroPermis: 'Numéro de permis',
  datePermis: 'Date de dépôt du dossier',
};

const valeur = (v?: string | null): string => (v && v.trim() ? v.trim() : APROX_A_PRECISER);
const ligne = (label: string, v?: string | null): string => `- ${label} : ${valeur(v)}`;
const texte = (values: Record<string, StudyValue>, id: string): string => {
  const v = values[id];
  return typeof v === 'string' ? v : '';
};
const dateFrancaise = (iso?: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : APROX_A_PRECISER;
};
const avecUnite = (v: string, unite: string): string | undefined => (v.trim() ? `${v.trim()} ${unite}` : undefined);

function faitsLignes(projet: StudyProjet, cles: (keyof StudyProjet)[]): string[] {
  return cles.map(c => ligne(FAITS_FR[c], projet[c]));
}

function libellesEtudes(def: StudyKindDef, ids: string[]): string[] {
  return def.etudes.filter(e => ids.includes(e.id)).map(e => `- ${e.libelle}`);
}

const GEOTECHNIQUE: StudyKindDef = {
  kind: 'geotechnique',
  prefix: 'geo',
  etudes: [
    { id: 'G1', libelle: 'G1 : étude géotechnique préalable (site)' },
    { id: 'G2AVP', libelle: 'G2 : étude géotechnique de conception, avant-projet (AVP)' },
    { id: 'G2PRO', libelle: 'G2 : étude géotechnique de conception, projet (PRO)' },
    { id: 'G3', libelle: 'G3 : étude géotechnique d’exécution (DCE, EXE)' },
    { id: 'G4', libelle: 'G4 : supervision géotechnique d’exécution' },
  ],
  champs: [
    { id: 'sondagesNombre', type: 'number' },
    { id: 'sondagesProfondeur', type: 'number' },
    { id: 'sondagesTypes', type: 'text' },
    { id: 'niveaux', type: 'text' },
    { id: 'sousSol', type: 'checkbox' },
    { id: 'emprise', type: 'number' },
    { id: 'reponseAvant', type: 'date' },
    { id: 'interventionDes', type: 'date' },
    { id: 'acces', type: 'textarea' },
    { id: 'commentaire', type: 'textarea' },
  ],
  groupes: [
    { id: 'investigations', champs: ['sondagesNombre', 'sondagesProfondeur', 'sondagesTypes'] },
    { id: 'building', champs: ['niveaux', 'sousSol', 'emprise'] },
    { id: 'calendar', champs: ['reponseAvant', 'interventionDes'] },
    { id: 'access', champs: ['acces', 'commentaire'] },
  ],
  faits: ['name', 'reference', 'maitreOuvrage', 'adresse', 'cpVille', 'refCadastrale', 'surfaceParcelle', 'zonePlu', 'sismicite', 'retraitArgiles', 'programme', 'surfacePlancher'],
  introMail: 'Dans le cadre d’un projet de construction, nous sollicitons votre offre pour une étude de sol.',
  sections: r => {
    const v = r.values;
    const etudes = libellesEtudes(GEOTECHNIQUE, r.etudes);
    return [
      { titre: 'TERRAIN', lignes: faitsLignes(r.projet, ['adresse', 'cpVille', 'refCadastrale', 'surfaceParcelle', 'zonePlu', 'sismicite', 'retraitArgiles']) },
      {
        titre: 'PROJET',
        lignes: [
          ...faitsLignes(r.projet, ['programme', 'surfacePlancher']),
          ligne('Niveaux', `${texte(v, 'niveaux')}${v.sousSol === true ? ', avec sous-sol' : ', sans sous-sol'}`),
          ligne('Emprise au sol', avecUnite(texte(v, 'emprise'), 'm²')),
        ],
      },
      { titre: 'ÉTUDES DEMANDÉES', lignes: etudes.length ? etudes : [`- ${APROX_A_PRECISER}`] },
      {
        titre: 'INVESTIGATIONS SOUHAITÉES',
        lignes: [
          ligne('Nombre de sondages', texte(v, 'sondagesNombre')),
          ligne('Profondeur indicative', avecUnite(texte(v, 'sondagesProfondeur'), 'm')),
          ligne('Types de sondages et d’essais', texte(v, 'sondagesTypes')),
        ],
      },
      {
        titre: 'CALENDRIER',
        lignes: [
          ligne('Réponse attendue avant le', dateFrancaise(texte(v, 'reponseAvant'))),
          ligne('Intervention souhaitée à partir du', dateFrancaise(texte(v, 'interventionDes'))),
        ],
      },
      { titre: 'ACCÈS ET CONTRAINTES', lignes: [`- ${valeur(texte(v, 'acces'))}`] },
    ];
  },
};

const CONTROLE_TECHNIQUE: StudyKindDef = {
  kind: 'controle_technique',
  prefix: 'ct',
  etudes: [
    { id: 'L', libelle: 'L : solidité des ouvrages' },
    { id: 'S', libelle: 'S : sécurité des personnes' },
    { id: 'SEI', libelle: 'SEI : sécurité incendie' },
    { id: 'PH', libelle: 'PH : accessibilité des personnes handicapées' },
    { id: 'TH', libelle: 'TH : isolation thermique et économies d’énergie' },
  ],
  champs: [
    { id: 'typeBatiment', type: 'text' },
    { id: 'categorieErp', type: 'text' },
    { id: 'debutTravaux', type: 'date' },
    { id: 'dureeTravaux', type: 'number' },
    { id: 'reponseAvant', type: 'date' },
    { id: 'ouvragesParticuliers', type: 'textarea' },
    { id: 'commentaire', type: 'textarea' },
  ],
  groupes: [
    { id: 'building', champs: ['typeBatiment', 'categorieErp'] },
    { id: 'works', champs: ['debutTravaux', 'dureeTravaux', 'reponseAvant'] },
    { id: 'specific', champs: ['ouvragesParticuliers', 'commentaire'] },
  ],
  faits: ['name', 'reference', 'maitreOuvrage', 'programme', 'typeProjet', 'numeroPermis', 'datePermis', 'surfacePlancher'],
  introMail: 'Dans le cadre d’un projet de construction, nous sollicitons votre offre de contrôle technique pour les missions ci-dessous.',
  sections: r => {
    const v = r.values;
    const missions = libellesEtudes(CONTROLE_TECHNIQUE, r.etudes);
    return [
      { titre: 'PROJET', lignes: faitsLignes(r.projet, ['typeProjet', 'programme', 'surfacePlancher', 'numeroPermis', 'datePermis']) },
      { titre: 'MISSIONS DEMANDÉES', lignes: missions.length ? missions : [`- ${APROX_A_PRECISER}`] },
      { titre: 'BÂTIMENT', lignes: [ligne('Type de bâtiment', texte(v, 'typeBatiment')), ligne('Catégorie ERP', texte(v, 'categorieErp'))] },
      {
        titre: 'TRAVAUX ET CALENDRIER',
        lignes: [
          ligne('Début prévisionnel des travaux', dateFrancaise(texte(v, 'debutTravaux'))),
          ligne('Durée prévisionnelle (mois)', texte(v, 'dureeTravaux')),
          ligne('Réponse attendue avant le', dateFrancaise(texte(v, 'reponseAvant'))),
        ],
      },
      { titre: 'OUVRAGES PARTICULIERS', lignes: [`- ${valeur(texte(v, 'ouvragesParticuliers'))}`] },
    ];
  },
};

const CSPS: StudyKindDef = {
  kind: 'csps',
  prefix: 'csps',
  etudes: [
    { id: 'PREP', libelle: 'Préparation : plan général de coordination en phase conception (PGC)' },
    { id: 'COORD', libelle: 'Coordination SPS en phase réalisation' },
    { id: 'DIU', libelle: 'Dossier d’interventions ultérieures sur l’ouvrage (DIU)' },
  ],
  champs: [
    { id: 'nombreLots', type: 'number' },
    { id: 'effectifMax', type: 'number' },
    { id: 'dureeTravaux', type: 'number' },
    { id: 'debutTravaux', type: 'date' },
    { id: 'risques', type: 'textarea' },
    { id: 'reponseAvant', type: 'date' },
    { id: 'commentaire', type: 'textarea' },
  ],
  groupes: [
    { id: 'site', champs: ['nombreLots', 'effectifMax', 'dureeTravaux', 'debutTravaux'] },
    { id: 'risks', champs: ['risques'] },
    { id: 'calendar', champs: ['reponseAvant', 'commentaire'] },
  ],
  faits: ['name', 'reference', 'maitreOuvrage', 'adresse', 'cpVille', 'programme', 'surfacePlancher'],
  introMail: 'Dans le cadre d’un projet de construction, nous sollicitons votre offre de coordination SPS pour les missions ci-dessous.',
  sections: r => {
    const v = r.values;
    const missions = libellesEtudes(CSPS, r.etudes);
    return [
      { titre: 'TERRAIN', lignes: faitsLignes(r.projet, ['adresse', 'cpVille']) },
      { titre: 'PROJET', lignes: faitsLignes(r.projet, ['programme', 'surfacePlancher']) },
      { titre: 'MISSIONS DEMANDÉES', lignes: missions.length ? missions : [`- ${APROX_A_PRECISER}`] },
      {
        titre: 'CHANTIER',
        lignes: [
          ligne('Nombre d’entreprises (lots) prévues', texte(v, 'nombreLots')),
          ligne('Effectif maximal simultané', texte(v, 'effectifMax')),
          ligne('Durée prévisionnelle (mois)', texte(v, 'dureeTravaux')),
          ligne('Début prévisionnel des travaux', dateFrancaise(texte(v, 'debutTravaux'))),
        ],
      },
      { titre: 'RISQUES PARTICULIERS', lignes: [`- ${valeur(texte(v, 'risques'))}`] },
      { titre: 'CALENDRIER', lignes: [ligne('Réponse attendue avant le', dateFrancaise(texte(v, 'reponseAvant')))] },
    ];
  },
};

export const STUDY_KIND_DEFS: Record<StudyKind, StudyKindDef> = {
  geotechnique: GEOTECHNIQUE,
  controle_technique: CONTROLE_TECHNIQUE,
  csps: CSPS,
};

/** Objet de la demande : la nature, l'intitulé, puis la référence entre parenthèses si elle existe. */
export function buildStudySubject(kind: StudyKind, projet: StudyProjet): string {
  const code = projet.reference?.trim();
  const nature: Record<StudyKind, string> = {
    geotechnique: 'Demande de devis, étude de sol',
    controle_technique: 'Consultation, contrôle technique',
    csps: 'Consultation, coordination SPS',
  };
  return `${nature[kind]} : ${projet.name}${code ? ` (${code})` : ''}`;
}

/** Corps du message : opération, sections propres à la nature, commentaires, formule de politesse. */
export function buildStudyRequestBody(kind: StudyKind, r: StudyRequest): string {
  const def = STUDY_KIND_DEFS[kind];
  const lignes: string[] = [
    'Bonjour,',
    '',
    def.introMail,
    '',
    'OPÉRATION',
    ligne('Intitulé', r.projet.name),
    ligne('Référence', r.projet.reference),
    ligne('Maître d’ouvrage', r.projet.maitreOuvrage),
    ligne('Maître d’œuvre', r.moeNom ? `${r.moeNom}${r.moeEmail ? ` (${r.moeEmail})` : ''}` : undefined),
  ];
  for (const section of def.sections(r)) {
    lignes.push('', section.titre, ...section.lignes);
  }
  const commentaire = texte(r.values, 'commentaire').trim();
  if (commentaire) lignes.push('', 'COMMENTAIRES', commentaire);
  lignes.push(
    '',
    'Merci de nous transmettre votre offre détaillée : prix par prestation, délais d’intervention, hypothèses retenues et conditions de réalisation.',
    '',
    'Cordialement,',
  );
  return lignes.join('\n');
}

/** Données de l'affaire reprises dans une demande, à partir de la fiche projet. */
export function studyProjetFromProject(p: Project): StudyProjet {
  return {
    name: p.name,
    reference: p.project_code || p.reference || undefined,
    maitreOuvrage: p.nom_societe || p.client || undefined,
    adresse: p.adresse_terrain || p.address || undefined,
    cpVille: p.cp_ville_terrain || [p.site_postcode, p.site_city].filter(Boolean).join(' ') || undefined,
    refCadastrale: p.ref_cadastrale || undefined,
    surfaceParcelle: p.surface_parcelle || undefined,
    zonePlu: p.zone_plu || undefined,
    sismicite: p.sismicite || undefined,
    retraitArgiles: p.retrait_argiles || undefined,
    programme: p.programme || undefined,
    surfacePlancher: p.surface_plancher || undefined,
    typeProjet: p.type_projet || undefined,
    numeroPermis: p.num_permis_construire || undefined,
    datePermis: p.date_depot_pc || undefined,
  };
}

/** Destinataires : une catégorie de contact par nature. Un contact sans catégorie n'est jamais proposé. */
export const STUDY_RECIPIENT_FILTER: Record<StudyKind, (c: { category?: string | null }) => boolean> = {
  geotechnique: c => {
    const n = normalizeCategory(c.category);
    return n.length > 0 && (n.includes('etude') || n.includes('geotech') || n === 'bet');
  },
  controle_technique: c => {
    const n = normalizeCategory(c.category);
    return n.length > 0 && (n.includes('controle') || n === 'ct');
  },
  csps: c => {
    const n = normalizeCategory(c.category);
    return n.length > 0 && (n.includes('sps') || n.includes('coordinat'));
  },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lit une liste d'adresses saisies à la main (virgules, points-virgules ou espaces). */
export function parseEmailList(texteSaisi: string): { valides: string[]; invalides: string[] } {
  const morceaux = texteSaisi.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  const valides = [...new Set(morceaux.filter(s => EMAIL.test(s)))];
  const invalides = morceaux.filter(s => !EMAIL.test(s));
  return { valides, invalides };
}
