// ── Message d'envoi du DCE : un modèle, des blocs propres à chaque entreprise ──
// Le même texte sert à l'envoi d'une seule entreprise et à l'envoi groupé : le modèle
// porte des jetons {{...}} remplacés entreprise par entreprise (lots, pièces, lien de
// dépôt). Aucun jeton n'est inventé : un bloc sans donnée devient vide et les lignes
// vides en trop sont resserrées.

import type { BlocVisite } from './actVisites';
import type { BlocAdditif } from './dceRevisions';
import { blocQuantitesAConfirmer, type LotQuantitesAConfirmer } from './quantitesConfirmation';

export interface LotMessage { lot_number: string; lot_title: string }
export interface LigneIndiceMessage { designation: string; fichier: string; indice: string }

export interface DonneesMessageDce {
  operation: string;
  entreprise: string;
  lots: LotMessage[];
  /** Libellés des pièces du marché (RC, CCAP, acte d'engagement) générées pour ce message. */
  piecesMarche: string[];
  lignesIndices: LigneIndiceMessage[];
  /** Visite de site : son créneau, ou les créneaux proposés. Absent : aucune visite annoncée. */
  visite?: BlocVisite;
  /** Additif au DCE : numéro, motif, pièces modifiées et lien « j'ai bien reçu » de l'entreprise. */
  additif?: BlocAdditif;
  /** Réponse publique à diffuser (question sans nom d'auteur). */
  questionReponse?: { objet?: string; question: string; reponse: string };
  /** Quantités à confirmer par l'entreprise (postes dont sa quantité diffère du dossier). */
  quantites?: LotQuantitesAConfirmer[];
  /** Lien de dépôt personnel de l'entreprise. */
  lienDepot?: string;
  /** Date limite de remise, déjà mise en forme. */
  dateLimite?: string;
  /** Raison pour laquelle aucun lien de dépôt n'est proposé (espace indisponible). */
  depotNonPropose?: string;
  /** Le lien devait être créé mais la création a échoué. */
  echecLienDepot?: boolean;
  /** Fichiers qui n'ont pas pu être joints. */
  echecsPieces: string[];
}

export const MODELE_SUJET = 'Consultation des entreprises — {{operation}}{{lots_courts}}';

export const MODELE_CORPS = [
  'Bonjour,',
  '',
  'Dans le cadre de la consultation des entreprises pour l\'opération « {{operation}} », nous vous transmettons le dossier de consultation (DCE){{lots}}',
  '',
  '{{pieces_marche}}',
  '',
  '{{pieces_dossier}}',
  '',
  '{{visite}}',
  '',
  '{{depot}}',
  '',
  '{{avertissements}}',
  '',
  'Nous restons à votre disposition pour toute précision.',
  '',
  'Cordialement,',
].join('\n');

/** Additif au DCE : les pièces modifiées sont jointes et remplacent les versions précédentes. */
export const MODELE_SUJET_ADDITIF = 'Additif n°{{numero_additif}} au DCE : {{operation}}';

export const MODELE_CORPS_ADDITIF = [
  'Bonjour,',
  '',
  'Dans le cadre de la consultation des entreprises pour l\'opération « {{operation}} », le dossier de consultation a été modifié.',
  '',
  '{{additif}}',
  '',
  'Les pièces modifiées sont jointes à ce message et remplacent les versions précédentes. Merci d\'en tenir compte pour votre offre.',
  '',
  '{{pieces_dossier}}',
  '',
  '{{accuse}}',
  '',
  '{{avertissements}}',
  '',
  'Cordialement,',
].join('\n');

/** Envoi de documents choisis (un ou plusieurs, mis à jour) : seuls ceux qui concernent les lots de l'entreprise sont joints. */
export const MODELE_SUJET_DOCUMENTS = 'Documents du DCE : {{operation}}{{lots_courts}}';

export const MODELE_CORPS_DOCUMENTS = [
  'Bonjour,',
  '',
  'Dans le cadre de la consultation des entreprises pour l\'opération « {{operation}} », nous vous transmettons les documents suivants{{lots}}',
  '',
  '{{pieces_dossier}}',
  '',
  'Ces documents sont joints à ce message. Lorsqu\'ils portent un indice supérieur à celui déjà reçu, ils remplacent les versions précédentes : merci d\'en tenir compte pour votre offre.',
  '',
  '{{avertissements}}',
  '',
  'Nous restons à votre disposition pour toute précision.',
  '',
  'Cordialement,',
].join('\n');

