/**
 * Calcul de l'effectif des ERP par type d'établissement et seuils de la 5e catégorie
 * (documents « Mode de calcul de l'effectif des E.R.P. par type » et tableau des seuils).
 */

/** Personnes comptées par unité saisie : public (dont visiteurs) et personnel. */
export interface FacteurErp { public?: number; personnel?: number }

export interface LigneErp {
  id: string;
  label: string;
  unit: string;
  /** Personnes par unité saisie (1 pers./3 m² s'écrit 1/3). */
  facteur: FacteurErp;
}

/** Une manière de calculer l'effectif ; quand il y en a plusieurs, la plus grande valeur s'applique. */
export interface FormuleErp {
  label?: string;
  lignes: Array<{ ligne: string; facteur?: FacteurErp }>;
}

/** `null` : pas de seuil ; `'interdit'` : la 5e catégorie exclut ce niveau. */
export interface SeuilsErp {
  sousSol: number | null | 'interdit';
  etages: number | null;
  /** Effectif total (public + personnel), tous niveaux. */
  total: number | null;
  /** Seuil propre aux résidents (structures d'accueil). */
  residents?: number;
  /** Pas de 5e catégorie pour ce type (établissements flottants). */
  sansCinquieme?: boolean;
}

export interface NatureErp {
  id: string;
  code: string;
  /** Libellé court, repris dans `type_et_cat`. */
  short: string;
  label: string;
  seuils: SeuilsErp;
  /** Précision réglementaire à afficher avec les seuils ou le calcul. */
  note?: string;
  lignes: LigneErp[];
  formules: FormuleErp[];
  /** Ligne dont la quantité est le nombre de résidents, pour le seuil spécifique. */
  residentsLigne?: string;
}

const PUB = (n: number): FacteurErp => ({ public: n });
const unite = (id: string, label: string, unit: string, n: number): LigneErp => ({ id, label, unit, facteur: PUB(n) });

const SPECTATEURS: LigneErp[] = [
  unite('sp_sieges', 'Spectateurs : sièges', 'sièges', 1),
  unite('sp_bancs', 'Spectateurs : bancs ou gradins', 'm linéaires', 2),
  unite('sp_promenoirs', 'Spectateurs : promenoirs', 'm linéaires', 1 / 5),
  unite('sp_debout_m2', 'Spectateurs debout', 'm²', 3),
  unite('sp_debout_ml', 'Spectateurs debout', 'm linéaires', 5),
];
const spect = (...ids: string[]) => ids.map(ligne => ({ ligne }));
const SP_ASSIS = spect('sp_sieges', 'sp_bancs', 'sp_promenoirs');
const SP_TOUS = spect('sp_sieges', 'sp_bancs', 'sp_promenoirs', 'sp_debout_m2', 'sp_debout_ml');
const pick = (...ids: string[]) => SPECTATEURS.filter(l => ids.includes(l.id));

const SEUILS_X: SeuilsErp = { sousSol: 100, etages: 100, total: 200 };
const SEUILS_L_SPECTACLE: SeuilsErp = { sousSol: 20, etages: null, total: 50 };
const SEUILS_L_REUNION: SeuilsErp = { sousSol: 100, etages: null, total: 200 };
const SEUILS_M: SeuilsErp = { sousSol: 100, etages: 100, total: 200 };
const SEUILS_SANS: SeuilsErp = { sousSol: null, etages: null, total: null };

