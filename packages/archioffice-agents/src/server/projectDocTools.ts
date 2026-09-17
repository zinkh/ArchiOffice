// ── Lecture du CCTP et du DPGF d'un projet ──────────────────────────────────
// Un CCTP complet fait couramment plusieurs centaines de milliers de
// caractères et un DPGF plusieurs milliers de lignes : les injecter tels
// quels coûterait plus cher en jetons que tout le reste du prompt réuni, pour
// une question qui ne porte le plus souvent que sur un lot.
//
// D'où deux niveaux : sans `lot`, un sommaire (lots, chapitres, totaux) ;
// avec `lot`, le détail de ce seul lot, tronqué. Le modèle choisit donc
// lui-même sa profondeur de lecture, au lieu de tout recevoir à chaque
// message comme le fait le référentiel firm_knowledge.
import type { FunctionDeclarationLike, ToolOutcome } from './toolTypes.js';
import { internalHeaders, type InternalAuth } from './internalApi.js';

const MAX_ARTICLE_CHARS = 1200;
const MAX_ARTICLES_PER_LOT = 60;
const MAX_LIGNES_PER_LOT = 120;

async function getJson(baseUrl: string, path: string, auth: InternalAuth): Promise<{ status: number; data: any }> {
  try {
    const res = await fetch(baseUrl + path, { headers: internalHeaders(auth) });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  } catch (e: any) {
    return { status: 0, data: { error: e?.message || 'Requête impossible.' } };
  }
}

async function postJson(baseUrl: string, path: string, auth: InternalAuth, body: unknown): Promise<{ status: number; data: any }> {
  try {
    const res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: internalHeaders(auth, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  } catch (e: any) {
    return { status: 0, data: { error: e?.message || 'Requête impossible.' } };
  }
}

function matchesLot(lot: any, wanted: string): boolean {
  const needle = wanted.toLowerCase().trim();
  return (
    String(lot?.numero ?? '').toLowerCase() === needle ||
    String(lot?.titre ?? '').toLowerCase().includes(needle)
  );
}

// Le CCTP n'est pas un document séparé : sa description technique vit dans
// les champs `cctpDescription` portés par les lots, chapitres et lignes du
// même arbre que le DPGF (src/components/pro/CCTPEditor.tsx — « le CCTP
// partage le même dpgf.lots »). `read_cctp` lit donc la même ressource que
// `read_dpgf` (voir KIND_BY_TOOL plus bas) et cette fonction en extrait le
// texte CCTP plutôt que les montants.
function nbArticlesCctp(lignes: any[]): number {
  let n = 0;
  for (const l of lignes ?? []) {
    if (Array.isArray(l?.children) && l.children.length) n += nbArticlesCctp(l.children);
    else n++;
  }
  return n;
}

function resumerArticlesCctp(lignes: any[], remaining: { n: number }): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const l of lignes ?? []) {
    if (remaining.n <= 0) break;
    if (Array.isArray(l?.children) && l.children.length) {
      out.push(...resumerArticlesCctp(l.children, remaining));
      continue;
    }
    remaining.n--;
    const text = String(l?.cctpDescription ?? '');
    out.push({
      numero: l?.numero,
      designation: l?.designation,
      unite: l?.unite,
      contenu: text ? text.slice(0, MAX_ARTICLE_CHARS) : undefined,
      tronque: text.length > MAX_ARTICLE_CHARS || undefined,
    });
  }
  return out;
}

export function summarizeCctp(dpgf: any, wantedLot?: string): Record<string, unknown> {
  const lots: any[] = Array.isArray(dpgf?.lots) ? dpgf.lots : [];
  const header = {
    titre: dpgf?.titre ?? null,
    version: dpgf?.version ?? null,
    statut: dpgf?.statut ?? null,
    nb_lots: lots.length,
  };

  if (!wantedLot) {
    return {
      ...header,
      lots: lots.map(l => ({
        numero: l?.numero,
        titre: l?.titre,
        nb_chapitres: Array.isArray(l?.chapitres) ? l.chapitres.length : 0,
        nb_articles: (l?.chapitres || []).reduce((n: number, c: any) => n + nbArticlesCctp(c?.lignes || []), 0),
      })),
      note: "Sommaire uniquement. Rappelle read_cctp avec le paramètre lot pour obtenir le détail d'un lot précis.",
    };
  }

  const lot = lots.find(l => matchesLot(l, wantedLot));
  if (!lot) {
    return { ...header, error: `Aucun lot ne correspond à « ${wantedLot} ».`, lots_disponibles: lots.map(l => `${l?.numero} ${l?.titre}`) };
  }

  const remaining = { n: MAX_ARTICLES_PER_LOT };
  const chapitres = (lot.chapitres || []).map((c: any) => ({
    numero: c?.numero,
    titre: c?.titre,
    description: c?.cctpDescription || undefined,
    articles: resumerArticlesCctp(c?.lignes || [], remaining),
  }));

  return { ...header, lot: { numero: lot.numero, titre: lot.titre, description: lot.cctpDescription || undefined, chapitres } };
}

