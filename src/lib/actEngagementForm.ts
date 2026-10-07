// ── Acte d'engagement : formulaire PDF à remplir par chaque entreprise ───────
// Un seul document par opération, identique pour toutes les entreprises : elle
// le complète (champs de formulaire PDF) puis le retourne signé. Les noms de
// champs sont STABLES (`ae_*`), car c'est ce qui permet de relire le formulaire
// rempli (`lireActeFormulaire`) : ne pas les renommer sans changer la version.
//
// Un lot par ligne du tableau des prix, repéré par son numéro dans le nom du
// champ : une entreprise peut se porter candidate sur plusieurs lots avec un
// seul acte.
import type { AgencySettings } from './proposalExport';
import { drawAgencyFooters, drawAgencyHeader, loadLogoDataUrl } from './pdfLetterhead';
import { POINTILLES, type ContexteMarche } from './actMarche';

export const AE_FORM_VERSION = 1;
/** Repère posé dans les mots-clés du PDF : reconnaît un acte d'engagement ArchiOffice. */
export const AE_KEYWORD = `archioffice-acte-engagement-v${AE_FORM_VERSION}`;

export const CHAMPS_ENTREPRISE = [
  { cle: 'entreprise', libelle: 'Dénomination sociale' },
  { cle: 'representant', libelle: 'Nom et prénom du signataire' },
  { cle: 'qualite', libelle: 'Qualité du signataire' },
  { cle: 'siege', libelle: 'Adresse du siège' },
  { cle: 'siret', libelle: 'SIRET' },
  { cle: 'ape', libelle: 'Code APE' },
  { cle: 'rcs', libelle: 'N° d\'inscription au RCS ou au répertoire des métiers' },
  { cle: 'email', libelle: 'E-mail' },
  { cle: 'telephone', libelle: 'Téléphone' },
] as const;

export type CleEntreprise = typeof CHAMPS_ENTREPRISE[number]['cle'];

/** Numéro de lot utilisable dans un nom de champ PDF. */
export const cleLot = (numero: string) => numero.trim().replace(/[^A-Za-z0-9]+/g, '_');

export const nomChamp = {
  entreprise: (cle: CleEntreprise) => `ae_${cle}`,
  tva: 'ae_tva_taux',
  frais: 'ae_frais_non_inclus',
  lieu: 'ae_lieu',
  date: 'ae_date',
  lotCandidat: (numero: string) => `ae_lot_${cleLot(numero)}_candidat`,
  lotPrix: (numero: string) => `ae_lot_${cleLot(numero)}_prix_ht`,
  lotDelai: (numero: string) => `ae_lot_${cleLot(numero)}_delai_mois`,
};

export interface LotFormulaire { numero: string; titre: string }

// ── Génération ───────────────────────────────────────────────────────────────

const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FOND: [number, number, number] = [235, 236, 238];
const GRIS_TRAIT: [number, number, number] = [150, 150, 150];
const M = 16;

/**
 * Fabrique le formulaire. `valeurs` (nom de champ → texte, ou true pour une case
 * cochée) ne sert qu'aux tests, pour produire un formulaire déjà rempli.
 */
