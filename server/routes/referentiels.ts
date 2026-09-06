// ── Référentiels de la bibliothèque d'ouvrages ───────────────────────────────
// Trois nomenclatures publiques sur lesquelles un article se classe :
//   - EU SfB plus (août 2024)        : l'élément d'ouvrage, « (21/2) Mur »
//   - NF DTU, BNTEC/FFB (jan. 2026)  : la norme d'exécution qui s'y applique
//   - NAF rév. 2, INSEE              : l'activité de l'entreprise qui l'exécute
//
// Les tables `ref_*` sont globales et non multi-tenant (voir l'en-tête de
// supabase/migrate_bibliotheque_ouvrages.sql), donc pas de tenantScopedFrom
// ici : il n'y a pas de tenant_id à filtrer, et une nomenclature publique n'a
// rien de confidentiel entre cabinets.
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
}

// Ces tables ne changent qu'à la révision d'une norme, soit une fois par an au
// mieux. Les relire à chaque ouverture de la bibliothèque coûterait quatre
// requêtes pour un résultat identique, alors qu'elles tiennent en mémoire.
let cache: any = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

async function loadReferentiels(supabaseAdmin: any) {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

  const [sfb, corpsEtat, dtu, liens, naf] = await Promise.all([
    supabaseAdmin.from('ref_sfb_elements').select('*').order('position'),
    supabaseAdmin.from('ref_corps_etat').select('*').order('position'),
    supabaseAdmin.from('ref_dtu').select('*').order('numero'),
    supabaseAdmin.from('ref_dtu_corps_etat').select('*'),
    supabaseAdmin.from('ref_naf').select('*').order('code'),
  ]);
  for (const r of [sfb, corpsEtat, dtu, liens, naf]) {
    if (r.error) throw r.error;
  }

  // Le rattachement DTU / corps d'état est N-N : un même DTU relève parfois de
  // deux métiers (NF DTU 26.1, façades et enduits intérieurs). On le renvoie
  // replié dans les deux sens pour que le client filtre sans refaire la
  // jointure à chaque frappe.
  const dtuParCorpsEtat: Record<string, string[]> = {};
  const corpsEtatParDtu: Record<string, string[]> = {};
  for (const l of liens.data ?? []) {
    (dtuParCorpsEtat[l.corps_etat_code] ||= []).push(l.dtu_code);
    (corpsEtatParDtu[l.dtu_code] ||= []).push(l.corps_etat_code);
  }

  cache = {
    sfb: sfb.data ?? [],
    corpsEtat: corpsEtat.data ?? [],
    dtu: dtu.data ?? [],
    naf: naf.data ?? [],
    dtuParCorpsEtat,
    corpsEtatParDtu,
  };
  cachedAt = Date.now();
  return cache;
}

export function registerReferentielRoutes(app: Express, { supabaseAdmin }: RouteDeps) {
  // Un seul appel : les quatre nomenclatures pèsent ~120 Ko et la page les
  // veut toutes en même temps pour construire son arbre et ses filtres.
  app.get('/api/referentiels', async (_req: any, res: any) => {
    try {
      res.json(await loadReferentiels(supabaseAdmin));
    } catch (e: any) {
      console.error('[GET /api/referentiels]', e);
      res.status(500).json({ error: 'Failed to fetch referentiels' });
    }
  });
}
