// ── Écriture de lignes dans le DPGF d'une opération (outil manage_dpgf) ───────
// Logique pure sur le document `dpgfs.data` (lots > chapitres > lignes), sans
// accès base : la route (routes/dpgf.ts) lit, applique, puis écrit sous verrou.
//
// Règles à ne pas défaire :
//   - un chapitre `cctpOnly` n'est JAMAIS touché (ni ajout, ni remplacement), et
//     aucune ligne portant un `cctpDescription` n'est supprimée ni écrasée :
//     le texte technique du CCTP appartient à l'architecte ;
//   - `batimentId` / `phaseId` / `trancheId` sont laissés ABSENTS sur une
//     nouvelle ligne : `batimentId: ''` signifie « aucun bâtiment, sans
//     héritage » (types/dpgf.ts), absent veut dire « hérite du chapitre/lot » ;
//   - seul le `prixTotal` des lignes touchées est recalculé ; les sous-totaux de
//     lot, `totalHT` et `totalTTC` le sont pour tout le document.

export class DpgfLignesError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Json = Record<string, any>;

export const MAX_LIGNES_PAR_APPEL = 300;
export const CHAPITRE_PAR_DEFAUT = 'DESCRIPTION DES OUVRAGES';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** « 01 » et « 1 » désignent le même numéro, la casse et les espaces ne comptent pas. */
export function normNumero(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().split('.').map(seg => (/^\d+$/.test(seg) ? String(parseInt(seg, 10)) : seg)).join('.');
}
const normTexte = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Un nombre positif ou nul, écrit « 12,5 » ou 12.5 ; sinon une erreur qui nomme le champ. */
function nombre(valeur: unknown, champ: string, ou: string): number {
  const n = typeof valeur === 'number' ? valeur : Number(String(valeur ?? '').trim().replace(/\s/g, '').replace(',', '.'));
  if (valeur === '' || valeur === null || !Number.isFinite(n)) throw new DpgfLignesError(`${ou} : ${champ} doit être un nombre.`);
  if (n < 0) throw new DpgfLignesError(`${ou} : ${champ} ne peut pas être négatif.`);
  return n;
}

export interface LigneSaisie { designation: string; unite?: string; quantite: number | string; prix_unitaire?: number | string; numero?: string }

export type Operation =
  | { action: 'add_lignes'; lot: string; chapitre?: string; lignes: LigneSaisie[]; replace_existing?: boolean }
  | { action: 'update_ligne'; id?: string; numero?: string; lot?: string; designation?: string; unite?: string; quantite?: number | string; prix_unitaire?: number | string }
  | { action: 'delete_ligne'; id?: string; numero?: string; lot?: string };

export interface Rapport {
  action: Operation['action'];
  /** add_lignes : nombre de lignes ajoutées par lot (numéro du lot). */
  lignes_ajoutees?: Record<string, number>;
  lignes_remplacees?: number;
  /** Lignes gardées parce qu'elles portent un texte CCTP. */
  lignes_conservees?: { numero: string; raison: string }[];
  ligne?: Json;
  sous_totaux: { lot: string; titre: string; sous_total_ht: number }[];
  total_ht: number;
  total_ttc: number;
  tva: number;
}

// ── Recherche ────────────────────────────────────────────────────────────────

const lotsDe = (doc: Json): Json[] => (Array.isArray(doc.lots) ? doc.lots : []);

function trouverLot(doc: Json, ref: string): Json {
  const lots = lotsDe(doc);
  const n = normNumero(ref);
  const lot = lots.find(l => normNumero(l.numero) === n) ?? lots.find(l => normTexte(l.titre) === normTexte(ref));
  if (!lot) {
    const dispo = lots.map(l => `${l.numero} ${l.titre ?? ''}`.trim()).join(', ') || 'aucun lot';
    throw new DpgfLignesError(`Le lot « ${ref} » n'existe pas dans ce DPGF. Lots disponibles : ${dispo}.`, 404);
  }
  return lot;
}

