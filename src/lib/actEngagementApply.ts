// ── Import d'un acte d'engagement rempli dans les offres de la consultation ──
// Pur : calcule les entreprises et offres résultantes ET le compte rendu de ce
// qui va changer, pour que l'écran montre l'effet avant de l'appliquer.
//
// Rapprochement de l'entreprise : SIRET (via la fiche contact) d'abord, nom
// ensuite ; sinon une entreprise est créée. Une offre déjà saisie pour le
// couple lot x entreprise est mise à jour (montant d'ouverture), jamais
// dupliquée ; les négociations, notes et conformité ne sont pas touchées.
import type { ActeRempli } from './actEngagementForm';

export interface EntrepriseOffre {
  id: string;
  contact_id?: string;
  nom: string;
  email?: string;
  lots_ids: string[];
  envoyer_dce: boolean;
  offre_recue_le?: string;
  ne_repond_pas?: boolean;
}

export interface OffreImportee {
  id: string;
  lot_id: string;
  entreprise_id: string;
  montant_base: number;
  note_technique: number;
  conforme: boolean;
  motif_nc?: string;
}

export interface ContactRapprochable {
  id: string;
  siret?: string;
  company_name?: string;
  first_name?: string;
  last_name?: string;
}

export interface LotRapprochable { id: string; lot_number: string; lot_title: string }

export interface ResumeImport {
  entrepriseNom: string;
  rapprochement: 'siret' | 'nom' | 'nouvelle';
  lots: { numero: string; titre: string; prix: number; action: 'ajoutee' | 'mise_a_jour' | 'identique'; ancien?: number }[];
  ignores: string[];
}

export interface ResultatImport {
  entreprises: EntrepriseOffre[];
  offres: OffreImportee[];
  resume: ResumeImport;
}

const chiffres = (s?: string) => (s ?? '').replace(/\D/g, '');

/** Nom comparable : sans accents, casse, ponctuation ni forme juridique. */
export function nomComparable(nom: string): string {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(m => m && !['sas', 'sarl', 'eurl', 'sasu', 'sa', 'sci', 'ets', 'etablissements', 'societe'].includes(m))
    .join(' ');
}

const nomContact = (c: ContactRapprochable) => c.company_name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(' ');

export function appliquerActeAuxOffres(
  etat: { entreprises: EntrepriseOffre[]; offres: OffreImportee[] },
  acte: ActeRempli,
  lots: LotRapprochable[],
  contacts: ContactRapprochable[],
  opts: { aujourdhui: string; genererId: () => string },
): ResultatImport {
  const nomActe = acte.entreprise.entreprise?.trim() ?? '';
  const siret = chiffres(acte.entreprise.siret);
  const ignores: string[] = [];

  const contactSiret = siret.length === 14 ? contacts.find(c => chiffres(c.siret) === siret) : undefined;
  const comparable = nomComparable(nomActe);
  const contactNom = !contactSiret && comparable ? contacts.find(c => nomComparable(nomContact(c)) === comparable) : undefined;
  const contact = contactSiret ?? contactNom;

  let existante: EntrepriseOffre | undefined;
  let rapprochement: ResumeImport['rapprochement'] = 'nouvelle';
  if (contactSiret) {
    existante = etat.entreprises.find(e => e.contact_id === contactSiret.id);
    if (existante) rapprochement = 'siret';
  }
  if (!existante && comparable) {
    existante = etat.entreprises.find(e => nomComparable(e.nom) === comparable)
      ?? (contact ? etat.entreprises.find(e => e.contact_id === contact.id) : undefined);
    if (existante) rapprochement = contactSiret && existante.contact_id === contactSiret.id ? 'siret' : 'nom';
  }

  const entrepriseId = existante?.id ?? opts.genererId();
  const nom = existante?.nom ?? (nomActe || (contact ? nomContact(contact) : 'Entreprise sans nom'));
  if (!nomActe && !existante) ignores.push('La dénomination est absente du formulaire : l\'entreprise est créée sans nom.');

  const retenus = acte.lots.filter(l => l.candidat);
  const lotsIds = new Set(existante?.lots_ids ?? []);
  const offres = [...etat.offres];
  const resumeLots: ResumeImport['lots'] = [];

  for (const l of retenus) {
    const lot = lots.find(x => x.lot_number === l.numero);
    if (!lot) { ignores.push(`Lot ${l.numero} : inconnu de l'opération.`); continue; }
    if (l.prixHT === null || l.prixHT <= 0) { ignores.push(`Lot ${l.numero} : pas de prix exploitable, aucune offre créée.`); continue; }
    lotsIds.add(lot.id);
    const i = offres.findIndex(o => o.lot_id === lot.id && o.entreprise_id === entrepriseId);
    if (i >= 0) {
      const ancien = offres[i].montant_base;
      if (ancien === l.prixHT) resumeLots.push({ numero: l.numero, titre: lot.lot_title, prix: l.prixHT, action: 'identique' });
      else {
        offres[i] = { ...offres[i], montant_base: l.prixHT };
        resumeLots.push({ numero: l.numero, titre: lot.lot_title, prix: l.prixHT, action: 'mise_a_jour', ancien: ancien || undefined });
      }
    } else {
      offres.push({ id: opts.genererId(), lot_id: lot.id, entreprise_id: entrepriseId, montant_base: l.prixHT, note_technique: 0, conforme: true, motif_nc: '' });
      resumeLots.push({ numero: l.numero, titre: lot.lot_title, prix: l.prixHT, action: 'ajoutee' });
    }
  }

  const entreprise: EntrepriseOffre = {
    ...(existante ?? { id: entrepriseId, nom, lots_ids: [], envoyer_dce: false }),
    contact_id: existante?.contact_id ?? contact?.id,
    email: existante?.email || acte.entreprise.email || undefined,
    lots_ids: [...lotsIds],
    offre_recue_le: existante?.offre_recue_le || opts.aujourdhui,
    ne_repond_pas: false,
  };
  const entreprises = existante
    ? etat.entreprises.map(e => (e.id === existante!.id ? entreprise : e))
    : (resumeLots.length > 0 ? [...etat.entreprises, entreprise] : etat.entreprises);

  return { entreprises, offres, resume: { entrepriseNom: nom, rapprochement, lots: resumeLots, ignores } };
}
