// ── Saisie des prix POSTE PAR POSTE d'une entreprise (manage_consultation, set_postes) ──
//
// Écrit ce que l'écran ACT écrit quand on clique « Saisir les postes » : les P.U. dans les offres du DPGF
// (`dpgfs.offres`, `OffreDocument.prix`, une table article -> P.U. avec `null` pour « pour mémoire »), les lignes
// qu'une entreprise ajoute au bordereau (`postesAjoutes`), puis le lot passe en `mode_saisie: 'postes'` avec un
// `montant_base` DÉDUIT des prix. Le DPGF lui-même (l'estimation du cabinet) n'est jamais modifié.
//
// Ce paquet n'importe rien de `src/` : `articlesDuLot`, `totalLotPostes` et `repartirSaisie` reprennent à
// l'identique `chapitresDuLot`, `totalLotPostes` et `repartirSaisie` de `src/lib/comparatifPrix.ts`. Toute
// évolution de l'un doit être répercutée sur l'autre (tests/agentConsultationPostes.test.ts).
import { failure, norm, plural, text, type Json, type ToolRequest } from './toolRequest.js';

type Result = { response: Json; summary?: string };
type Prix = Record<string, number | null>;

export const FICHIER_SAISIE_MANUELLE = 'Saisie manuelle';
const MAX_ITEMS = 50;
const MAX_POSTES = 600;
const today = () => new Date().toISOString().slice(0, 10);

// ── Lecture du document ──────────────────────────────────────────────────────

export interface Article { id: string; numero: string; designation: string; unite: string; quantite: number; horsBase: boolean }

const estHorsBase = (l: Json) => !!l.nature && l.nature !== 'base';

/** Articles feuilles chiffrables d'un lot du DPGF, dans l'ordre du document (comme `chapitresDuLot`). */
export function articlesDuLot(lot: Json): Article[] {
  const feuilles = (lignes: Json[], horsBaseParent = false): Article[] => lignes.flatMap((l): Article[] => {
    if (l.cctpOnly) return [];
    const hb = horsBaseParent || estHorsBase(l);
    if (Array.isArray(l.children) && l.children.length) return feuilles(l.children, hb);
    if (l.type === 'titre' || l.type === 'commentaire' || l.type === 'sous-total') return [];
    return [{ id: String(l.id), numero: text(l.numero), designation: text(l.designation), unite: text(l.unite), quantite: Number(l.quantite) || 0, horsBase: hb }];
  });
  return (Array.isArray(lot.chapitres) ? lot.chapitres : [])
    .filter((c: Json) => !c.cctpOnly)
    .flatMap((c: Json) => feuilles(Array.isArray(c.lignes) ? c.lignes : []));
}

const segment = (s: string) => (/^\d+$/.test(s) ? String(parseInt(s, 10)) : s.toLowerCase());
/** « 03.01 » et « 3.1 » désignent le même numéro. */
export const cleNumero = (n: unknown) => text(n).split('.').map(s => segment(s.trim())).filter(Boolean).join('.');

/**
 * Article d'un lot désigné par son numéro (dans le lot : « 3.1 », ou préfixé par le numéro du lot : « 02.3.1 ») ou par
 * son identifiant. Un numéro porté par deux articles du lot est refusé : on ne devine pas.
 */
export function trouverArticle(articles: Article[], ref: Json, numeroLot: string): { article?: Article; erreur?: string } {
  if (text(ref.id)) {
    const a = articles.find(x => x.id === text(ref.id));
    return a ? { article: a } : { erreur: `identifiant de poste introuvable : ${text(ref.id)}` };
  }
  const brut = cleNumero(ref.numero);
  if (!brut) return { erreur: 'numero (ou id) du poste requis' };
  const prefixe = cleNumero(numeroLot);
  const candidats = [brut, ...(prefixe && brut.startsWith(`${prefixe}.`) ? [brut.slice(prefixe.length + 1)] : [])];
  for (const c of candidats) {
    const trouves = articles.filter(x => cleNumero(x.numero) === c);
    if (trouves.length === 1) return { article: trouves[0] };
    if (trouves.length > 1) return { erreur: `numéro ${text(ref.numero)} porté par ${trouves.length} postes du lot : ${trouves.map(t => `« ${t.designation} »`).join(', ')} (utilise id)` };
  }
  return { erreur: `poste ${text(ref.numero)} introuvable dans le DPGF de ce lot` };
}