export function summarizeDpgf(dpgf: any, wantedLot?: string): Record<string, unknown> {
  const lots: any[] = Array.isArray(dpgf?.lots) ? dpgf.lots : [];
  const header = {
    titre: dpgf?.titre ?? null,
    version: dpgf?.version ?? null,
    statut: dpgf?.statut ?? null,
    total_ht: dpgf?.totalHT ?? null,
    tva: dpgf?.TVA ?? null,
    total_ttc: dpgf?.totalTTC ?? null,
    nb_lots: lots.length,
  };

  if (!wantedLot) {
    return {
      ...header,
      lots: lots.map(l => ({ numero: l?.numero, titre: l?.titre, sous_total_ht: l?.sousTotal ?? null })),
      note: "Sommaire uniquement. Rappelle read_dpgf avec le paramètre lot pour obtenir le détail chiffré d'un lot.",
    };
  }

  const lot = lots.find(l => matchesLot(l, wantedLot));
  if (!lot) {
    return { ...header, error: `Aucun lot ne correspond à « ${wantedLot} ».`, lots_disponibles: lots.map(l => `${l?.numero} ${l?.titre}`) };
  }

  const lignes: any[] = [];
  const walk = (rows: any[]) => {
    for (const row of rows || []) {
      if (lignes.length >= MAX_LIGNES_PER_LOT) return;
      lignes.push({
        numero: row?.numero,
        designation: row?.designation,
        unite: row?.unite,
        quantite: row?.quantite,
        prix_unitaire_ht: row?.prixUnitaire,
        prix_total_ht: row?.prixTotal,
      });
      if (Array.isArray(row?.children)) walk(row.children);
    }
  };
  for (const chapitre of lot.chapitres || []) walk(chapitre?.lignes || []);

  return {
    ...header,
    lot: { numero: lot.numero, titre: lot.titre, sous_total_ht: lot.sousTotal ?? null, lignes },
    tronque: lignes.length >= MAX_LIGNES_PER_LOT || undefined,
  };
}

const TYPE_MARCHE_LABELS: Record<string, string> = {
  bons_de_commande: 'marché à bons de commande',
  prix_unitaires: 'marché à prix unitaires',
  mixte: 'marché mixte',
};

/**
 * Résume un BPU. La note d'en-tête n'est pas décorative : sans elle, un modèle
 * présente volontiers le total du DQE comme « le montant du marché », alors
 * qu'un bordereau de prix unitaires n'a pas de montant — les travaux se règlent
 * sur quantités réellement exécutées. C'est l'erreur métier que la
 * fonctionnalité existe pour éviter.
 */
