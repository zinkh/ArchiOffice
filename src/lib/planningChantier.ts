// Planning de chantier (Gantt par lot) de l'onglet DET.
//
// Le planning appartient à l'affaire (table project_chantier_planning, une ligne
// par affaire, contenu jsonb) : ce n'est ni le diagramme de Gantt des tâches
// internes du cabinet (`tasks`), ni les jalons de mission. Il décrit comment les
// ENTREPRISES interviennent, lot par lot, de l'ordre de service de démarrage à la
// réception. Logique pure, partagée par l'écran, le PDF et le serveur.
//
// Les dates sont des « AAAA-MM-JJ » calculées en UTC : un fuseau ou le passage à
// l'heure d'été ne doit jamais décaler une barre d'un jour.

export type SourceTache = 'ia' | 'manuel';

export interface TachePlanning {
  id: string;
  /** `project_lots.id`. Vide : tâche générale du chantier (installation, réception...). */
  lotId: string;
  libelle: string;
  /** Premier jour travaillé (AAAA-MM-JJ). */
  debut: string;
  /** Dernier jour travaillé, inclus. */
  fin: string;
  /** 0 à 100. */
  avancement: number;
  source: SourceTache;
  /** Un jalon est une échéance d'un jour (réception, fin de gros œuvre...). */
  jalon?: boolean;
  /** Identifiants des prédécesseurs, relation fin à début (jours inclusifs). */
  dependencies?: string[];
  /**
   * Délai en jours après la fin d'un prédécesseur (séchage, délai d'approvisionnement...), par identifiant
   * de prédécesseur ; absent ou 0 : la tâche peut commencer le lendemain. Jours calendaires, ou jours
   * ouvrés quand le calendrier du chantier est en jours ouvrés.
   */
  delais?: Record<string, number>;
}

export interface PlanningChantier {
  version: 1;
  taches: TachePlanning[];
  /** Hypothèses retenues lors de la dernière génération IA, à relire. */
  hypotheses: string[];
  genereLe: string | null;
  /** Calendrier partagé des entreprises de cette affaire, sans recalcul des dates. */
  calendrier?: CalendrierPlanning;
}

export const PLANNING_VIDE: PlanningChantier = { version: 1, taches: [], hypotheses: [], genereLe: null };

export const MAX_TACHES = 400;
export const MAX_DELAI = 365;
const MAX_LIBELLE = 160;
const MAX_HYPOTHESES = 12;
const MAX_HYPOTHESE = 300;
const JOUR_MS = 86_400_000;

// ── Dates ────────────────────────────────────────────────────────────────────

export const estDateIso = (valeur: unknown): valeur is string =>
  typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valeur) && !Number.isNaN(Date.parse(`${valeur}T00:00:00Z`))
  && new Date(`${valeur}T00:00:00Z`).toISOString().slice(0, 10) === valeur;

const enMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const enIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const ajouterJours = (iso: string, jours: number): string => enIso(enMs(iso) + jours * JOUR_MS);

/** Nombre de jours entre deux dates (négatif si `b` précède `a`). */
export const joursEntre = (a: string, b: string): number => Math.round((enMs(b) - enMs(a)) / JOUR_MS);

/** Lundi de la semaine de la date donnée (0 = dimanche dans Date.getUTCDay). */
export function lundiDe(iso: string): string {
  const jour = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return ajouterJours(iso, -((jour + 6) % 7));
}

export const aujourdhuiIso = (maintenant = new Date()): string => maintenant.toISOString().slice(0, 10);

// ── Assainissement ───────────────────────────────────────────────────────────