// ── Prix d'une entreprise (reprise de comparatifPrix.ts) ─────────────────────

export interface PosteAjoute { id: string; numero: string; designation: string; unite: string; quantite: number | null; prixUnitaire: number | null; lotId?: string; /** Article du DPGF que le poste chiffre (rattachement posé à l'écran), conservé à chaque réécriture. */ articleId?: string }

const retenue = (o: Json, entrepriseId: string) => o.entrepriseId === entrepriseId && o.statut !== 'ecartee';

/** Prix d'une entreprise sur tout le document : plusieurs fichiers se superposent, le plus récent l'emporte. */
export function prixEntreprise(offres: Json[], entrepriseId: string): Prix {
  const out: Prix = {};
  const docs = offres.filter(o => retenue(o, entrepriseId)).sort((a, b) => String(a.importedAt || '').localeCompare(String(b.importedAt || '')));
  for (const o of docs) for (const [id, pu] of Object.entries((o.prix ?? {}) as Prix)) out[id] = pu;
  return out;
}

export function ajoutsEntreprise(offres: Json[], entrepriseId: string, lotId: string): PosteAjoute[] {
  return offres.filter(o => retenue(o, entrepriseId)).flatMap(o => ((o.postesAjoutes ?? []) as PosteAjoute[]).filter(p => p.lotId === lotId));
}

/** Sans quantité annoncée, un poste ajouté vaut 1 (« ens », « forf »). */
const montantPoste = (p: PosteAjoute) => (p.prixUnitaire != null ? p.prixUnitaire * (p.quantite ?? 1) : 0);

/** Total HT d'un lot d'après les P.U. (base seulement, options comptées à part) + postes ajoutés ; null sans aucun prix. */
export function totalLotPostes(articles: Article[], prix: Prix, ajouts: PosteAjoute[], quantiteDe: (a: Article) => number = a => a.quantite): number | null {
  let total = 0; let chiffres = 0;
  for (const a of articles) {
    const pu = prix[a.id];
    if (typeof pu !== 'number') continue;
    chiffres++;
    if (!a.horsBase) total += pu * quantiteDe(a);
  }
  for (const p of ajouts) if (p.prixUnitaire != null) { chiffres++; total += montantPoste(p); }
  return chiffres > 0 ? total : null;
}

// ── Quantités de l'entreprise (reprise de quantitesEntreprise.ts) ────────────
// Une quantité n'est gardée que si elle DIFFÈRE de celle du DPGF (absence = même quantité) ; le DPGF n'est jamais modifié.

export type Quantites = Record<string, number>;
/** Comparaison à la virgule près : seul le bruit des nombres flottants est écarté. */
export const quantitesDifferent = (a: number, b: number) => Math.abs(a - b) > 1e-9;

export function quantitesEntreprise(offres: Json[], entrepriseId: string): Quantites {
  const out: Quantites = {};
  const docs = offres.filter(o => retenue(o, entrepriseId)).sort((a, b) => String(a.importedAt || '').localeCompare(String(b.importedAt || '')));
  for (const o of docs) for (const [id, q] of Object.entries((o.quantites ?? {}) as Quantites)) if (typeof q === 'number' && Number.isFinite(q)) out[id] = q;
  return out;
}

export function quantitesAcceptees(offres: Json[], entrepriseId: string): Set<string> {
  const docs = offres.filter(o => retenue(o, entrepriseId)).sort((a, b) => String(a.importedAt || '').localeCompare(String(b.importedAt || '')));
  const acceptees = new Set<string>();
  for (const o of docs) {
    for (const id of Object.keys(o.quantites ?? {})) acceptees.delete(id);
    for (const id of (o.quantitesAcceptees ?? []) as string[]) acceptees.add(id);
  }
  return acceptees;
}

/** Quantité utilisée pour un article : base `moe` (celle du DPGF, sauf quantité acceptée) ou `entreprise` (toujours la sienne). */
export const quantiteRetenue = (base: 'moe' | 'entreprise', a: Article, q: Quantites, acceptees: ReadonlySet<string>) =>
  typeof q[a.id] === 'number' && (base === 'entreprise' || acceptees.has(a.id)) ? q[a.id] : a.quantite;

export interface MiseAJourOffre { id: string | null; prix: Prix; postesAjoutes: PosteAjoute[]; quantites?: Quantites; quantitesAcceptees?: string[] }

