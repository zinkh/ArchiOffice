// Bâtiments et phases d'un chantier.
//
// Même registre que celui du CCTP/DPGF (`DecoupageDocument`, types/dpgf.ts), mais
// porté par l'AFFAIRE (`projects.chantier_decoupage`) et non par un document : un
// compte-rendu ou une observation ne doit pas dépendre de l'ouverture d'un DPGF,
// ni d'un réseau disponible, pour savoir de quel bâtiment on parle. Un chantier peut
// reprendre le registre du DPGF d'un geste (`registreDepuisDocument`), en gardant les
// mêmes identifiants.
import type { Batiment, DecoupageDocument, PhaseOperation } from '../types/dpgf';
import type { PendingWrite } from '../db';

export type DecoupageChantier = Pick<DecoupageDocument, 'multiBatiments' | 'multiPhases' | 'batiments' | 'phases'>;

/** Un enregistrement qui porte un bâtiment et/ou une phase (compte-rendu, observation). */
export interface AvecDecoupage {
  batiment_id?: string | null;
  phase_id?: string | null;
}

const MAX_ENTREES = 50;
const MAX_CODE = 12;
const MAX_LIBELLE = 80;

const parOrdre = <T extends { ordre: number }>(items: T[]) => [...items].sort((a, b) => a.ordre - b.ordre);

function nettoyerRegistre<T extends Batiment | PhaseOperation>(brut: unknown): T[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const sortie: T[] = [];
  for (const entree of brut.slice(0, MAX_ENTREES)) {
    if (!entree || typeof entree !== 'object') continue;
    const { id, code, libelle, ordre } = entree as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 64 || vus.has(id)) continue;
    vus.add(id);
    sortie.push({
      id,
      code: typeof code === 'string' ? code.trim().slice(0, MAX_CODE) : '',
      libelle: typeof libelle === 'string' ? libelle.trim().slice(0, MAX_LIBELLE) : '',
      ordre: Number.isFinite(Number(ordre)) ? Number(ordre) : sortie.length,
    } as T);
  }
  return parOrdre(sortie);
}

/** Assainit un registre reçu d'un client : bornes, types, doublons d'identifiant écartés. */
export function sanitizeDecoupage(brut: unknown): DecoupageChantier {
  const source = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const batiments = nettoyerRegistre<Batiment>(source.batiments);
  const phases = nettoyerRegistre<PhaseOperation>(source.phases);
  return {
    // Un registre vide ne peut pas être « actif » : il ne proposerait aucun choix.
    multiBatiments: batiments.length > 0 && source.multiBatiments !== false,
    multiPhases: phases.length > 0 && source.multiPhases !== false,
    batiments,
    phases,
  };
}

export const DECOUPAGE_VIDE: DecoupageChantier = { multiBatiments: false, multiPhases: false, batiments: [], phases: [] };

/** Reprend le registre d'un document (DPGF/CCTP), identifiants conservés. */
export function registreDepuisDocument(doc: DecoupageDocument | null | undefined): DecoupageChantier {
  return sanitizeDecoupage({
    multiBatiments: true,
    multiPhases: true,
    batiments: doc?.batiments,
    phases: doc?.phases,
  });
}

export function batimentsActifs(d: DecoupageChantier | null | undefined): Batiment[] {
  return d?.multiBatiments ? parOrdre(d.batiments ?? []) : [];
}

export function phasesActives(d: DecoupageChantier | null | undefined): PhaseOperation[] {
  return d?.multiPhases ? parOrdre(d.phases ?? []) : [];
}

export function libelleRegistre(item: Batiment | PhaseOperation): string {
  return [item.code, item.libelle].filter(Boolean).join(' · ') || 'Sans nom';
}

/**
 * « Bât. A · Phase 1 » : l'étiquette courte d'un enregistrement. Un identifiant qui
 * n'est plus au registre (bâtiment supprimé depuis) n'est pas affiché : mieux vaut
 * rien qu'un code opaque.
 */
export function etiquetteDecoupage(item: AvecDecoupage, d: DecoupageChantier | null | undefined): string {
  const bat = batimentsActifs(d).find(b => b.id === item.batiment_id);
  const pha = phasesActives(d).find(p => p.id === item.phase_id);
  return [bat && (bat.code || bat.libelle), pha && (pha.code || pha.libelle)].filter(Boolean).join(' · ');
}

export interface FiltreDecoupage {
  /** '' = tous ; SANS_AFFECTATION = ceux sans bâtiment (ou sans phase). */
  batimentId: string;
  phaseId: string;
}

export const SANS_AFFECTATION = '__aucun__';

export function correspondDecoupage(item: AvecDecoupage, filtre: FiltreDecoupage): boolean {
  const ok = (valeur: string | null | undefined, voulu: string) =>
    !voulu || (voulu === SANS_AFFECTATION ? !valeur : valeur === voulu);
  return ok(item.batiment_id, filtre.batimentId) && ok(item.phase_id, filtre.phaseId);
}

/**
 * Superpose la file d'écritures en attente (hors ligne) à une liste de comptes-rendus
 * lue du réseau ou du cache : les créations absentes de la liste y sont ajoutées, les
 * modifications (PUT complet du compte-rendu) rejouées dans l'ordre par-dessus. La file
 * fait foi tant qu'elle n'a pas atteint le serveur : sans cela, un compte-rendu créé
 * sur le chantier sans réseau disparaissait de la liste au premier rechargement.
 */
export function superposerEcrituresEnAttente<T extends { id: string; project_id?: string; date?: string; pendingSync?: boolean }>(
  liste: T[],
  enAttente: Pick<PendingWrite, 'method' | 'url' | 'jsonBody' | 'createdAt'>[],
  projectId: string,
): T[] {
  const parId = new Map<string, T>(liste.map(r => [r.id, r]));
  const ordonnees = [...enAttente].sort((a, b) => a.createdAt - b.createdAt);
  for (const w of ordonnees) {
    if (w.method === 'POST' && w.url === `/api/projects/${projectId}/reports` && w.jsonBody?.id) {
      const existant = parId.get(w.jsonBody.id);
      parId.set(w.jsonBody.id, existant
        ? { ...existant, pendingSync: true }
        : { ...w.jsonBody, project_id: projectId, pendingSync: true } as T);
      continue;
    }
    const m = w.method === 'PUT' ? /^\/api\/reports\/([^/]+)$/.exec(w.url) : null;
    if (m && parId.has(m[1])) {
      // L'état « en attente » est celui de la création, jamais celui du corps d'une modification.
      const { pendingSync: _ignore, ...modification } = w.jsonBody ?? {};
      parId.set(m[1], { ...parId.get(m[1])!, ...modification });
    }
  }
  return [...parId.values()].sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || (Number((b as any).report_number) || 0) - (Number((a as any).report_number) || 0));
}