function summarizeBpu(bpu: any, wantedLot?: string): Record<string, unknown> {
  const marche = bpu?.marche ?? {};
  const lots: any[] = Array.isArray(bpu?.lots) ? bpu.lots : [];

  let nbArticles = 0;
  const compter = (lignes: any[]) => {
    for (const l of lignes ?? []) {
      if (Array.isArray(l.children) && l.children.length) compter(l.children);
      else nbArticles++;
    }
  };
  for (const lot of lots) for (const chap of lot.chapitres ?? []) compter(chap.lignes);

  const entete = {
    titre: bpu?.titre, version: bpu?.version, statut: bpu?.statut,
    type_marche: TYPE_MARCHE_LABELS[marche.typeMarche] ?? marche.typeMarche,
    objet: marche.objet || undefined,
    montant_mini_ht: marche.montantMiniHT,
    montant_maxi_ht: marche.montantMaxiHT,
    duree_mois: marche.dureeInitialeMois,
    nb_reconductions: marche.nbReconductions,
    nb_lots: lots.length,
    nb_articles: nbArticles,
    nb_tranches: (bpu?.tranches ?? []).length,
    montant_estimatif_dqe_ht: bpu?.totalHT,
    note:
      "Un BPU est un catalogue de prix unitaires : le montant indiqué est une ESTIMATION (le DQE), " +
      "pas le montant du marché. Les travaux sont réglés sur quantités réellement exécutées.",
  };

  if (!wantedLot) {
    return {
      ...entete,
      tranches: (bpu?.tranches ?? []).map((t: any) => ({ code: t.code, libelle: t.libelle, type: t.type })),
      lots: lots.map(l => ({ numero: l.numero, titre: l.titre, montant_estimatif_ht: l.sousTotal })),
      note_navigation: "Rappelle cet outil avec le paramètre lot pour obtenir les articles d'un lot.",
    };
  }

  const lot = lots.find(l => matchesLot(l, wantedLot));
  if (!lot) return { ...entete, erreur: `Aucun lot ne correspond à « ${wantedLot} ».` };

  const articles: Record<string, unknown>[] = [];
  const walk = (lignes: any[]) => {
    for (const l of lignes ?? []) {
      if (articles.length >= MAX_LIGNES_PER_LOT) return;
      if (Array.isArray(l.children) && l.children.length) { walk(l.children); continue; }
      articles.push({
        numero: l.numero,
        designation: String(l.designation ?? '').slice(0, MAX_ARTICLE_CHARS),
        unite: l.unite,
        prix_unitaire_ht: l.prixUnitaire,
        quantite_estimative: l.quantite || undefined,
        nature: l.nature && l.nature !== 'base' ? l.nature : undefined,
      });
    }
  };
  for (const chap of lot.chapitres ?? []) walk(chap.lignes);

  return {
    ...entete,
    lot: { numero: lot.numero, titre: lot.titre, montant_estimatif_ht: lot.sousTotal },
    articles,
    tronque: articles.length >= MAX_LIGNES_PER_LOT || undefined,
  };
}

export function buildProjectDocTools(): FunctionDeclarationLike[] {
  const params = {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: "Identifiant du projet (visible dans la liste des projets du prompt système)" },
      lot: { type: 'string', description: "Numéro ou titre du lot à détailler. Sans ce paramètre, seul le sommaire est renvoyé." },
    },
    required: ['project_id'],
  };
  return [
    {
      name: 'read_cctp',
      description:
        "Lit le CCTP d'un projet. Sans paramètre lot, renvoie le sommaire (liste des lots et nombre d'articles) ; avec un lot, renvoie le détail des articles de ce lot. " +
        "Commence toujours par le sommaire avant de demander un lot précis.",
      parametersJsonSchema: params,
    },
    {
      name: 'read_dpgf',
      description:
        "Lit le DPGF (décomposition du prix global et forfaitaire) d'un projet. Sans paramètre lot, renvoie les totaux et les sous-totaux par lot ; avec un lot, renvoie ses lignes chiffrées.",
      parametersJsonSchema: params,
    },
    {
      name: 'read_bpu',
      description:
        "Lit le BPU (bordereau de prix unitaires) et le DQE d'un projet, pour les marchés à prix unitaires ou à bons de commande. " +
        "Sans paramètre lot, renvoie le cadre du marché et la liste des lots ; avec un lot, renvoie ses articles et leurs prix unitaires. " +
        "Le montant indiqué est une estimation (DQE), jamais le montant du marché.",
      parametersJsonSchema: params,
    },
  ];
}

