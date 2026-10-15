// Suivi d'un lot dans un compte-rendu de chantier : retard cumulé, bâtiments concernés,
// heure de convocation, pénalités et intempéries. Logique pure, partagée par l'écran,
// l'export PDF et les tests (rien d'autre n'est importé ici que des types).
import type { IntemperieLot, PenaliteLot, SiteReport, SiteReportLotTracking } from '../types';
import type { Batiment } from '../types/dpgf';

// ── Pénalités ────────────────────────────────────────────────────────────────

/**
 * Types de pénalités du marché de travaux. Ils reprennent l'article 4 du CCAP généré
 * par l'ACT (retard d'exécution, absence en réunion, retard de documents) et ajoutent
 * les cas courants d'un CCTP ; « Autre » laisse l'architecte nommer le motif.
 */
export const PENALITE_TYPES: { value: PenaliteLot['type']; label: string }[] = [
  { value: 'retard_execution', label: "Retard d'exécution des travaux" },
  { value: 'absence_reunion', label: 'Absence à une réunion de chantier' },
  { value: 'retard_documents', label: 'Retard de remise des documents' },
  { value: 'retard_reserves', label: 'Retard de levée des réserves' },
  { value: 'proprete_securite', label: 'Propreté et sécurité du chantier' },
  { value: 'autre', label: 'Autre (à préciser)' },
];

export function libellePenalite(p: Pick<PenaliteLot, 'type' | 'motif'>): string {
  if (p.type === 'autre' && p.motif?.trim()) return p.motif.trim();
  return PENALITE_TYPES.find(t => t.value === p.type)?.label ?? 'Pénalité';
}

const arrondi2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Montant d'une pénalité : nombre de jours × montant par jour. */
export function montantPenalite(p: Pick<PenaliteLot, 'jours' | 'montant_jour'>): number {
  const jours = Number(p.jours);
  const montant = Number(p.montant_jour);
  if (!Number.isFinite(jours) || !Number.isFinite(montant) || jours < 0 || montant < 0) return 0;
  return arrondi2(jours * montant);
}

export function totalPenalites(t?: Pick<SiteReportLotTracking, 'penalites'> | null): { nombre: number; jours: number; montant: number } {
  const liste = t?.penalites ?? [];
  return {
    nombre: liste.length,
    jours: liste.reduce((s, p) => s + (Number(p.jours) || 0), 0),
    montant: arrondi2(liste.reduce((s, p) => s + montantPenalite(p), 0)),
  };
}