/**
 * Répartit l'état voulu d'un lot (prix et postes ajoutés d'UNE entreprise) entre ses offres : un prix corrigé est
 * réécrit dans l'offre qui le porte (la plus récente), un prix supprimé l'est partout, un prix nouveau va dans l'offre
 * « Saisie manuelle ». Les autres lots de ces offres ne sont jamais touchés. Ne rend que les offres qui changent.
 */
export function repartirSaisie(
  offres: Json[], entrepriseId: string, lotId: string, idsLot: string[], prixLot: Prix, ajoutsLot: PosteAjoute[],
  /** Quantités voulues (article -> quantité, undefined : celle du DPGF) et articles acceptés ; omis : quantités enregistrées non touchées. */
  quantitesLot?: Record<string, number | undefined>, accepteesLot?: ReadonlySet<string>,
): MiseAJourOffre[] {
  const miennes = offres.filter(o => retenue(o, entrepriseId)).sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')));
  const manuelle = miennes.find(o => o.fichierNom === FICHIER_SAISIE_MANUELLE) ?? null;

  const etats = new Map<string | null, MiseAJourOffre>();
  const etat = (o: Json | null): MiseAJourOffre => {
    const cle = o?.id ?? null;
    let e = etats.get(cle);
    if (!e) { e = { id: cle, prix: { ...(o?.prix ?? {}) }, postesAjoutes: [...(o?.postesAjoutes ?? [])] }; etats.set(cle, e); }
    return e;
  };

  for (const id of idsLot) {
    const voulu = prixLot[id];
    const porteuses = miennes.filter(o => Object.prototype.hasOwnProperty.call(o.prix ?? {}, id));
    if (voulu === undefined) { for (const o of porteuses) delete etat(o).prix[id]; }
    else etat(porteuses[0] ?? manuelle).prix[id] = voulu;
  }

  if (quantitesLot) {
    const qEtat = (o: Json | null) => {
      const e = etat(o);
      e.quantites ??= { ...(o?.quantites ?? {}) };
      e.quantitesAcceptees ??= [...(o?.quantitesAcceptees ?? [])];
      return e as MiseAJourOffre & { quantites: Quantites; quantitesAcceptees: string[] };
    };
    for (const id of idsLot) {
      const voulue = quantitesLot[id];
      const porteuses = miennes.filter(o => Object.prototype.hasOwnProperty.call(o.prix ?? {}, id));
      for (const o of miennes) {
        if (Object.prototype.hasOwnProperty.call(o.quantites ?? {}, id)) delete qEtat(o).quantites[id];
        if (((o.quantitesAcceptees ?? []) as string[]).includes(id)) qEtat(o).quantitesAcceptees = qEtat(o).quantitesAcceptees.filter(x => x !== id);
      }
      if (typeof voulue !== 'number') continue;
      const porteuse = qEtat(porteuses[0] ?? manuelle);
      porteuse.quantites[id] = voulue;
      if (accepteesLot?.has(id)) porteuse.quantitesAcceptees.push(id);
    }
  }

  const voulus = new Map(ajoutsLot.map(p => [p.id, p]));
  const places = new Set<string>();
  for (const o of miennes) {
    const courants = (o.postesAjoutes ?? []) as PosteAjoute[];
    const gardes = courants.filter(p => p.lotId !== lotId || voulus.has(p.id)).map(p => (p.lotId === lotId ? voulus.get(p.id)! : p));
    for (const p of gardes) if (p.lotId === lotId) places.add(p.id);
    if (JSON.stringify(gardes) !== JSON.stringify(courants)) etat(o).postesAjoutes = gardes;
  }
  for (const p of ajoutsLot) if (!places.has(p.id)) etat(manuelle).postesAjoutes.push({ ...p, lotId });

  const originaux = new Map(miennes.map(o => [o.id, o]));
  return [...etats.values()].filter(e => {
    const o = e.id ? originaux.get(e.id) : null;
    if (!o) return Object.keys(e.prix).length > 0 || e.postesAjoutes.length > 0 || Object.keys(e.quantites ?? {}).length > 0;
    return JSON.stringify(e.prix) !== JSON.stringify(o.prix ?? {}) || JSON.stringify(e.postesAjoutes) !== JSON.stringify(o.postesAjoutes ?? [])
      || (e.quantites !== undefined && JSON.stringify(e.quantites) !== JSON.stringify(o.quantites ?? {}))
      || (e.quantitesAcceptees !== undefined && JSON.stringify([...e.quantitesAcceptees].sort()) !== JSON.stringify([...(o.quantitesAcceptees ?? [])].sort()));
  });
}