/** Réponse à une question, diffusée à toutes les entreprises concernées sans citer l'auteur de la question. */
export const MODELE_SUJET_REPONSE = 'Réponse à une question : {{operation}}';

export const MODELE_CORPS_REPONSE = [
  'Bonjour,',
  '',
  'Dans le cadre de la consultation des entreprises pour l\'opération « {{operation}} », nous portons à la connaissance de toutes les entreprises consultées la réponse suivante.',
  '',
  '{{question_reponse}}',
  '',
  'Cette réponse fait partie du dossier de consultation.',
  '',
  'Cordialement,',
].join('\n');

/** Convocation à la visite de site, envoyée seule (après l'envoi du DCE ou lors d'un changement de créneau). */
export const MODELE_SUJET_VISITE = 'Visite de site — {{operation}}';

export const MODELE_CORPS_VISITE = [
  'Bonjour,',
  '',
  'Dans le cadre de la consultation des entreprises pour l\'opération « {{operation}} », nous vous informons de la visite de site suivante.',
  '',
  '{{visite}}',
  '',
  'Merci de nous confirmer votre présence en répondant à ce message.',
  '',
  'Cordialement,',
].join('\n');

/** Demande de confirmation des quantités : l'entreprise répond poste par poste depuis sa page de dépôt. */
export const MODELE_SUJET_QUANTITES = 'Quantités à confirmer : {{operation}}';

export const MODELE_CORPS_QUANTITES = [
  'Bonjour,',
  '',
  'Dans le cadre de la consultation des entreprises pour l\'opération « {{operation}} », votre offre est chiffrée sur des quantités qui diffèrent de celles du dossier. Merci de nous confirmer, pour chaque poste, la quantité à retenir.',
  '',
  '{{quantites}}',
  '',
  '{{depot}}',
  '',
  '{{avertissements}}',
  '',
  'Cordialement,',
].join('\n');

/** Jetons reconnus, avec ce qu'ils deviennent : sert d'aide dans la fenêtre d'envoi groupé. */
export const JETONS_MODELE: Array<{ jeton: string; aide: string }> = [
  { jeton: 'operation', aide: 'Nom de l\'opération' },
  { jeton: 'entreprise', aide: 'Nom de l\'entreprise destinataire' },
  { jeton: 'lots', aide: 'Lots de l\'entreprise (liste)' },
  { jeton: 'lots_courts', aide: 'Lots de l\'entreprise, en une ligne (Lot 01, Lot 02)' },
  { jeton: 'pieces_marche', aide: 'Pièces du marché jointes (RC, CCAP, acte d\'engagement)' },
  { jeton: 'pieces_dossier', aide: 'Pièces du dossier et indices de révision' },
  { jeton: 'visite', aide: 'Visite de site : créneau de l\'entreprise (ou créneaux proposés), lieu et consignes' },
  { jeton: 'additif', aide: 'Additif au DCE : numéro, motif et pièces modifiées (modèle d\'additif)' },
  { jeton: 'numero_additif', aide: 'Numéro de l\'additif' },
  { jeton: 'accuse', aide: 'Lien « j\'ai bien reçu » propre à l\'entreprise (modèle d\'additif)' },
  { jeton: 'quantites', aide: 'Postes dont la quantité est à confirmer, par lot (modèle de quantités)' },
  { jeton: 'question_reponse', aide: 'Question et réponse à diffuser (modèle de réponse)' },
  { jeton: 'depot', aide: 'Lien de dépôt personnel et date limite' },
  { jeton: 'avertissements', aide: 'Pièces non jointes ou lien non créé' },
];

const JETON = /\{\{\s*([a-z_]+)\s*\}\}/g;

const libelleLot = (l: LotMessage) => `Lot ${l.lot_number} — ${l.lot_title}`;

