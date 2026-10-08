// ── Intégration d'une saisie en ligne dans les offres de la consultation ─────
// Pur : calcule l'effet d'une remise (aperçu) et la consultation résultante,
// pour que l'écran montre ce qui va changer AVANT de l'appliquer. Rien n'est
// jamais écrit tant que l'architecte n'a pas confirmé.
//
// La base reste `Offre.montant_base` (source unique du prix de base). Options
// et variantes deviennent des lignes de la négociation du couple lot x
// entreprise, au prix d'OUVERTURE ; les tours de négociation déjà saisis ne
// bougent pas. Rejouer l'intégration d'une version plus récente met à jour les
// lignes de même intitulé au lieu de les dupliquer.
import {
  negociationVide, remplacerNegociation, trouverNegociation,
  type LigneOffre, type Negociation,
} from './actNegociation';
import type { SaisieOffre } from './consultationDepot';

export interface OffreApplicable {
  id: string;
  lot_id: string;
  entreprise_id: string;
  montant_base: number;
  note_technique: number;
  conforme: boolean;
  motif_nc?: string;
}

export interface ConsultationApplicable {
  entreprises: Array<{ id: string; nom: string; offre_recue_le?: string; ne_repond_pas?: boolean }>;
  offres: OffreApplicable[];
  negociations?: Negociation[];
}

export interface DepotSaisie {
  id: string;
  entreprise_id: string;
  lot_id: string | null;
  received_at: string;
  payload: SaisieOffre;
}

export type ActionLigne = 'ajoutee' | 'mise_a_jour' | 'identique';

export interface ApercuSaisie {
  lotId: string;
  entrepriseId: string;
  action: ActionLigne;
  ancienMontant?: number;
  nouveauMontant: number;
  lignes: Array<{ kind: 'option' | 'variante'; libelle: string; montant: number; action: ActionLigne; ancien?: number }>;
  delaiSemaines?: number;
  observations?: string;
}

const memeLibelle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Rien à intégrer si la remise ne vise aucun lot, ou une entreprise retirée de la consultation depuis. */
export function saisieIntegrable(c: ConsultationApplicable, depot: DepotSaisie): boolean {
  return !!depot.lot_id && c.entreprises.some(e => e.id === depot.entreprise_id);
}

export function apercuSaisie(c: ConsultationApplicable, depot: DepotSaisie): ApercuSaisie | null {
  if (!saisieIntegrable(c, depot)) return null;
  const lotId = depot.lot_id as string;
  const offre = c.offres.find(o => o.lot_id === lotId && o.entreprise_id === depot.entreprise_id);
  const s = depot.payload;
  const action: ActionLigne = !offre ? 'ajoutee' : offre.montant_base === s.montant_base ? 'identique' : 'mise_a_jour';

  const existantes = trouverNegociation(c.negociations, lotId, depot.entreprise_id)?.lignes ?? [];
  const lignes = s.lignes.map(l => {
    const deja = existantes.find(x => x.kind === l.kind && memeLibelle(x.libelle, l.libelle));
    const a: ActionLigne = !deja ? 'ajoutee' : deja.montant_ouverture === l.montant ? 'identique' : 'mise_a_jour';
    return { kind: l.kind, libelle: l.libelle, montant: l.montant, action: a, ancien: deja?.montant_ouverture };
  });

  return {
    lotId, entrepriseId: depot.entreprise_id, action,
    ancienMontant: offre?.montant_base, nouveauMontant: s.montant_base, lignes,
    delaiSemaines: s.delai_semaines, observations: s.observations,
  };
}

/** Jour AAAA-MM-JJ (heure de Paris) d'une date ISO. */
function jourFrance(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}

export function appliquerSaisie<T extends ConsultationApplicable>(
  c: T, depot: DepotSaisie, opts: { genererId: () => string },
): T {
  if (!saisieIntegrable(c, depot)) return c;
  const lotId = depot.lot_id as string;
  const s = depot.payload;

  const offres = c.offres.some(o => o.lot_id === lotId && o.entreprise_id === depot.entreprise_id)
    ? c.offres.map(o => (o.lot_id === lotId && o.entreprise_id === depot.entreprise_id ? { ...o, montant_base: s.montant_base } : o))
    : [...c.offres, {
        id: opts.genererId(), lot_id: lotId, entreprise_id: depot.entreprise_id,
        montant_base: s.montant_base, note_technique: 0, conforme: true,
      }];

  let negociations = c.negociations;
  const note = [
    s.delai_semaines ? `Délai annoncé par l'entreprise : ${s.delai_semaines} semaines.` : '',
    s.observations ? `Observations de l'entreprise : ${s.observations}` : '',
  ].filter(Boolean).join(' ');
  if (s.lignes.length > 0 || note) {
    const base = trouverNegociation(c.negociations, lotId, depot.entreprise_id) ?? negociationVide(lotId, depot.entreprise_id);
    let lignes = [...base.lignes];
    for (const l of s.lignes) {
      const i = lignes.findIndex(x => x.kind === l.kind && memeLibelle(x.libelle, l.libelle));
      if (i >= 0) lignes[i] = { ...lignes[i], montant_ouverture: l.montant };
      else lignes = [...lignes, { id: opts.genererId(), kind: l.kind, libelle: l.libelle, montant_ouverture: l.montant } satisfies LigneOffre];
    }
    negociations = remplacerNegociation(c.negociations, {
      ...base, lignes,
      // La remarque de vérification n'est jamais écrasée : celle de l'architecte prime.
      remarque_verification: base.remarque_verification || note || undefined,
    });
  }

  return {
    ...c,
    offres,
    negociations,
    entreprises: c.entreprises.map(e => (e.id === depot.entreprise_id
      ? { ...e, offre_recue_le: e.offre_recue_le || jourFrance(depot.received_at), ne_repond_pas: false }
      : e)),
  };
}
