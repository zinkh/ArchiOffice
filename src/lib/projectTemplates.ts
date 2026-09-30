// Vocabulaire et petits utilitaires partagés entre l'écran des modèles de
// projet, les écrans de création (affaire, contrat MOE, proposition) et le
// serveur.
import type {
  ContratMOE, ContratMOEMission, ProjectTemplate, TemplateMarcheType, TemplateOperationType,
} from '../types';

export const OPERATION_LABELS: Record<TemplateOperationType, string> = {
  neuf: 'Construction neuve',
  rehabilitation: 'Réhabilitation',
  extension: 'Extension',
  maison_individuelle: 'Maison individuelle',
  permis_seul: 'Permis de construire seul',
  autre: 'Autre',
};

export const MARCHE_LABELS: Record<TemplateMarcheType, string> = {
  prive: 'Marché privé',
  public: 'Marché public',
};

/** « 6 lots · 9 jalons · 12 tâches », en ne nommant que ce que le modèle porte. */
export function summarizeTemplate(t: Pick<ProjectTemplate, 'default_lots' | 'default_milestones' | 'default_tasks' | 'default_missions'>): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const parts: string[] = [];
  const missions = (t.default_missions ?? []).filter(m => m.incluse).length;
  const lots = t.default_lots?.length ?? 0;
  const milestones = t.default_milestones?.length ?? 0;
  const tasks = t.default_tasks?.length ?? 0;
  if (missions) parts.push(plural(missions, 'mission', 'missions'));
  if (lots) parts.push(plural(lots, 'lot', 'lots'));
  if (milestones) parts.push(plural(milestones, 'jalon', 'jalons'));
  if (tasks) parts.push(plural(tasks, 'tâche', 'tâches'));
  return parts.join(' · ');
}

/** Date ISO (YYYY-MM-DD) décalée de `days` jours à partir de `start`. */
export function addDaysIso(start: string, days: number): string {
  const base = /^\d{4}-\d{2}-\d{2}/.test(start) ? new Date(`${start.slice(0, 10)}T12:00:00Z`) : new Date();
  base.setUTCDate(base.getUTCDate() + Math.round(days));
  return base.toISOString().slice(0, 10);
}

// ── Contrat MOE ─────────────────────────────────────────────────────────────

/**
 * Le type de contrat le plus proche du type d'opération. Le contrat n'a pas de
 * type « extension » ni « maison individuelle » : une construction neuve en est
 * la forme contractuelle. Un permis seul n'a pas non plus le sien, c'est sa
 * répartition de missions (esquisse, avant-projet, dossier de permis) qui en
 * porte la portée réelle.
 */
export function contratTypeFor(op?: TemplateOperationType): ContratMOE['type_contrat'] {
  return op === 'rehabilitation' ? 'rehabilitation' : 'construction_neuve';
}

/** Ce que le contrat reprend d'un modèle : type, type de maître d'ouvrage, missions. Copie profonde. */
export function contratDefaultsFromTemplate(t: Pick<ProjectTemplate, 'operation_type' | 'marche_type' | 'default_missions'>): Partial<ContratMOE> {
  const missions = (t.default_missions ?? []).map(m => ({ ...m }));
  return {
    type_contrat: contratTypeFor(t.operation_type),
    type_moa: t.marche_type === 'public' ? 'public' : 'prive',
    ...(missions.length ? { missions_list: missions } : {}),
  };
}

// ── Proposition : répartition des honoraires ────────────────────────────────

// Libellés de la répartition des propositions (src/lib/feeDistribution.ts) :
// les mêmes missions y portent des noms abrégés et l'id « projet » au lieu de « pro ».
const FEE_MISSION_NAMES: Record<string, { id: string; name: string }> = {
  esquisse: { id: 'esquisse', name: 'Esquisse' },
  aps: { id: 'aps', name: 'A.P.S.' },
  apd: { id: 'apd', name: 'A.P.D.' },
  pro: { id: 'projet', name: 'Projet' },
  act: { id: 'act', name: 'A.C.T.' },
  visa: { id: 'visa', name: 'VISA' },
  det: { id: 'det', name: 'D.E.T.' },
  aor: { id: 'aor', name: 'A.O.R.' },
  opc: { id: 'opc', name: 'OPC' },
  diag: { id: 'diag', name: 'Diagnostic' },
};

/**
 * Répartition des honoraires d'une proposition (chaîne JSON, comme
 * `Proposal.fee_distribution`) à partir des missions d'un modèle.
 *
 * Les missions à pourcentage (base ET exécution du modèle) sont rangées sous
 * « Mission base », comme le fait déjà la répartition par défaut des
 * propositions : c'est la seule catégorie dont le montant suit le total des
 * honoraires. Les missions complémentaires restent à part, à chiffrer à la
 * main. Seules les missions `incluse` sont reprises.
 */
export function feeDistributionFromTemplate(
  missions: ContratMOEMission[] | undefined,
  total = 0,
  precision = 2,
): string | undefined {
  const included = (missions ?? []).filter(m => m.incluse);
  if (!included.length) return undefined;
  return JSON.stringify({
    missions: included.map((m: ContratMOEMission) => {
      const label = FEE_MISSION_NAMES[m.id];
      const complementaire = m.category === 'complementaire';
      const pct = m.pct ?? 0;
      return {
        id: label?.id ?? m.id,
        name: label?.name ?? m.name,
        category: complementaire ? 'Missions complémentaires' : 'Mission base',
        default_pct: complementaire ? undefined : pct,
        amount: complementaire ? 0 : Number((total * (pct / 100)).toFixed(precision)),
        percentages: {},
      };
    }),
  });
}
