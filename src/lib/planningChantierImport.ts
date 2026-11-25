// Import d'un planning de chantier depuis un fichier : XML GanttProject (.gan), XML Microsoft Project, ou PDF.
//
// Logique pure, partagée par l'écran et le serveur. Un import ne fait que PROPOSER des tâches : rien n'est écrit
// tant que l'architecte ne l'a pas appliqué (même principe que la génération IA). Le planning ne crée jamais de
// lot : une tâche dont le lot n'est pas reconnu devient une tâche générale, et l'écran le dit.
import { parsePlanningXml, type ParsedPlanningXml } from './projectPlanningXml';
import {
  MAX_DELAI, MAX_TACHES, estDateIso, sanitizePlanning,
  type LotPlanifiable, type PlanningChantier, type TachePlanning,
} from './planningChantier';

export type FormatImportPlanning = 'ganttproject' | 'msproject' | 'pdf';

export interface PlanningImporte {
  format: FormatImportPlanning;
  /** Nom de l'opération porté par le fichier, s'il en a un. */
  nomProjet?: string;
  taches: TachePlanning[];
  /** Ce que l'import a dû décider à la place de l'architecte : à lire avant d'appliquer. */
  avertissements: string[];
  /** Lignes du fichier non reprises (dates illisibles, au-delà du plafond). */
  ecartees: number;
  /** Tâches rangées sans lot reconnu dans les tâches générales. */
  sansLot: number;
}

export type ModeImportPlanning = 'remplacer' | 'ajouter';

/** Plafond de taille d'un fichier de planning, partagé écran / serveur. */
export const MAX_FICHIER_PLANNING = 15 * 1024 * 1024;

export type TypeFichierPlanning = 'xml' | 'pdf' | 'mpp';

/** Type de fichier d'après son nom ; `null` pour une extension que l'import ne lit pas. */
export function typeFichierPlanning(nom: string): TypeFichierPlanning | null {
  const extension = nom.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === 'xml' || extension === 'gan') return 'xml';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'mpp' || extension === 'mpt') return 'mpp';
  return null;
}

export const MESSAGE_MPP = 'Le format .mpp de Microsoft Project est un format binaire fermé que l’application ne lit pas. Dans Microsoft Project, utilisez Fichier > Enregistrer sous > « XML (*.xml) », puis importez ce fichier.';

// ── Rapprochement des lots ───────────────────────────────────────────────────

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normaliser = (s: string) => sansAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const numeroNormalise = (n: unknown) => String(n ?? '').trim().toLowerCase().replace(/^lot\s*/, '').replace(/^0+(?=\d)/, '');
const EST_GENERAL = /^(taches?|travaux)?\s*(generale?s?|communes?|chantier)$|^general$/;

type Rapprochement = { lot: LotPlanifiable } | { general: true } | null;

/**
 * Cherche le lot d'un intitulé de groupe ou de tâche : « Lot 02 · Charpente » par son numéro, sinon un intitulé
 * qui contient (ou est contenu dans) le titre d'un lot. Le numéro prime : un titre peut se retrouver dans plusieurs lots.
 */
export function rapprocherLot(intitule: string, lots: LotPlanifiable[]): Rapprochement {
  const texte = normaliser(intitule);
  if (!texte) return null;
  if (EST_GENERAL.test(texte)) return { general: true };
  const numero = sansAccents(intitule).match(/\blot\s*(?:n\s*)?[°o]?\s*(\d+[a-z]?)\b/i)?.[1];
  if (numero) {
    const parNumero = lots.find(l => numeroNormalise(l.lot_number) === numeroNormalise(numero));
    if (parNumero) return { lot: parNumero };
  }
  const parTitre = lots.filter(l => {
    const titre = normaliser(l.lot_title);
    return titre.length >= 4 && (texte.includes(titre) || (texte.length >= 4 && titre.includes(texte)));
  });
  // Plusieurs lots possibles : on ne choisit pas à la place de l'architecte.
  return parTitre.length === 1 ? { lot: parTitre[0] } : null;
}

