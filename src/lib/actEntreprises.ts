// ── Logique du suivi des entreprises consultées (module ACT) ─────────────────
// Fonctions pures : statut d'une entreprise, couverture des lots, suggestions
// de contacts par métier, filtres. Le composant ne fait que les afficher.

export interface EntrepriseSuivi {
  id: string;
  contact_id?: string;
  nom: string;
  email?: string;
  /** Autres adresses de destination (séparées par des virgules ou des points-virgules), en plus de l'e-mail du contact. */
  emails_supplementaires?: string;
  lots_ids: string[];
  envoyer_dce: boolean;
  dce_transmis_le?: string;
  relance_le?: string;
  offre_recue_le?: string;
  ne_repond_pas?: boolean;
  /**
   * Date d'une remise faite sur l'espace de dépôt et pas encore traitée. Jamais
   * enregistrée avec la consultation : elle se déduit des remises reçues
   * (consultation_depots) et ne sert qu'au statut affiché.
   */
  depot_recu_le?: string;
}

export interface LotSuivi {
  id: string;
  lot_number: string;
  lot_title: string;
}

/** En deçà, un lot n'a pas assez d'entreprises consultées pour une mise en concurrence sérieuse. */
export const MIN_ENTREPRISES_PAR_LOT = 3;

export const SANS_LOT = '__sans_lot__';

export type StatutEntreprise =
  | 'a_envoyer'
  | 'dce_envoye'
  | 'a_relancer'
  | 'offre_deposee'
  | 'offre_recue'
  | 'sans_reponse'
  | 'hors_envoi';

export const STATUT_LABELS: Record<StatutEntreprise, string> = {
  a_envoyer: 'DCE à envoyer',
  dce_envoye: 'DCE envoyé',
  a_relancer: 'À relancer',
  offre_deposee: 'Offre déposée',
  offre_recue: 'Offre reçue',
  sans_reponse: 'Ne répond pas',
  hors_envoi: 'DCE non prévu',
};

/** Ordre d'affichage dans les filtres : ce qui demande une action d'abord. */
export const STATUT_ORDER: StatutEntreprise[] = [
  'a_envoyer', 'offre_deposee', 'a_relancer', 'dce_envoye', 'offre_recue', 'sans_reponse', 'hors_envoi',
];

/** Date du jour au format AAAA-MM-JJ, en heure locale (pas UTC : un envoi à 0 h 30 reste du jour). */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Statut déduit des dates et cases déjà saisies : rien de plus à renseigner.
 * Une relance dont la date est atteinte, sans offre reçue ni déposée, passe à « À relancer ».
 */
export function statutEntreprise(e: EntrepriseSuivi, today: string = todayIso()): StatutEntreprise {
  if (e.ne_repond_pas) return 'sans_reponse';
  if (e.offre_recue_le) return 'offre_recue';
  // Une remise déposée par l'entreprise attend l'intégration de l'architecte :
  // c'est ce qui demande une action, avant même une relance.
  if (e.depot_recu_le) return 'offre_deposee';
  if (e.dce_transmis_le) return e.relance_le && e.relance_le <= today ? 'a_relancer' : 'dce_envoye';
  return e.envoyer_dce ? 'a_envoyer' : 'hors_envoi';
}

export interface ResumeSuivi {
  total: number;
  parStatut: Record<StatutEntreprise, number>;
}

export function resumeSuivi(entreprises: EntrepriseSuivi[], today: string = todayIso()): ResumeSuivi {
  const parStatut = Object.fromEntries(STATUT_ORDER.map(s => [s, 0])) as Record<StatutEntreprise, number>;
  for (const e of entreprises) parStatut[statutEntreprise(e, today)] += 1;
  return { total: entreprises.length, parStatut };
}

// ── Couverture des lots ──────────────────────────────────────────────────────

export interface CouvertureLot {
  lot: LotSuivi;
  /** Entreprises consultées sur ce lot, hors « ne répond pas » qui ne comptent pas comme concurrence. */
  nb: number;
}

export interface Couverture {
  lotsInsuffisants: CouvertureLot[];
  sansLot: EntrepriseSuivi[];
  sansEmail: EntrepriseSuivi[];
}