// ── Outil ────────────────────────────────────────────────────────────────────

export interface PostesCtx {
  request: ToolRequest; pid: string; args: Json; consultation: Json; entreprises: Json[]; lots: Json[];
  lotNum: (id: string) => unknown; recordUrl: string;
  /** Écrit le total, le mode « postes » et la date de réception dans la consultation (`manageOffres`, modePostes). */
  ecrireConsultation: (items: Json[]) => Promise<Result>;
}

const nombre = (v: unknown): number => (typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.')));
/** undefined = absent ; null = pour mémoire ; sinon nombre >= 0 ; NaN = invalide. */
const puSaisi = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === 'string' && /^(pm|pour m[ée]moire)$/i.test(v.trim()))) return null;
  const n = nombre(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6) / 1e6 : NaN;
};

interface Plan {
  label: string; item: Json; lot: Json; docLot: Json; articles: Article[]; entId: string | null; entNom: string;
  prixLot: Prix; ajouts: PosteAjoute[]; total: number; nbChiffres: number; nbMemoire: number; nbAjoutes: number; ancien?: Json;
  /** Quantités de l'entreprise à écrire (seulement quand l'appel en donne) et articles acceptés ; écarts constatés avec le DPGF. */
  quantitesLot?: Record<string, number | undefined>; accepteesLot?: Set<string>; ecartsQuantites: Json[];
}