// ── Fichiers XML ─────────────────────────────────────────────────────────────

/**
 * Convertit un fichier XML lu (GanttProject ou Microsoft Project) en tâches de chantier. Les groupes récapitulatifs
 * ne sont pas des tâches : ils donnent leur lot aux tâches qu'ils contiennent. Les liens fin à début et leurs
 * décalages sont repris ; un lien vers un groupe est écarté (le planning relie des tâches).
 */
export function planningDepuisImport(parsed: ParsedPlanningXml, lots: LotPlanifiable[], fabriqueId: () => string): PlanningImporte {
  const parId = new Map(parsed.tasks.map(t => [t.sourceId, t]));
  const aDesEnfants = new Set(parsed.tasks.map(t => t.parentSourceId).filter((id): id is string => !!id));
  // Un groupe sans enfant lisible reste une tâche ordinaire.
  const estGroupe = (id: string) => !!parId.get(id)?.summary && aDesEnfants.has(id);

  const lotDe = (sourceId: string): Rapprochement => {
    const vus = new Set<string>();
    for (let courant = parId.get(sourceId); courant && !vus.has(courant.sourceId); courant = courant.parentSourceId ? parId.get(courant.parentSourceId) : undefined) {
      vus.add(courant.sourceId);
      // La tâche elle-même d'abord (« Lot 03 Couverture : zinguerie » dans un fichier à plat), puis ses groupes.
      const trouve = rapprocherLot(courant.title, lots);
      if (trouve && (courant.sourceId !== sourceId || 'lot' in trouve)) return trouve;
    }
    return null;
  };

  const avertissements: string[] = [];
  const gardees: TachePlanning[] = [];
  const idPar = new Map<string, string>();
  let ecartees = 0;
  let sansLot = 0;
  let liensIgnores = 0;

  for (const t of parsed.tasks) {
    if (estGroupe(t.sourceId)) continue;
    if (gardees.length >= MAX_TACHES) { ecartees++; continue; }
    if (!estDateIso(t.start_date)) { ecartees++; continue; }
    let debut = t.start_date;
    let fin = estDateIso(t.end_date) ? t.end_date : debut;
    if (fin < debut) [debut, fin] = [fin, debut];
    const jalon = t.milestone === true;
    if (jalon) fin = debut;
    const rattache = lotDe(t.sourceId);
    // Un groupe « Tâches générales » est un rangement voulu : il ne compte pas comme un lot non reconnu.
    if (!rattache) sansLot++;
    const id = fabriqueId();
    idPar.set(t.sourceId, id);
    gardees.push({
      id,
      lotId: rattache && 'lot' in rattache ? rattache.lot.id : '',
      libelle: t.title,
      debut, fin,
      avancement: t.progress,
      source: 'manuel',
      ...(jalon ? { jalon: true } : {}),
    });
  }

  // Liens : seulement entre tâches reprises ; `sanitizePlanning` écarte les cycles à l'application.
  const parIdNouveau = new Map(gardees.map(g => [g.id, g]));
  for (const t of parsed.tasks) {
    const id = idPar.get(t.sourceId);
    const tache = id ? parIdNouveau.get(id) : undefined;
    if (!id || !tache) continue;
    const dependencies: string[] = [];
    const delais: Record<string, number> = {};
    for (const source of t.dependencies) {
      const precedent = idPar.get(source);
      if (!precedent || precedent === id) { liensIgnores++; continue; }
      dependencies.push(precedent);
      const jours = t.lagDays?.[source];
      if (jours && jours > 0) delais[precedent] = Math.min(MAX_DELAI, jours);
    }
    if (dependencies.length) tache.dependencies = [...new Set(dependencies)];
    if (Object.keys(delais).length) tache.delais = delais;
  }

  if (sansLot) avertissements.push(`${sansLot} tâche${sansLot > 1 ? 's' : ''} sans lot reconnu rangée${sansLot > 1 ? 's' : ''} dans les tâches générales : le planning ne crée jamais de lot, affectez-les ensuite depuis la fiche de chaque tâche.`);
  if (liensIgnores) avertissements.push(`${liensIgnores} lien${liensIgnores > 1 ? 's' : ''} non repris (vers un groupe ou une tâche absente).`);
  if (ecartees) avertissements.push(`${ecartees} ligne${ecartees > 1 ? 's' : ''} du fichier non reprise${ecartees > 1 ? 's' : ''} (dates illisibles ou plus de ${MAX_TACHES} tâches).`);
  return { format: parsed.format, nomProjet: parsed.projectName, taches: gardees, avertissements, ecartees, sansLot };
}