export const ERP_NATURES: ReadonlyArray<NatureErp> = [
  {
    id: 'J-ages', code: 'J', short: 'personnes âgées', label: 'Structure d\'accueil pour personnes âgées',
    seuils: { sousSol: null, etages: null, total: 100, residents: 25 },
    note: 'Résidents + personnel + 1 visiteur pour 3 résidents. 5e catégorie sous 25 résidents et 100 personnes au total.',
    residentsLigne: 'residents',
    lignes: [
      { id: 'residents', label: 'Résidents (visiteurs : 1 pour 3 résidents)', unit: 'résidents', facteur: PUB(4 / 3) },
      { id: 'personnel', label: 'Personnel', unit: 'personnes', facteur: { personnel: 1 } },
    ],
    formules: [{ lignes: [{ ligne: 'residents' }, { ligne: 'personnel' }] }],
  },
  {
    id: 'J-handi', code: 'J', short: 'personnes handicapées', label: 'Structure d\'accueil pour personnes handicapées',
    seuils: { sousSol: null, etages: null, total: 100, residents: 20 },
    note: 'Résidents + personnel + 1 visiteur pour 3 résidents. 5e catégorie sous 20 résidents et 100 personnes au total.',
    residentsLigne: 'residents',
    lignes: [
      { id: 'residents', label: 'Résidents (visiteurs : 1 pour 3 résidents)', unit: 'résidents', facteur: PUB(4 / 3) },
      { id: 'personnel', label: 'Personnel', unit: 'personnes', facteur: { personnel: 1 } },
    ],
    formules: [{ lignes: [{ ligne: 'residents' }, { ligne: 'personnel' }] }],
  },
  {
    id: 'L-audition', code: 'L', short: 'audition, conférence, réunion', label: 'Salle d\'audition, de conférence, de réunion, de quartier, associations',
    seuils: SEUILS_L_REUNION,
    lignes: [
      unite('sieges', 'Sièges ou places de bancs numérotées', 'sièges', 1),
      unite('bancs', 'Bancs (1 pers. par 0,50 m)', 'm linéaires', 2),
      unite('debout', 'Personnes debout (3 pers./m²)', 'm²', 3),
      unite('promenoirs', 'Promenoirs et files d\'attente (5 pers./m)', 'm linéaires', 5),
    ],
    formules: [{ lignes: ['sieges', 'bancs', 'debout', 'promenoirs'].map(ligne => ({ ligne })) }],
  },
  {
    id: 'L-reunion', code: 'L', short: 'réunion sans spectacle', label: 'Salle de réunion sans spectacle',
    seuils: SEUILS_L_REUNION,
    lignes: [unite('surface', 'Surface totale de la salle', 'm²', 1)],
    formules: [{ lignes: [{ ligne: 'surface' }] }],
  },
  {
    id: 'L-spectacle', code: 'L', short: 'spectacle, projection', label: 'Salle de spectacle (cirque non forain compris) ou de projection',
    seuils: SEUILS_L_SPECTACLE,
    lignes: [
      unite('sieges', 'Sièges ou places de bancs numérotées', 'sièges', 1),
      unite('bancs', 'Bancs (1 pers. par 0,50 m)', 'm linéaires', 2),
      unite('debout', 'Personnes debout (3 pers./m²)', 'm²', 3),
      unite('promenoirs', 'Promenoirs et files d\'attente (5 pers./m)', 'm linéaires', 5),
    ],
    formules: [{ lignes: ['sieges', 'bancs', 'debout', 'promenoirs'].map(ligne => ({ ligne })) }],
  },
  {
    id: 'L-cabaret', code: 'L', short: 'cabaret', label: 'Cabaret',
    seuils: SEUILS_L_SPECTACLE,
    note: '4 pers. pour 3 m² de la surface de la salle, déduction faite des estrades des musiciens et des aménagements fixes.',
    lignes: [unite('surface', 'Surface de la salle (estrades et aménagements fixes déduits)', 'm²', 4 / 3)],
    formules: [{ lignes: [{ ligne: 'surface' }] }],
  },
  {
    id: 'L-polyvalente', code: 'L', short: 'salle polyvalente', label: 'Salle polyvalente',
    seuils: SEUILS_L_REUNION,
    note: 'Salle polyvalente à dominante sportive de plus de 1 200 m² ou de moins de 6,50 m de hauteur : seuils du spectacle (sous-sol 20, total 50).',
    lignes: [unite('surface', 'Surface totale de la salle', 'm²', 1)],
    formules: [{ lignes: [{ ligne: 'surface' }] }],
  },
  {
    id: 'L-multimedia', code: 'L', short: 'multimédia', label: 'Salle multimédia',
    seuils: SEUILS_L_SPECTACLE,
    note: 'Déclaration du maître d\'ouvrage, avec au minimum 1 pers. pour 2 m² de la surface totale.',
    lignes: [unite('surface', 'Surface totale de la salle (minimum 1 pers./2 m²)', 'm²', 1 / 2)],
    formules: [{ lignes: [{ ligne: 'surface' }] }],
  },
  {
    id: 'M-magasin', code: 'M', short: 'magasin de vente', label: 'Magasin de vente',
    seuils: SEUILS_M,
    note: 'Surface accessible au public évaluée forfaitairement au 1/3 de celle des locaux où il a accès, sauf justification de la surface réelle mise à disposition.',
    lignes: [
      unite('rdc', 'Rez-de-chaussée : surface accessible au public (2 pers./m²)', 'm²', 2),
      unite('ssol_1er', 'Sous-sol et 1er étage : surface accessible au public (1 pers./m²)', 'm²', 1),
      unite('e2', '2e étage : surface accessible au public (1 pers./2 m²)', 'm²', 1 / 2),
      unite('esup', 'Étages supérieurs : surface accessible au public (1 pers./5 m²)', 'm²', 1 / 5),
    ],
    formules: [{ lignes: ['rdc', 'ssol_1er', 'e2', 'esup'].map(ligne => ({ ligne })) }],
  },
  {
    id: 'M-mail', code: 'M', short: 'mail de centre commercial', label: 'Centre commercial : mails',
    seuils: SEUILS_M,
    lignes: [unite('surface', 'Surface totale des mails (1 pers./5 m²)', 'm²', 1 / 5)],
    formules: [{ lignes: [{ ligne: 'surface' }] }],
  },
  {
    id: 'M-local-petit', code: 'M', short: 'locaux de vente < 300 m²', label: 'Centre commercial : locaux de vente de moins de 300 m²',
    seuils: SEUILS_M,
    note: 'Locaux de vente de 300 m² et plus : calcul des magasins de vente.',
    lignes: [unite('surface', 'Surface totale (1 pers./2 m² sur le tiers de la surface)', 'm²', 1 / 6)],
    formules: [{ lignes: [{ ligne: 'surface' }] }],
  },
  {
    id: 'M-meubles', code: 'M', short: 'meubles, jardinage, gros matériel', label: 'Magasin de meubles, d\'articles de jardinage, de matériaux de construction ou de gros matériel',
    seuils: SEUILS_M,
    lignes: [unite('surface', 'Surface des locaux accessibles au public (1 pers./3 m² sur le tiers)', 'm²', 1 / 9)],
    formules: [{ lignes: [{ ligne: 'surface' }] }],
  },
  {
    id: 'M-boutique', code: 'M', short: 'boutique < 500 m²', label: 'Boutique de moins de 500 m² en rez-de-chaussée',
    seuils: SEUILS_M,
    note: 'Valable si la largeur des circulations principales est d\'au moins 1,80 m : 1 pers./m² sur le tiers de la surface accessible au public.',
    lignes: [unite('surface', 'Surface accessible au public', 'm²', 1 / 3)],
    formules: [{ lignes: [{ ligne: 'surface' }] }],
  },
  {
    id: 'N', code: 'N', short: 'restaurant, débit de boisson', label: 'Restaurant, café, bar, brasserie',
    seuils: { sousSol: 100, etages: 200, total: 200 },
    lignes: [
      unite('assise', 'Zones à restauration assise (1 pers./m²)', 'm²', 1),
      unite('debout', 'Zones à restauration debout (2 pers./m²)', 'm²', 2),
      unite('attente', 'Files d\'attente (3 pers./m²)', 'm²', 3),
    ],
    formules: [{ lignes: ['assise', 'debout', 'attente'].map(ligne => ({ ligne })) }],
  },
  {
    id: 'O', code: 'O', short: 'hôtel', label: 'Hôtel, pension de famille, résidence de tourisme',
    seuils: { sousSol: null, etages: null, total: 100 },
    lignes: [
      unite('couchages', 'Personnes pouvant occuper les chambres', 'personnes', 1),
      { id: 'personnel', label: 'Personnel', unit: 'personnes', facteur: { personnel: 1 } },
    ],
    formules: [{ lignes: [{ ligne: 'couchages' }, { ligne: 'personnel' }] }],
  },
  {
    id: 'P', code: 'P', short: 'danse, jeux', label: 'Salle de danse et salle de jeux',
    seuils: { sousSol: 20, etages: 100, total: 120 },
    lignes: [
      unite('surface', 'Surface de la salle, estrades et aménagements fixes déduits (4 pers./3 m²)', 'm²', 4 / 3),
      unite('billards', 'Billards autres qu\'électriques ou électroniques (4 pers. chacun)', 'billards', 4),
      unite('assise', 'Consommation assise (calcul du type N : 1 pers./m²)', 'm²', 1),
      unite('debout', 'Consommation debout (calcul du type N : 2 pers./m²)', 'm²', 2),
    ],
    formules: [
      { label: 'Salle de danse ou de jeux', lignes: [{ ligne: 'surface' }] },
      { label: 'Billards et public', lignes: ['billards', 'assise', 'debout'].map(ligne => ({ ligne })) },
    ],
  },
  {
    id: 'R-enseignement', code: 'R', short: 'enseignement, formation', label: 'Établissement d\'enseignement et de formation, internat primaire et secondaire, colonie de vacances, centre de loisirs sans hébergement',
    seuils: { sousSol: 100, etages: 100, total: 200 },
    note: 'Effectif fixé par déclaration du chef d\'établissement ou du maître d\'ouvrage.',
    lignes: [], formules: [],
  },
  {
    id: 'R-creche', code: 'R', short: 'crèche, école maternelle', label: 'Crèche, école maternelle, halte-garderie, jardin d\'enfants',
    seuils: { sousSol: 'interdit', etages: 20, total: 100 },
    note: 'Effectif fixé par déclaration du chef d\'établissement ou du maître d\'ouvrage. Accueil de jeunes enfants interdit en sous-sol en 5e catégorie.',
    lignes: [], formules: [],
  },
  {
    id: 'R-mam', code: 'R', short: 'maison d\'assistants maternels', label: 'Maison d\'assistants maternels (MAM)',
    seuils: { sousSol: null, etages: null, total: 16 },
    note: 'Effectif fixé par déclaration du chef d\'établissement ou du maître d\'ouvrage.',
    lignes: [], formules: [],
  },
  {
    id: 'S', code: 'S', short: 'bibliothèque', label: 'Bibliothèque, centre de documentation',
    seuils: { sousSol: 100, etages: 100, total: 200 },
    note: 'Effectif fixé par déclaration du chef d\'établissement ou du maître d\'ouvrage.',
    lignes: [], formules: [],
  },
  {
    id: 'T', code: 'T', short: 'exposition', label: 'Salle d\'exposition à vocation commerciale',
    seuils: { sousSol: 100, etages: 100, total: 200 },
    lignes: [
      unite('temporaire', 'Occupation temporaire : surface totale (1 pers./m²)', 'm²', 1),
      unite('permanente', 'Occupation permanente : surface totale (1 pers./9 m²)', 'm²', 1 / 9),
    ],
    formules: [
      { label: 'Occupation temporaire', lignes: [{ ligne: 'temporaire' }] },
      { label: 'Occupation permanente', lignes: [{ ligne: 'permanente' }] },
    ],
  },
  {
    id: 'U-sans', code: 'U', short: 'soins sans hébergement', label: 'Établissement de soins sans hébergement',
    seuils: { sousSol: null, etages: null, total: 100 },
    note: 'Déclaration justifiée du chef d\'établissement, et forfaitairement : 8 pers. par poste de consultation.',
    lignes: [unite('consult', 'Postes de consultation (8 pers. chacun)', 'postes', 8)],
    formules: [{ lignes: [{ ligne: 'consult' }] }],
  },
  {
    id: 'U-avec', code: 'U', short: 'soins avec hébergement', label: 'Établissement de soins avec hébergement',
    seuils: { sousSol: null, etages: null, total: 20 },
    note: 'Forfait : 1 pers. par lit, 1 pers. pour 3 lits pour le personnel, 1 pers. par lit pour les visiteurs, 8 pers. par poste de consultation. Pouponnières, psychiatrie, longue durée, personnes sans autonomie de vie : visiteurs sur la base de 1 pers. pour 2 lits.',
    lignes: [
      { id: 'lits', label: 'Lits (patient et visiteur : 1 pers. chacun ; personnel : 1 pers. pour 3 lits)', unit: 'lits', facteur: { public: 2, personnel: 1 / 3 } },
      unite('consult', 'Postes de consultation (8 pers. chacun)', 'postes', 8),
    ],
    formules: [{ lignes: [{ ligne: 'lits' }, { ligne: 'consult' }] }],
  },
  {
    id: 'V', code: 'V', short: 'culte', label: 'Lieu de culte',
    seuils: { sousSol: 100, etages: 200, total: 300 },
    lignes: [
      unite('sieges', 'Sièges', 'sièges', 1),
      unite('bancs', 'Bancs (1 pers. par 0,50 m)', 'm linéaires', 2),
      unite('fideles', 'Surface réservée aux fidèles, en l\'absence de sièges (2 pers./m²)', 'm²', 2),
    ],
    formules: [{ lignes: ['sieges', 'bancs', 'fideles'].map(ligne => ({ ligne })) }],
  },
  {
    id: 'W', code: 'W', short: 'administration, banque, bureau', label: 'Administration, banque, bureau',
    seuils: { sousSol: 100, etages: 200, total: 200 },
    note: 'Déclaration du maître d\'ouvrage ou de l\'exploitant, à défaut le calcul ci-dessous. Un bureau dont le professionnel ne reçoit pas de clientèle n\'est pas un ERP.',
    lignes: [
      unite('amenages', 'Locaux aménagés accessibles au public (1 pers./10 m²)', 'm²', 1 / 10),
      unite('non_amenages', 'Locaux non aménagés (1 pers./100 m² de planchers)', 'm²', 1 / 100),
    ],
    formules: [{ lignes: [{ ligne: 'amenages' }, { ligne: 'non_amenages' }] }],
  },
  {
    id: 'X-omnisports', code: 'X', short: 'omnisports, EPS', label: 'Salle omnisports, salle d\'EPS, salle sportive spécialisée',
    seuils: SEUILS_X,
    note: 'Soit la déclaration du maître d\'ouvrage ou de l\'exploitant, soit la plus grande des valeurs calculées.',
    lignes: [
      unite('aire', 'Aire de sport', 'm²', 1),
      unite('courts', 'Courts de tennis (25 pers. chacun)', 'courts', 25),
      ...pick('sp_sieges', 'sp_bancs', 'sp_promenoirs'),
    ],
    formules: [
      { label: '1 pers./4 m² d\'aire de sport', lignes: [{ ligne: 'aire', facteur: PUB(1 / 4) }] },
      { label: '25 pers. par court de tennis', lignes: [{ ligne: 'courts' }] },
      { label: '1 pers./8 m² d\'aire de sport et spectateurs', lignes: [{ ligne: 'aire', facteur: PUB(1 / 8) }, ...SP_ASSIS] },
    ],
  },
  {
    id: 'X-patinoire', code: 'X', short: 'patinoire', label: 'Patinoire',
    seuils: SEUILS_X,
    lignes: [unite('plan', 'Plan de patinage', 'm²', 1), ...pick('sp_sieges', 'sp_bancs', 'sp_promenoirs')],
    formules: [
      { label: '2 pers. pour 3 m² de plan de patinage', lignes: [{ ligne: 'plan', facteur: PUB(2 / 3) }] },
      { label: '1 pers./10 m² de plan de patinage et spectateurs', lignes: [{ ligne: 'plan', facteur: PUB(1 / 10) }, ...SP_ASSIS] },
    ],
  },
  {
    id: 'X-polyvalente', code: 'X', short: 'polyvalente sportive', label: 'Salle polyvalente à dominante sportive',
    seuils: SEUILS_X,
    note: 'Salle de moins de 1 200 m² ou de plus de 6,50 m de hauteur sous plafond (au-delà : seuils du spectacle).',
    lignes: [unite('aire', 'Aire de sport (1 pers./m²)', 'm²', 1), ...pick('sp_sieges', 'sp_bancs', 'sp_promenoirs')],
    formules: [{ lignes: [{ ligne: 'aire' }, ...SP_ASSIS] }],
  },
  {
    id: 'X-piscine-couverte', code: 'X', short: 'piscine couverte', label: 'Piscine couverte (ou transformable couverte)',
    seuils: SEUILS_X,
    lignes: [unite('plan', 'Plan d\'eau, hors bassins de plongeon indépendants et pataugeoires', 'm²', 1), ...pick('sp_sieges', 'sp_bancs', 'sp_promenoirs')],
    formules: [
      { label: '1 pers./m² de plan d\'eau', lignes: [{ ligne: 'plan' }] },
      { label: '1 pers./5 m² de plan d\'eau et spectateurs', lignes: [{ ligne: 'plan', facteur: PUB(1 / 5) }, ...SP_ASSIS] },
    ],
  },
  {
    id: 'X-piscine-decouverte', code: 'X', short: 'piscine transformable découverte', label: 'Piscine transformable en utilisation découverte',
    seuils: SEUILS_X,
    lignes: [unite('plan', 'Plan d\'eau découvert, hors bassins de plongeon indépendants et pataugeoires', 'm²', 1), ...pick('sp_sieges', 'sp_bancs', 'sp_promenoirs')],
    formules: [
      { label: '3 pers. pour 2 m² de plan d\'eau découvert', lignes: [{ ligne: 'plan', facteur: PUB(3 / 2) }] },
      { label: '1 pers./5 m² de plan d\'eau et spectateurs', lignes: [{ ligne: 'plan', facteur: PUB(1 / 5) }, ...SP_ASSIS] },
    ],
  },
  {
    id: 'X-piscine-mixte', code: 'X', short: 'piscine mixte', label: 'Piscine mixte',
    seuils: SEUILS_X,
    lignes: [
      unite('couvert', 'Plan d\'eau couvert, hors bassins de plongeon indépendants et pataugeoires', 'm²', 1),
      unite('decouvert', 'Plan d\'eau défini ci-dessus, situé en plein air', 'm²', 3 / 2),
      ...pick('sp_sieges', 'sp_bancs', 'sp_promenoirs'),
    ],
    formules: [
      { label: '1 pers./m² couvert et 3 pers. pour 2 m² en plein air', lignes: [{ ligne: 'couvert' }, { ligne: 'decouvert' }] },
      { label: '1 pers./5 m² de plans d\'eau et spectateurs', lignes: [{ ligne: 'couvert', facteur: PUB(1 / 5) }, { ligne: 'decouvert', facteur: PUB(1 / 5) }, ...SP_ASSIS] },
    ],
  },
  {
    id: 'Y', code: 'Y', short: 'musée', label: 'Musée',
    seuils: { sousSol: 100, etages: 100, total: 200 },
    lignes: [unite('surface', 'Surface accessible au public (1 pers./5 m²)', 'm²', 1 / 5)],
    formules: [{ lignes: [{ ligne: 'surface' }] }],
  },
  {
    id: 'PA-terrain', code: 'PA', short: 'terrain de sports, stade', label: 'Plein air : terrain de sports, stade',
    seuils: { sousSol: null, etages: null, total: 300 },
    note: 'Soit la déclaration du maître d\'ouvrage ou de l\'exploitant, soit la plus grande des valeurs calculées.',
    lignes: [unite('aire', 'Aire de sport', 'm²', 1), unite('courts', 'Courts de tennis (25 pers. chacun)', 'courts', 25), ...SPECTATEURS],
    formules: [
      { label: '1 pers./10 m² d\'aire de sport et spectateurs', lignes: [{ ligne: 'aire', facteur: PUB(1 / 10) }, ...SP_TOUS] },
      { label: '25 pers. par court de tennis et spectateurs', lignes: [{ ligne: 'courts' }, ...SP_TOUS] },
    ],
  },
  {
    id: 'PA-patinage', code: 'PA', short: 'piste de patinage', label: 'Plein air : piste de patinage',
    seuils: { sousSol: null, etages: null, total: 300 },
    lignes: [unite('plan', 'Plan de patinage (2 pers. pour 3 m²)', 'm²', 2 / 3), ...SPECTATEURS],
    formules: [{ lignes: [{ ligne: 'plan' }, ...SP_TOUS] }],
  },
  {
    id: 'PA-bassin', code: 'PA', short: 'bassin de natation', label: 'Plein air : bassin de natation',
    seuils: { sousSol: null, etages: null, total: 300 },
    lignes: [unite('plan', 'Plan d\'eau, hors bassin de plongeon indépendant et pataugeoires (3 pers. pour 2 m²)', 'm²', 3 / 2), ...SPECTATEURS],
    formules: [{ lignes: [{ ligne: 'plan' }, ...SP_TOUS] }],
  },
  {
    id: 'PA-autre', code: 'PA', short: 'autres activités', label: 'Plein air : autres activités',
    seuils: { sousSol: null, etages: null, total: 300 },
    note: 'Nombre de spectateurs.',
    lignes: SPECTATEURS,
    formules: [{ lignes: SP_TOUS }],
  },
  { id: 'SG', code: 'SG', short: 'structure gonflable', label: 'Structure gonflable', seuils: SEUILS_SANS, note: 'Pas de seuil.', lignes: [], formules: [] },
  { id: 'PS', code: 'PS', short: 'parc de stationnement', label: 'Parc de stationnement couvert', seuils: SEUILS_SANS, note: 'Pas de seuil.', lignes: [], formules: [] },
  { id: 'GA', code: 'GA', short: 'gare', label: 'Gare', seuils: SEUILS_SANS, note: 'Pas de seuil.', lignes: [], formules: [] },
  { id: 'OA', code: 'OA', short: 'hôtel-restaurant d\'altitude', label: 'Hôtel-restaurant d\'altitude', seuils: { sousSol: null, etages: null, total: 20 }, lignes: [], formules: [] },
  { id: 'REF', code: 'REF', short: 'refuge de montagne', label: 'Refuge de montagne', seuils: SEUILS_SANS, note: 'Pas de seuil.', lignes: [], formules: [] },
  {
    id: 'CTS', code: 'CTS', short: 'chapiteau, tente', label: 'Chapiteau, tente et structure',
    seuils: { sousSol: null, etages: null, total: 50 },
    note: 'Mode de calcul propre au type d\'activité concerné.', lignes: [], formules: [],
  },
  {
    id: 'EF', code: 'EF', short: 'établissement flottant', label: 'Établissement flottant',
    seuils: { sousSol: null, etages: null, total: null, sansCinquieme: true },
    note: 'Mode de calcul propre au type d\'activité concerné. Pas de 5e catégorie.', lignes: [], formules: [],
  },
];