function trouverChapitre(lot: Json, ref: string): Json {
  const chapitres: Json[] = Array.isArray(lot.chapitres) ? lot.chapitres : [];
  const n = normNumero(ref);
  const chap = chapitres.find(c => normNumero(c.numero) === n) ?? chapitres.find(c => normTexte(c.titre) === normTexte(ref));
  if (!chap) {
    const dispo = chapitres.filter(c => !c.cctpOnly).map(c => `${c.numero} ${c.titre ?? ''}`.trim()).join(', ') || 'aucun chapitre';
    throw new DpgfLignesError(`Le chapitre « ${ref} » n'existe pas dans le lot ${lot.numero}. Chapitres disponibles : ${dispo}.`, 404);
  }
  if (chap.cctpOnly) throw new DpgfLignesError(`Le chapitre « ${chap.titre} » du lot ${lot.numero} est réservé au CCTP : il n'est pas modifié par cet outil.`, 400);
  return chap;
}

interface Trouvee { lot: Json; chapitre: Json; liste: Json[]; index: number; ligne: Json }

function parcourir(doc: Json, fn: (t: Trouvee) => void) {
  for (const lot of lotsDe(doc)) {
    for (const chapitre of (Array.isArray(lot.chapitres) ? lot.chapitres : [])) {
      const marche = (liste: Json[]) => liste.forEach((ligne, index) => {
        fn({ lot, chapitre, liste, index, ligne });
        if (Array.isArray(ligne.children) && ligne.children.length) marche(ligne.children);
      });
      marche(Array.isArray(chapitre.lignes) ? chapitre.lignes : []);
    }
  }
}