const texte = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Assainit un planning reçu d'un client (ou relu de la base) : bornes, types,
 * dates valides (début et fin remis dans l'ordre), identifiants uniques,
 * avancement entre 0 et 100. Ce qui n'a ni libellé ni date lisible est écarté.
 */
export function sanitizePlanning(brut: unknown): PlanningChantier {
  const source = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const vus = new Set<string>();
  const taches: TachePlanning[] = [];
  const liens = new Map<string, string[]>();
  const delaisBruts = new Map<string, Record<string, unknown>>();
  for (const entree of (Array.isArray(source.taches) ? source.taches : []).slice(0, MAX_TACHES)) {
    if (!entree || typeof entree !== 'object') continue;
    const t = entree as Record<string, unknown>;
    const libelle = texte(t.libelle, MAX_LIBELLE);
    if (!libelle || !estDateIso(t.debut)) continue;
    let debut = t.debut;
    let fin = estDateIso(t.fin) ? t.fin : debut;
    if (fin < debut) [debut, fin] = [fin, debut];
    const jalon = t.jalon === true;
    if (jalon) fin = debut;
    let id = typeof t.id === 'string' && t.id && t.id.length <= 64 && !vus.has(t.id) ? t.id : `t-${taches.length + 1}-${vus.size}`;
    while (vus.has(id)) id += '-';
    vus.add(id);
    liens.set(id, Array.isArray(t.dependencies) ? [...new Set(t.dependencies.filter((d): d is string => typeof d === 'string'))].slice(0, MAX_TACHES) : []);
    if (t.delais && typeof t.delais === 'object' && !Array.isArray(t.delais)) delaisBruts.set(id, t.delais as Record<string, unknown>);
    const avancement = Number(t.avancement);
    taches.push({
      id,
      lotId: texte(t.lotId, 64),
      libelle,
      debut,
      fin,
      avancement: Number.isFinite(avancement) ? Math.min(100, Math.max(0, Math.round(avancement))) : 0,
      source: t.source === 'ia' ? 'ia' : 'manuel',
      ...(jalon ? { jalon: true } : {}),
    });
  }
  // Nettoyage après lecture de tous les identifiants : suppression / remplacement IA.
  const graphe = new Map<string, string[]>();
  const atteint = (depart: string, cible: string, visites = new Set<string>()): boolean => {
    if (depart === cible) return true;
    if (visites.has(depart)) return false;
    visites.add(depart);
    return (graphe.get(depart) ?? []).some(id => atteint(id, cible, visites));
  };
  for (const t of taches) {
    const deps = (liens.get(t.id) ?? []).filter(id => vus.has(id) && id !== t.id);
    const valides = deps.filter(id => !atteint(id, t.id));
    if (valides.length) t.dependencies = valides;
    graphe.set(t.id, valides);
    // Un délai n'existe que pour un lien conservé : entier de 1 à MAX_DELAI jours, le reste est écarté.
    const delais: Record<string, number> = {};
    for (const id of valides) {
      const n = Math.round(Number(delaisBruts.get(t.id)?.[id]));
      if (Number.isFinite(n) && n > 0) delais[id] = Math.min(MAX_DELAI, n);
    }
    if (Object.keys(delais).length) t.delais = delais;
  }
  return {
    version: 1,
    taches,
    ...(source.calendrier && typeof source.calendrier === 'object' ? { calendrier: sanitizeCalendrierPlanning(source.calendrier) } : {}),
    hypotheses: (Array.isArray(source.hypotheses) ? source.hypotheses : [])
      .map(h => texte(h, MAX_HYPOTHESE)).filter(Boolean).slice(0, MAX_HYPOTHESES),
    genereLe: typeof source.genereLe === 'string' && !Number.isNaN(Date.parse(source.genereLe)) ? source.genereLe : null,
  };
}

// ── Lecture du planning ──────────────────────────────────────────────────────

export interface LotPlanifiable {
  id: string;
  lot_number: string;
  lot_title: string;
  contact_name?: string;
}

export interface LignePlanningLot {
  /** `null` : tâches générales, sans lot. */
  lot: LotPlanifiable | null;
  taches: TachePlanning[];
  debut: string;
  fin: string;
  /** Avancement du lot, pondéré par la durée de chaque tâche. */
  avancement: number;
}

export const dureeJours = (t: Pick<TachePlanning, 'debut' | 'fin'>) => joursEntre(t.debut, t.fin) + 1;

/** Lots dans leur ordre et tâches dans l'ordre enregistré, indépendant des dates. */
export function planningParLot(planning: PlanningChantier, lots: LotPlanifiable[]): LignePlanningLot[] {
  const resume = (lot: LotPlanifiable | null, taches: TachePlanning[]): LignePlanningLot => {
    const tri = [...taches];
    const poids = tri.reduce((n, t) => n + dureeJours(t), 0);
    return {
      lot,
      taches: tri,
      debut: tri.reduce((m, t) => (t.debut < m ? t.debut : m), tri[0].debut),
      fin: tri.reduce((m, t) => (t.fin > m ? t.fin : m), tri[0].fin),
      avancement: poids > 0 ? Math.round(tri.reduce((n, t) => n + t.avancement * dureeJours(t), 0) / poids) : 0,
    };
  };
  const lignes: LignePlanningLot[] = [];
  const connus = new Set(lots.map(l => l.id));
  const generales = planning.taches.filter(t => !t.lotId || !connus.has(t.lotId));
  if (generales.length) lignes.push(resume(null, generales));
  for (const lot of lots) {
    const taches = planning.taches.filter(t => t.lotId === lot.id);
    if (taches.length) lignes.push(resume(lot, taches));
  }
  return lignes;
}

/** Première et dernière date du planning, `null` s'il est vide. */
export function bornesPlanning(planning: PlanningChantier): { debut: string; fin: string } | null {
  if (!planning.taches.length) return null;
  return {
    debut: planning.taches.reduce((m, t) => (t.debut < m ? t.debut : m), planning.taches[0].debut),
    fin: planning.taches.reduce((m, t) => (t.fin > m ? t.fin : m), planning.taches[0].fin),
  };
}

/** Lundis des semaines couvrant l'intervalle, du plus ancien au plus récent. */
export function semainesEntre(debut: string, fin: string): string[] {
  const semaines: string[] = [];
  for (let lundi = lundiDe(debut); lundi <= fin && semaines.length < 520; lundi = ajouterJours(lundi, 7)) semaines.push(lundi);
  return semaines;
}

export type EtatTache = 'a_venir' | 'en_cours' | 'terminee' | 'en_retard';

const dureeEcoulee = (t: TachePlanning, aujourdhui: string) => Math.min(dureeJours(t), joursEntre(t.debut, aujourdhui) + 1);

/**
 * Se déduit, ne se saisit pas : terminée à 100 %, en retard si la date de fin est
 * passée sans l'être ou si l'avancement est inférieur de plus de 20 points à
 * l'avancement linéaire attendu.
 */
export function etatTache(t: TachePlanning, aujourdhui = aujourdhuiIso()): EtatTache {
  if (t.avancement >= 100) return 'terminee';
  if (aujourdhui > t.fin) return 'en_retard';
  if (aujourdhui < t.debut) return t.avancement > 0 ? 'en_cours' : 'a_venir';
  const attendu = Math.round((dureeEcoulee(t, aujourdhui) / dureeJours(t)) * 100);
  return attendu - t.avancement > 20 ? 'en_retard' : 'en_cours';
}

// ── Réponse de l'IA ──────────────────────────────────────────────────────────

/** Ce que le modèle rend : des semaines, jamais des dates (il se trompe de calendrier). */
export interface TacheGeneree {
  lot_numero?: unknown;
  libelle?: unknown;
  semaine_debut?: unknown;
  duree_semaines?: unknown;
  jalon?: unknown;
}

const numeroNormalise = (n: unknown) => String(n ?? '').trim().toLowerCase().replace(/^lot\s*/, '').replace(/^0+(?=\d)/, '');
const EST_GENERAL = (numero: string) => numero === '' || numero === 'general' || numero === 'général' || numero === 'generale' || numero === 'générale';

export interface PlanningGenere {
  taches: TachePlanning[];
  hypotheses: string[];
  /** Tâches écartées : lot inconnu, durée illisible. */
  ecartees: number;
}

/**
 * Convertit la réponse du modèle en planning. Le modèle raisonne en semaines
 * depuis le démarrage (semaine 1 = semaine de `dateDebut`) ; les dates sont posées
 * ici, du lundi au vendredi. Un lot que le projet ne connaît pas est écarté : le
 * planning ne crée jamais de lot.
 */
export function planningDepuisReponse(
  brut: unknown,
  lots: LotPlanifiable[],
  dateDebut: string,
  fabriqueId: () => string,
): PlanningGenere {
  const source = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const lundi = lundiDe(dateDebut);
  const parNumero = new Map(lots.map(l => [numeroNormalise(l.lot_number), l]));
  const taches: TachePlanning[] = [];
  let ecartees = 0;
  for (const entree of (Array.isArray(source.taches) ? source.taches : []).slice(0, MAX_TACHES) as TacheGeneree[]) {
    const libelle = texte(entree?.libelle, MAX_LIBELLE);
    const numero = numeroNormalise(entree?.lot_numero);
    const general = EST_GENERAL(numero);
    const lot = general ? undefined : parNumero.get(numero);
    const debutSemaine = Math.round(Number(entree?.semaine_debut));
    const duree = Math.round(Number(entree?.duree_semaines));
    const jalon = entree?.jalon === true;
    if (!libelle || (!lot && !general) || !Number.isFinite(debutSemaine) || debutSemaine < 1 || debutSemaine > 520) { ecartees++; continue; }
    if (!jalon && (!Number.isFinite(duree) || duree < 1 || duree > 260)) { ecartees++; continue; }
    const debut = ajouterJours(lundi, (debutSemaine - 1) * 7);
    // Un jalon tombe le vendredi de sa semaine ; une tâche s'achève le vendredi de sa dernière semaine.
    const fin = jalon ? ajouterJours(debut, 4) : ajouterJours(debut, (duree - 1) * 7 + 4);
    taches.push({
      id: fabriqueId(),
      lotId: lot?.id ?? '',
      libelle,
      debut: jalon ? fin : debut,
      fin,
      avancement: 0,
      source: 'ia',
      ...(jalon ? { jalon: true } : {}),
    });
  }
  return {
    taches,
    hypotheses: (Array.isArray(source.hypotheses) ? source.hypotheses : [])
      .map(h => texte(h, MAX_HYPOTHESE)).filter(Boolean).slice(0, MAX_HYPOTHESES),
    ecartees,
  };
}

/**
 * Fusionne une génération dans le planning existant. Seules les tâches des lots
 * générés sont concernées (`lotsGeneres` porte '' pour les tâches générales) : les
 * tâches de l'IA y sont remplacées, celles saisies à la main sont gardées si
 * `garderManuel`. Le reste du planning n'est pas touché.
 */
export function appliquerGeneration(
  actuel: PlanningChantier,
  genere: PlanningGenere,
  lotsGeneres: Set<string>,
  options: { garderManuel: boolean; maintenant?: Date },
): PlanningChantier {
  const concerne = (t: TachePlanning) => lotsGeneres.has(t.lotId);
  const conservees = actuel.taches.filter(t => !concerne(t) || (options.garderManuel && t.source === 'manuel'));
  return sanitizePlanning({
    ...actuel,
    taches: [...conservees, ...genere.taches],
    hypotheses: genere.hypotheses,
    genereLe: (options.maintenant ?? new Date()).toISOString(),
  });
}


/** Détection par parcours des prédécesseurs, indépendante des dates et des lots. */
export function cycleDependances(taches: Pick<TachePlanning, 'id' | 'dependencies'>[]): boolean {
  const parId = new Map(taches.map(t => [t.id, t.dependencies ?? []]));
  const actifs = new Set<string>();
  const faits = new Set<string>();
  const visite = (id: string): boolean => {
    if (actifs.has(id)) return true;
    if (faits.has(id)) return false;
    actifs.add(id);
    if ((parId.get(id) ?? []).some(visite)) return true;
    actifs.delete(id); faits.add(id);
    return false;
  };
  return taches.some(t => visite(t.id));
}

export function incoherencesDependances(taches: TachePlanning[], ouvre: EstOuvre = TOUS_LES_JOURS): { tache: TachePlanning; precedent: TachePlanning }[] {
  const parId = new Map(taches.map(t => [t.id, t]));
  return taches.flatMap(tache => (tache.dependencies ?? []).flatMap(id => {
    const precedent = parId.get(id);
    // La fin est inclusive, y compris pour les jalons datés sans heure ; le délai du lien s'ajoute au lendemain.
    return precedent && ecartInsuffisant(precedent.fin, tache.debut, delaiDuLien(tache, id), ouvre) ? [{ tache, precedent }] : [];
  }));
}

export interface AffichagePlanning {
  echelle: 'semaines' | 'mois';
  relatif: boolean;
  numerosSemaines: boolean;
  generales: boolean;
  replies: string[];
  avancement: boolean;
  largeurLibelles: number;
  largeurPeriode: number;
  ajusterLargeur: boolean;
  joursFeries: boolean;
  conges: boolean;
  /** Réglage de saisie, local à l'appareil : décale les successeurs d'une tâche dont les dates changent. */
  cascade: boolean;
}
export const AFFICHAGE_PLANNING: AffichagePlanning = { echelle: 'semaines', relatif: false, numerosSemaines: true, generales: true, replies: [], avancement: true, largeurLibelles: 272, largeurPeriode: 84, ajusterLargeur: false, joursFeries: true, conges: true, cascade: false };
export function bornerLargeur(v: unknown, min: number, max: number, repli: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : repli;
}
export function sanitizeAffichage(v: unknown): AffichagePlanning {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<AffichagePlanning>;
  return { echelle: o.echelle === 'mois' ? 'mois' : 'semaines', relatif: o.relatif === true,
    numerosSemaines: o.numerosSemaines !== false, generales: o.generales !== false,
    joursFeries: o.joursFeries !== false, conges: o.conges !== false,
    avancement: o.avancement !== false, ajusterLargeur: o.ajusterLargeur === true, cascade: o.cascade === true,
    largeurLibelles: bornerLargeur(o.largeurLibelles, 140, 560, AFFICHAGE_PLANNING.largeurLibelles),
    largeurPeriode: bornerLargeur(o.largeurPeriode, 28, 240, AFFICHAGE_PLANNING.largeurPeriode),
    replies: Array.isArray(o.replies) ? o.replies.filter((s): s is string => typeof s === 'string').slice(0, MAX_TACHES) : [] };
}

export function semaineIso(iso: string): string {
  const jeudi = ajouterJours(lundiDe(iso), 3);
  const annee = jeudi.slice(0, 4);
  const semaine = 1 + Math.round(joursEntre(lundiDe(`${annee}-01-04`), lundiDe(iso)) / 7);
  return `${annee}-S${String(semaine).padStart(2, '0')}`;
}

/** Mois relatifs ancrés au jour de démarrage, rabattus au dernier jour du mois. */
export function ajouterMois(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const jour = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(jour, dernier));
  return d.toISOString().slice(0, 10);
}

