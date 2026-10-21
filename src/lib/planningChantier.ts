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
}

export interface PlanningChantier {
  version: 1;
  taches: TachePlanning[];
  /** Hypothèses retenues lors de la dernière génération IA, à relire. */
  hypotheses: string[];
  genereLe: string | null;
}

export const PLANNING_VIDE: PlanningChantier = { version: 1, taches: [], hypotheses: [], genereLe: null };

export const MAX_TACHES = 400;
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
    const id = typeof t.id === 'string' && t.id && t.id.length <= 64 && !vus.has(t.id) ? t.id : `t-${taches.length + 1}-${vus.size}`;
    vus.add(id);
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
  return {
    version: 1,
    taches,
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

/** Les tâches rangées par lot, dans l'ordre des lots ; les tâches générales d'abord. */
export function planningParLot(planning: PlanningChantier, lots: LotPlanifiable[]): LignePlanningLot[] {
  const parDebut = (a: TachePlanning, b: TachePlanning) => a.debut.localeCompare(b.debut) || a.fin.localeCompare(b.fin);
  const resume = (lot: LotPlanifiable | null, taches: TachePlanning[]): LignePlanningLot => {
    const tri = [...taches].sort(parDebut);
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
