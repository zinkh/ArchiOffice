// ── Remontée des prix vers la bibliothèque d'ouvrages ────────────────────────
// Un article inséré depuis la bibliothèque garde la trace de sa provenance
// (`articleTypeId` sur la ligne, cf. src/types/dpgf.ts). C'est ce fil qui rend
// la boucle possible : quand une entreprise renvoie un bordereau chiffré, on
// sait à quel article de la bibliothèque chaque prix se rapporte, et on peut
// l'y verser sans que personne ne resaisisse quoi que ce soit.
//
// Ce qu'on verse est une OBSERVATION, pas le prix courant de l'article. Le prix
// courant reste ce que le cabinet a décidé de mettre dans ses DPGF ; une offre
// isolée, même la mieux-disante, ne le redéfinit pas d'office.
import { tenantScopedFrom } from './tenantScopedFrom';

/** Une ligne d'arbre DPGF/BPU, réduite à ce dont la remontée a besoin. */
interface LigneArbre {
  id: string;
  unite?: string;
  articleTypeId?: string;
  children?: LigneArbre[];
}

interface DocumentArbre {
  lots?: { chapitres?: { lignes?: LigneArbre[] }[] }[];
}

/** Aplatit l'arbre lot > chapitre > article > sous-articles. */
export function aplatirLignes(document: DocumentArbre | null | undefined): LigneArbre[] {
  const out: LigneArbre[] = [];
  const descendre = (lignes: LigneArbre[] | undefined) => {
    for (const l of lignes ?? []) {
      out.push(l);
      descendre(l.children);
    }
  };
  for (const lot of document?.lots ?? []) {
    for (const chap of lot.chapitres ?? []) descendre(chap.lignes);
  }
  return out;
}

export interface ObservationAEcrire {
  article_id: string;
  prix_ht: number;
  unite: string | null;
  date_observation: string;
  origine: 'offre' | 'bpu' | 'marche' | 'saisie' | 'import';
  entreprise: string | null;
  project_id: string | null;
  source_ref: string;
  created_by: string | null;
}

/**
 * Écrit les observations en upsert sur `source_ref`. L'upsert n'est pas un
 * détail : une offre corrigée puis réimportée doit RECTIFIER le prix déjà
 * remonté, pas en ajouter un second — sinon la médiane d'un article finirait
 * par mesurer le nombre d'imports plutôt que le nombre d'entreprises.
 */
export async function ecrireObservations(
  supabaseAdmin: any,
  tenantId: string,
  observations: ObservationAEcrire[],
): Promise<number> {
  if (observations.length === 0) return 0;
  // tenantScopedFrom n'expose pas upsert ; on pose donc tenant_id nous-mêmes,
  // exactement comme son insert() le ferait.
  const rows = observations.map(o => ({ ...o, tenant_id: tenantId }));
  const { error } = await supabaseAdmin
    .from('article_prix_observations')
    .upsert(rows, { onConflict: 'tenant_id,source_ref' });
  if (error) throw error;
  return rows.length;
}

/**
 * Verse dans la bibliothèque les prix d'une offre reçue sur un BPU.
 *
 * Seules les lignes issues de la bibliothèque (`articleTypeId` renseigné) sont
 * concernées : pour les autres, il n'existe aucun article auquel rattacher le
 * prix. Un prix `null` est ignoré — dans une offre, `null` veut dire « non
 * chiffré » ou « pour mémoire », surtout pas zéro, qui est un prix.
 *
 * Renvoie le nombre d'observations écrites, pour que l'appelant puisse le dire
 * à l'utilisateur sans refaire le calcul.
 */
export async function remonterPrixOffre(
  supabaseAdmin: any,
  tenantId: string,
  opts: {
    projectId: string;
    document: DocumentArbre | null | undefined;
    offre: any;
    userId?: string;
  },
): Promise<number> {
  const { projectId, document, offre, userId } = opts;
  if (!offre?.id || !offre?.prix || typeof offre.prix !== 'object') return 0;
  // Une offre écartée ne doit pas peser sur les statistiques du cabinet.
  if (offre.statut === 'ecartee') return 0;

  const lignes = aplatirLignes(document);
  const dateObs = (offre.dateReception || offre.importedAt || new Date().toISOString()).slice(0, 10);

  // Les articles de la bibliothèque existants, pour ne pas tenter d'écrire une
  // observation sur un article supprimé depuis l'insertion (la clé étrangère
  // ferait échouer tout le lot à cause d'une seule ligne périmée).
  const ids = [...new Set(lignes.map(l => l.articleTypeId).filter(Boolean))] as string[];
  if (ids.length === 0) return 0;
  const { data: existants, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
    .select('id').in('id', ids);
  if (error) throw error;
  const connus = new Set((existants ?? []).map((a: any) => a.id));

  const observations: ObservationAEcrire[] = [];
  const vus = new Set<string>();
  for (const ligne of lignes) {
    if (!ligne.articleTypeId || !connus.has(ligne.articleTypeId)) continue;
    const prix = offre.prix[ligne.id];
    if (prix === null || prix === undefined) continue;
    const valeur = Number(prix);
    if (!Number.isFinite(valeur) || valeur <= 0) continue;

    // Deux lignes du bordereau peuvent pointer le même article de la
    // bibliothèque ; la clé de source les distingue par ligne, donc les deux
    // prix remontent — ce sont bien deux observations de la même entreprise
    // sur deux emplois de l'article. Le garde-fou ici ne sert qu'à ne pas
    // écrire deux fois la MÊME clé dans un seul lot, ce que l'upsert refuse.
    const sourceRef = `bpu:${offre.id}:${ligne.id}`;
    if (vus.has(sourceRef)) continue;
    vus.add(sourceRef);

    observations.push({
      article_id: ligne.articleTypeId,
      prix_ht: valeur,
      unite: ligne.unite ?? null,
      date_observation: dateObs,
      origine: 'offre',
      entreprise: offre.entrepriseNom ?? null,
      project_id: projectId,
      source_ref: sourceRef,
      created_by: userId ?? null,
    });
  }

  return ecrireObservations(supabaseAdmin, tenantId, observations);
}