/** Lit un fichier XML de planning et le convertit ; lève une erreur lisible pour un fichier inexploitable. */
export function lireXmlPlanning(contenu: string, lots: LotPlanifiable[], fabriqueId: () => string): PlanningImporte {
  const importe = planningDepuisImport(parsePlanningXml(contenu), lots, fabriqueId);
  if (!importe.taches.length) throw new Error('Le fichier ne contient aucune tâche importable.');
  return importe;
}

// ── PDF lu par l'IA ──────────────────────────────────────────────────────────

/** Ce que le modèle rend pour un planning en PDF : des dates AAAA-MM-JJ lues dans le document, jamais déduites. */
export const SCHEMA_PLANNING_PDF = {
  type: 'object',
  properties: {
    taches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Identifiant court unique de la tâche dans cette réponse (T1, T2...)' },
          lot_numero: { type: 'string', description: 'Numéro du lot tel que fourni, ou « general » pour une tâche commune au chantier ou sans lot reconnu' },
          libelle: { type: 'string', description: 'Intitulé de la tâche tel qu’écrit dans le document' },
          debut: { type: 'string', description: 'Date de début AAAA-MM-JJ lue dans le document' },
          fin: { type: 'string', description: 'Date de fin AAAA-MM-JJ lue dans le document (absente pour un jalon)' },
          jalon: { type: 'boolean', description: 'Vrai pour une échéance sans durée' },
          avancement: { type: 'integer', description: 'Avancement 0 à 100 si le document l’indique' },
          predecesseurs: { type: 'array', items: { type: 'string' }, description: 'ref des tâches qui précèdent celle-ci, seulement si le document l’indique' },
        },
        required: ['libelle', 'debut'],
      },
    },
    remarques: { type: 'array', items: { type: 'string' }, description: 'Ce qui était ambigu ou illisible dans le document' },
  },
  required: ['taches'],
};

const texteCourt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Convertit la réponse du modèle (planning lu dans un PDF) en tâches. Une date qui n'existe pas au calendrier écarte
 * la tâche : on ne devine jamais une date. Un lot inconnu devient une tâche générale, jamais un lot créé.
 */
