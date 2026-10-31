// Cartouche « Stockage » de la barre latérale : types de la réponse de
// GET /api/billing/storage et logique pure (formats, seuils), testée sans navigateur.
// Aucun import réseau ici (la lecture est dans StorageCartouche.tsx) : `apiFetch`
// tire le client Supabase du navigateur, que les tests de logique pure n'ont pas.

export interface StorageUserLine {
  /** Chaîne vide quand le document n'a aucun auteur enregistré. */
  name: string;
  bytes: number;
  files: number;
  is_me: boolean;
}

export interface StorageBreakdown {
  /** `all` : détail de toute l'équipe (administrateurs, managers). `self` : la seule ligne de l'appelant. */
  scope: 'all' | 'self';
  users: StorageUserLine[];
  unattributed_bytes: number | null;
}

export interface StorageUsage {
  plan: string;
  used_bytes: number;
  limit_bytes: number;
  /** Null quand la répartition par auteur n'est pas disponible (instance non migrée). */
  breakdown: StorageBreakdown | null;
}

export const STORAGE_WARNING_RATIO = 0.8;

export type StorageLevel = 'ok' | 'warning' | 'full' | 'expired';

/** Un plafond à zéro est un abonnement expiré (voir PLAN_LIMITS.expired), pas un cabinet à 0 %. */
export function storageLevel(usedBytes: number, limitBytes: number): StorageLevel {
  if (!(limitBytes > 0)) return 'expired';
  const ratio = usedBytes / limitBytes;
  if (ratio >= 1) return 'full';
  if (ratio >= STORAGE_WARNING_RATIO) return 'warning';
  return 'ok';
}

/** Pourcentage entier borné à 0-100 ; une valeur non nulle ne s'affiche jamais « 0 % ». */
export function storagePercent(usedBytes: number, limitBytes: number): number {
  if (!(limitBytes > 0) || !(usedBytes > 0)) return 0;
  return Math.min(100, Math.max(1, Math.round((usedBytes / limitBytes) * 100)));
}

const KO = 1024;
const MO = KO * 1024;
const GO = MO * 1024;

/** 92,4 Mo, 5 Go, 512 Ko : une décimale sous 100, aucune au-delà. Unités anglaises (MB, GB) pour `en`. */
export function formatBytes(bytes: number, lang = 'fr'): string {
  const english = lang.toLowerCase().startsWith('en');
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const [value, unit] =
    safe >= GO ? [safe / GO, english ? 'GB' : 'Go']
    : safe >= MO ? [safe / MO, english ? 'MB' : 'Mo']
    : safe >= KO ? [safe / KO, english ? 'KB' : 'Ko']
    : [safe, english ? 'B' : 'o'];
  const rounded = unit === 'o' || unit === 'B' ? 0 : value >= 100 ? 0 : 1;
  const text = new Intl.NumberFormat(english ? 'en-GB' : 'fr-FR', { maximumFractionDigits: rounded }).format(value);
  return `${text} ${unit}`;
}
