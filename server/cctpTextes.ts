// Écriture des TEXTES du CCTP par les agents et le MCP (outil manage_cctp).
// Logique pure sur le document `dpgfs.data` (lots > chapitres > lignes), sans accès
// base : la route (routes/dpgf.ts) lit, applique, puis écrit sous verrou, comme pour
// manage_dpgf (dpgfLignes.ts).
//
// Règles à ne pas défaire :
//   - le MCP n'envoie jamais le document entier : une opération ciblée sur UN élément
//     (lot, chapitre ou article) ou l'ajout d'articles ;
//   - remplacer un texte déjà rédigé n'est jamais silencieux : `set_texte` sur un texte non
//     vide exige `remplacer: true` (l'outil le fait confirmer à l'utilisateur) ; `append_texte`
//     ajoute à la suite sans rien perdre ;
//   - un élément « en cours d'édition » par quelqu'un d'autre n'est pas touché (409), sauf
//     `forcer: true` sur demande explicite ;
//   - un article ajouté n'a NI quantité, NI prix, NI bâtiment (comme dans l'éditeur du CCTP) ;
//     dans un chapitre réservé au CCTP ou avec `cctp_only: true`, il reste absent du DPGF ;
//   - jamais de quantité ni de prix écrits ici : c'est le rôle de manage_dpgf.

import { PAR_AGENT, enCoursParAutre, libelleMarqueur, normaliserMarqueur } from '../src/lib/marqueurRedaction';
import { DpgfLignesError, normNumero } from './dpgfLignes';

type Json = Record<string, any>;

export const MAX_TEXTE = 20_000;
export const MAX_ARTICLES_CCTP = 100;

const normTexte = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export type CibleCctp = 'lot' | 'chapitre' | 'article';

export type OperationCctp =
  | { action: 'set_texte' | 'append_texte'; cible: CibleCctp; lot?: string; chapitre?: string; id?: string; numero?: string; texte: string; remplacer?: boolean; forcer?: boolean; par?: string }
  | { action: 'add_articles'; lot: string; chapitre: string; articles: { designation: string; texte?: string; unite?: string; cctp_only?: boolean; numero?: string }[]; forcer?: boolean; par?: string };

export interface RapportCctp {
  action: OperationCctp['action'];
  cible?: { type: CibleCctp; id: string; numero: string; intitule: string };
  /** Texte avant l'opération (set_texte), pour la confirmation. */
  avant?: string;
  apres?: string;
  articles_ajoutes?: { id: string; numero: string; designation: string; cctp_only: boolean }[];
}

const lotsDe = (doc: Json): Json[] => (Array.isArray(doc.lots) ? doc.lots : []);

function trouverLot(doc: Json, ref: string): Json {
  const n = normNumero(ref);
  const lot = lotsDe(doc).find(l => normNumero(l.numero) === n) ?? lotsDe(doc).find(l => normTexte(l.titre) === normTexte(ref));
  if (!lot) {
    const dispo = lotsDe(doc).map(l => `${l.numero} ${l.titre ?? ''}`.trim()).join(', ') || 'aucun lot';
    throw new DpgfLignesError(`Le lot « ${ref} » n'existe pas. Lots disponibles : ${dispo}.`, 404);
  }
  return lot;
}

function trouverChapitre(lot: Json, ref: string): Json {
  const chapitres: Json[] = Array.isArray(lot.chapitres) ? lot.chapitres : [];
  const n = normNumero(ref);
  const chap = chapitres.find(c => normNumero(c.numero) === n) ?? chapitres.find(c => normTexte(c.titre) === normTexte(ref));
  if (!chap) {
    const dispo = chapitres.map(c => `${c.numero} ${c.titre ?? ''}`.trim()).join(', ') || 'aucun chapitre';
    throw new DpgfLignesError(`Le chapitre « ${ref} » n'existe pas dans le lot ${lot.numero}. Chapitres disponibles : ${dispo}.`, 404);
  }
  return chap;
}