export function couverture(
  entreprises: EntrepriseSuivi[],
  lots: LotSuivi[],
  min: number = MIN_ENTREPRISES_PAR_LOT,
): Couverture {
  const lotIds = new Set(lots.map(l => l.id));
  const actives = entreprises.filter(e => !e.ne_repond_pas);
  const lotsInsuffisants = lots
    .map(lot => ({ lot, nb: actives.filter(e => e.lots_ids.includes(lot.id)).length }))
    .filter(c => c.nb < min);
  return {
    lotsInsuffisants,
    sansLot: entreprises.filter(e => !e.lots_ids.some(id => lotIds.has(id))),
    sansEmail: entreprises.filter(e => e.envoyer_dce && !e.dce_transmis_le && !(e.email || '').trim()),
  };
}

// ── Suggestions de contacts par métier ───────────────────────────────────────

const MOTS_VIDES = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'sur', 'avec', 'pour', 'par',
  'lot', 'travaux', 'divers',
]);

/** Minuscules, sans accents, en mots d'au moins 4 lettres hors mots vides, réduits à leur radical (5 lettres). */
export function radicauxMetier(texte: string): Set<string> {
  const mots = texte
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(m => m.length >= 4 && !MOTS_VIDES.has(m));
  return new Set(mots.map(m => m.slice(0, 5)));
}

export interface ContactSuggere {
  id: string;
  company_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  email_work?: string;
  corps_etat?: string[];
}

export function nomContact(c: ContactSuggere): string {
  return c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
}

/**
 * Contacts « Entreprise » dont un corps d'état déclaré recoupe l'intitulé du lot,
 * les plus proches d'abord. Exclut ceux déjà consultés. Rapprochement par radicaux
 * (« Menuiserie » / « Menuiseries ») : volontairement large, c'est une suggestion
 * que l'architecte confirme, pas une affectation.
 */
export function suggererContacts<T extends ContactSuggere>(
  lot: LotSuivi,
  contacts: T[],
  dejaConsultes: Set<string>,
  limite = 6,
): T[] {
  const radicauxLot = radicauxMetier(lot.lot_title);
  if (radicauxLot.size === 0) return [];
  return contacts
    .filter(c => !dejaConsultes.has(c.id) && nomContact(c))
    .map(c => {
      const radicauxContact = radicauxMetier((c.corps_etat || []).join(' '));
      let score = 0;
      for (const r of radicauxContact) if (radicauxLot.has(r)) score += 1;
      return { c, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || nomContact(a.c).localeCompare(nomContact(b.c), 'fr'))
    .slice(0, limite)
    .map(x => x.c);
}

/**
 * Lots dont l'intitulé recoupe l'un des corps d'état donnés : sert à proposer
 * le classement d'une entreprise qu'on vient d'ajouter sans lot (« Charpente -
 * Ossature bois » -> « Lot 02 Charpente bois »). Une proposition modifiable,
 * jamais une affectation : même rapprochement que `suggererContacts`.
 */
export function lotsCorrespondants(libellesCorpsEtat: string[], lots: LotSuivi[]): string[] {
  const radicauxCorps = radicauxMetier(libellesCorpsEtat.join(' '));
  if (radicauxCorps.size === 0) return [];
  return lots
    .filter(lot => {
      for (const r of radicauxMetier(lot.lot_title)) if (radicauxCorps.has(r)) return true;
      return false;
    })
    .map(lot => lot.id);
}

// ── Filtres ──────────────────────────────────────────────────────────────────

export interface FiltresEntreprises {
  recherche: string;
  /** Identifiant de lot, SANS_LOT, ou '' pour tous. */
  lot: string;
  statut: StatutEntreprise | '';
}

export const FILTRES_VIDES: FiltresEntreprises = { recherche: '', lot: '', statut: '' };

export function filtresActifs(f: FiltresEntreprises): boolean {
  return !!(f.recherche.trim() || f.lot || f.statut);
}

const sansAccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche (nom ou email) et statut. Le filtre par lot s'applique aux groupes, pas aux entreprises. */
export function filtrerEntreprises<T extends EntrepriseSuivi>(
  entreprises: T[],
  f: FiltresEntreprises,
  today: string = todayIso(),
): T[] {
  const q = sansAccent(f.recherche.trim());
  return entreprises.filter(e => {
    if (q && !sansAccent(`${e.nom} ${e.email || ''}`).includes(q)) return false;
    if (f.statut && statutEntreprise(e, today) !== f.statut) return false;
    return true;
  });
}

// ── Liste à plat (une ligne par entreprise) ──────────────────────────────────

export type Regroupement = 'lot' | 'aucun';

/**
 * Une ligne par entreprise, triée par nom (les noms vides en dernier), avec le
 * filtre par lot appliqué à l'appartenance : le regroupement par lot répète au
 * contraire une entreprise dans chacun de ses lots.
 */
export function listeAPlat<T extends EntrepriseSuivi>(
  entreprises: T[],
  lotFiltre: string,
  lots: LotSuivi[],
): T[] {
  const lotIds = new Set(lots.map(l => l.id));
  return entreprises
    .filter(e => {
      if (!lotFiltre) return true;
      if (lotFiltre === SANS_LOT) return !e.lots_ids.some(id => lotIds.has(id));
      return e.lots_ids.includes(lotFiltre);
    })
    .sort((a, b) => {
      if (!a.nom.trim() !== !b.nom.trim()) return a.nom.trim() ? -1 : 1;
      return a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });
    });
}