/** Les valeurs de chaque jeton pour une entreprise. */
export function blocsMessageDce(d: DonneesMessageDce): Record<string, string> {
  const lotsCourts = d.lots.map(l => `Lot ${l.lot_number}`).join(', ');
  const piecesMarche = d.piecesMarche.length
    ? ['Pièces du marché jointes :', ...d.piecesMarche.map(l => `- ${l}`),
       ...(d.piecesMarche.some(l => /acte/i.test(l)) ? ['L\'acte d\'engagement est à compléter, signer et remettre avec votre offre.'] : [])].join('\n')
    : '';
  const piecesDossier = d.lignesIndices.length
    ? ['Pièces du dossier (indice de révision) :',
       ...d.lignesIndices.map(l => `- ${l.designation}${l.fichier ? ` : ${l.fichier}` : ''}${l.indice ? ` (indice ${l.indice})` : ''}`),
       '', 'Le tableau des indices est joint à ce message.'].join('\n')
    : '';
  const v = d.visite;
  const visite = v && v.creneaux.length
    ? [
        v.assigne ? 'Visite de site :' : 'Visite de site, créneaux proposés :',
        ...v.creneaux.map(c => `- ${c}`),
        ...(v.assigne ? [] : ['Merci de nous indiquer le créneau que vous retenez.']),
        ...(v.lieu ? [`Lieu : ${v.lieu}`] : []),
        ...(v.consignes ? [`Consignes : ${v.consignes}`] : []),
      ].join('\n')
    : '';
  const a = d.additif;
  const additif = a
    ? [`Additif n° ${a.numero} du ${a.date}`, `Motif : ${a.motif}`, '', 'Pièces modifiées :', ...a.pieces.map(p => `- ${p}`)].join('\n')
    : '';
  const accuse = a?.lienAccuse
    ? ['Merci de confirmer la réception de cet additif en ouvrant le lien suivant :', a.lienAccuse].join('\n')
    : '';
  const qr = d.questionReponse;
  const questionReponse = qr
    ? [...(qr.objet ? [`Objet : ${qr.objet}`] : []), `Question : ${qr.question}`, '', `Réponse : ${qr.reponse}`].join('\n')
    : '';
  const depot = d.lienDepot && d.quantites
    ? ['Vous pouvez répondre en ligne, poste par poste, depuis votre espace personnel :', d.lienDepot,
       'Ce lien vous est personnel : merci de ne pas le transmettre.'].join('\n')
    : d.lienDepot
    ? ['Vous pouvez remettre votre offre en ligne sur votre espace de dépôt personnel (saisie de l\'offre ou dépôt de vos documents) :', d.lienDepot,
       ...(d.dateLimite ? [`Date limite de remise : ${d.dateLimite}.`] : []),
       'Ce lien vous est personnel : merci de ne pas le transmettre.'].join('\n')
    : '';
  const avertissements = [
    ...(!d.lienDepot && d.depotNonPropose ? [`[Lien de dépôt non proposé : ${d.depotNonPropose}]`] : []),
    ...(d.echecLienDepot ? ['[Lien de dépôt non créé : à créer depuis la ligne de l\'entreprise (icône lien)]'] : []),
    ...(d.echecsPieces.length ? [`[À joindre manuellement, téléchargement impossible : ${d.echecsPieces.join(', ')}]`] : []),
  ].join('\n\n');
  return {
    operation: d.operation,
    entreprise: d.entreprise,
    lots: d.lots.length ? ` relatif à :\n${d.lots.map(l => `- ${libelleLot(l)}`).join('\n')}` : '.',
    lots_courts: lotsCourts ? ` — ${lotsCourts}` : '',
    pieces_marche: piecesMarche,
    pieces_dossier: piecesDossier,
    visite,
    question_reponse: questionReponse,
    quantites: d.quantites ? blocQuantitesAConfirmer(d.quantites) : '',
    additif,
    numero_additif: a ? String(a.numero) : '',
    accuse,
    depot,
    avertissements,
  };
}

/** Remplace les jetons connus ; un jeton inconnu reste en clair, pour que la faute se voie. */
export function remplirModele(modele: string, blocs: Record<string, string>): string {
  return modele
    .replace(JETON, (tout, nom: string) => (nom in blocs ? blocs[nom] : tout))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

/** Jetons du modèle qui ne sont pas reconnus (faute de frappe). */
export function jetonsInconnus(modele: string, connus: string[] = JETONS_MODELE.map(j => j.jeton)): string[] {
  const trouves = new Set<string>();
  for (const m of modele.matchAll(JETON)) if (!connus.includes(m[1])) trouves.add(m[0]);
  return [...trouves];
}
