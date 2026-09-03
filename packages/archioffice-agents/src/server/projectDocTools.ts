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

const MAX_ARTICLE_CHARS = 1200;
const MAX_ARTICLES_PER_LOT = 60;
const MAX_LIGNES_PER_LOT = 120;

async function getJson(baseUrl: string, path: string, authHeader: string): Promise<{ status: number; data: any }> {
  try {
    const res = await fetch(baseUrl + path, { headers: { Authorization: authHeader } });
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

export function summarizeCctp(cctp: any, wantedLot?: string): Record<string, unknown> {
  const lots: any[] = Array.isArray(cctp?.lots) ? cctp.lots : [];
  const header = {
    titre: cctp?.titre ?? null,
    version: cctp?.version ?? null,
    statut: cctp?.statut ?? null,
    nb_lots: lots.length,
  };

  if (!wantedLot) {
    return {
      ...header,
      lots: lots.map(l => ({
        numero: l?.numero,
        titre: l?.titre,
        nb_chapitres: Array.isArray(l?.chapitres) ? l.chapitres.length : 0,
        nb_articles: (l?.chapitres || []).reduce((n: number, c: any) => n + (c?.articles?.length || 0), 0),
      })),
      note: "Sommaire uniquement. Rappelle read_cctp avec le paramètre lot pour obtenir le détail d'un lot précis.",
    };
  }

  const lot = lots.find(l => matchesLot(l, wantedLot));
  if (!lot) {
    return { ...header, error: `Aucun lot ne correspond à « ${wantedLot} ».`, lots_disponibles: lots.map(l => `${l?.numero} ${l?.titre}`) };
  }

  let remaining = MAX_ARTICLES_PER_LOT;
  const chapitres = (lot.chapitres || []).map((c: any) => ({
    numero: c?.numero,
    titre: c?.titre,
    articles: (c?.articles || []).slice(0, Math.max(remaining, 0)).map((a: any) => {
      remaining--;
      const text = [a?.description, a?.prescriptionsTechniques].filter(Boolean).join('\n');
      return {
        numero: a?.numero,
        designation: a?.designation,
        unite: a?.unite,
        normes: a?.normes || undefined,
        contenu: text.slice(0, MAX_ARTICLE_CHARS),
        tronque: text.length > MAX_ARTICLE_CHARS || undefined,
      };
    }),
  }));

  return { ...header, lot: { numero: lot.numero, titre: lot.titre, description: lot.description, chapitres } };
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
  ];
}

export async function executeProjectDocTool(
  baseUrl: string,
  authHeader: string,
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const projectId = String(args.project_id || '').trim();
  if (!projectId) return { response: { error: 'project_id est requis.' } };
  const lot = args.lot ? String(args.lot) : undefined;

  const kind = name === 'read_cctp' ? 'cctp' : 'dpgf';
  const { status, data } = await getJson(baseUrl, `/api/projects/${encodeURIComponent(projectId)}/${kind}`, authHeader);

  if (status === 404) {
    return {
      response: {
        error: `Aucun ${kind.toUpperCase()} n'existe encore pour ce projet — dis-le à l'utilisateur au lieu de supposer son contenu.`,
      },
    };
  }
  if (status !== 200 || !data) {
    return { response: { error: data?.error || `Lecture du ${kind.toUpperCase()} impossible.` } };
  }

  const summary = kind === 'cctp' ? summarizeCctp(data, lot) : summarizeDpgf(data, lot);
  return {
    response: summary,
    summary: `${kind.toUpperCase()} consulté${lot ? ` (lot ${lot})` : ''}`,
  };
}

export const PROJECT_DOC_TOOL_NAMES = ['read_cctp', 'read_dpgf'];