export async function genererActeFormulaire(
  ctx: ContexteMarche, lots: LotFormulaire[], tvaPct: number, settings: AgencySettings,
  valeurs: Record<string, string | boolean> = {},
): Promise<ArrayBuffer> {
  const [{ jsPDF, AcroFormTextField, AcroFormCheckBox }, logo] = await Promise.all([import('jspdf'), loadLogoDataUrl(settings.logoUrl)]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const p = ctx.params;
  const W = pdf.internal.pageSize.getWidth() - M * 2;
  const entete = { title: 'Acte d\'engagement', subtitle: ctx.operation.nom, reference: ctx.operation.code, logo, margin: M };
  let y = drawAgencyHeader(pdf, settings, entete);
  const BAS = 281;
  const place = (h: number) => { if (y + h > BAS) { pdf.addPage(); y = drawAgencyHeader(pdf, settings, entete); } };

  pdf.setProperties({
    title: `Acte d'engagement ${ctx.operation.nom}`,
    subject: ctx.operation.code ?? ctx.operation.nom,
    keywords: AE_KEYWORD,
  });

  const texte = (txt: string, o: { gras?: boolean; taille?: number; couleur?: [number, number, number]; x?: number; largeur?: number; apres?: number } = {}) => {
    const t = o.taille ?? 9.5;
    pdf.setFont('helvetica', o.gras ? 'bold' : 'normal'); pdf.setFontSize(t); pdf.setTextColor(...(o.couleur ?? GRIS_TEXTE));
    const lignes = pdf.splitTextToSize(txt, o.largeur ?? W) as string[];
    for (const l of lignes) { place(t * 0.4); pdf.text(l, o.x ?? M, y + t * 0.32); y += t * 0.4; }
    y += o.apres ?? 1.6;
  };
  const titre = (txt: string) => {
    place(14); y += 3;
    pdf.setFillColor(...GRIS_FOND); pdf.rect(M, y - 1, W, 7, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(...GRIS_TEXTE);
    pdf.text(txt.toUpperCase(), M + 2, y + 4); y += 9;
  };

  const champTexte = (nom: string, x: number, top: number, w: number, h = 6.5, multiligne = false, defaut = '') => {
    pdf.setDrawColor(...GRIS_TRAIT); pdf.setLineWidth(0.25); pdf.rect(x, top, w, h);
    const f = new AcroFormTextField();
    f.fieldName = nom; f.x = x + 0.4; f.y = top + 0.4; f.width = w - 0.8; f.height = h - 0.8;
    f.maxFontSize = 9; f.fontSize = 9; f.multiline = multiligne;
    const v = valeurs[nom];
    f.value = typeof v === 'string' ? v : defaut;
    pdf.addField(f);
  };
  const champCase = (nom: string, x: number, top: number) => {
    pdf.setDrawColor(...GRIS_TRAIT); pdf.setLineWidth(0.25); pdf.rect(x, top, 5.5, 5.5);
    const f = new AcroFormCheckBox();
    f.fieldName = nom; f.x = x + 0.4; f.y = top + 0.4; f.width = 4.7; f.height = 4.7;
    f.appearanceState = valeurs[nom] === true ? 'On' : 'Off';
    pdf.addField(f);
  };

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...GRIS_TEXTE);
  pdf.text('ACTE D\'ENGAGEMENT', M + W / 2, y + 6, { align: 'center' }); y += 11;
  texte('Formulaire à compléter par l\'entreprise, puis à signer et à retourner au maître d\'œuvre avec les pièces demandées au règlement de consultation. Merci de ne pas modifier la structure du document : il est lu automatiquement.', { couleur: GRIS_DOUX, taille: 8.5, apres: 3 });

  // Maître d'ouvrage et opération : informations déjà connues.
  const infos: [string, string][] = [
    ['Maître d\'ouvrage', p.moa_nom || POINTILLES],
    ['Représenté par', p.moa_representant || POINTILLES],
    ['Adresse', p.moa_adresse || POINTILLES],
    ['Opération', ctx.operation.nom + (ctx.operation.code ? ` (${ctx.operation.code})` : '')],
    ['Lieu des travaux', p.lieu_construction || ctx.operation.adresse || POINTILLES],
  ];
  for (const [k, val] of infos) {
    place(5); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...GRIS_DOUX); pdf.text(k, M, y + 3);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...GRIS_TEXTE);
    const l = pdf.splitTextToSize(val, W - 42) as string[]; pdf.text(l, M + 42, y + 3); y += Math.max(1, l.length) * 3.8 + 1;
  }

  titre('Article 1. Identification de l\'entreprise');
  const COL = (W - 4) / 2;
  const lignesChamps: CleEntreprise[][] = [['entreprise', 'representant'], ['qualite', 'email'], ['siege'], ['siret', 'ape'], ['rcs', 'telephone']];
  for (const ligne of lignesChamps) {
    place(14);
    ligne.forEach((cle, j) => {
      const c = CHAMPS_ENTREPRISE.find(x => x.cle === cle)!;
      const x = M + j * (COL + 4);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...GRIS_DOUX);
      pdf.text(c.libelle, x, y + 2.5);
      // Une adresse est longue : le siège occupe toute la ligne.
      champTexte(nomChamp.entreprise(cle), x, y + 3.5, ligne.length === 1 ? W : COL);
    });
    y += 12.5;
  }
  y += 1;
  texte(`Après avoir pris connaissance du cahier des clauses administratives particulières (CCAP), de la norme NF P 03-001 qu'il rend applicable, et des documents qui y sont mentionnés, relatifs aux travaux nécessaires à ${p.nature_travaux || POINTILLES} situés ${p.lieu_construction || ctx.operation.adresse || POINTILLES}, pour le compte de ${p.moa_nom || POINTILLES}, je m'engage sans réserve, conformément aux stipulations des documents visés ci-dessus, à exécuter les travaux du ou des lots cochés ci-dessous, dans les conditions ci-après définies.`, { apres: 2 });

  titre('Article 2. Prix');
  texte('Cochez chaque lot pour lequel vous remettez une offre, et indiquez le prix global forfaitaire, ferme, HT, ainsi que votre délai propre d\'exécution.', { couleur: GRIS_DOUX, taille: 8.5 });
  const xLot = M + 8; const wPrix = 38; const wDelai = 30;
  const xPrix = M + W - wPrix - wDelai - 2; const xDelai = M + W - wDelai;
  place(8);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...GRIS_DOUX);
  pdf.text('Lot', xLot, y + 3); pdf.text('Prix HT (€)', xPrix, y + 3); pdf.text('Délai (mois)', xDelai, y + 3); y += 5;
  for (const lot of lots) {
    const lignes = pdf.splitTextToSize(`Lot ${lot.numero} : ${lot.titre}`, xPrix - xLot - 3) as string[];
    const h = Math.max(7.5, lignes.length * 3.9 + 3);
    place(h + 1);
    champCase(nomChamp.lotCandidat(lot.numero), M, y + (h - 5.5) / 2);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GRIS_TEXTE);
    pdf.text(lignes, xLot, y + (h - lignes.length * 3.9) / 2 + 3);
    champTexte(nomChamp.lotPrix(lot.numero), xPrix, y + (h - 6.5) / 2, wPrix);
    champTexte(nomChamp.lotDelai(lot.numero), xDelai, y + (h - 6.5) / 2, wDelai);
    y += h + 1;
  }
  y += 2;
  place(14);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GRIS_TEXTE);
  pdf.text('TVA au taux de (%)', M, y + 4.5);
  champTexte(nomChamp.tva, M + 38, y, 22, 6.5, false, String(tvaPct).replace('.', ','));
  y += 10;
  pdf.setFontSize(8); pdf.setTextColor(...GRIS_DOUX);
  pdf.text('Frais et prestations à la charge du maître d\'ouvrage et non inclus dans le prix :', M, y + 2.5);
  champTexte(nomChamp.frais, M, y + 3.5, W, 14, true); y += 19;

  titre('Article 3. Délais');
  texte(`Conformément à l'article 5 du CCAP, le délai global d'exécution des travaux est de ${p.delai_execution_mois ?? POINTILLES} mois à compter de la date fixée par l'ordre de service délivré au lot n° 1 et communiqué à toutes les entreprises. Mon propre délai d'exécution, indiqué ci-dessus pour chaque lot, sera déterminé dans les conditions prévues à cet article 5.`);

  y += 4;
  place(42);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GRIS_TEXTE);
  pdf.text('Fait à', M, y + 4.5); champTexte(nomChamp.lieu, M + 12, y, 55);
  pdf.text('le', M + 72, y + 4.5); champTexte(nomChamp.date, M + 78, y, 35);
  y += 10;
  pdf.setFont('helvetica', 'bold'); pdf.text('Signature de l\'entrepreneur (cachet et signature)', M, y + 3);
  pdf.setDrawColor(...GRIS_TRAIT); pdf.rect(M, y + 5, W / 2, 24); y += 33;

  titre('Article 4. Notification');
  place(36);
  texte('Est acceptée la présente offre pour valoir acte d\'engagement. Partie réservée au maître d\'ouvrage.');
  texte(`À ${p.lieu_signature || POINTILLES}, le ${POINTILLES}.`);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...GRIS_TEXTE);
  pdf.text('Signature du maître d\'ouvrage', M, y + 3); y += 24;

  drawAgencyFooters(pdf, settings, { title: 'Acte d\'engagement', margin: M });
  return pdf.output('arraybuffer');
}

