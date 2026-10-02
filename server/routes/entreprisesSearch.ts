// ── Recherche d'entreprises du bâtiment ─────────────────────────────────────
// Interroge l'API publique « Recherche d'entreprises » (annuaire SIRENE, sans
// clé) pour trouver des entreprises à consulter, puis enrichit chaque résultat :
//   - de ses qualifications RGE connues (base ouverte ADEME, server/rgeLookup.ts) ;
//   - du libellé de son code NAF (référentiel du cabinet, ref_naf) ;
//   - d'un renvoi vers la fiche contact si elle y figure déjà.
//
// Pourquoi par le serveur plutôt que depuis le navigateur, comme l'autocomplétion
// de nom d'entreprise des fiches : le jeu de résultats est croisé avec d'autres
// sources, mis en cache, et la limite de débit de l'API publique est partagée
// par tous les cabinets derrière la même adresse.
//
// Ce n'est PAS une recherche dans le répertoire Qualibat, qui n'expose aucune
// API ouverte : « RGE uniquement » restreint aux entreprises déclarées RGE, ce
// qui ne couvre qu'une partie des qualifiées Qualibat.
import type { Express } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { fetchWithTimeout } from '../fetchWithTimeout';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { qualificationsRgeParSiret, type RgeQualification } from '../rgeLookup';
import { normaliserSiret } from '../../src/lib/qualifications';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const API = 'https://recherche-entreprises.api.gouv.fr/search';
const TIMEOUT_MS = 12_000;
const PAR_PAGE = 15;
const MAX_PAGE = 50;

const limiteur = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id || ipKeyGenerator(req.ip || ''),
  message: { error: 'Trop de recherches. Veuillez patienter une minute.' },
});

export interface ResultatEntreprise {
  siren: string;
  siret: string;
  nom: string;
  adresse: string;
  code_postal: string;
  commune: string;
  departement: string;
  naf: string;
  naf_libelle: string | null;
  effectif: string | null;
  date_creation: string | null;
  /** Déclarée RGE dans l'annuaire SIRENE (indicateur de l'API, indépendant de la base ADEME). */
  rge_declaree: boolean;
}

const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Lecture tolérante d'un résultat de l'API : tous les champs sont facultatifs côté source. */
export function parseResultats(json: any): { resultats: ResultatEntreprise[]; total: number; pages: number } {
  const brut: any[] = Array.isArray(json?.results) ? json.results : [];
  const resultats: ResultatEntreprise[] = [];
  for (const r of brut) {
    const siret = normaliserSiret(r?.siege?.siret);
    const siren = normaliserSiret(r?.siren);
    const nom = texte(r?.nom_complet) || texte(r?.nom_raison_sociale);
    if (!siren || !nom) continue;
    resultats.push({
      siren,
      siret,
      nom,
      adresse: texte(r?.siege?.adresse),
      code_postal: texte(r?.siege?.code_postal),
      commune: texte(r?.siege?.libelle_commune),
      departement: texte(r?.siege?.departement),
      naf: texte(r?.activite_principale),
      naf_libelle: null,
      effectif: texte(r?.tranche_effectif_salarie) || null,
      date_creation: texte(r?.date_creation) || null,
      rge_declaree: r?.complements?.est_rge === true,
    });
  }
  return {
    resultats,
    total: Number.isFinite(Number(json?.total_results)) ? Number(json.total_results) : resultats.length,
    pages: Number.isFinite(Number(json?.total_pages)) ? Number(json.total_pages) : 1,
  };
}

/** Paramètres vérifiés avant d'être transmis à l'API : rien de brut ne part en amont. */
export function construireRequete(query: Record<string, unknown>): { ok: true; url: string } | { ok: false; error: string } {
  const q = texte(query.q).slice(0, 120);
  if (q.length < 2) return { ok: false, error: 'Saisissez au moins deux caractères.' };

  const params = new URLSearchParams({ q, etat_administratif: 'A', per_page: String(PAR_PAGE) });

  const dep = texte(query.departement).toUpperCase();
  if (dep) {
    if (!/^(\d{2,3}|2[AB])$/.test(dep)) return { ok: false, error: 'Département invalide (ex. 54, 2A, 971).' };
    params.set('departement', dep);
  }
  if (query.batiment === '1' || query.batiment === 'true') params.set('section_activite_principale', 'F');
  if (query.rge === '1' || query.rge === 'true') params.set('est_rge', 'true');

  const page = Number.parseInt(String(query.page ?? '1'), 10);
  params.set('page', String(Number.isFinite(page) ? Math.min(Math.max(page, 1), MAX_PAGE) : 1));
  return { ok: true, url: `${API}?${params.toString()}` };
}

export function registerEntrepriseSearchRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/entreprises/search', limiteur, async (req: any, res: any) => {
    try {
      const requete = construireRequete(req.query);
      if (!requete.ok) return res.status(400).json({ error: requete.error });

      let reponse: Response;
      try {
        reponse = await fetchWithTimeout(requete.url, { headers: { Accept: 'application/json' } }, TIMEOUT_MS);
      } catch {
        return res.status(502).json({ error: "L'annuaire des entreprises est injoignable. Réessayez plus tard." });
      }
      if (reponse.status === 429) return res.status(429).json({ error: "L'annuaire des entreprises limite les requêtes. Réessayez dans un instant." });
      if (!reponse.ok) return res.status(502).json({ error: `L'annuaire des entreprises a répondu ${reponse.status}.` });
      const { resultats, total, pages } = parseResultats(await reponse.json().catch(() => null));

      const tenantId = await getTenantId(req.user.id);
      const sirets = resultats.map(r => r.siret).filter(Boolean);

      // Les trois enrichissements sont facultatifs : un échec de l'un laisse la
      // liste de résultats intacte, sans la valeur correspondante.
      const [rge, naf, contacts] = await Promise.all([
        qualificationsRgeParSiret(sirets).then(m => ({ ok: true as const, m })).catch(() => ({ ok: false as const, m: new Map<string, RgeQualification[]>() })),
        (async () => {
          const codes = [...new Set(resultats.map(r => r.naf).filter(Boolean))];
          if (codes.length === 0) return new Map<string, string>();
          const { data } = await supabaseAdmin.from('ref_naf').select('code, libelle').in('code', codes);
          return new Map<string, string>((data || []).map((n: any) => [n.code, n.libelle]));
        })().catch(() => new Map<string, string>()),
        (async () => {
          const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('id, siret');
          const parSiret = new Map<string, string>();
          for (const c of data || []) {
            const s = normaliserSiret((c as any).siret);
            if (s) parSiret.set(s, (c as any).id);
          }
          return parSiret;
        })().catch(() => new Map<string, string>()),
      ]);

      res.json({
        total,
        pages,
        rge_indisponible: !rge.ok,
        resultats: resultats.map(r => ({
          ...r,
          naf_libelle: naf.get(r.naf) ?? null,
          qualifications: r.siret ? (rge.m.get(r.siret) ?? null) : null,
          contact_id: r.siret ? (contacts.get(r.siret) ?? null) : null,
        })),
      });
    } catch (e: any) {
      console.error('[GET /api/entreprises/search]', e?.message);
      res.status(500).json({ error: 'La recherche a échoué.' });
    }
  });
}