/** Montant en euros, espace ordinaire entre les milliers (l'espace fine de fr-FR s'imprime mal en PDF). */
export function formatEuros(n: number): string {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/[  ]/g, ' ')} €`;
}

/** « 2 pénalités · 450,00 € » ; vide quand il n'y en a pas. */
export function resumePenalites(t?: Pick<SiteReportLotTracking, 'penalites'> | null): string {
  const { nombre, montant } = totalPenalites(t);
  if (nombre === 0) return '';
  return `${nombre} pénalité${nombre > 1 ? 's' : ''} · ${formatEuros(montant)}`;
}

// ── Intempéries ──────────────────────────────────────────────────────────────

export const INTEMPERIE_TYPES: { value: IntemperieLot['type']; label: string }[] = [
  { value: 'pluie', label: 'Pluie' },
  { value: 'gel', label: 'Gel' },
  { value: 'neige', label: 'Neige, verglas' },
  { value: 'vent', label: 'Vent' },
  { value: 'canicule', label: 'Canicule' },
  { value: 'autre', label: 'Autre' },
];

export function libelleIntemperie(type: IntemperieLot['type']): string {
  return INTEMPERIE_TYPES.find(t => t.value === type)?.label ?? 'Intempérie';
}

/**
 * Jours d'intempéries d'un lot sur ce compte-rendu : les événements saisis, plus l'ancien
 * nombre de jours (`intemperies_jours`, colonne supprimée de l'écran) tant qu'il n'est pas retiré.
 */
export function joursIntemperies(t?: Pick<SiteReportLotTracking, 'intemperies_list' | 'intemperies_jours'> | null): number {
  const saisis = (t?.intemperies_list ?? []).reduce((s, i) => s + (Number(i.jours) || 0), 0);
  const ancien = Number(t?.intemperies_jours) || 0;
  return Math.round((saisis + ancien) * 100) / 100;
}

// ── Retard cumulé ────────────────────────────────────────────────────────────

/**
 * Retard cumulé d'un lot : la somme des retards de la semaine inscrits dans le compte-rendu
 * affiché et dans tous les précédents. Jamais saisi : un chiffre à la main divergeait du
 * détail. Un compte-rendu ancien qui n'a que l'ancien cumul saisi (aucun retard de semaine
 * nulle part) garde le dernier de ces cumuls plutôt que de retomber à zéro.
 */
export function retardCumule(lotId: string, reports: Pick<SiteReport, 'report_number' | 'lot_tracking'>[], current: Pick<SiteReport, 'report_number'>): number {
  const concernes = reports
    .filter(r => (r.report_number ?? 0) <= (current.report_number ?? 0))
    .sort((a, b) => (a.report_number ?? 0) - (b.report_number ?? 0));
  let somme = 0;
  let aUneSemaine = false;
  let dernierAncienCumul = 0;
  for (const r of concernes) {
    const t = r.lot_tracking?.find(x => x.lot_id === lotId);
    if (!t) continue;
    if (t.retard_semaine != null && Number.isFinite(Number(t.retard_semaine))) {
      somme += Number(t.retard_semaine);
      aUneSemaine = true;
    }
    if (t.retard_cumule != null && Number.isFinite(Number(t.retard_cumule))) dernierAncienCumul = Number(t.retard_cumule);
  }
  return aUneSemaine ? somme : dernierAncienCumul;
}

// ── Bâtiments concernés (W/D) ────────────────────────────────────────────────

/** Court repère d'un bâtiment pour une case ou une colonne : son code, à défaut l'initiale de son nom. */
export function reperBatiment(b: Pick<Batiment, 'code' | 'libelle'>): string {
  return b.code?.trim() || b.libelle?.trim().charAt(0).toUpperCase() || '?';
}

/**
 * Bâtiments cochés pour un lot. Un suivi enregistré avant les cases par bâtiment porte
 * `concerned` (« W », « D », « W/D ») : chaque lettre désigne le bâtiment dont le code ou le
 * nom commence par elle (WETLAB, DRYLAB), pour que l'ancien choix ne disparaisse pas.
 */
export function batimentsDuLot(t: Pick<SiteReportLotTracking, 'batiment_ids' | 'concerned'> | undefined, batiments: Batiment[]): string[] {
  const ids = new Set(batiments.map(b => b.id));
  if (t?.batiment_ids) return t.batiment_ids.filter(id => ids.has(id));
  if (!t?.concerned) return [];
  const lettres = t.concerned.split('').filter(l => l === 'W' || l === 'D');
  return batiments
    .filter(b => lettres.some(l => reperBatiment(b).toUpperCase().startsWith(l) || b.libelle?.trim().toUpperCase().startsWith(l)))
    .map(b => b.id);
}

/** Nouvelle liste de bâtiments après avoir coché ou décoché l'un d'eux, dans l'ordre du registre. */
export function basculerBatiment(
  t: Pick<SiteReportLotTracking, 'batiment_ids' | 'concerned'> | undefined,
  batimentId: string,
  coche: boolean,
  batiments: Batiment[],
): string[] {
  const actuels = new Set(batimentsDuLot(t, batiments));
  if (coche) actuels.add(batimentId); else actuels.delete(batimentId);
  return batiments.filter(b => actuels.has(b.id)).map(b => b.id);
}

/** « W / D » : repères des bâtiments cochés, pour l'impression. */
export function resumeBatiments(t: Pick<SiteReportLotTracking, 'batiment_ids' | 'concerned'> | undefined, batiments: Batiment[]): string {
  const ids = new Set(batimentsDuLot(t, batiments));
  return batiments.filter(b => ids.has(b.id)).map(reperBatiment).join(' / ');
}

// ── Heure de convocation ─────────────────────────────────────────────────────

export const HEURE_VALIDE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Heure d'un lot : la sienne si elle est saisie, sinon l'heure par défaut du compte-rendu. */
export function heureEffective(t: Pick<SiteReportLotTracking, 'heure'> | undefined, defaut?: string | null): string {
  return t?.heure || defaut || '';
}
