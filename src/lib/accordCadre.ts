// ── Accords-cadres et marchés subséquents ────────────────────────────────────
// Logique pure (testée), partagée entre l'écran et le serveur : consommation du
// plafond, conditions d'émission d'un subséquent, contrôle des lignes de
// commande contre le bordereau de l'offre retenue. Pas d'accès réseau ici.
//
// Le contrôle définitif du plafond se fait en base, sous verrou
// (enregistrer_marche_subsequent) : ces fonctions servent à l'aperçu à l'écran
// et à la validation des lignes, jamais à autoriser une écriture seules.

export type ModeExecution = 'bons_de_commande' | 'marches_subsequents' | 'mixte';
export type TypeMarche = 'marche' | 'accord_cadre' | 'subsequent';

export const LIBELLE_MODE_EXECUTION: Record<ModeExecution, string> = {
  bons_de_commande: 'Bons de commande',
  marches_subsequents: 'Marchés subséquents',
  mixte: 'Mixte (bons de commande et marchés subséquents)',
};

/** Seuil à partir duquel la consommation du plafond est signalée. */
export const SEUIL_PLAFOND_PROCHE_PCT = 80;

export interface ConditionsAccordCadre {
  montantMiniHT: number | null;
  montantMaxiHT: number | null;
  /** AAAA-MM-JJ */
  dateFin: string | null;
}

/** Ligne d'un marché subséquent : un article du bordereau, une quantité, le prix de l'offre. */
export interface LigneCommande {
  /** Identifiant de l'article, clé de `offre_snapshot.prix`. */
  articleId?: string;
  refBpu?: string;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
}

export interface SubsequentLu {
  montant_ht: number;
  statut?: string | null;
}

export type StatutConsommation = 'sans_plafond' | 'normal' | 'proche' | 'atteint' | 'depasse';

