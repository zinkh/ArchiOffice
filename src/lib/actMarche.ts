// ── Documents contractuels du marché de travaux (module ACT) ─────────────────
// Trois pièces produites à partir de la consultation :
//   - le règlement de consultation (RC) ;
//   - le CCAP, d'après le modèle de CCAP d'un marché de travaux privés
//     (norme AFNOR P 03-001, annexes de l'Ordre des architectes) ;
//   - l'acte d'engagement, un par lot et par entreprise.
// Ce module ne fait que construire un contenu structuré (`DocModele`) : le rendu
// PDF et Word est dans `actMarcheExport.ts`. Une information absente est
// rendue par des points de suspension, jamais inventée.
import { montantEnLettres } from './numberToFrenchWords';
import { PARAMETRES_DEFAUT, type DonneesNegociation, type PieceAttendue } from './actNegociation';

export const POINTILLES = '……';

/** Réglages du marché, enregistrés dans `consultation.marche` (jsonb, sans migration). */
export interface ParametresMarche {
  nature_travaux?: string;
  lieu_construction?: string;
  permis_numero?: string;
  permis_date?: string;
  habitation_neuve?: boolean;
  moa_nom?: string;
  moa_adresse?: string;
  moa_representant?: string;
  moe_mission?: string;
  sps_nom?: string;
  sps_adresse?: string;
  controle_technique?: string;
  opc_par_moe?: boolean;
  penalite_retard?: string;
  penalite_absence_eur?: number;
  penalite_documents_eur?: number;
  delai_execution_mois?: number;
  jours_intemperies?: number;
  periode_preparation_jours?: number;
  piquetage_general?: string;
  piquetage_enterres?: string;
  retenue_garantie_pct?: number;
  caution_delai_mois?: number;
  acompte_delai_jours?: number;
  solde_delai_jours?: number;
  financement_pret?: boolean;
  seuil_pret_ttc?: number;
  validite_offre_pret_jours?: number;
  delai_condition_pret_jours?: number;
  seuil_garantie_paiement_ht?: number;
  conditions_diverses?: string;
  lieu_signature?: string;
  date_signature?: string;
  // Règlement de consultation
  rc_procedure?: string;
  rc_date_limite?: string;
  rc_heure_limite?: string;
  rc_mode_remise?: string;
  rc_validite_offres_jours?: number;
  rc_variantes?: boolean;
  rc_negociation?: boolean;
  rc_visite_site?: string;
  rc_contact?: string;
}

export const PARAMETRES_MARCHE_DEFAUT: Required<Pick<ParametresMarche,
  'habitation_neuve' | 'opc_par_moe' | 'controle_technique' | 'penalite_retard' | 'jours_intemperies' |
  'retenue_garantie_pct' | 'caution_delai_mois' | 'acompte_delai_jours' | 'solde_delai_jours' |
  'financement_pret' | 'seuil_pret_ttc' | 'seuil_garantie_paiement_ht' | 'rc_validite_offres_jours' |
  'rc_variantes' | 'rc_negociation' | 'rc_procedure'>> = {
  habitation_neuve: false,
  opc_par_moe: true,
  controle_technique: '',
  penalite_retard: '1/3000e',
  jours_intemperies: 10,
  retenue_garantie_pct: 5,
  caution_delai_mois: 12,
  acompte_delai_jours: 30,
  solde_delai_jours: 45,
  financement_pret: false,
  seuil_pret_ttc: 21500,
  seuil_garantie_paiement_ht: 12000,
  rc_validite_offres_jours: 90,
  rc_variantes: false,
  rc_negociation: true,
  rc_procedure: 'Consultation d\'entreprises sur marché privé, en lots séparés',
};

export function parametresMarcheDe(c: { marche?: ParametresMarche }): ParametresMarche {
  return { ...PARAMETRES_MARCHE_DEFAUT, ...(c.marche ?? {}) };
}

// ── Contenu structuré ────────────────────────────────────────────────────────

export type Bloc =
  | { t: 'h'; text: string }
  | { t: 'sh'; text: string }
  | { t: 'p'; text: string }
  | { t: 'li'; text: string }
  | { t: 'kv'; rows: [string, string][] }
  | { t: 'sign'; labels: string[] };

export interface DocModele {
  titre: string;
  sousTitre?: string;
  reference?: string;
  blocs: Bloc[];
}