// ── Lecture d'un formulaire rempli ───────────────────────────────────────────

export interface LotRempli {
  numero: string;
  /** Intitulé connu de l'opération, absent pour un lot que l'opération ne porte pas. */
  titre?: string;
  candidat: boolean;
  prixHT: number | null;
  delaiMois: number | null;
}

export interface ActeRempli {
  entreprise: Partial<Record<CleEntreprise, string>>;
  tvaPct: number | null;
  fraisNonInclus: string;
  lieu: string;
  date: string;
  lots: LotRempli[];
  /** Points à vérifier avant d'exploiter le formulaire (jamais corrigés d'office). */
  avertissements: string[];
}

/** « 12 500,50 » ou « 12500.5 » en nombre ; null si vide ou illisible. */
export function nombreFrancais(s: string | undefined): number | null {
  if (!s) return null;
  const propre = s.replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(propre)) return null;
  return Number(propre);
}

const estCoche = (v: string | boolean | undefined) => v === true || (typeof v === 'string' && !['', 'off', 'false', '0', 'non'].includes(v.trim().toLowerCase()));

/**
 * Interprète les champs d'un formulaire rempli. `lotsConnus` est la liste des
 * lots de l'opération : un lot du formulaire absent de cette liste est
 * signalé, un lot connu qui n'a pas de ligne aussi.
 */