export interface Consommation {
  cumulHT: number;
  /** Reste avant le maxi, jamais négatif ; `null` sans plafond. */
  resteMaxiHT: number | null;
  pctMaxi: number | null;
  /** Reste à commander pour atteindre le minimum (0 si atteint) ; `null` sans minimum. */
  resteAuMiniHT: number | null;
  miniAtteint: boolean | null;
  statut: StatutConsommation;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

export function montantLigne(l: Pick<LigneCommande, 'quantite' | 'prixUnitaire'>): number {
  return arrondi((Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0));
}

export function totalLignes(lignes: LigneCommande[]): number {
  return arrondi(lignes.reduce((s, l) => s + montantLigne(l), 0));
}

/** Un subséquent résilié ne consomme plus le plafond. */
export function compteDansLePlafond(s: SubsequentLu): boolean {
  return (s.statut ?? 'en_cours') !== 'resilie';
}

export function consommation(c: ConditionsAccordCadre, subsequents: SubsequentLu[]): Consommation {
  const cumulHT = arrondi(subsequents.filter(compteDansLePlafond).reduce((s, m) => s + (Number(m.montant_ht) || 0), 0));
  const maxi = c.montantMaxiHT;
  const mini = c.montantMiniHT;
  const pctMaxi = maxi && maxi > 0 ? Math.round((cumulHT / maxi) * 1000) / 10 : null;
  let statut: StatutConsommation = 'sans_plafond';
  if (maxi !== null && maxi > 0) {
    if (cumulHT > maxi) statut = 'depasse';
    else if (cumulHT === maxi) statut = 'atteint';
    else if ((pctMaxi ?? 0) >= SEUIL_PLAFOND_PROCHE_PCT) statut = 'proche';
    else statut = 'normal';
  }
  return {
    cumulHT,
    resteMaxiHT: maxi === null ? null : arrondi(Math.max(maxi - cumulHT, 0)),
    pctMaxi,
    resteAuMiniHT: mini === null ? null : arrondi(Math.max(mini - cumulHT, 0)),
    miniAtteint: mini === null ? null : cumulHT >= mini,
    statut,
  };
}

export type CodeRefus =
  | 'ACCORD_CADRE_NON_SIGNE'
  | 'ACCORD_CADRE_ECHU'
  | 'PLAFOND_DEPASSE'
  | 'MONTANT_INVALIDE';

export const MESSAGE_REFUS: Record<CodeRefus, string> = {
  ACCORD_CADRE_NON_SIGNE: "L'accord-cadre doit être signé avant d'émettre un marché subséquent.",
  ACCORD_CADRE_ECHU: "La date de notification dépasse la fin de l'accord-cadre.",
  PLAFOND_DEPASSE: "Ce marché subséquent dépasse le montant maximum de l'accord-cadre. Relevez-le par avenant.",
  MONTANT_INVALIDE: 'Le montant du marché subséquent est invalide.',
};

export type Emission = { ok: true } | { ok: false; code: CodeRefus; message: string };

/**
 * Aperçu des conditions d'émission, dans l'ordre où la base les vérifie.
 * `cumulAutresHT` exclut, en modification, le montant du subséquent édité.
 */
export function verifierEmission(args: {
  signe: boolean;
  conditions: ConditionsAccordCadre;
  cumulAutresHT: number;
  montantHT: number;
  dateNotification: string;
}): Emission {
  const refus = (code: CodeRefus): Emission => ({ ok: false, code, message: MESSAGE_REFUS[code] });
  if (!args.signe) return refus('ACCORD_CADRE_NON_SIGNE');
  if (!Number.isFinite(args.montantHT) || args.montantHT < 0) return refus('MONTANT_INVALIDE');
  const { dateFin, montantMaxiHT } = args.conditions;
  if (dateFin && args.dateNotification > dateFin) return refus('ACCORD_CADRE_ECHU');
  if (montantMaxiHT !== null && arrondi(args.cumulAutresHT + args.montantHT) > montantMaxiHT) return refus('PLAFOND_DEPASSE');
  return { ok: true };
}

const TOLERANCE_PRIX = 0.005;

export interface ResultatLignes {
  ok: boolean;
  erreurs: string[];
}

/**
 * Contrôle des lignes d'un subséquent : quantités et prix positifs ou nuls et,
 * quand l'offre retenue est figée, prix identique à celui du bordereau. Une ligne
 * absente du bordereau est refusée : un subséquent ne crée pas de prix nouveau.
 * Sans bordereau figé (accord-cadre saisi à la main), les prix ne sont pas contrôlés.
 */
export function validerLignesCommande(
  lignes: LigneCommande[],
  prixBordereau: Record<string, number | null> | null | undefined,
): ResultatLignes {
  const erreurs: string[] = [];
  if (lignes.length === 0) erreurs.push('Au moins une ligne est requise.');
  const controle = !!prixBordereau && Object.keys(prixBordereau).length > 0;
  lignes.forEach((l, i) => {
    const nom = l.designation?.trim() || `ligne ${i + 1}`;
    if (!l.designation?.trim()) erreurs.push(`Ligne ${i + 1} : désignation manquante.`);
    if (!Number.isFinite(l.quantite) || l.quantite < 0) erreurs.push(`« ${nom} » : quantité invalide.`);
    if (!Number.isFinite(l.prixUnitaire) || l.prixUnitaire < 0) erreurs.push(`« ${nom} » : prix unitaire invalide.`);
    if (!controle) return;
    const prix = l.articleId ? prixBordereau![l.articleId] : undefined;
    if (prix === undefined || prix === null) erreurs.push(`« ${nom} » : article absent du bordereau de l'accord-cadre.`);
    else if (Math.abs(prix - l.prixUnitaire) > TOLERANCE_PRIX) erreurs.push(`« ${nom} » : prix différent du bordereau (${prix} € HT).`);
  });
  return { ok: erreurs.length === 0, erreurs };
}

/** Libellé court d'un marché pour les sélecteurs (OS, situations) : « AC lot 02 / MS n°3 ». */
export function libelleMarche(m: {
  type_marche?: TypeMarche | null;
  lot_numero?: string | null;
  numero_subsequent?: number | null;
  entreprise_nom?: string;
}): string {
  const lot = m.lot_numero ? `lot ${m.lot_numero}` : '';
  if (m.type_marche === 'accord_cadre') return ['AC', lot, m.entreprise_nom].filter(Boolean).join(' ');
  if (m.type_marche === 'subsequent') return ['MS', `n°${m.numero_subsequent ?? '?'}`, lot, m.entreprise_nom].filter(Boolean).join(' ');
  return [lot, m.entreprise_nom].filter(Boolean).join(' ');
}