type ChampsEmailContact = {
  email?: string | null;
  email_work?: string | null;
  email_home?: string | null;
  email_other?: string | null;
};

/**
 * Adresses saisies sur la ligne de consultation à reporter sur la fiche contact.
 * - Une adresse CORRIGÉE (présente avant la saisie, absente après) remplace
 *   l'ancienne là où elle se trouve sur la fiche ; `avant` est la liste des
 *   adresses de la ligne avant la saisie. Une adresse simplement supprimée de la
 *   ligne reste sur la fiche : la fiche ne perd rien sans remplaçante.
 * - Les autres nouvelles adresses vont dans les emplacements VIDES (pro, e-mail,
 *   perso, autre) ; une adresse déjà sur la fiche n'est jamais dupliquée (casse ignorée).
 * Rend `null` quand il n'y a rien à changer. Au-delà de quatre adresses, le surplus
 * reste sur la ligne de consultation (la fiche n'a que quatre champs).
 */
export function completerEmailsContact(
  contact: ChampsEmailContact,
  e: Pick<EntrepriseSuivi, 'email' | 'emails_supplementaires'>,
  avant: string[] = [],
): Partial<Record<keyof ChampsEmailContact, string>> | null {
  const cle = (a?: string | null) => (a ?? '').trim().toLowerCase();
  const champs: (keyof ChampsEmailContact)[] = ['email_work', 'email', 'email_home', 'email_other'];
  const apres = destinatairesEntreprise(e);
  const present = new Set(champs.map(k => cle(contact[k])).filter(Boolean));
  const gardees = new Set(apres.map(cle));
  const remplacables = avant.filter(a => !gardees.has(cle(a)) && present.has(cle(a)));
  const aAjouter = apres.filter(a => !present.has(cle(a)));
  const patch: Partial<Record<keyof ChampsEmailContact, string>> = {};
  const restantes: string[] = [];
  for (const adresse of aAjouter) {
    const ancienne = remplacables.shift();
    const champ = ancienne ? champs.find(k => cle(contact[k]) === cle(ancienne) && !(k in patch)) : undefined;
    if (champ) patch[champ] = adresse; else restantes.push(adresse);
  }
  const libres = champs.filter(k => !cle(contact[k]) && !(k in patch));
  restantes.forEach((adresse, i) => { if (libres[i]) patch[libres[i]] = adresse; });
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Destinataires d'un message à l'entreprise : l'e-mail du contact d'abord, puis
 * les adresses supplémentaires saisies sur la ligne, sans doublon (casse ignorée).
 */
export function destinatairesEntreprise(e: Pick<EntrepriseSuivi, 'email' | 'emails_supplementaires'>): string[] {
  const vus = new Set<string>();
  return [e.email ?? '', ...(e.emails_supplementaires ?? '').split(/[;,\s]+/)]
    .map(a => a.trim())
    .filter(a => a.includes('@') && !vus.has(a.toLowerCase()) && !!vus.add(a.toLowerCase()));
}