export function lireActeFormulaire(champs: Record<string, string | boolean>, lotsConnus: LotFormulaire[]): ActeRempli {
  const texte = (nom: string) => (typeof champs[nom] === 'string' ? (champs[nom] as string).trim() : '');
  const avertissements: string[] = [];

  const entreprise: ActeRempli['entreprise'] = {};
  for (const c of CHAMPS_ENTREPRISE) {
    const v = texte(nomChamp.entreprise(c.cle));
    if (v) entreprise[c.cle] = v;
  }
  if (!entreprise.entreprise) avertissements.push('La dénomination de l\'entreprise n\'est pas renseignée.');
  if (!entreprise.siret) avertissements.push('Le SIRET n\'est pas renseigné.');
  else if (entreprise.siret.replace(/\s/g, '').length !== 14) avertissements.push('Le SIRET ne comporte pas 14 chiffres.');

  const tvaPct = nombreFrancais(texte(nomChamp.tva));
  if (tvaPct === null) avertissements.push('Le taux de TVA est illisible ou absent.');

  const numeros = new Map<string, string>();
  for (const nom of Object.keys(champs)) {
    const m = /^ae_lot_(.+)_(candidat|prix_ht|delai_mois)$/.exec(nom);
    if (m) numeros.set(m[1], m[1]);
  }
  const lots: LotRempli[] = [];
  for (const lot of lotsConnus) {
    const k = cleLot(lot.numero);
    if (!numeros.has(k)) { avertissements.push(`Le lot ${lot.numero} n'apparaît pas dans le formulaire.`); continue; }
    numeros.delete(k);
    lots.push(lireLot(champs, lot.numero, lot.titre, avertissements));
  }
  for (const k of numeros.keys()) {
    avertissements.push(`Le formulaire porte un lot « ${k} » que l'opération ne connaît pas : il est ignoré.`);
  }
  if (!lots.some(l => l.candidat)) avertissements.push('Aucun lot n\'est chiffré par cette entreprise.');

  return {
    entreprise, tvaPct, fraisNonInclus: texte(nomChamp.frais), lieu: texte(nomChamp.lieu), date: texte(nomChamp.date),
    lots, avertissements,
  };
}

function lireLot(champs: Record<string, string | boolean>, numero: string, titre: string, avertissements: string[]): LotRempli {
  const brut = (n: string) => (typeof champs[n] === 'string' ? (champs[n] as string).trim() : '');
  const prixTexte = brut(nomChamp.lotPrix(numero));
  const prixHT = nombreFrancais(prixTexte);
  const delaiMois = nombreFrancais(brut(nomChamp.lotDelai(numero)));
  const coche = estCoche(champs[nomChamp.lotCandidat(numero)]);
  if (prixTexte && prixHT === null) avertissements.push(`Lot ${numero} : le prix « ${prixTexte} » est illisible.`);
  if (prixHT !== null && prixHT < 0) avertissements.push(`Lot ${numero} : le prix est négatif.`);
  if (prixHT !== null && !coche) avertissements.push(`Lot ${numero} : un prix est saisi mais le lot n'est pas coché, il est retenu.`);
  if (coche && prixHT === null) avertissements.push(`Lot ${numero} : coché sans prix.`);
  return { numero, titre, candidat: coche || prixHT !== null, prixHT, delaiMois };
}