export function planningDepuisPdf(brut: unknown, lots: LotPlanifiable[], fabriqueId: () => string): PlanningImporte {
  const source = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const entrees = (Array.isArray(source.taches) ? source.taches : []) as Record<string, unknown>[];
  const parNumero = new Map(lots.map(l => [numeroNormalise(l.lot_number), l]));
  const gardees: TachePlanning[] = [];
  const idParRef = new Map<string, string>();
  const liens: { id: string; refs: unknown }[] = [];
  let ecartees = 0;
  let sansLot = 0;

  for (const entree of entrees.slice(0, MAX_TACHES + 100)) {
    if (gardees.length >= MAX_TACHES) { ecartees++; continue; }
    const libelle = texteCourt(entree?.libelle, 160);
    if (!libelle || !estDateIso(entree?.debut)) { ecartees++; continue; }
    const jalon = entree.jalon === true;
    let debut = entree.debut as string;
    let fin = estDateIso(entree.fin) ? entree.fin as string : debut;
    if (fin < debut) [debut, fin] = [fin, debut];
    if (jalon) fin = debut;
    const numero = numeroNormalise(entree.lot_numero);
    const lot = numero && numero !== 'general' && numero !== 'général' ? parNumero.get(numero) : undefined;
    // « general » est un rangement voulu par le modèle, pas un lot qu'on n'a pas su reconnaître.
    if (!lot && numero !== 'general' && numero !== 'général') sansLot++;
    const avancement = Math.round(Number(entree.avancement));
    const id = fabriqueId();
    const ref = texteCourt(entree.ref, 40);
    if (ref && !idParRef.has(ref)) idParRef.set(ref, id);
    liens.push({ id, refs: entree.predecesseurs });
    gardees.push({
      id, lotId: lot?.id ?? '', libelle, debut, fin,
      avancement: Number.isFinite(avancement) ? Math.min(100, Math.max(0, avancement)) : 0,
      source: 'manuel',
      ...(jalon ? { jalon: true } : {}),
    });
  }
  const parIdNouveau = new Map(gardees.map(g => [g.id, g]));
  for (const { id, refs } of liens) {
    const precedents = (Array.isArray(refs) ? refs : []).map(r => idParRef.get(texteCourt(r, 40))).filter((p): p is string => !!p && p !== id);
    const tache = parIdNouveau.get(id);
    if (tache && precedents.length) tache.dependencies = [...new Set(precedents)];
  }

  const avertissements = (Array.isArray(source.remarques) ? source.remarques : []).map(r => texteCourt(r, 300)).filter(Boolean).slice(0, 8);
  if (sansLot) avertissements.push(`${sansLot} tâche${sansLot > 1 ? 's' : ''} sans lot reconnu rangée${sansLot > 1 ? 's' : ''} dans les tâches générales : affectez-les ensuite depuis la fiche de chaque tâche.`);
  if (ecartees) avertissements.push(`${ecartees} ligne${ecartees > 1 ? 's' : ''} du document non reprise${ecartees > 1 ? 's' : ''} (date absente ou illisible).`);
  return { format: 'pdf', taches: gardees, avertissements, ecartees, sansLot };
}

// ── Application ──────────────────────────────────────────────────────────────

/**
 * Applique un import au planning. « Remplacer » repart des seules tâches importées (le calendrier partagé est gardé) ;
 * « Ajouter » conserve tout ce qui existe. Les tâches importées sont `manuel` : une génération IA ultérieure ne les efface pas.
 */
export function appliquerImport(actuel: PlanningChantier, importe: PlanningImporte, mode: ModeImportPlanning): PlanningChantier {
  if (mode === 'remplacer') return sanitizePlanning({ ...actuel, taches: importe.taches, hypotheses: [], genereLe: null });
  return sanitizePlanning({ ...actuel, taches: [...actuel.taches, ...importe.taches] });
}

/** Début et fin d'un import, pour l'aperçu (`null` sans tâche). */
export function bornesImport(importe: Pick<PlanningImporte, 'taches'>): { debut: string; fin: string } | null {
  if (!importe.taches.length) return null;
  return importe.taches.reduce(
    (b, t) => ({ debut: t.debut < b.debut ? t.debut : b.debut, fin: t.fin > b.fin ? t.fin : b.fin }),
    { debut: importe.taches[0].debut, fin: importe.taches[0].fin },
  );
}

/** Des dates avant 2000 ou après 2100 trahissent presque toujours une lecture erronée (surtout d'un PDF). */
export function datesVraisemblables(importe: Pick<PlanningImporte, 'taches'>): boolean {
  const b = bornesImport(importe);
  return !b || (b.debut >= '2000-01-01' && b.fin <= '2100-12-31');
}