function trouverArticle(doc: Json, op: { id?: string; numero?: string; lot?: string }): Json {
  const id = String(op.id ?? '').trim();
  const numero = String(op.numero ?? '').trim();
  if (!id && !numero) throw new DpgfLignesError("Désigne l'article par son id ou par son numero.");
  const lotVise = op.lot ? trouverLot(doc, op.lot) : null;
  const trouves: { noeud: Json; lot: Json; chap: Json }[] = [];
  for (const lot of lotsDe(doc)) {
    if (lotVise && lot !== lotVise) continue;
    for (const chap of (Array.isArray(lot.chapitres) ? lot.chapitres : [])) {
      const marche = (lignes: Json[]) => lignes.forEach(l => {
        if (id ? String(l.id) === id : normNumero(l.numero) === normNumero(numero)) trouves.push({ noeud: l, lot, chap });
        if (Array.isArray(l.children) && l.children.length) marche(l.children);
      });
      marche(Array.isArray(chap.lignes) ? chap.lignes : []);
    }
  }
  if (!trouves.length) throw new DpgfLignesError(`Aucun article ne correspond à ${id ? `l'id ${id}` : `« ${numero} »`}.`, 404);
  if (trouves.length > 1) {
    throw new DpgfLignesError(`Plusieurs articles portent le numéro « ${numero} » (${trouves.map(t => `lot ${t.lot.numero}, chapitre ${t.chap.numero}`).join(' ; ')}) : précise le lot ou utilise l'id.`);
  }
  return trouves[0].noeud;
}

function nettoyerTexte(valeur: unknown, ou: string): string {
  if (typeof valeur !== 'string') throw new DpgfLignesError(`${ou} : texte est requis (texte brut ; [b]…[/b] pour le gras).`);
  const t = valeur.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  if (t.length > MAX_TEXTE) throw new DpgfLignesError(`${ou} : le texte dépasse ${MAX_TEXTE} caractères.`);
  return t;
}

function verifierMain(noeud: Json, op: { par?: unknown; forcer?: boolean }, ou: string): void {
  const m = normaliserMarqueur(noeud.marqueur);
  const par = typeof op.par === 'string' && op.par.trim() ? op.par.trim() : PAR_AGENT;
  if (!enCoursParAutre(m, par) || op.forcer === true) return;
  throw new DpgfLignesError(
    `${ou} est ${libelleMarqueur(m!)}. Ne le modifie pas : demande à l'utilisateur de lever le marqueur, ou rappelle avec forcer: true seulement s'il le demande explicitement.`,
    409,
  );
}

function ecrireTexte(doc: Json, op: Extract<OperationCctp, { action: 'set_texte' | 'append_texte' }>): RapportCctp {
  const cible = op.cible;
  if (!['lot', 'chapitre', 'article'].includes(cible)) throw new DpgfLignesError('cible doit valoir lot, chapitre ou article.');
  let noeud: Json;
  let intitule: string;
  if (cible === 'lot') {
    if (!op.lot) throw new DpgfLignesError('lot est requis (numéro du lot).');
    noeud = trouverLot(doc, op.lot);
    intitule = String(noeud.titre ?? '');
  } else if (cible === 'chapitre') {
    if (!op.lot || !op.chapitre) throw new DpgfLignesError('lot et chapitre sont requis pour cible = chapitre.');
    noeud = trouverChapitre(trouverLot(doc, op.lot), op.chapitre);
    intitule = String(noeud.titre ?? '');
  } else {
    noeud = trouverArticle(doc, op);
    intitule = String(noeud.designation ?? '');
  }
  const numero = String(noeud.numero);
  const ou = `${cible === 'article' ? 'Article' : cible === 'chapitre' ? 'Chapitre' : 'Lot'} ${numero}`;
  verifierMain(noeud, op, ou);
  const texte = nettoyerTexte(op.texte, ou);
  if (!texte) throw new DpgfLignesError(`${ou} : texte ne peut pas être vide.`);
  const avant = String(noeud.cctpDescription ?? '');

  let apres: string;
  if (op.action === 'append_texte') {
    apres = avant.trim() ? `${avant.trimEnd()}\n\n${texte}` : texte;
    if (apres.length > MAX_TEXTE) throw new DpgfLignesError(`${ou} : le texte obtenu dépasse ${MAX_TEXTE} caractères.`);
  } else {
    if (avant.trim() && avant.trim() !== texte && op.remplacer !== true) {
      throw new DpgfLignesError(`${ou} porte déjà un texte. Remplacer exige remplacer: true (après accord de l'utilisateur), ou utilise append_texte pour ajouter à la suite.`, 409);
    }
    apres = texte;
  }
  noeud.cctpDescription = apres;
  return { action: op.action, cible: { type: cible, id: String(noeud.id), numero, intitule }, avant, apres };
}

function ajouterArticles(doc: Json, op: Extract<OperationCctp, { action: 'add_articles' }>): RapportCctp {
  if (!op.lot || !op.chapitre) throw new DpgfLignesError('lot et chapitre sont requis pour add_articles.');
  if (!Array.isArray(op.articles) || !op.articles.length) throw new DpgfLignesError('articles est requis : au moins un article à ajouter.');
  if (op.articles.length > MAX_ARTICLES_CCTP) throw new DpgfLignesError(`${op.articles.length} articles en un appel : le maximum est ${MAX_ARTICLES_CCTP}.`);
  const lot = trouverLot(doc, op.lot);
  const chap = trouverChapitre(lot, op.chapitre);
  verifierMain(chap, op, `Le chapitre ${chap.numero}`);
  chap.lignes = Array.isArray(chap.lignes) ? chap.lignes : [];

  const existants = new Set((chap.lignes as Json[]).map(l => normNumero(l.numero)));
  const base = String(chap.numero);
  let max = 0;
  for (const l of chap.lignes as Json[]) {
    const m = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)$`).exec(String(l.numero).trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const suivant = () => { let n = ++max; while (existants.has(normNumero(`${base}.${n}`))) n = ++max; return `${base}.${n}`; };

  // Tout est validé AVANT la moindre écriture : un appel est accepté en entier ou refusé en entier.
  const nouveaux: Json[] = [];
  op.articles.forEach((a, i) => {
    const ou = `Article ${i + 1}`;
    const designation = String(a?.designation ?? '').trim();
    if (!designation) throw new DpgfLignesError(`${ou} : designation est requise.`);
    if (designation.length > 1000) throw new DpgfLignesError(`${ou} : designation dépasse 1000 caractères.`);
    const texte = a.texte === undefined || a.texte === '' ? '' : nettoyerTexte(a.texte, ou);
    let numero = String(a.numero ?? '').trim();
    if (numero) {
      if (existants.has(normNumero(numero))) throw new DpgfLignesError(`${ou} : le numéro « ${numero} » existe déjà dans le chapitre ${chap.numero}.`);
    } else numero = suivant();
    existants.add(normNumero(numero));
    // Sans quantité ni prix : un article du CCTP n'en porte que s'il est ensuite chiffré dans le DPGF.
    const reserve = !!chap.cctpOnly || a.cctp_only === true;
    nouveaux.push({
      id: crypto.randomUUID(), type: 'ouvrage', numero, designation,
      unite: reserve ? '' : String(a.unite ?? '').trim(), quantite: 0, prixUnitaire: 0, prixTotal: 0,
      cctpOnly: reserve, cctpDescription: texte, children: [],
    });
  });
  chap.lignes.push(...nouveaux);
  return {
    action: 'add_articles',
    cible: { type: 'chapitre', id: String(chap.id), numero: String(chap.numero), intitule: String(chap.titre ?? '') },
    articles_ajoutes: nouveaux.map(n => ({ id: n.id, numero: n.numero, designation: n.designation, cctp_only: n.cctpOnly })),
  };
}

/** Applique l'opération à une COPIE du document. Une erreur laisse le document d'origine intact. */
export function appliquerOperationCctp(source: Json, op: OperationCctp): { doc: Json; rapport: RapportCctp } {
  const doc: Json = JSON.parse(JSON.stringify(source));
  switch (op?.action) {
    case 'set_texte':
    case 'append_texte': return { doc, rapport: ecrireTexte(doc, op) };
    case 'add_articles': return { doc, rapport: ajouterArticles(doc, op) };
    default: throw new DpgfLignesError('action doit valoir set_texte, append_texte ou add_articles.');
  }
}