export interface ContexteMarche {
  operation: { nom: string; code?: string; adresse?: string };
  params: ParametresMarche;
  agence: { nom?: string; adresse?: string };
}

const v = (s?: string | number | null): string => (s === undefined || s === null || `${s}`.trim() === '' ? POINTILLES : `${s}`);
const dateFr = (iso?: string) => {
  if (!iso) return POINTILLES;
  const [a, m, j] = iso.split('-');
  return a && m && j ? `${j}/${m}/${a}` : iso;
};

/** Montant avec espace ordinaire : l'espace fine de `Intl` est absente des polices de jsPDF. */
export const eurosTxt = (n: number | null | undefined): string =>
  n == null ? POINTILLES : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n).replace(/[  ]/g, ' ');

const nombre = (n?: number, repli = POINTILLES) => (n === undefined || n === null || Number.isNaN(n) ? repli : String(n));

// ── Règlement de consultation ────────────────────────────────────────────────

export interface EntreesRC {
  dce: { nom: string; type_doc: string }[];
  piecesAdmin: PieceAttendue[];
  piecesOffre: PieceAttendue[];
  criteres: { nom: string; poids: number }[];
  lots: { numero: string; titre: string }[];
}

export function construireRC(ctx: ContexteMarche, e: EntreesRC): DocModele {
  const p = { ...PARAMETRES_MARCHE_DEFAUT, ...ctx.params };
  const blocs: Bloc[] = [];
  blocs.push({ t: 'kv', rows: [
    ['Maître d\'ouvrage', v(p.moa_nom)],
    ['Opération', ctx.operation.nom + (ctx.operation.code ? ` (${ctx.operation.code})` : '')],
    ['Lieu des travaux', v(p.lieu_construction || ctx.operation.adresse)],
    ['Maîtrise d\'œuvre', [ctx.agence.nom, ctx.agence.adresse].filter(Boolean).join(', ') || POINTILLES],
    ['Date limite de remise des offres', `${dateFr(p.rc_date_limite)}${p.rc_heure_limite ? ` à ${p.rc_heure_limite}` : ''}`],
  ] });

  blocs.push({ t: 'h', text: '1. Objet de la consultation' });
  blocs.push({ t: 'p', text: `La présente consultation porte sur ${v(p.nature_travaux)}, situés ${v(p.lieu_construction || ctx.operation.adresse)}.` });
  if (p.permis_numero || p.permis_date) {
    blocs.push({ t: 'p', text: `Permis de construire n° ${v(p.permis_numero)}, délivré le ${dateFr(p.permis_date)}.` });
  }
  blocs.push({ t: 'p', text: `Procédure : ${p.rc_procedure}.` });
  if (e.lots.length) {
    blocs.push({ t: 'p', text: 'Les travaux sont décomposés en lots, chaque lot faisant l\'objet d\'un marché distinct :' });
    e.lots.forEach(l => blocs.push({ t: 'li', text: `Lot ${l.numero} : ${l.titre}` }));
  }

  blocs.push({ t: 'h', text: '2. Conditions de la consultation' });
  blocs.push({ t: 'p', text: `Les prix sont globaux, forfaitaires, fermes et actualisables. Le marché est conclu par lot et par entreprise, ou par un groupement d'entreprises solidaires ayant un mandataire commun.` });
  blocs.push({ t: 'p', text: p.rc_variantes
    ? 'Les variantes sont autorisées. Elles doivent être présentées sur un document distinct, en complément de l\'offre de base conforme au dossier de consultation.'
    : 'Les variantes ne sont pas autorisées. Les options éventuelles sont chiffrées séparément de l\'offre de base.' });
  blocs.push({ t: 'p', text: `Les offres restent valables ${nombre(p.rc_validite_offres_jours)} jours à compter de la date limite de remise.` });
  blocs.push({ t: 'p', text: p.rc_negociation
    ? 'Le maître d\'ouvrage se réserve la possibilité de négocier avec tout ou partie des candidats, et de ne pas attribuer certains lots.'
    : 'Le maître d\'ouvrage choisit l\'offre sans négociation, et se réserve la possibilité de ne pas attribuer certains lots.' });
  blocs.push({ t: 'p', text: 'Le délai global d\'exécution est fixé par l\'acte d\'engagement et ne peut être modifié par le candidat.' });

  blocs.push({ t: 'h', text: '3. Contenu du dossier de consultation' });
  if (e.dce.length) {
    blocs.push({ t: 'p', text: 'Le dossier de consultation des entreprises comprend :' });
    e.dce.forEach(d => blocs.push({ t: 'li', text: `${d.nom} (${d.type_doc})` }));
  } else {
    blocs.push({ t: 'p', text: `Le dossier de consultation des entreprises comprend : ${POINTILLES}` });
  }

  blocs.push({ t: 'h', text: '4. Présentation des offres' });
  blocs.push({ t: 'p', text: 'Chaque candidat remet un dossier rédigé en français, comprenant :' });
  blocs.push({ t: 'sh', text: 'Pièces administratives' });
  (e.piecesAdmin.length ? e.piecesAdmin : [{ id: '-', nom: POINTILLES }]).forEach(x => blocs.push({ t: 'li', text: x.nom }));
  blocs.push({ t: 'sh', text: 'Pièces de l\'offre' });
  (e.piecesOffre.length ? e.piecesOffre : [{ id: '-', nom: POINTILLES }]).forEach(x => blocs.push({ t: 'li', text: x.nom }));

  blocs.push({ t: 'h', text: '5. Jugement des offres' });
  blocs.push({ t: 'p', text: 'Les offres conformes sont jugées lot par lot selon les critères pondérés suivants :' });
  if (e.criteres.length) e.criteres.forEach(c => blocs.push({ t: 'li', text: `${c.nom || POINTILLES} : ${c.poids} %` }));
  else blocs.push({ t: 'li', text: POINTILLES });
  blocs.push({ t: 'p', text: 'Une offre incomplète, non conforme au dossier de consultation ou dont le prix est anormalement bas pourra être écartée.' });

  blocs.push({ t: 'h', text: '6. Remise des offres' });
  blocs.push({ t: 'p', text: `Les offres sont remises au plus tard le ${dateFr(p.rc_date_limite)}${p.rc_heure_limite ? ` à ${p.rc_heure_limite}` : ''}, ${v(p.rc_mode_remise)}.` });
  blocs.push({ t: 'p', text: 'Toute offre reçue après cette date et cette heure sera renvoyée à son auteur sans avoir été ouverte.' });

  blocs.push({ t: 'h', text: '7. Renseignements complémentaires' });
  blocs.push({ t: 'p', text: `Les demandes de renseignements sont adressées par écrit à : ${v(p.rc_contact)}. Les réponses sont communiquées à l'ensemble des candidats.` });
  blocs.push({ t: 'p', text: `Visite du site : ${v(p.rc_visite_site)}.` });

  blocs.push({ t: 'sign', labels: ['Le candidat (cachet, date et signature)'] });
  return { titre: 'RÈGLEMENT DE CONSULTATION', sousTitre: `${ctx.operation.nom}`, reference: ctx.operation.code, blocs };
}