function trouverLigne(doc: Json, op: { id?: string; numero?: string; lot?: string }): Trouvee {
  const id = String(op.id ?? '').trim();
  const numero = String(op.numero ?? '').trim();
  if (!id && !numero) throw new DpgfLignesError("Désigne la ligne par son id ou par son numero.");
  const lotVise = op.lot ? trouverLot(doc, op.lot) : null;
  const trouvees: Trouvee[] = [];
  parcourir(doc, t => {
    if (lotVise && t.lot !== lotVise) return;
    if (id ? String(t.ligne.id) === id : normNumero(t.ligne.numero) === normNumero(numero)) trouvees.push(t);
  });
  if (!trouvees.length) throw new DpgfLignesError(`Aucune ligne ne correspond à ${id ? `l'id ${id}` : `« ${numero} »`}.`, 404);
  if (trouvees.length > 1) {
    throw new DpgfLignesError(
      `Plusieurs lignes portent le numéro « ${numero} » (${trouvees.map(t => `lot ${t.lot.numero}, chapitre ${t.chapitre.numero}`).join(' ; ')}) : précise le lot ou utilise l'id.`,
    );
  }
  const t = trouvees[0];
  if (t.chapitre.cctpOnly || t.ligne.cctpOnly) throw new DpgfLignesError('Cette ligne est réservée au CCTP : elle n\'est pas modifiée par cet outil.');
  return t;
}

// ── Totaux ───────────────────────────────────────────────────────────────────

const sommeLigne = (l: Json): number => (Array.isArray(l.children) && l.children.length
  ? l.children.reduce((s: number, c: Json) => s + sommeLigne(c), 0)
  : Number(l.prixTotal) || 0);

/** Sous-total de chaque lot, totalHT et totalTTC (TVA du document, 20 % à défaut). */
export function recalculerTotaux(doc: Json): Pick<Rapport, 'sous_totaux' | 'total_ht' | 'total_ttc' | 'tva'> {
  const tva = Number.isFinite(Number(doc.TVA)) && doc.TVA !== null && doc.TVA !== '' ? Number(doc.TVA) : 20;
  for (const lot of lotsDe(doc)) {
    lot.sousTotal = round2((Array.isArray(lot.chapitres) ? lot.chapitres : [])
      .filter((c: Json) => !c.cctpOnly)
      .reduce((s: number, c: Json) => s + (Array.isArray(c.lignes) ? c.lignes : []).reduce((t: number, l: Json) => t + sommeLigne(l), 0), 0));
  }
  doc.totalHT = round2(lotsDe(doc).reduce((s, l) => s + (Number(l.sousTotal) || 0), 0));
  doc.TVA = tva;
  doc.totalTTC = round2(doc.totalHT * (1 + tva / 100));
  return {
    sous_totaux: lotsDe(doc).map(l => ({ lot: String(l.numero), titre: String(l.titre ?? ''), sous_total_ht: l.sousTotal })),
    total_ht: doc.totalHT, total_ttc: doc.totalTTC, tva,
  };
}

// ── Opérations ───────────────────────────────────────────────────────────────

function prochainNumero(chapitre: Json, deja: Set<string>): () => string {
  const base = String(chapitre.numero);
  let max = 0;
  for (const l of chapitre.lignes as Json[]) {
    const m = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)$`).exec(String(l.numero).trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return () => {
    let n = ++max;
    while (deja.has(normNumero(`${base}.${n}`))) n = ++max;
    return `${base}.${n}`;
  };
}

function ajouterLignes(doc: Json, op: Extract<Operation, { action: 'add_lignes' }>): Partial<Rapport> {
  if (!Array.isArray(op.lignes) || !op.lignes.length) throw new DpgfLignesError('lignes est requis : au moins une ligne à ajouter.');
  if (op.lignes.length > MAX_LIGNES_PAR_APPEL) {
    throw new DpgfLignesError(`${op.lignes.length} lignes en un appel : le maximum est ${MAX_LIGNES_PAR_APPEL}. Découpe l'import en plusieurs appels.`);
  }
  if (!String(op.lot ?? '').trim()) throw new DpgfLignesError('lot est requis (numéro du lot, ex. « 05 »).');

  // Tout est validé AVANT la moindre écriture : un appel est accepté en entier ou refusé en entier.
  const lot = trouverLot(doc, op.lot);
  const chapitre = trouverChapitre(lot, String(op.chapitre ?? '').trim() || CHAPITRE_PAR_DEFAUT);
  chapitre.lignes = Array.isArray(chapitre.lignes) ? chapitre.lignes : [];

  const conservees: Rapport['lignes_conservees'] = [];
  let remplacees = 0;
  if (op.replace_existing) {
    const gardees: Json[] = [];
    for (const l of chapitre.lignes as Json[]) {
      if (String(l.cctpDescription ?? '').trim()) { gardees.push(l); conservees.push({ numero: String(l.numero), raison: 'porte un texte CCTP' }); }
      else if (l.cctpOnly) { gardees.push(l); conservees.push({ numero: String(l.numero), raison: 'réservée au CCTP' }); }
      else remplacees++;
    }
    chapitre.lignes = gardees;
  }

  const existants = new Set((chapitre.lignes as Json[]).map(l => normNumero(l.numero)));
  const suivant = prochainNumero(chapitre, existants);
  const nouvelles: Json[] = [];
  op.lignes.forEach((s, i) => {
    const ou = `Ligne ${i + 1}`;
    const designation = String(s?.designation ?? '').trim();
    if (!designation) throw new DpgfLignesError(`${ou} : designation est requise.`);
    if (designation.length > 1000) throw new DpgfLignesError(`${ou} : designation dépasse 1000 caractères.`);
    const quantite = nombre(s.quantite, 'quantite', ou);
    const prixUnitaire = s.prix_unitaire === undefined || s.prix_unitaire === null || s.prix_unitaire === '' ? 0 : nombre(s.prix_unitaire, 'prix_unitaire', ou);
    let numero = String(s.numero ?? '').trim();
    if (numero) {
      if (existants.has(normNumero(numero))) throw new DpgfLignesError(`${ou} : le numéro « ${numero} » existe déjà dans le chapitre ${chapitre.numero}.`);
    } else numero = suivant();
    existants.add(normNumero(numero));
    nouvelles.push({
      id: crypto.randomUUID(), type: 'ouvrage', numero, designation,
      unite: String(s.unite ?? '').trim(), quantite, prixUnitaire,
      prixTotal: round2(quantite * prixUnitaire),
      cctpOnly: false, cctpDescription: '', children: [],
    });
  });

  chapitre.lignes.push(...nouvelles);
  return {
    lignes_ajoutees: { [String(lot.numero)]: nouvelles.length },
    ...(op.replace_existing ? { lignes_remplacees: remplacees, lignes_conservees: conservees } : {}),
  };
}