export interface PeriodePlanning { debut: string; fin: string; libelle: string }
/** Même axe écran / PDF : en relatif S1/M1 commence exactement au premier jour du planning. */
export function periodesPlanning(debut: string, fin: string, affichage: AffichagePlanning): PeriodePlanning[] {
  const hebdo = affichage.echelle === 'semaines';
  const origine = affichage.relatif ? debut : hebdo ? lundiDe(debut) : `${debut.slice(0, 7)}-01`;
  const resultat: PeriodePlanning[] = [];
  for (let i = 0; i < 1200; i++) {
    const date = hebdo ? ajouterJours(origine, i * 7) : ajouterMois(origine, i);
    if (date > fin) break;
    const suivante = hebdo ? ajouterJours(date, 7) : ajouterMois(origine, i + 1);
    const libelle = affichage.relatif ? `${hebdo ? 'S' : 'M'}${i + 1}` : hebdo
      ? affichage.numerosSemaines ? semaineIso(date) : `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
      : `${date.slice(5, 7)}/${date.slice(0, 4)}`;
    resultat.push({ debut: date, fin: ajouterJours(suivante, -1), libelle });
  }
  return resultat;
}

/** Position continue dans des colonnes de longueurs calendaires différentes. */
export function positionPlanning(iso: string, periodes: PeriodePlanning[]): number {
  const i = periodes.findIndex(p => iso >= p.debut && iso <= p.fin);
  if (i >= 0) return i + joursEntre(periodes[i].debut, iso) / (joursEntre(periodes[i].debut, periodes[i].fin) + 1);
  if (!periodes.length) return 0;
  return iso < periodes[0].debut ? 0 : periodes.length;
}


/** Inverse de l'axe, arrondi au jour le plus proche, y compris hors de l'intervalle visible. */
export function dateDepuisPositionPlanning(position: number, periodes: PeriodePlanning[], echelle: AffichagePlanning['echelle']): string {
  if (!periodes.length || !Number.isFinite(position)) throw new Error('Axe du planning invalide');
  const i = Math.floor(position);
  const origine = periodes[0].debut;
  const debut = echelle === 'semaines' ? ajouterJours(origine, i * 7) : ajouterMois(origine, i);
  const suivante = echelle === 'semaines' ? ajouterJours(debut, 7) : ajouterMois(origine, i + 1);
  return ajouterJours(debut, Math.round((position - i) * joursEntre(debut, suivante)));
}

export type GesteDatesPlanning = 'deplacer' | 'debut' | 'fin';
/** Préserve la durée d'un déplacement ; une borne redimensionnée ne croise jamais l'autre. */
export function datesParGeste(tache: TachePlanning, geste: GesteDatesPlanning, date: string): TachePlanning {
  if (!estDateIso(date)) return tache;
  if (geste === 'deplacer' || tache.jalon) {
    const delta = joursEntre(tache.debut, date);
    const fin = ajouterJours(tache.fin, delta);
    return estDateIso(fin) ? { ...tache, debut: date, fin } : tache;
  }
  return geste === 'debut' ? { ...tache, debut: date > tache.fin ? tache.fin : date }
    : { ...tache, fin: date < tache.debut ? tache.debut : date };
}

export type ResultatLienPlanning = 'ajoute' | 'soi' | 'cycle' | 'existant' | 'introuvable';
export function verifierLienPlanning(taches: TachePlanning[], precedent: string, suivant: string): ResultatLienPlanning {
  if (precedent === suivant) return 'soi';
  if (!taches.some(t => t.id === precedent) || !taches.some(t => t.id === suivant)) return 'introuvable';
  if (taches.find(t => t.id === suivant)?.dependencies?.includes(precedent)) return 'existant';
  return cycleDependances(taches.map(t => t.id === suivant ? { ...t, dependencies: [...(t.dependencies ?? []), precedent] } : t)) ? 'cycle' : 'ajoute';
}

/** Toutes les colonnes tiennent dans la région en mode ajusté, sans changer l'échelle calendaire. */
export function dimensionsPlanning(largeurDisponible: number, periodes: number, affichage: AffichagePlanning) {
  const libelles = Math.min(affichage.largeurLibelles, Math.max(140, largeurDisponible - 96));
  const periode = affichage.ajusterLargeur && periodes > 0 ? Math.max(0.01, (largeurDisponible - libelles - 80) / periodes) : affichage.largeurPeriode;
  return { libelles, periode };
}


export type ZoneFeriesPlanning = 'france' | 'alsace_moselle' | 'aucun';
export interface PeriodeCalendrierPlanning {
  id: string;
  libelle: string;
  debut: string;
  fin: string;
  type: 'conge' | 'ferie';
}
export interface CalendrierPlanning {
  joursFeries: ZoneFeriesPlanning;
  periodes: PeriodeCalendrierPlanning[];
  /**
   * Calcul en jours ouvrés : du lundi au vendredi, hors jours fériés de la zone et hors périodes de congés
   * ou de fermeture. Sert au placement, au décalage des successeurs et aux délais ; les dates enregistrées
   * restent des dates réelles et les exports XML gardent leur calendrier de sept jours.
   */
  joursOuvres?: boolean;
}
export const CALENDRIER_PLANNING: CalendrierPlanning = { joursFeries: 'france', periodes: [] };
export const MAX_PERIODES_CALENDRIER = 100;
export function sanitizeCalendrierPlanning(brut: unknown): CalendrierPlanning {
  const o = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const ids = new Set<string>();
  const periodes: PeriodeCalendrierPlanning[] = [];
  for (const entree of (Array.isArray(o.periodes) ? o.periodes : []).slice(0, MAX_PERIODES_CALENDRIER)) {
    if (!entree || typeof entree !== 'object') continue;
    const p = entree as Record<string, unknown>;
    const libelle = texte(p.libelle, 100);
    if (!libelle || !estDateIso(p.debut) || !estDateIso(p.fin) || p.fin < p.debut) continue;
    let id = texte(p.id, 64) || `periode-${periodes.length + 1}`;
    while (ids.has(id)) id += '-';
    ids.add(id);
    periodes.push({ id, libelle, debut: p.debut, fin: p.fin, type: p.type === 'ferie' ? 'ferie' : 'conge' });
  }
  return {
    joursFeries: o.joursFeries === 'aucun' || o.joursFeries === 'alsace_moselle' ? o.joursFeries : 'france', periodes,
    ...(o.joursOuvres === true ? { joursOuvres: true } : {}),
  };
}

// ── Jours ouvrés, liens et délais ────────────────────────────────────────────

/** Vrai si le jour est travaillé. Le calendrier du chantier en fournit une version (voir planningChantierCalendrier). */
export type EstOuvre = (iso: string) => boolean;
export const TOUS_LES_JOURS: EstOuvre = () => true;
export const LUNDI_AU_VENDREDI: EstOuvre = iso => { const j = new Date(`${iso}T00:00:00Z`).getUTCDay(); return j !== 0 && j !== 6; };
/** Garde-fou : un calendrier sans aucun jour travaillé ne doit jamais faire boucler. */
const BORNE_JOURS = 4000;

/** Premier jour travaillé à partir de `iso` inclus. */
export function premierJourOuvre(iso: string, ouvre: EstOuvre = TOUS_LES_JOURS): string {
  let jour = iso;
  for (let i = 0; i < BORNE_JOURS && !ouvre(jour); i++) jour = ajouterJours(jour, 1);
  return jour;
}
/** `n` jours travaillés après `iso` (n entier, 0 rend `iso`). */
export function avancerOuvres(iso: string, n: number, ouvre: EstOuvre = TOUS_LES_JOURS): string {
  let jour = iso;
  for (let i = 0; i < n; i++) jour = premierJourOuvre(ajouterJours(jour, 1), ouvre);
  return jour;
}
/** Jours travaillés dans [debut, fin], bornes incluses (0 si la fin précède le début). */
export function joursOuvresEntre(debut: string, fin: string, ouvre: EstOuvre = TOUS_LES_JOURS): number {
  let n = 0;
  for (let jour = debut, i = 0; jour <= fin && i < BORNE_JOURS; jour = ajouterJours(jour, 1), i++) if (ouvre(jour)) n++;
  return n;
}
/** Durée en jours travaillés (au moins 1 : une tâche posée sur un week-end compte un jour). */
export const dureeOuvree = (t: Pick<TachePlanning, 'debut' | 'fin'>, ouvre: EstOuvre = TOUS_LES_JOURS) => Math.max(1, joursOuvresEntre(t.debut, t.fin, ouvre));

const delaiDuLien = (tache: Pick<TachePlanning, 'delais'>, precedent: string) => tache.delais?.[precedent] ?? 0;
/** Premier début permis par un prédécesseur : `delai` jours (travaillés) pleins après sa fin. */
export const debutMinimalLien = (finPrecedent: string, delai: number, ouvre: EstOuvre = TOUS_LES_JOURS) => avancerOuvres(finPrecedent, 1 + Math.max(0, delai), ouvre);
/** Écart insuffisant : la tâche chevauche son prédécesseur ou laisse moins de `delai` jours entre les deux. */
function ecartInsuffisant(finPrecedent: string, debut: string, delai: number, ouvre: EstOuvre): boolean {
  return debut <= finPrecedent || joursOuvresEntre(ajouterJours(finPrecedent, 1), ajouterJours(debut, -1), ouvre) < delai;
}

/** Déplace une tâche à un nouveau début en gardant sa durée (en jours travaillés si `ouvre` l'est). */
export function deplacerTacheAu(tache: TachePlanning, debut: string, ouvre: EstOuvre = TOUS_LES_JOURS): TachePlanning {
  if (!estDateIso(debut)) return tache;
  if (tache.jalon) return { ...tache, debut, fin: debut };
  const fin = avancerOuvres(debut, dureeOuvree(tache, ouvre) - 1, ouvre);
  // Hors des dates représentables (an 9999) : la tâche reste telle quelle.
  return estDateIso(fin) ? { ...tache, debut, fin } : tache;
}

export interface DecalageSuccesseurs {
  taches: TachePlanning[];
  /** Tâches décalées, avec leur décalage en jours (positif : plus tard). */
  decalees: { id: string; jours: number }[];
  /** Tâches terminées (100 %) en conflit : jamais déplacées, l'alerte de dates incohérentes reste. */
  terminees: string[];
}

/**
 * Décalage « poussé » des successeurs, fin à début, après un changement de dates.
 * - Seuls les successeurs (directs ou indirects) des tâches `modifiees` sont examinés.
 * - Un successeur n'est jamais avancé : il est reculé seulement si son début précède le lendemain
 *   de la fin la plus tardive de ses prédécesseurs, et il garde sa durée (un jour pour un jalon).
 * - Une tâche terminée (100 %) n'est jamais déplacée.
 * - Les tâches déplacées passent en `manuel`, comme après toute modification de dates.
 * Fonction pure : le planning reçu n'est pas modifié. Les cycles sont refusés ailleurs, une borne
 * de passes garantit malgré tout l'arrêt.
 */
export function decalerSuccesseurs(taches: TachePlanning[], modifiees: string[], ouvre: EstOuvre = TOUS_LES_JOURS): DecalageSuccesseurs {
  const parId = new Map(taches.map(t => [t.id, t]));
  const successeurs = new Map<string, string[]>();
  for (const t of taches) for (const p of t.dependencies ?? []) successeurs.set(p, [...(successeurs.get(p) ?? []), t.id]);
  // Tâches en aval des modifiées.
  const aval = new Set<string>();
  const pile = [...modifiees];
  while (pile.length) for (const s of successeurs.get(pile.pop()!) ?? []) if (!aval.has(s)) { aval.add(s); pile.push(s); }
  const courantes = new Map(taches.map(t => [t.id, t]));
  const terminees = new Set<string>();
  for (let passe = 0; passe <= taches.length; passe++) {
    let change = false;
    for (const t of taches) {
      if (!aval.has(t.id) || modifiees.includes(t.id)) continue;
      const actuelle = courantes.get(t.id)!;
      if (!estDateIso(actuelle.debut) || !estDateIso(actuelle.fin)) continue;
      const liens = (actuelle.dependencies ?? []).flatMap(id => { const fin = courantes.get(id)?.fin; return fin && estDateIso(fin) ? [{ fin, delai: delaiDuLien(actuelle, id) }] : []; });
      // Même critère que l'alerte de dates incohérentes : on ne pousse que ce qui est en conflit.
      if (!liens.some(l => ecartInsuffisant(l.fin, actuelle.debut, l.delai, ouvre))) continue;
      if (actuelle.avancement >= 100) { terminees.add(t.id); continue; }
      const debutMin = liens.map(l => debutMinimalLien(l.fin, l.delai, ouvre)).reduce((m, d) => (d > m ? d : m));
      courantes.set(t.id, { ...deplacerTacheAu(actuelle, debutMin, ouvre), source: 'manuel' });
      change = true;
    }
    if (!change) break;
  }
  const decalees = taches.flatMap(t => {
    const nouvelle = courantes.get(t.id)!;
    return nouvelle.debut !== t.debut ? [{ id: t.id, jours: joursEntre(t.debut, nouvelle.debut) }] : [];
  });
  return { taches: taches.map(t => courantes.get(t.id) ?? parId.get(t.id)!), decalees, terminees: [...terminees] };
}

/** Appelé uniquement à l'ajout d'un prédécesseur : aucun recalcul continu ni cascade.
 * Toutes les fins sont inclusives ; conserver la durée (un jour pour un jalon).
 */
export function placerApresPredecesseurs(tache: TachePlanning, taches: TachePlanning[], ouvre: EstOuvre = TOUS_LES_JOURS): TachePlanning {
  const precedents = taches.filter(t => t.id !== tache.id && tache.dependencies?.includes(t.id));
  if (!precedents.length || !estDateIso(tache.debut) || !estDateIso(tache.fin) || tache.fin < tache.debut) return tache;
  // Le prédécesseur le plus contraignant (fin + délai du lien) donne le début.
  const debut = precedents.map(p => debutMinimalLien(p.fin, delaiDuLien(tache, p.id), ouvre)).reduce((m, d) => (d > m ? d : m));
  return deplacerTacheAu(tache, debut, ouvre);
}