export const naturesDuType = (code: string) => ERP_NATURES.filter(n => n.code === code);
export const natureParShort = (code: string, short: string | undefined) =>
  ERP_NATURES.find(n => n.code === code && n.short === short);

export interface EffectifCalcule {
  public: number;
  personnel: number;
  total: number;
  /** Libellé de la formule retenue quand plusieurs s'appliquent. */
  formule?: string;
}

/**
 * Effectif d'une nature : la plus grande des formules, sauf si l'effectif a été déclaré
 * (maître d'ouvrage ou exploitant), qui prime sur le calcul pour le public.
 */
export function calculerEffectif(nature: NatureErp, quantites: Record<string, number>, declare?: number): EffectifCalcule {
  const q = (id: string) => Math.max(0, Number(quantites[id]) || 0);
  const lignes = new Map(nature.lignes.map(l => [l.id, l]));
  let best = { public: 0, personnel: 0, formule: undefined as string | undefined };
  for (const f of nature.formules) {
    let pub = 0;
    let per = 0;
    for (const { ligne, facteur } of f.lignes) {
      const fac = facteur ?? lignes.get(ligne)?.facteur ?? {};
      pub += q(ligne) * (fac.public ?? 0);
      per += q(ligne) * (fac.personnel ?? 0);
    }
    if (pub + per > best.public + best.personnel) best = { public: pub, personnel: per, formule: nature.formules.length > 1 ? f.label : undefined };
  }
  const round = (n: number) => Math.ceil(n - 1e-9);
  const dec = declare != null && declare > 0 ? declare : undefined;
  const pub = round(dec ?? best.public);
  const per = round(best.personnel);
  return { public: pub, personnel: per, total: pub + per, formule: dec != null ? undefined : best.formule };
}