export async function executeProjectDocTool(
  baseUrl: string,
  auth: InternalAuth,
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const projectId = String(args.project_id || '').trim();
  if (!projectId) return { response: { error: 'project_id est requis.' } };
  const lot = args.lot ? String(args.lot) : undefined;

  const kind = KIND_BY_TOOL[name];
  if (!kind) return { response: { error: `Outil inconnu : ${name}.` } };
  // Le CCTP n'a pas de route propre : sa description technique vit sur
  // l'arbre du DPGF (voir summarizeCctp ci-dessus), donc read_cctp lit la
  // même ressource que read_dpgf plutôt qu'un endpoint dédié — RESOURCE_BY_KIND.
  const resource = RESOURCE_BY_KIND[kind];
  const label = LABEL_BY_KIND[kind];
  const { status, data } = await getJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}/${resource}`, auth);

  // Le DPGF (et donc le CCTP, qui en dépend) répond 404 quand il n'existe
  // pas ; la route du BPU répond 200 avec null. Les deux veulent la même
  // réponse à l'utilisateur.
  if (status === 404 || (status === 200 && !data)) {
    return {
      response: {
        error: `Aucun ${label} n'existe encore pour ce projet — dis-le à l'utilisateur au lieu de supposer son contenu.`,
      },
    };
  }
  if (status !== 200 || !data) {
    return { response: { error: data?.error || `Lecture du ${label} impossible.` } };
  }

  // La route du BPU rend la ligne entière (document + offres), pas le document.
  const payload = kind === 'bpu' ? (data.document ?? data) : data;
  const summary = kind === 'cctp' ? summarizeCctp(payload, lot)
    : kind === 'bpu' ? summarizeBpu(payload, lot)
    : summarizeDpgf(payload, lot);
  return {
    response: summary,
    summary: `${label} consulté${lot ? ` (lot ${lot})` : ''}`,
  };
}

const KIND_BY_TOOL: Record<string, 'cctp' | 'dpgf' | 'bpu'> = {
  read_cctp: 'cctp', read_dpgf: 'dpgf', read_bpu: 'bpu',
};

// read_cctp lit la même route que read_dpgf (voir plus haut) : il n'existe
// plus de table/endpoint `cctps` séparé.
const RESOURCE_BY_KIND: Record<'cctp' | 'dpgf' | 'bpu', 'dpgf' | 'bpu'> = {
  cctp: 'dpgf', dpgf: 'dpgf', bpu: 'bpu',
};

const LABEL_BY_KIND: Record<'cctp' | 'dpgf' | 'bpu', string> = {
  cctp: 'CCTP', dpgf: 'DPGF', bpu: 'BPU',
};

export const PROJECT_DOC_TOOL_NAMES = Object.keys(KIND_BY_TOOL);

// ── Écriture du CCTP et du DPGF d'un projet ─────────────────────────────────
// Le CCTP n'est pas un document séparé (voir plus haut) : écrire un article
// signifie ajouter/modifier une LIGNE dans l'arbre lots > chapitres > lignes
// du DPGF, avec son texte technique (cctpDescription) et/ou ses champs
// chiffrés (unite/quantite/prixUnitaire) sur la même ligne. Le document
// entier est un blob JSON réécrit en bloc par POST (server/routes/dpgf.ts) —
// il n'y a pas de route CRUD par ligne, donc ce tool lit le document courant,
// modifie l'arbre en mémoire, recalcule les totaux touchés, puis le
// réécrit intégralement, exactement comme le ferait un humain dans
// CCTPEditor.tsx/DPGFWorkspace.tsx après une frappe.
//
// Volontairement scopé au niveau ARTICLE (lot > chapitre > article) : pas de
// sous-articles (children), pas de suppression, pas de champs de découpage
// (bâtiment/phase/tranche). Un agent qui doit aller plus loin doit le dire à
// l'utilisateur plutôt qu'improviser une structure que l'éditeur humain ne
// pourrait pas rouvrir proprement.

const MAX_CCTP_DESCRIPTION_CHARS = 20000;

function matchesNumero(node: any, numero: string): boolean {
  return String(node?.numero ?? '').trim().toLowerCase() === numero.trim().toLowerCase();
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Somme récursive d'une ligne et de ses éventuels enfants (voir treeOps.ts
 * côté frontend — dupliqué ici en miniature plutôt que partagé entre les
 * deux packages, même parti que le reste des helpers de cette famille). */
function sumLigneTotal(ligne: any): number {
  if (Array.isArray(ligne?.children) && ligne.children.length > 0) {
    return ligne.children.reduce((s: number, c: any) => s + sumLigneTotal(c), 0);
  }
  return Number(ligne?.prixTotal) || 0;
}

function recomputeDocumentTotals(doc: any): void {
  for (const lot of doc.lots || []) {
    lot.sousTotal = round2(
      (lot.chapitres || []).reduce(
        (s: number, c: any) => s + (c.lignes || []).reduce((ls: number, l: any) => ls + sumLigneTotal(l), 0),
        0,
      ),
    );
  }
  doc.totalHT = round2((doc.lots || []).reduce((s: number, l: any) => s + (Number(l.sousTotal) || 0), 0));
  const tva = Number(doc.TVA);
  doc.totalTTC = round2(doc.totalHT * (1 + (isFinite(tva) ? tva : 0) / 100));
}

function emptyDpgf(projectId: string): any {
  return {
    id: 'new',
    projectId,
    titre: 'DPGF',
    version: '1.0',
    dateCreation: new Date().toISOString(),
    statut: 'draft',
    lots: [],
    totalHT: 0,
    TVA: 20,
    totalTTC: 0,
  };
}

export function buildWriteProjectDocTools(): FunctionDeclarationLike[] {
  return [
    {
      name: 'write_dpgf_article',
      description:
        "Crée ou met à jour un article du CCTP/DPGF d'un projet — sa description technique (cctp_description), et/ou sa ligne chiffrée (unite/quantite/prix_unitaire). " +
        "Le lot et le chapitre sont créés automatiquement s'ils n'existent pas encore (donne alors leur titre). S'ils existent déjà, seul leur numero suffit pour les retrouver — inutile de redonner leur titre. " +
        "S'il n'existe encore aucun DPGF pour ce projet, l'outil en crée un vide puis y ajoute l'article : dis-le à l'utilisateur plutôt que de le laisser croire qu'un document existait déjà. " +
        "N'écris JAMAIS dans la ressource 'specifications' pour un CCTP — c'est un reliquat obsolète que l'application n'affiche plus comme tel. " +
        "Toujours relire le document avec read_cctp ou read_dpgf avant d'écrire, pour ne pas dupliquer un article déjà existant sous un autre numero.",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: "Identifiant du projet (visible dans la liste des projets du prompt système)" },
          lot: {
            type: 'object',
            description: 'Lot contenant le chapitre. Créé automatiquement si numero ne correspond à aucun lot existant.',
            properties: {
              numero: { type: 'string', description: 'Numéro du lot (ex: "1", "LOT 03")' },
              titre: { type: 'string', description: "Titre du lot — requis uniquement pour CRÉER un nouveau lot" },
            },
            required: ['numero'],
          },
          chapitre: {
            type: 'object',
            description: 'Chapitre du lot contenant l\'article. Créé automatiquement si numero ne correspond à aucun chapitre existant dans ce lot.',
            properties: {
              numero: { type: 'string', description: 'Numéro du chapitre' },
              titre: { type: 'string', description: "Titre du chapitre — requis uniquement pour CRÉER un nouveau chapitre" },
            },
            required: ['numero'],
          },
          article: {
            type: 'object',
            description: "L'article lui-même. designation est requis pour CRÉER un nouvel article ; pour mettre à jour un article existant (même numero), seuls les champs fournis changent.",
            properties: {
              numero: { type: 'string', description: "Numéro de l'article" },
              designation: { type: 'string', description: "Intitulé de l'article — requis à la création" },
              unite: { type: 'string', description: "Unité (m², ml, u, ens...)" },
              quantite: { type: 'number', description: 'Quantité chiffrée pour le DPGF' },
              prix_unitaire: { type: 'number', description: 'Prix unitaire HT pour le DPGF' },
              cctp_description: { type: 'string', description: "Texte technique de l'article pour le CCTP (prescriptions, matériaux, mise en œuvre...)" },
            },
            required: ['numero'],
          },
        },
        required: ['project_id', 'lot', 'chapitre', 'article'],
      },
    },
  ];
}

export const PROJECT_DOC_WRITE_TOOL_NAMES = ['write_dpgf_article'];

export async function executeWriteProjectDocTool(
  baseUrl: string,
  auth: InternalAuth,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (name !== 'write_dpgf_article') return { response: { error: `Outil d'écriture inconnu : ${name}.` } };

  const projectId = String(args.project_id || '').trim();
  if (!projectId) return { response: { error: 'project_id est requis.' } };

  const lotArg = (args.lot ?? {}) as Record<string, unknown>;
  const chapitreArg = (args.chapitre ?? {}) as Record<string, unknown>;
  const articleArg = (args.article ?? {}) as Record<string, unknown>;

  const lotNumero = String(lotArg.numero || '').trim();
  const chapitreNumero = String(chapitreArg.numero || '').trim();
  const articleNumero = String(articleArg.numero || '').trim();
  if (!lotNumero) return { response: { error: 'lot.numero est requis.' } };
  if (!chapitreNumero) return { response: { error: 'chapitre.numero est requis.' } };
  if (!articleNumero) return { response: { error: 'article.numero est requis.' } };

  const cctpDescription = articleArg.cctp_description != null ? String(articleArg.cctp_description) : undefined;
  if (cctpDescription && cctpDescription.length > MAX_CCTP_DESCRIPTION_CHARS) {
    return { response: { error: `cctp_description dépasse ${MAX_CCTP_DESCRIPTION_CHARS} caractères.` } };
  }

  const { status: getStatus, data: getData } = await getJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}/dpgf`, auth);
  let doc: any;
  let documentCreated = false;
  if (getStatus === 404) {
    doc = emptyDpgf(projectId);
    documentCreated = true;
  } else if (getStatus !== 200 || !getData) {
    return { response: { error: getData?.error || 'Lecture du DPGF impossible.' } };
  } else {
    doc = getData;
  }
  doc.lots = Array.isArray(doc.lots) ? doc.lots : [];

  let lot = doc.lots.find((l: any) => matchesNumero(l, lotNumero));
  let lotCreated = false;
  if (!lot) {
    const titre = lotArg.titre ? String(lotArg.titre) : '';
    if (!titre) return { response: { error: `Le lot "${lotNumero}" n'existe pas encore — fournis lot.titre pour le créer.` } };
    lot = { id: crypto.randomUUID(), numero: lotNumero, titre, chapitres: [], sousTotal: 0 };
    doc.lots.push(lot);
    lotCreated = true;
  }
  lot.chapitres = Array.isArray(lot.chapitres) ? lot.chapitres : [];

  let chapitre = lot.chapitres.find((c: any) => matchesNumero(c, chapitreNumero));
  let chapitreCreated = false;
  if (!chapitre) {
    const titre = chapitreArg.titre ? String(chapitreArg.titre) : '';
    if (!titre) return { response: { error: `Le chapitre "${chapitreNumero}" n'existe pas encore dans le lot "${lotNumero}" — fournis chapitre.titre pour le créer.` } };
    chapitre = { id: crypto.randomUUID(), numero: chapitreNumero, titre, lignes: [] };
    lot.chapitres.push(chapitre);
    chapitreCreated = true;
  }
  chapitre.lignes = Array.isArray(chapitre.lignes) ? chapitre.lignes : [];

  let ligne = chapitre.lignes.find((l: any) => matchesNumero(l, articleNumero));
  let articleCreated = false;
  if (!ligne) {
    const designation = articleArg.designation ? String(articleArg.designation) : '';
    if (!designation) return { response: { error: `L'article "${articleNumero}" n'existe pas encore — fournis article.designation pour le créer.` } };
    ligne = {
      id: crypto.randomUUID(),
      numero: articleNumero,
      designation,
      unite: '',
      quantite: 0,
      prixUnitaire: 0,
      prixTotal: 0,
      type: 'ouvrage',
    };
    chapitre.lignes.push(ligne);
    articleCreated = true;
  } else if (articleArg.designation) {
    ligne.designation = String(articleArg.designation);
  }
  if (articleArg.unite != null) ligne.unite = String(articleArg.unite);
  if (articleArg.quantite != null) ligne.quantite = Number(articleArg.quantite) || 0;
  if (articleArg.prix_unitaire != null) ligne.prixUnitaire = Number(articleArg.prix_unitaire) || 0;
  if (cctpDescription !== undefined) ligne.cctpDescription = cctpDescription;
  ligne.prixTotal = round2((Number(ligne.quantite) || 0) * (Number(ligne.prixUnitaire) || 0));

  recomputeDocumentTotals(doc);

  const { status: postStatus, data: postData } = await postJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}/dpgf`, auth, doc);
  if (postStatus !== 200 || !postData) {
    return { response: { error: postData?.error || "L'enregistrement du DPGF a échoué." } };
  }

  const actions = [
    documentCreated && 'DPGF créé',
    lotCreated && `lot "${lotNumero}" créé`,
    chapitreCreated && `chapitre "${chapitreNumero}" créé`,
    articleCreated ? `article "${articleNumero}" créé` : `article "${articleNumero}" mis à jour`,
  ].filter(Boolean).join(', ');

  return {
    response: {
      article: {
        numero: ligne.numero, designation: ligne.designation, unite: ligne.unite,
        quantite: ligne.quantite, prix_unitaire_ht: ligne.prixUnitaire, prix_total_ht: ligne.prixTotal,
        cctp_description: ligne.cctpDescription || undefined,
      },
      lot_sous_total_ht: lot.sousTotal,
      document_total_ht: doc.totalHT,
      actions,
    },
    summary: `Article "${articleNumero}" (${actions}) dans le lot "${lotNumero}" du projet.`,
  };
}
