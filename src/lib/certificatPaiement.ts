// ── Situations de travaux et certificats de paiement ─────────────────────────
// L'entreprise adresse chaque mois une situation : une facture intermédiaire
// qui porte le montant CUMULÉ des travaux exécutés depuis le début du marché.
// L'architecte la vérifie, retient le cumul qu'il admet (souvent égal, parfois
// réduit) et établit le certificat de paiement : ce que le maître d'ouvrage
// doit verser pour cette période. À la fin, le décompte de clôture reprend
// toutes les situations et dit ce qui reste à payer.
//
// Tout se calcule PAR MARCHÉ (une entreprise, un lot) : le cumul précédent est
// celui de la situation antérieure du même marché, jamais d'un autre lot.
// Module pur, partagé par l'écran, l'export PDF et le serveur (pièce jointe
// Chorus Pro / Super PDP), pour que les trois donnent les mêmes chiffres.

export interface MarcheTravaux {
  id: string;
  entreprise_nom: string;
  entreprise_siret?: string | null;
  lot_numero?: string | null;
  lot_titre?: string | null;
  montant_ht?: number | string | null;
  tva_rate?: number | string | null;
  avance_montant_ttc?: number | string | null;
  retenue_garantie_pct?: number | string | null;
  /** Retenue remplacée par une caution bancaire : rien n'est retenu. */
  retenue_garantie_bancaire?: boolean | null;
  revision_active?: boolean | null;
}

/** Valeurs stockées en base, inchangées : seul leur affichage se traduit. */
export type EtatSituation = 'Brouillon' | 'Validée' | 'Payée';

export interface SituationTravaux {
  id: string;
  marche_id?: string | null;
  numero_situation: number;
  date_situation?: string | null;
  date_reception_situation?: string | null;
  reference_entreprise?: string | null;
  /** Cumul HT présenté par l'entreprise depuis le début du marché. */
  montant_presente_ht?: number | string | null;
  /** Cumul HT admis par l'architecte. Vide : le cumul présenté est admis. */
  montant_admis_ht?: number | string | null;
  revision_coeff?: number | string | null;
  penalites_ht?: number | string | null;
  penalites_notes?: string | null;
  avance_remboursement?: number | string | null;
  notes_moe?: string | null;
  date_certificat?: string | null;
  etat: EtatSituation | string;
}

export interface Certificat {
  numero: number;
  cumulPresenteHt: number;
  cumulAdmisHt: number;
  /** Écart entre présenté et admis (positif quand l'architecte réduit). */
  ecartHt: number;
  cumulPrecedentHt: number;
  /** Travaux de la période : cumul admis moins cumul précédent. */
  periodeHt: number;
  revisionCoeff: number;
  revisionHt: number;
  periodeHtRevise: number;
  tvaRate: number;
  tva: number;
  periodeTtc: number;
  retenuePct: number;
  retenue: number;
  avanceRemboursement: number;
  penalites: number;
  netAPayer: number;
  /** Avancement du marché : cumul admis rapporté au montant du marché. */
  avancementPct: number | null;
  /** Total des nets des certificats antérieurs du même marché. */
  cumulNetPrecedent: number;
}

