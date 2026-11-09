// Récapitulatif des situations de travaux PAR LOT : pour chaque marché (une entreprise, un lot),
// toutes les situations présentées avec leur date, leur date de paiement, ce qui reste à payer et
// la retenue de garantie. Les montants viennent du certificat de paiement (`certificatPaiement.ts`),
// jamais recalculés ici : le net à payer et la retenue d'une situation sont ceux du certificat.
import {
  certificatsDuMarche, estCertifiee, situationsDuMarche,
  type MarcheTravaux, type SituationTravaux,
} from './certificatPaiement';

const arrondi = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LigneRecapSituation {
  situationId: string;
  numero: number;
  /** Date de la situation (celle de l'entreprise), à défaut sa date de réception. */
  dateSituation: string | null;
  etat: string;
  cumulPresenteHt: number;
  cumulAdmisHt: number;
  periodeHt: number;
  /** Net à payer TTC du certificat (après retenue, avance et pénalités). */
  netAPayer: number;
  /** Date de règlement ; seulement pour une situation payée. */
  datePaiement: string | null;
  payee: boolean;
  /** Ce qui reste à payer sur cette situation : le net tant qu'elle n'est pas payée, 0 ensuite. */
  resteAPayer: number;
  /** Retenue de garantie opérée sur cette situation. */
  retenue: number;
  certifiee: boolean;
}

export interface RecapLot {
  marche: MarcheTravaux;
  lot: string;
  lignes: LigneRecapSituation[];
  totalPeriodeHt: number;
  totalNetAPayer: number;
  totalPaye: number;
  totalResteAPayer: number;
  retenueCumulee: number;
}

const jour = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

type SituationAvecPaiement = SituationTravaux & { date_paiement?: string | null };

export function recapMarche(marche: MarcheTravaux, situations: SituationTravaux[]): RecapLot {
  const liste = situationsDuMarche(situations, marche.id) as SituationAvecPaiement[];
  const certificats = certificatsDuMarche(marche, situations);
  const lignes: LigneRecapSituation[] = liste.map((s, i) => {
    const c = certificats[i];
    const payee = s.etat === 'Payée';
    return {
      situationId: s.id,
      numero: s.numero_situation,
      dateSituation: jour(s.date_situation) ?? jour(s.date_reception_situation),
      etat: String(s.etat),
      cumulPresenteHt: c.cumulPresenteHt,
      cumulAdmisHt: c.cumulAdmisHt,
      periodeHt: c.periodeHt,
      netAPayer: c.netAPayer,
      datePaiement: payee ? jour(s.date_paiement) : null,
      payee,
      resteAPayer: payee ? 0 : Math.max(0, c.netAPayer),
      retenue: c.retenue,
      certifiee: estCertifiee(s),
    };
  });
  const somme = (f: (l: LigneRecapSituation) => number) => arrondi(lignes.reduce((t, l) => t + f(l), 0));
  return {
    marche,
    lot: [marche.lot_numero, marche.lot_titre].filter(Boolean).join(' ').trim() || marche.entreprise_nom,
    lignes,
    totalPeriodeHt: somme(l => l.periodeHt),
    totalNetAPayer: somme(l => l.netAPayer),
    totalPaye: somme(l => (l.payee ? Math.max(0, l.netAPayer) : 0)),
    totalResteAPayer: somme(l => l.resteAPayer),
    retenueCumulee: somme(l => l.retenue),
  };
}

/** Un récapitulatif par marché qui a au moins une situation, dans l'ordre fourni. Un accord-cadre (sans situation propre) est omis. */
export function recapParLot(marches: MarcheTravaux[], situations: SituationTravaux[]): RecapLot[] {
  return marches
    .filter(m => m.type_marche !== 'accord_cadre' && situationsDuMarche(situations, m.id).length > 0)
    .map(m => recapMarche(m, situations));
}