export async function manageOffresPostes(c: PostesCtx): Promise<Result> {
  const { request, pid, args, consultation, entreprises, lots, lotNum, recordUrl } = c;
  if (consultation.document_reference === 'bpu') {
    return failure("Cette consultation compare le bordereau (BPU), pas le DPGF : la saisie par poste n'est disponible que pour le DPGF.");
  }
  const base = `/api/projects/${encodeURIComponent(pid)}/dpgf`;
  const [{ res: dr, json: doc }, { res: or, json: offresLues }] = await Promise.all([request(base), request(`${base}/offres`)]);
  if (!dr.ok || !Array.isArray(doc?.lots) || doc.lots.length === 0) return failure("Ce projet n'a pas de DPGF : la saisie par poste s'appuie sur ses articles.");
  let offres: Json[] = or.ok && Array.isArray(offresLues) ? offresLues : [];

  const items = (Array.isArray(args.offres) ? args.offres : []).filter((x: unknown) => x && typeof x === 'object').slice(0, MAX_ITEMS) as Json[];
  if (!items.length) return failure('offres est requis : [{lot, entreprise, postes: [{numero, prix_unitaire}], postes_ajoutes?: [...]}].');

  const plans: Plan[] = []; const non_traites: Json[] = []; const vus = new Set<string>();
  for (const it of items) {
    const label = `${text(it.entreprise) || text(it.contact_id) || '?'} / lot ${text(it.lot) || '?'}`;
    const lot = lots.find(l => String(l.id) === text(it.lot) || norm(l.lot_number) === norm(it.lot));
    if (!lot) { non_traites.push({ element: label, raison: 'lot introuvable', lots_possibles: lots.map(l => l.lot_number) }); continue; }
    const docLot = doc.lots.find((l: Json) => l.projectLotId === lot.id) ?? doc.lots.find((l: Json) => cleNumero(l.numero) === cleNumero(lot.lot_number));
    if (!docLot) { non_traites.push({ element: label, raison: "ce lot n'existe pas dans le DPGF (onglet PRO)" }); continue; }
    const ent = entreprises.find(e => String(e.id) === text(it.entreprise ?? it.contact_id) || (text(it.contact_id) && e.contact_id === text(it.contact_id)) || norm(e.nom) === norm(it.entreprise));
    const cleDoublon = `${lot.id}|${ent?.id ?? norm(it.entreprise ?? it.contact_id)}`;
    if (vus.has(cleDoublon)) { non_traites.push({ element: label, raison: 'lot et entreprise déjà présents dans cet appel' }); continue; }
    vus.add(cleDoublon);

    const articles = articlesDuLot(docLot);
    const postes = (Array.isArray(it.postes) ? it.postes : []).filter((x: unknown) => x && typeof x === 'object') as Json[];
    const ajoutes = (Array.isArray(it.postes_ajoutes) ? it.postes_ajoutes : []).filter((x: unknown) => x && typeof x === 'object') as Json[];
    if (!postes.length && !ajoutes.length) { non_traites.push({ element: label, raison: 'postes ou postes_ajoutes requis' }); continue; }
    if (postes.length + ajoutes.length > MAX_POSTES) { non_traites.push({ element: label, raison: `${MAX_POSTES} lignes au plus par lot et par appel` }); continue; }

    const erreurs: Json[] = []; const nouveaux: Prix = {}; const articlesVus = new Set<string>();
    const quantitesDonnees: Record<string, number | undefined> = {}; let quantitesFournies = false;
    for (const p of postes) {
      const { article, erreur } = trouverArticle(articles, p, text(docLot.numero));
      if (!article) { erreurs.push({ poste: text(p.numero ?? p.id), raison: erreur }); continue; }
      if (articlesVus.has(article.id)) { erreurs.push({ poste: article.numero, raison: 'poste indiqué deux fois' }); continue; }
      articlesVus.add(article.id);
      const pu = puSaisi(p.pour_memoire === true ? null : p.prix_unitaire);
      if (pu === undefined) { erreurs.push({ poste: article.numero, raison: 'prix_unitaire requis (ou pour_memoire: true)' }); continue; }
      if (typeof pu === 'number' && Number.isNaN(pu)) { erreurs.push({ poste: article.numero, raison: 'prix_unitaire : nombre positif ou nul, en euros HT' }); continue; }
      nouveaux[article.id] = pu;
      if (p.quantite !== undefined && p.quantite !== null && p.quantite !== '') {
        const q = nombre(p.quantite);
        if (!Number.isFinite(q) || q < 0) { erreurs.push({ poste: article.numero, raison: 'quantite : nombre positif ou nul (la quantité proposée par l\'entreprise)' }); continue; }
        quantitesFournies = true;
        // Une quantité qui reprend celle du DPGF (ou un poste sans quantité) n'est pas gardée : absence = même quantité.
        quantitesDonnees[article.id] = article.quantite > 0 && quantitesDifferent(q, article.quantite) ? q : undefined;
      }
    }
    const entId = ent ? String(ent.id) : null;
    let ajouts: PosteAjoute[] = entId ? ajoutsEntreprise(offres, entId, String(docLot.id)) : [];
    for (const a of ajoutes) {
      if (!text(a.designation)) { erreurs.push({ poste_ajoute: text(a.numero), raison: 'designation requise' }); continue; }
      const pu = puSaisi(a.pour_memoire === true ? null : a.prix_unitaire);
      if (pu === undefined || (typeof pu === 'number' && Number.isNaN(pu))) { erreurs.push({ poste_ajoute: text(a.designation), raison: 'prix_unitaire : nombre positif ou nul (ou pour_memoire: true)' }); continue; }
      const q = a.quantite === undefined || a.quantite === null ? null : nombre(a.quantite);
      if (q !== null && (!Number.isFinite(q) || q < 0)) { erreurs.push({ poste_ajoute: text(a.designation), raison: 'quantite : nombre positif ou nul' }); continue; }
      const poste: PosteAjoute = { id: crypto.randomUUID(), numero: text(a.numero), designation: text(a.designation), unite: text(a.unite), quantite: q, prixUnitaire: pu, lotId: String(docLot.id) };
      // Rejouer un appel met à jour la ligne déjà saisie (même numéro et même désignation) au lieu de la doubler.
      const meme = ajouts.find(x => cleNumero(x.numero) === cleNumero(poste.numero) && norm(x.designation) === norm(poste.designation));
      if (meme) ajouts = ajouts.map(x => (x === meme ? { ...poste, id: meme.id, ...(meme.articleId ? { articleId: meme.articleId } : {}) } : x));
      else ajouts.push(poste);
    }
    if (erreurs.length) {
      non_traites.push({
        element: label, raison: "lignes refusées : rien n'est enregistré pour ce lot", erreurs,
        ...(erreurs.some(e => String(e.raison).includes('introuvable')) ? { numeros_possibles: articles.slice(0, 80).map(a => a.numero) } : {}),
      });
      continue;
    }

    const actuel = entId ? prixEntreprise(offres, entId) : {};
    const prixLot: Prix = {};
    for (const a of articles) if (Object.prototype.hasOwnProperty.call(actuel, a.id)) prixLot[a.id] = actuel[a.id];
    Object.assign(prixLot, nouveaux);
    // Quantités de l'entreprise : celles déjà enregistrées, complétées par celles de cet appel. Le total suit la base du lot.
    const dejaQ = entId ? quantitesEntreprise(offres, entId) : {};
    const accepteesLot = new Set(entId ? quantitesAcceptees(offres, entId) : []);
    const quantitesLot: Record<string, number | undefined> = {};
    for (const a of articles) if (typeof dejaQ[a.id] === 'number') quantitesLot[a.id] = dejaQ[a.id];
    Object.assign(quantitesLot, quantitesDonnees);
    for (const a of articles) if (quantitesLot[a.id] === undefined) accepteesLot.delete(a.id);
    const qActuelles: Quantites = {};
    for (const a of articles) if (typeof quantitesLot[a.id] === 'number') qActuelles[a.id] = quantitesLot[a.id] as number;
    const baseQ: 'moe' | 'entreprise' = consultation.base_quantites === 'entreprise' ? 'entreprise' : 'moe';
    const total = totalLotPostes(articles, prixLot, ajouts, a => quantiteRetenue(baseQ, a, qActuelles, accepteesLot)) ?? 0;
    const ecartsQuantites = articles.filter(a => typeof qActuelles[a.id] === 'number').map(a => ({
      poste: a.numero, quantite_dpgf: a.quantite, quantite_entreprise: qActuelles[a.id], acceptee: accepteesLot.has(a.id),
    }));
    const valeurs = articles.map(a => prixLot[a.id]);
    plans.push({
      label, item: it, lot, docLot, articles, entId, entNom: ent ? String(ent.nom) : text(it.entreprise), prixLot, ajouts, total: Math.round(total * 100) / 100,
      nbChiffres: valeurs.filter(v => typeof v === 'number').length + ajouts.filter(p => p.prixUnitaire != null).length,
      nbMemoire: valeurs.filter(v => v === null).length + ajouts.filter(p => p.prixUnitaire == null).length,
      nbAjoutes: ajouts.length,
      ...(quantitesFournies ? { quantitesLot, accepteesLot } : {}), ecartsQuantites,
      ancien: ent ? (Array.isArray(consultation.offres) ? consultation.offres : []).find((o: Json) => o.lot_id === lot.id && o.entreprise_id === ent.id) : undefined,
    });
  }
  if (!plans.length) return failure("Aucune saisie n'a pu être faite.", { non_traites });

  // Passer en « postes » remplace un total saisi à la main : confirmation, avec les deux montants.
  const ecrasements = plans
    .filter(p => p.ancien && p.ancien.mode_saisie !== 'postes' && Number(p.ancien.montant_base) > 0 && Math.abs(Number(p.ancien.montant_base) - p.total) > 0.005)
    .map(p => ({ lot: lotNum(String(p.lot.id)), entreprise: p.entNom, total_saisi_actuel: p.ancien!.montant_base, nouveau_total_calcule: p.total }));
  if (ecrasements.length && args.confirm !== true) {
    return {
      response: {
        needs_confirmation: true, concerne: ecrasements, ...(non_traites.length ? { non_traites } : {}),
        avertissement: "Ces lots sont saisis au total : la saisie par poste remplace ce total par celui calculé d'après les prix (le total tapé n'est pas conservé).",
        instruction: "Présente cela à l'utilisateur. Ne rappelle l'outil avec confirm: true qu'après son accord explicite.",
      },
    };
  }

  // 1) La consultation d'abord : elle ajoute au besoin l'entreprise (donc son identifiant), le lot et la date de réception.
  const suivi: Json[] = plans.map(p => ({
    lot: lotNum(String(p.lot.id)), entreprise: text(p.item.entreprise), contact_id: p.item.contact_id, montant_base_ht: p.total,
    ...(p.item.partielle !== undefined ? { partielle: p.item.partielle } : {}), ...(p.item.perimetre !== undefined ? { perimetre: p.item.perimetre } : {}),
    ...(p.item.offre_recue_le !== undefined ? { offre_recue_le: p.item.offre_recue_le } : {}),
    ...(p.item.conforme !== undefined ? { conforme: p.item.conforme } : {}), ...(p.item.motif_non_conformite !== undefined ? { motif_non_conformite: p.item.motif_non_conformite } : {}),
    ...(p.item.note_technique !== undefined ? { note_technique: p.item.note_technique } : {}),
  }));
  const maj = await c.ecrireConsultation(suivi);
  if (maj.response.error && !maj.response.aucune_modification) return maj;
  const refus: Json[] = Array.isArray(maj.response.non_traites) ? maj.response.non_traites : [];

  const { res: ar, json: act } = await request(`/api/projects/${encodeURIComponent(pid)}/act`);
  const frais: Json[] = ar.ok && Array.isArray(act?.consultation?.entreprises) ? act.consultation.entreprises : [];

  // 2) Puis les prix dans les offres du DPGF, comme l'écran (`ecrireSaisie`).
  const faits: Json[] = [];
  for (const p of plans) {
    const ent = frais.find(e => (p.entId && String(e.id) === p.entId) || (text(p.item.contact_id) && e.contact_id === text(p.item.contact_id)) || norm(e.nom) === norm(p.entNom));
    if (!ent) {
      non_traites.push({ element: p.label, raison: 'entreprise non ajoutée à la consultation, prix non enregistrés', detail: refus.filter(r => norm(r.element).startsWith(norm(p.entNom))) });
      continue;
    }
    const idsLot = p.articles.map(a => a.id);
    const mises = repartirSaisie(offres, String(ent.id), String(p.docLot.id), idsLot, p.prixLot, p.ajouts, p.quantitesLot, p.accepteesLot);
    for (const m of mises) {
      if (m.id) {
        const { res, json } = await request(`${base}/offres/${encodeURIComponent(m.id)}`, 'PUT', {
          prix: m.prix, postesAjoutes: m.postesAjoutes,
          ...(m.quantites ? { quantites: m.quantites, quantitesAcceptees: m.quantitesAcceptees ?? [] } : {}),
        });
        if (!res.ok) return failure(`${json?.error || `Enregistrement des prix impossible (HTTP ${res.status})`}. La consultation est déjà à jour : rejouer l'appel est sans risque.`, { faits });
        offres = offres.map(o => (o.id === m.id ? { ...o, ...json } : o));
      } else {
        const { res, json } = await request(`${base}/offres`, 'POST', {
          offre: {
            entrepriseId: String(ent.id), entrepriseNom: String(ent.nom), dateReception: today(), fichierNom: FICHIER_SAISIE_MANUELLE,
            documentVersion: doc.version ?? '', prix: m.prix, anomalies: [], postesAjoutes: m.postesAjoutes, statut: 'validee',
            ...(m.quantites ? { quantites: m.quantites, quantitesAcceptees: m.quantitesAcceptees ?? [] } : {}),
          },
        });
        if (!res.ok) return failure(`${json?.error || `Enregistrement des prix impossible (HTTP ${res.status})`}. La consultation est déjà à jour : rejouer l'appel est sans risque.`, { faits });
        offres = [...offres, json];
      }
    }
    faits.push({
      lot: lotNum(String(p.lot.id)), entreprise: String(ent.nom), postes_chiffres: p.nbChiffres, postes_pour_memoire: p.nbMemoire, postes_ajoutes_par_l_entreprise: p.nbAjoutes,
      total_ht: p.total, ...(p.ancien?.montant_base ? { ancien_montant_ht: p.ancien.montant_base } : {}),
      articles_du_dpgf_non_chiffres: p.articles.filter(a => p.prixLot[a.id] === undefined).length,
      ...(p.ecartsQuantites.length ? { quantites_differentes_du_dpgf: p.ecartsQuantites } : {}),
    });
  }
  if (!faits.length) return failure("Aucune saisie n'a pu être faite.", { non_traites });

  return {
    response: {
      success: true, project_id: pid, saisies: faits, ...(non_traites.length ? { non_traites } : {}),
      rappel: "Le DPGF n'est pas modifié : ces prix (et les quantités proposées par l'entreprise, si elles diffèrent) sont rangés par entreprise, à côté de l'estimation. Le total du lot est calculé d'après les prix, sur les quantités du maître d'œuvre sauf quantités acceptées (ou sur celles de l'entreprise si la base de la consultation l'indique) ; accepter une quantité se fait à l'écran.",
      record_url: recordUrl,
    },
    summary: `${plural(faits.length, 'lot saisi')} poste par poste (consultation)`,
  };
}