export interface NiveauxErp { sousSol?: number; etages?: number; residents?: number }

/**
 * Catégorie d'après l'effectif total : 1re à 3e au-dessus de 300 personnes ; en dessous,
 * 5e catégorie si aucun seuil du type n'est atteint, sinon 4e. `motifs` dit ce qui fait la 4e.
 */
export function categorieErp(nature: NatureErp | undefined, effectifTotal: number, niveaux: NiveauxErp = {}): { categorie: number | null; motifs: string[] } {
  if (!Number.isFinite(effectifTotal) || effectifTotal <= 0) return { categorie: null, motifs: [] };
  if (effectifTotal > 1500) return { categorie: 1, motifs: [] };
  if (effectifTotal > 700) return { categorie: 2, motifs: [] };
  if (effectifTotal > 300) return { categorie: 3, motifs: [] };
  if (!nature) return { categorie: null, motifs: [] };
  const s = nature.seuils;
  const motifs: string[] = [];
  if (s.sansCinquieme) motifs.push('pas de 5e catégorie pour ce type');
  if (s.total != null && effectifTotal >= s.total) motifs.push(`effectif total de ${s.total} personnes atteint`);
  if (s.residents != null && (niveaux.residents ?? 0) >= s.residents) motifs.push(`${s.residents} résidents atteints`);
  if (s.sousSol === 'interdit') { if ((niveaux.sousSol ?? 0) > 0) motifs.push('accueil interdit en sous-sol'); }
  else if (s.sousSol != null && (niveaux.sousSol ?? 0) >= s.sousSol) motifs.push(`${s.sousSol} personnes atteintes en sous-sol`);
  if (s.etages != null && (niveaux.etages ?? 0) >= s.etages) motifs.push(`${s.etages} personnes atteintes aux étages`);
  return { categorie: motifs.length ? 4 : 5, motifs };
}

export function descriptionSeuils(s: SeuilsErp): string[] {
  if (s.sansCinquieme) return ['Pas de 5e catégorie'];
  const out: string[] = [];
  if (s.sousSol === 'interdit') out.push('Sous-sol : interdit');
  else out.push(`Sous-sol : ${s.sousSol == null ? 'pas de seuil' : s.sousSol}`);
  out.push(`Étages : ${s.etages == null ? 'pas de seuil' : s.etages}`);
  out.push(`Total des niveaux : ${s.total == null ? 'pas de seuil' : s.total}`);
  if (s.residents != null) out.push(`Résidents : ${s.residents}`);
  return out;
}