// ── CCAP ─────────────────────────────────────────────────────────────────────

export function construireCCAP(ctx: ContexteMarche): DocModele {
  const p = { ...PARAMETRES_MARCHE_DEFAUT, ...ctx.params };
  const b: Bloc[] = [];
  const art = (titre: string) => b.push({ t: 'h', text: titre });
  const sub = (titre: string) => b.push({ t: 'sh', text: titre });
  const para = (text: string) => b.push({ t: 'p', text });
  const li = (text: string) => b.push({ t: 'li', text });

  para('Établi selon la norme AFNOR P 03-001 relative au cahier des clauses administratives générales applicable aux travaux de bâtiment faisant l\'objet de marchés privés (CCAG).');

  art('1. Le marché');
  sub('1.1 Objet');
  b.push({ t: 'kv', rows: [
    ['Nature des travaux', v(p.nature_travaux)],
    ['Lieu de construction', v(p.lieu_construction || ctx.operation.adresse)],
    ['Permis de construire', `n° ${v(p.permis_numero)}, délivré le ${dateFr(p.permis_date)}`],
  ] });
  if (p.habitation_neuve) {
    para('Lorsqu\'il est signé pour la construction d\'un immeuble neuf d\'habitation, le marché de travaux ne devient définitif qu\'au terme d\'un délai de 7 jours pendant lequel l\'acquéreur non professionnel a la faculté de se rétracter. Le marché est adressé par lettre recommandée avec demande d\'avis de réception. La faculté de rétractation est exercée dans ces mêmes formes (articles L.231-4, L.271-1 et L.271-2 du code de la construction et de l\'habitation).');
  }
  sub('1.2 Désignation des parties');
  para(`Ce marché est conclu entre ${v(p.moa_nom)}${p.moa_adresse ? `, ${p.moa_adresse}` : ''}${p.moa_representant ? `, représenté par ${p.moa_representant}` : ''}, désigné ci-après le maître d'ouvrage,`);
  para(`assisté de ${v(ctx.agence.nom)}${ctx.agence.adresse ? ` (${ctx.agence.adresse})` : ''}, architecte chargé de ${v(p.moe_mission)}, désigné ci-après le maître d'œuvre,`);
  para('et l\'entreprise désignée à l\'acte d\'engagement, désignée ci-après l\'entrepreneur.');
  sub('1.3 Contrôle technique');
  para(p.controle_technique ? `Le contrôle technique est assuré par ${p.controle_technique}.` : 'Sans objet.');
  sub('1.4 Coordination sécurité');
  para(`La coordination en matière de sécurité et de protection de la santé est assurée par ${v(p.sps_nom)}${p.sps_adresse ? ` (${p.sps_adresse})` : ''}.`);
  sub('1.5 Coordination de chantier (OPC)');
  para(p.opc_par_moe
    ? 'La coordination de chantier est assurée par la personne chargée de la maîtrise d\'œuvre du chantier.'
    : 'Sans objet : aucune mission d\'ordonnancement, pilotage et coordination n\'est confiée à un tiers.');
  sub('1.6 Documents constituant le marché');
  para('Les pièces constituant le marché, prévalant les unes sur les autres dans l\'ordre où elles sont énumérées ci-après :');
  li('1. L\'acte d\'engagement accepté et ses éventuelles annexes.');
  li('2. Le présent CCAP.');
  li('3. Le cahier des clauses techniques particulières (CCTP), comprenant le devis descriptif et les prescriptions communes à tous les corps d\'état, ainsi que les plans et dessins.');
  li('4. Le calendrier prévisionnel général d\'exécution, complété éventuellement par le calendrier détaillé d\'exécution.');
  para('Pièces non jointes au marché : le cahier des clauses administratives générales applicables aux travaux de bâtiment faisant l\'objet de marchés privés, norme NF P 03-001, appelé « CCAG » dans le présent document.');
  para('Pièce annexée au marché : la décomposition du prix global et forfaitaire (DPGF). Ce document n\'est pas contractuel, mais est utilisé pour l\'établissement des situations de travaux et pour l\'évaluation des travaux modificatifs.');
  sub('1.7 Sous-traitance');
  para('Conformément à l\'article 4.4 du CCAG, l\'entrepreneur qui sous-traite l\'exécution de certaines prestations de son marché doit adresser au maître d\'ouvrage sa demande de sous-traitance par lettre recommandée avec avis de réception ou la remettre contre reçu. Si le maître d\'ouvrage n\'a pas répondu à cette demande dans un délai de 15 jours à compter de sa réception, l\'acceptation et l\'agrément des conditions de paiement du sous-traitant sont réputés acquis.');

  art('2. Représentation des parties, communication entre elles');
  sub('2.1 Présence aux rendez-vous de chantier');
  para('L\'entrepreneur ou le mandataire commun ou le représentant unique est tenu d\'assister aux rendez-vous de chantier provoqués par le maître d\'œuvre ou d\'y déléguer un agent qui a pouvoir pour donner sur-le-champ les ordres nécessaires sur le chantier.');
  para('Le maître d\'œuvre détermine en début de travaux le rythme des rendez-vous de chantier. Le programme de participation de l\'entrepreneur aux rendez-vous de chantier doit tenir compte du montant et de la nature des travaux.');
  sub('2.2 Comptes-rendus');
  para('Les prescriptions contenues dans les comptes-rendus de réunions de chantier sont applicables sauf contestation écrite de la part de l\'entrepreneur dans un délai de 5 jours à compter de leur réception, par dérogation à l\'article 15.2.1 du CCAG. Les comptes-rendus sont transmis soit par lettre, soit par télécopie, soit par courriel.');

  art('3. Rémunération');
  sub('3.1 Prix du marché');
  para('Le marché est passé à prix GLOBAL, FORFAITAIRE, FERME et actualisable.');
  para('L\'entrepreneur reconnaît formellement que les prix figurant au présent marché, qu\'il s\'agisse de prix forfaitaires globaux ou de prix unitaires des bordereaux, tiennent compte :');
  li('de toutes les prescriptions, garanties, sujétions et obligations résultant de ce marché, y compris les impôts, taxes et redevances de toute nature existant à la date de signature de l\'acte d\'engagement ;');
  li('de toutes les charges et de tous les aléas pouvant résulter de l\'exécution des travaux, notamment des circonstances locales, de la situation géographique du chantier (frais de transport du personnel, du matériel et des matériaux, indemnité de déplacement et de panier, surveillance du chantier, etc.) ;');
  li('du bénéfice de l\'entrepreneur.');
  para('La rémunération des travaux modificatifs acceptés par le maître d\'ouvrage tient compte des mêmes éléments.');

  art('4. Pénalités');
  sub('4.1 Pénalités de retard');
  para(`La pénalité prévue à l'article 9.5 du CCAG est fixée à ${v(p.penalite_retard)} du montant TTC du marché par jour calendaire de retard. Par dérogation au CCAG, elle est appliquée sans qu'il soit besoin d'une mise en demeure préalable et est plafonnée à 15 % du montant du marché.`);
  sub('4.2 Retenues en cours de travaux');
  para('En cas de constat par le maître d\'œuvre de retards partiels en cours d\'exécution des travaux, une retenue, dont le montant est égal à la pénalité définie à l\'article 4.1, est appliquée sur la situation de la période où a été constaté le retard. Les sommes ainsi retenues sont reversées à l\'entrepreneur, en fin de travaux, s\'il a respecté le délai global d\'exécution. Sinon, ces retenues deviennent des pénalités de retard définitives.');
  sub('4.3 Absence à une réunion');
  para(`Toute absence non explicitée par un motif sérieux de l'entrepreneur à une réunion de chantier à laquelle il aura été dûment convoqué sera passible de l'application d'une pénalité forfaitaire de ${p.penalite_absence_eur != null ? eurosTxt(p.penalite_absence_eur) : `${POINTILLES} €`} TTC.`);
  sub('4.4 Retard dans la remise des documents');
  para(`Tout retard dans la remise des documents par rapport aux délais prescrits par l'article 7.4 du CCAG (échantillons de matériaux, plans d'exécution, notes de calculs, etc.) sera passible d'une pénalité de ${p.penalite_documents_eur != null ? eurosTxt(p.penalite_documents_eur) : `${POINTILLES} €`} TTC par jour calendaire de retard.`);

  art('5. Délais');
  sub('5.1 Calendrier prévisionnel général d\'exécution');
  para('Le délai global d\'exécution de l\'ensemble des lots est fixé dans l\'acte d\'engagement :');
  li(`il est établi en tenant compte de ${nombre(p.jours_intemperies)} jours d'intempéries prévisibles ;`);
  li('il est établi en tenant compte des périodes de congés payés ;');
  li('il ne tient pas compte de la période de préparation prévue à l\'acte d\'engagement par dérogation au CCAG.');
  para('Les délais d\'exécution de chaque lot s\'inscrivent dans le délai global d\'exécution, conformément au calendrier prévisionnel général d\'exécution. Ils partent de la première intervention de l\'entrepreneur sur le chantier et expirent en même temps que sa dernière intervention.');
  sub('5.2 Calendrier détaillé d\'exécution');
  para('Le calendrier détaillé d\'exécution distingue les différents ouvrages ou groupes d\'ouvrages dont la construction fait l\'objet des travaux. Il indique en outre, pour chacun des lots, la durée et la date probable de départ des délais particuliers correspondant aux interventions successives de l\'entrepreneur sur le chantier.');
  para('Il est établi par le maître d\'œuvre en concertation avec les entrepreneurs pendant la période de préparation du chantier. Il doit s\'inscrire dans les limites du calendrier prévisionnel général d\'exécution. À défaut d\'accord sur le calendrier détaillé, le calendrier prévisionnel devient contractuel.');

  art('6. Travaux modificatifs');
  para('Si les travaux modificatifs sont assimilables à des ouvrages prévus au marché ils seront réglés en utilisant les prix unitaires figurant dans la DPGF, dans le cas contraire, ils seront réglés sur la base de prix nouveaux à déterminer avant exécution à partir des mêmes bases que celles de la DPGF.');
  para('Les travaux modificatifs doivent faire l\'objet d\'un accord préalable écrit du maître d\'ouvrage.');

  art('7. Hygiène, sécurité, protection de la santé');
  para('Les obligations de l\'entrepreneur sont définies à l\'article 5 du CCAG.');

  art('8. Dépenses d\'intérêt commun, compte prorata');
  para('Les dispositions de l\'article 14 du CCAG s\'appliquent.');

  art('9. Préparation de l\'exécution');
  sub('9.1 Période de préparation, programme d\'exécution des travaux');
  para(`Une période de préparation de ${nombre(p.periode_preparation_jours)} jours est prévue à compter de la notification du marché et préalablement à la délivrance de l'ordre de service de démarrage des travaux signé par le maître d'ouvrage. Durant cette période, l'entrepreneur, y compris ses sous-traitants, devra établir et présenter au visa du maître d'œuvre les documents d'exécution des travaux.`);
  sub('9.2 Plans d\'exécution, notes de calculs, études de détail');
  para('L\'entrepreneur établira ou fera établir, s\'il y a lieu, par les entrepreneurs spécialisés, tous dessins d\'exécution, calepins, épures, tracés, détails, ainsi que toutes notes de calcul, notes explicatives et notes justificatives nécessaires à l\'exécution des travaux. Le maître d\'œuvre dispose d\'un délai de quinze jours pour donner son accord ou formuler ses observations.');
  sub('9.3 Implantation');
  para(`Le piquetage général de la construction est assuré par le lot n° 1 ${v(p.piquetage_general)}. Le piquetage spécial des ouvrages souterrains ou enterrés est effectué par ${v(p.piquetage_enterres)}.`);

  art('10. Réception');
  sub('10.1 Réception');
  para('La réception a lieu à l\'achèvement de l\'ensemble des travaux. L\'entrepreneur chargé d\'aviser le maître d\'ouvrage et le maître d\'œuvre de la date à laquelle ces travaux sont considérés comme achevés est l\'entrepreneur titulaire du lot n° 1.');
  para('Chaque entrepreneur est tenu d\'aviser le maître d\'ouvrage et le maître d\'œuvre de la date à laquelle l\'ensemble de ses travaux est achevé. Postérieurement à cette information, la procédure de réception se déroule, simultanément pour tous les lots considérés, comme il est stipulé à l\'article 17 du CCAG.');
  sub('10.2 Levées des réserves');
  para('Lorsque les procès-verbaux de réception font état de réserves, par dérogation à l\'article 17.2.5 l\'entrepreneur dispose d\'un délai fixé au procès-verbal de réception pour reprendre les travaux concernés.');

  art('11. Constatation des droits à paiement');
  sub('11.1 État de situation');
  para('L\'entrepreneur remet chaque mois au maître d\'œuvre un état de situation. Cet état d\'acompte est présenté sous forme cumulative de l\'avancement des travaux.');
  sub('11.2 Paiements');
  para(`Acomptes : dans les ${nombre(p.acompte_delai_jours)} jours à compter de la remise de l'état de situation au maître d'œuvre, les acomptes sont payés à l'entrepreneur et, s'il y a sous-traitance et délégation, au sous-traitant.`);
  para(`Solde : dans les ${nombre(p.solde_delai_jours)} jours après l'expiration du délai défini à l'article 19.6.2 du CCAG pour la signification du décompte définitif, est dû le paiement du solde, amputé de la retenue de garantie constituée comme il est dit à l'article 20.5 du CCAG.`);
  para(`Retenue de garantie : elle correspond à ${nombre(p.retenue_garantie_pct)} % du montant HT des travaux. Elle est consignée entre les mains du maître d'ouvrage, sauf présentation d'une caution par l'entrepreneur. La caution est libérée ou les sommes consignées sont versées à l'entrepreneur dans un délai de ${nombre(p.caution_delai_mois)} mois à compter de la date de réception (au plus tard à l'expiration du délai d'une année à compter de la date de réception faite avec ou sans réserves).`);
  para('Intérêts moratoires : après mise en demeure par lettre recommandée avec avis de réception, les retards de paiement ouvrent droit, pour l\'entrepreneur, au paiement d\'intérêts moratoires à un taux qui sera le taux d\'intérêt légal augmenté de 7 points.');

  art('12. Financement');
  if (p.financement_pret) {
    para('Dans le cas où le maître d\'ouvrage entend acquitter le prix en totalité ou en partie au moyen d\'un prêt, les dispositions suivantes sont applicables.');
    sub(`12.1 Le montant de l'opération ne dépasse pas ${eurosTxt(p.seuil_pret_ttc)} TTC`);
    para('L\'engagement du maître d\'ouvrage au titre du présent marché est subordonné à l\'acceptation par lui de l\'offre du prêteur et à la non rétractation de cette acceptation dans les 7 jours qui suivent. Le maître d\'ouvrage s\'engage à informer, par écrit, l\'entrepreneur dans un délai de 3 jours suivant l\'expiration du délai de rétractation, de l\'attribution définitive du prêt.');
    para(`En tout état de cause, la durée de validité de l'offre de l'entrepreneur est limitée à ${nombre(p.validite_offre_pret_jours)} jours à compter de la date figurant sur le présent marché.`);
    sub(`12.2 Le montant des travaux dépasse ${eurosTxt(p.seuil_pret_ttc)} TTC`);
    para(`Le marché est conclu sous la condition suspensive d'obtention du prêt sollicité dans un délai de ${nombre(p.delai_condition_pret_jours)} jours à compter de la date figurant sur le présent marché (au moins un mois). Le maître d'ouvrage s'engage à informer, par écrit, l'entrepreneur de l'obtention du prêt sollicité au plus tard dans les 3 jours suivant l'expiration du délai indiqué ci-dessus.`);
  } else {
    para('Sans objet : le maître d\'ouvrage acquitte le prix sans recours à un prêt.');
  }

  art('13. Garantie de paiement');
  para(`Conformément aux dispositions de l'article 1799-1 du code civil, rappelées dans l'article 20.9 du CCAG, le maître d'ouvrage doit garantir le paiement des sommes dues à l'entrepreneur lorsque le montant des travaux, déduction faite de l'acompte versé à la commande, est supérieur à ${eurosTxt(p.seuil_garantie_paiement_ht)} HT.`);
  para('Cette garantie peut prendre deux formes : le paiement direct par l\'établissement de crédit lorsque les travaux sont entièrement financés par un crédit spécifique, ou la garantie conventionnelle ou cautionnement solidaire lorsque le maître d\'ouvrage ne recourt pas à un crédit spécifique ou lorsqu\'il y recourt partiellement.');

  art('14. Assurances');
  para('Avant tout commencement d\'exécution, l\'entrepreneur ainsi que les co-traitants doivent justifier qu\'ils sont assurés. L\'attestation de la compagnie d\'assurance portant mention de l\'étendue de la garantie est jointe au présent marché.');

  art('15. Résiliation');
  para('Le marché peut être résilié dans les conditions et formes définies à l\'article 22 du CCAG.');

  art('16. Tribunal compétent');
  para('Les litiges sont portés devant les tribunaux du lieu d\'exécution des travaux.');

  art('17. Conditions diverses');
  para(p.conditions_diverses?.trim() || POINTILLES);

  para(`Fait à ${v(p.lieu_signature)}, le ${dateFr(p.date_signature)}, en ${POINTILLES} originaux.`);
  b.push({ t: 'sign', labels: ['Signature du maître d\'ouvrage', 'Signature de l\'entrepreneur'] });

  return { titre: 'CAHIER DES CLAUSES ADMINISTRATIVES PARTICULIÈRES (CCAP)', sousTitre: `Marché de travaux privés : ${ctx.operation.nom}`, reference: ctx.operation.code, blocs: b };
}