function modifierLigne(doc: Json, op: Extract<Operation, { action: 'update_ligne' }>): Partial<Rapport> {
  const t = trouverLigne(doc, op);
  const l = t.ligne;
  const touche = ['designation', 'unite', 'quantite', 'prix_unitaire'].some(k => (op as Json)[k] !== undefined);
  if (!touche) throw new DpgfLignesError('Aucun champ à modifier : fournis designation, unite, quantite ou prix_unitaire.');
  const ou = `Ligne ${l.numero}`;
  if ((op.quantite !== undefined || op.prix_unitaire !== undefined) && Array.isArray(l.children) && l.children.length) {
    throw new DpgfLignesError(`${ou} : cette ligne a des sous-articles, son montant est la somme de ses enfants. Modifie plutôt un sous-article.`);
  }
  // Validation complète avant d'écrire.
  const designation = op.designation !== undefined ? String(op.designation).trim() : undefined;
  if (designation !== undefined && !designation) throw new DpgfLignesError(`${ou} : designation ne peut pas être vide.`);
  const quantite = op.quantite !== undefined ? nombre(op.quantite, 'quantite', ou) : undefined;
  const prix = op.prix_unitaire !== undefined ? nombre(op.prix_unitaire, 'prix_unitaire', ou) : undefined;

  if (designation !== undefined) l.designation = designation;
  if (op.unite !== undefined) l.unite = String(op.unite).trim();
  if (quantite !== undefined) l.quantite = quantite;
  if (prix !== undefined) l.prixUnitaire = prix;
  if (!(Array.isArray(l.children) && l.children.length)) l.prixTotal = round2((Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0));
  return { ligne: resume(l, t) };
}

function supprimerLigne(doc: Json, op: Extract<Operation, { action: 'delete_ligne' }>): Partial<Rapport> {
  const t = trouverLigne(doc, op);
  if (String(t.ligne.cctpDescription ?? '').trim()) {
    throw new DpgfLignesError(`La ligne ${t.ligne.numero} porte un texte CCTP : elle n'est pas supprimée par cet outil.`);
  }
  t.liste.splice(t.index, 1);
  return { ligne: resume(t.ligne, t) };
}

const resume = (l: Json, t: Trouvee) => ({
  id: l.id, lot: String(t.lot.numero), chapitre: String(t.chapitre.numero), numero: l.numero, designation: l.designation,
  unite: l.unite, quantite: l.quantite, prix_unitaire: l.prixUnitaire, prix_total: l.prixTotal,
});

/**
 * Applique une opération à une COPIE du document et rend le nouveau document avec son
 * rapport. Une erreur (DpgfLignesError) laisse le document d'origine intact.
 */
export function appliquerOperation(source: Json, op: Operation): { doc: Json; rapport: Rapport } {
  const doc: Json = JSON.parse(JSON.stringify(source));
  let partiel: Partial<Rapport>;
  switch (op?.action) {
    case 'add_lignes': partiel = ajouterLignes(doc, op); break;
    case 'update_ligne': partiel = modifierLigne(doc, op); break;
    case 'delete_ligne': partiel = supprimerLigne(doc, op); break;
    default: throw new DpgfLignesError('action doit valoir add_lignes, update_ligne ou delete_ligne.');
  }
  const totaux = recalculerTotaux(doc);
  return { doc, rapport: { action: op.action, ...partiel, ...totaux } };
}