export interface DecompteCloture {
  marche: MarcheTravaux;
  certificats: Certificat[];
  totalHt: number;
  totalRevisionHt: number;
  totalHtRevise: number;
  tva: number;
  totalTtc: number;
  totalPenalites: number;
  totalRetenue: number;
  avanceVersee: number;
  totalAvanceRemboursee: number;
  /** Nets des certificats déjà établis (validés ou payés). */
  dejaCertifie: number;
  /** TTC dû, moins pénalités, avance, certificats établis et retenue. */
  resteAPayerTtc: number;
  montantMarcheHt: number;
  ecartMarcheHt: number;
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const arrondi = (n: number): number => Math.round(n * 100) / 100;

/** Le cumul admis, ou à défaut le cumul présenté. */
export function cumulAdmis(s: SituationTravaux): number {
  const admis = s.montant_admis_ht;
  if (admis !== null && admis !== undefined && String(admis).trim() !== '') return num(admis);
  return num(s.montant_presente_ht);
}

/** Situations d'un marché, dans l'ordre de leur numéro. */
export function situationsDuMarche(situations: SituationTravaux[], marcheId: string): SituationTravaux[] {
  return situations
    .filter((s) => s.marche_id === marcheId)
    .sort((a, b) => a.numero_situation - b.numero_situation);
}

/** Prochain numéro de situation pour un marché (1 pour la première). */
export function prochainNumero(situations: SituationTravaux[], marcheId: string): number {
  return situationsDuMarche(situations, marcheId).reduce((max, s) => Math.max(max, s.numero_situation), 0) + 1;
}

export function estCertifiee(s: SituationTravaux): boolean {
  return s.etat === 'Validée' || s.etat === 'Payée';
}

/**
 * Certificat de paiement d'une situation. `anterieures` : les situations du
 * même marché (toutes, la fonction ne garde que celles de numéro inférieur).
 */
export function calculerCertificat(
  situation: SituationTravaux,
  marche: MarcheTravaux | null | undefined,
  anterieures: SituationTravaux[],
): Certificat {
  const precedentes = anterieures
    .filter((s) => s.id !== situation.id && s.numero_situation < situation.numero_situation)
    .sort((a, b) => a.numero_situation - b.numero_situation);
  const derniere = precedentes[precedentes.length - 1];
  const cumulPrecedentHt = derniere ? cumulAdmis(derniere) : 0;

  const cumulPresenteHt = num(situation.montant_presente_ht);
  const cumulAdmisHt = cumulAdmis(situation);
  const periodeHt = arrondi(cumulAdmisHt - cumulPrecedentHt);

  const revisionCoeff = num(situation.revision_coeff) || 1;
  const revisionHt = marche?.revision_active ? arrondi(periodeHt * (revisionCoeff - 1)) : 0;
  const periodeHtRevise = arrondi(periodeHt + revisionHt);

  const tvaRate = marche?.tva_rate === null || marche?.tva_rate === undefined || String(marche.tva_rate) === ''
    ? 20 : num(marche.tva_rate);
  const tva = arrondi(periodeHtRevise * tvaRate / 100);
  const periodeTtc = arrondi(periodeHtRevise + tva);

  const retenuePct = marche?.retenue_garantie_bancaire ? 0
    : marche?.retenue_garantie_pct === null || marche?.retenue_garantie_pct === undefined ? 5 : num(marche.retenue_garantie_pct);
  // Pas de retenue sur une période négative (situation qui corrige à la baisse).
  const retenue = periodeTtc > 0 ? arrondi(periodeTtc * retenuePct / 100) : 0;
  const avanceRemboursement = arrondi(num(situation.avance_remboursement));
  const penalites = arrondi(num(situation.penalites_ht));
  const netAPayer = arrondi(periodeTtc - retenue - avanceRemboursement - penalites);

  const montantMarche = num(marche?.montant_ht);
  const avancementPct = montantMarche > 0 ? Math.round(cumulAdmisHt / montantMarche * 1000) / 10 : null;

  const cumulNetPrecedent = arrondi(precedentes.reduce(
    (total, s, i) => total + calculerCertificat(s, marche, precedentes.slice(0, i)).netAPayer, 0,
  ));

  return {
    numero: situation.numero_situation,
    cumulPresenteHt, cumulAdmisHt,
    ecartHt: arrondi(cumulPresenteHt - cumulAdmisHt),
    cumulPrecedentHt, periodeHt, revisionCoeff, revisionHt, periodeHtRevise,
    tvaRate, tva, periodeTtc, retenuePct, retenue, avanceRemboursement, penalites, netAPayer,
    avancementPct, cumulNetPrecedent,
  };
}

/** Certificats de toutes les situations d'un marché, dans l'ordre. */
export function certificatsDuMarche(marche: MarcheTravaux, situations: SituationTravaux[]): Certificat[] {
  const liste = situationsDuMarche(situations, marche.id);
  return liste.map((s, i) => calculerCertificat(s, marche, liste.slice(0, i)));
}

/**
 * Décompte de clôture d'un marché : total HT, toutes les situations, TVA,
 * ce qui a déjà été certifié et le reste à payer TTC. La retenue de garantie
 * est déduite du reste à payer et signalée à part : elle se libère à
 * l'expiration du délai de garantie (un an après la réception), pas ici.
 */
export function calculerDecompteCloture(marche: MarcheTravaux, situations: SituationTravaux[]): DecompteCloture {
  const liste = situationsDuMarche(situations, marche.id);
  const certificats = liste.map((s, i) => calculerCertificat(s, marche, liste.slice(0, i)));
  const somme = (f: (c: Certificat) => number) => arrondi(certificats.reduce((t, c) => t + f(c), 0));

  const totalHt = certificats.length ? certificats[certificats.length - 1].cumulAdmisHt : 0;
  const totalRevisionHt = somme((c) => c.revisionHt);
  const totalHtRevise = arrondi(totalHt + totalRevisionHt);
  const tva = somme((c) => c.tva);
  const totalTtc = arrondi(totalHtRevise + tva);
  const totalPenalites = somme((c) => c.penalites);
  const totalRetenue = somme((c) => c.retenue);
  const totalAvanceRemboursee = somme((c) => c.avanceRemboursement);
  const avanceVersee = arrondi(num(marche.avance_montant_ttc));
  const dejaCertifie = arrondi(certificats.reduce(
    (t, c, i) => t + (estCertifiee(liste[i]) ? c.netAPayer : 0), 0,
  ));
  // Ce que le maître d'ouvrage doit encore, hors retenue de garantie : le TTC
  // des travaux, moins les pénalités, moins ce qu'il a déjà versé (l'avance et
  // les certificats établis).
  const resteAPayerTtc = arrondi(totalTtc - totalPenalites - avanceVersee - dejaCertifie - totalRetenue);
  const montantMarcheHt = num(marche.montant_ht);

  return {
    marche, certificats, totalHt, totalRevisionHt, totalHtRevise, tva, totalTtc,
    totalPenalites, totalRetenue, avanceVersee, totalAvanceRemboursee, dejaCertifie,
    resteAPayerTtc, montantMarcheHt, ecartMarcheHt: arrondi(totalHt - montantMarcheHt),
  };
}

/** Synthèse d'un marché pour le tableau de l'onglet RDT. */
export interface SyntheseMarche {
  marche: MarcheTravaux;
  nbSituations: number;
  cumulAdmisHt: number;
  avancementPct: number | null;
  certifieTtc: number;
  aCertifier: number;
}

export function syntheseMarche(marche: MarcheTravaux, situations: SituationTravaux[]): SyntheseMarche {
  const liste = situationsDuMarche(situations, marche.id);
  const certificats = certificatsDuMarche(marche, situations);
  const dernier = certificats[certificats.length - 1];
  return {
    marche,
    nbSituations: liste.length,
    cumulAdmisHt: dernier?.cumulAdmisHt ?? 0,
    avancementPct: dernier?.avancementPct ?? (num(marche.montant_ht) > 0 ? 0 : null),
    certifieTtc: arrondi(certificats.reduce((t, c, i) => t + (estCertifiee(liste[i]) ? c.netAPayer : 0), 0)),
    aCertifier: liste.filter((s) => !estCertifiee(s)).length,
  };
}
