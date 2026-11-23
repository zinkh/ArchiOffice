// ── Message d'envoi du DCE : un modèle, des blocs propres à chaque entreprise ──
// Le même texte sert à l'envoi d'une seule entreprise et à l'envoi groupé : le modèle
// porte des jetons {{...}} remplacés entreprise par entreprise (lots, pièces, lien de
// dépôt). Aucun jeton n'est inventé : un bloc sans donnée devient vide et les lignes
// vides en trop sont resserrées.

import type { BlocVisite } from './actVisites';

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
  /** Réponse publique à diffuser (question sans nom d'auteur). */
  questionReponse?: { objet?: string; question: string; reponse: string };
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

/** Jetons reconnus, avec ce qu'ils deviennent : sert d'aide dans la fenêtre d'envoi groupé. */
export const JETONS_MODELE: Array<{ jeton: string; aide: string }> = [
  { jeton: 'operation', aide: 'Nom de l\'opération' },
  { jeton: 'entreprise', aide: 'Nom de l\'entreprise destinataire' },
  { jeton: 'lots', aide: 'Lots de l\'entreprise (liste)' },
  { jeton: 'lots_courts', aide: 'Lots de l\'entreprise, en une ligne (Lot 01, Lot 02)' },
  { jeton: 'pieces_marche', aide: 'Pièces du marché jointes (RC, CCAP, acte d\'engagement)' },
  { jeton: 'pieces_dossier', aide: 'Pièces du dossier et indices de révision' },
  { jeton: 'visite', aide: 'Visite de site : créneau de l\'entreprise (ou créneaux proposés), lieu et consignes' },
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
  const qr = d.questionReponse;
  const questionReponse = qr
    ? [...(qr.objet ? [`Objet : ${qr.objet}`] : []), `Question : ${qr.question}`, '', `Réponse : ${qr.reponse}`].join('\n')
    : '';
  const depot = d.lienDepot
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