// ── Acte d'engagement ────────────────────────────────────────────────────────

export interface EntrepriseActe {
  nom: string;
  representant?: string;
  siege?: string;
  siret?: string;
  ape?: string;
  rcs?: string;
}

export interface EntreesActe {
  lot: { numero: string; titre: string };
  entreprise: EntrepriseActe | null;
  montantHT: number | null;
  tvaPct: number;
  fraisNonInclus?: string;
}

export function construireActeEngagement(ctx: ContexteMarche, e: EntreesActe): DocModele {
  const p = { ...PARAMETRES_MARCHE_DEFAUT, ...ctx.params };
  const ent = e.entreprise;
  const tva = e.montantHT == null ? null : Math.round(e.montantHT * e.tvaPct) / 100;
  const ttc = e.montantHT == null || tva == null ? null : Math.round((e.montantHT + tva) * 100) / 100;
  const tvaTxt = (e.tvaPct || PARAMETRES_DEFAUT.tva_pct).toString().replace('.', ',');
  const b: Bloc[] = [];

  b.push({ t: 'kv', rows: [
    ['Maître d\'ouvrage', v(p.moa_nom)],
    ['Représenté par', v(p.moa_representant)],
    ['Adresse', v(p.moa_adresse)],
    ['Opération', ctx.operation.nom + (ctx.operation.code ? ` (${ctx.operation.code})` : '')],
    ['Lot n°', `${e.lot.numero} : ${e.lot.titre}`],
    ['Entreprise', v(ent?.nom)],
  ] });

  b.push({ t: 'h', text: 'Article 1. Identification de l\'entreprise' });
  b.push({ t: 'p', text: `Je soussigné, ${v(ent?.representant)}, agissant au nom et pour le compte de l'entreprise ${v(ent?.nom)}, ayant son siège ${v(ent?.siege)}, immatriculée au RCS ou au répertoire des métiers :` });
  b.push({ t: 'kv', rows: [
    ['Numéro d\'identité d\'établissement (SIRET)', v(ent?.siret)],
    ['Code d\'activité économique principale (APE)', v(ent?.ape)],
    ['Numéro d\'inscription au registre du commerce', v(ent?.rcs)],
  ] });
  b.push({ t: 'p', text: `Après avoir pris connaissance du cahier des clauses administratives particulières (CCAP) et des documents qui y sont mentionnés, relatifs aux travaux nécessaires à ${v(p.nature_travaux)} situés ${v(p.lieu_construction || ctx.operation.adresse)}, pour le compte de ${v(p.moa_nom)}${p.moa_representant ? `, représenté par ${p.moa_representant}` : ''},` });
  b.push({ t: 'p', text: `je m'engage sans réserve, conformément aux stipulations des documents visés ci-dessus, à exécuter les travaux concernant le lot n° ${e.lot.numero} (${e.lot.titre}) dans les conditions ci-après définies.` });

  b.push({ t: 'h', text: 'Article 2. Prix' });
  b.push({ t: 'kv', rows: [
    ['Prix global forfaitaire, ferme, des travaux HT', eurosTxt(e.montantHT)],
    [`TVA au taux de ${tvaTxt} %`, eurosTxt(tva)],
    ['Total TTC', eurosTxt(ttc)],
  ] });
  if (ttc != null) b.push({ t: 'p', text: `Soit, en lettres, ${montantEnLettres(ttc)} toutes taxes comprises.` });
  b.push({ t: 'p', text: `Frais et prestations à la charge du maître d'ouvrage et qui ne sont pas inclus dans le prix : ${e.fraisNonInclus?.trim() || POINTILLES}` });

  b.push({ t: 'h', text: 'Article 3. Délais' });
  b.push({ t: 'p', text: `Conformément à l'article 5 du CCAP, le délai global d'exécution des travaux est de ${nombre(p.delai_execution_mois)} mois à compter de la date fixée par l'ordre de service délivré au lot n° 1 et communiqué à toutes les entreprises.` });
  b.push({ t: 'p', text: 'Mon propre délai d\'exécution sera déterminé dans les conditions prévues à cet article 5.' });
  b.push({ t: 'p', text: `Fait à ${POINTILLES}, le ${POINTILLES}.` });
  b.push({ t: 'sign', labels: ['Signature de l\'entrepreneur'] });

  b.push({ t: 'h', text: 'Article 4. Notification' });
  b.push({ t: 'p', text: 'Est acceptée la présente offre pour valoir acte d\'engagement.' });
  b.push({ t: 'p', text: `À ${v(p.lieu_signature)}, le ${dateFr(p.date_signature)}.` });
  b.push({ t: 'sign', labels: ['Signature du maître d\'ouvrage'] });

  return { titre: 'ACTE D\'ENGAGEMENT', sousTitre: `Lot n° ${e.lot.numero} : ${e.lot.titre}`, reference: ctx.operation.code, blocs: b };
}

/** Compatibilité de type avec la consultation : seules les clés lues ici comptent. */
export type ConsultationMarche = DonneesNegociation & { marche?: ParametresMarche };
